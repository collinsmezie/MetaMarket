import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import type { Artifact } from '../../domain/models/artifact';
import type { IncomingMessage, MediaPart, MessagePart } from '../../domain/models/incoming-message';
import { isMediaPart } from '../../domain/models/incoming-message';
import {
  MEDIA_STORE,
  MediaProcessingError,
  OCR,
  SPEECH_TO_TEXT,
  type MediaDownloaderPort,
  type MediaProcessingJob,
  type MediaStorePort,
  type OcrPort,
  type SpeechToTextPort,
} from '../../domain/ports/outbound/media.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { MEDIA_DOWNLOADER_REGISTRY, type MediaDownloaderRegistry } from './media-downloader.registry';

const COMPONENT = 'MCOS';
const STAGE = 'MediaProcessingService';

/**
 * Converts raw media into structured artifacts (MCOS §5.2).
 *
 * After this stage every downstream component works with text, which is what makes a voice
 * note and a typed message genuinely interchangeable (MCOS Stage 2).
 */
@Injectable()
export class MediaProcessingService {
  constructor(
    @Inject(MEDIA_DOWNLOADER_REGISTRY) private readonly downloaders: MediaDownloaderRegistry,
    @Inject(MEDIA_STORE) private readonly store: MediaStorePort,
    @Inject(SPEECH_TO_TEXT) private readonly stt: SpeechToTextPort,
    @Inject(OCR) private readonly ocr: OcrPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Artifacts derivable from a message without any I/O.
   *
   * Text, locations, contacts and interactive replies are already structured, so a
   * text-only message never touches the queue.
   */
  extractInlineArtifacts(message: IncomingMessage): readonly Artifact[] {
    return message.parts.flatMap((part, index) => this.inlineArtifactFor(part, index));
  }

  private inlineArtifactFor(part: MessagePart, index: number): readonly Artifact[] {
    switch (part.type) {
      case 'text':
        // The user typed it, so there is no extraction uncertainty.
        return [
          { type: 'text', content: part.text, source: 'user_text', confidence: 1, originPartIndex: index },
        ];

      case 'button_reply':
      case 'list_selection':
        return [
          {
            type: 'text',
            content: part.title,
            source: 'interactive_reply',
            confidence: 1,
            originPartIndex: index,
          },
        ];

      case 'location':
        return [
          {
            type: 'location',
            latitude: part.latitude,
            longitude: part.longitude,
            source: 'location_parse',
            confidence: 1,
            originPartIndex: index,
            ...(part.name !== undefined ? { label: part.name } : {}),
          },
        ];

      case 'contact':
        return [
          {
            type: 'contact',
            name: part.name,
            phones: part.phones,
            source: 'user_text',
            confidence: 1,
            originPartIndex: index,
          },
        ];

      default:
        // Media parts need asynchronous work; handled by `process`.
        return [];
    }
  }

  /** Media parts requiring asynchronous processing, paired with their index. */
  mediaJobsFor(message: IncomingMessage): readonly MediaProcessingJob[] {
    const mediaIndices = message.parts.flatMap((part, index) => (isMediaPart(part) ? [index] : []));

    return mediaIndices.map((index) => ({
      messageId: message.id,
      conversationId: message.conversationId,
      channel: message.channel,
      partIndex: index,
      part: message.parts[index] as MediaPart,
      // Lets a worker recognise when it settled the final part and may resume the turn.
      totalMediaParts: mediaIndices.length,
    }));
  }

  /**
   * Runs one media job: download, persist, then transcribe or read.
   *
   * Errors propagate so the queue can apply its retry policy — swallowing them here would
   * leave the user waiting for a reply that never comes.
   */
  async process(job: MediaProcessingJob): Promise<readonly Artifact[]> {
    const startedAt = Date.now();

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { type: job.part.type, mediaId: job.part.mediaId, channel: job.channel },
      action: 'Downloading media from the originating channel',
      output: { queued: true },
    });

    const downloader = this.downloaders.forChannel(job.channel);
    const media = await downloader.download(job.part.mediaId);

    const stored = await this.persist(job, media, downloader);
    const artifacts: Artifact[] = [];

    if (stored !== null) {
      artifacts.push({
        type: 'media_reference',
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        byteSize: stored.byteSize,
        source: 'user_text',
        confidence: 1,
        originPartIndex: job.partIndex,
      });
    }

    const extracted = await this.extract(job, media);
    artifacts.push(...extracted);

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { type: job.part.type, mediaId: job.part.mediaId, channel: job.channel },
      action: this.describeExtraction(job.part),
      output: {
        artifacts: artifacts.map((artifact) =>
          artifact.type === 'text'
            ? { type: artifact.type, text: artifact.content, confidence: artifact.confidence }
            : { type: artifact.type, confidence: artifact.confidence },
        ),
      },
      durationMs: Date.now() - startedAt,
    });

    return artifacts;
  }

  /**
   * Stores the original bytes.
   *
   * Best-effort: losing the archive copy must not cost the user their transcription, so a
   * storage outage is logged and processing continues.
   */
  private async persist(
    job: MediaProcessingJob,
    media: { bytes: Buffer; mimeType: string },
    _downloader: MediaDownloaderPort,
  ): Promise<{ storageKey: string; mimeType: string; byteSize: number } | null> {
    const key = `${job.conversationId}/${job.part.mediaId}`;

    try {
      return await this.store.put({ key, bytes: media.bytes, mimeType: media.mimeType });
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Store`,
        input: { key, bytes: media.bytes.byteLength },
        action: 'Could not archive media to object storage; continuing with extraction',
        error,
      });
      return null;
    }
  }

  private async extract(
    job: MediaProcessingJob,
    media: { bytes: Buffer; mimeType: string },
  ): Promise<readonly Artifact[]> {
    const withFilename = { ...media, filename: job.part.filename };

    switch (job.part.type) {
      case 'audio': {
        const result = await this.stt.transcribe(withFilename);

        if (result.text.length === 0) {
          return [];
        }

        // Below the floor the transcription is more likely to mislead than help, so it is
        // kept but marked, letting the workflow decide to confirm rather than act.
        if (result.confidence < this.config.speechToText.minConfidence) {
          this.logger.stage({
            component: COMPONENT,
            stage: `${STAGE}:SpeechToText`,
            input: { mediaId: job.part.mediaId },
            action: `Transcription confidence ${result.confidence.toFixed(2)} is below the ${this.config.speechToText.minConfidence} floor; flagged as low confidence`,
            output: { text: result.text, confidence: result.confidence },
          });
        }

        return [
          {
            type: 'text',
            content: result.text,
            source: 'speech_to_text',
            confidence: result.confidence,
            originPartIndex: job.partIndex,
            ...(result.language !== undefined ? { language: result.language } : {}),
          },
        ];
      }

      case 'image': {
        const result = await this.ocr.extractText(withFilename);
        if (result.text.length === 0) return [];

        return [
          {
            type: 'text',
            content: result.text,
            source: 'ocr',
            confidence: result.confidence,
            originPartIndex: job.partIndex,
          },
        ];
      }

      case 'document':
      case 'video':
        // Document parsing and video analysis are declared capabilities of this service
        // (MCOS §5.2) but are not implemented in Phase 1. The caption, when present, is the
        // only text genuinely available — inventing content would be worse than none.
        return job.part.caption !== undefined && job.part.caption.length > 0
          ? [
              {
                type: 'text',
                content: job.part.caption,
                source: 'user_text',
                confidence: 1,
                originPartIndex: job.partIndex,
              },
            ]
          : [];

      default: {
        const exhaustive: never = job.part.type;
        throw new MediaProcessingError(
          `Unsupported media part type "${String(exhaustive)}"`,
          job.part.mediaId,
          false,
        );
      }
    }
  }

  private describeExtraction(part: MediaPart): string {
    switch (part.type) {
      case 'audio':
        return 'Executing Speech-To-Text via Whisper API';
      case 'image':
        return 'Extracting text from the image via vision model';
      case 'document':
        return 'Document parsing is not implemented in this phase; using the caption if present';
      case 'video':
        return 'Video analysis is not implemented in this phase; using the caption if present';
    }
  }
}
