import { Injectable } from '@nestjs/common';
import OpenAI, { toFile } from 'openai';
import { AppConfigService } from '../../../config/app-config.service';
import type {
  DownloadedMedia,
  SpeechToTextPort,
  TranscriptionResult,
} from '../../../domain/ports/outbound/media.port';
import { MediaProcessingError } from '../../../domain/ports/outbound/media.port';

/**
 * Whisper transcription for voice notes (MCOS §5.2, Stage 2).
 *
 * Voice is the primary input mode for many traders, so transcription quality directly
 * determines whether the platform understands them at all.
 */
@Injectable()
export class WhisperSpeechToTextAdapter implements SpeechToTextPort {
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor(config: AppConfigService) {
    const { apiKey } = config.openai;
    this.model = config.speechToText.model;
    this.client = apiKey === undefined ? null : new OpenAI({ apiKey });
  }

  async transcribe(media: DownloadedMedia): Promise<TranscriptionResult> {
    if (this.client === null) {
      throw new MediaProcessingError(
        'OPENAI_API_KEY is not configured, so voice notes cannot be transcribed.',
        'unknown',
        false,
      );
    }

    try {
      const file = await toFile(media.bytes, media.filename ?? 'audio.ogg', {
        type: media.mimeType,
      });

      const transcription = await this.client.audio.transcriptions.create({
        file,
        model: this.model,
        // Verbose JSON exposes the per-segment statistics needed to derive a confidence.
        response_format: 'verbose_json',
      });

      // `verbose_json` returns segments, language and duration, but the SDK's union type is
      // the narrower plain-text shape; narrow it explicitly rather than casting the result.
      const verbose = transcription as unknown as {
        text: string;
        language?: string;
        duration?: number;
        segments?: { avg_logprob: number; no_speech_prob: number }[];
      };

      return {
        text: verbose.text.trim(),
        confidence: this.deriveConfidence(verbose),
        ...(verbose.language !== undefined ? { language: verbose.language } : {}),
        ...(verbose.duration !== undefined ? { durationSeconds: verbose.duration } : {}),
      };
    } catch (error) {
      if (error instanceof MediaProcessingError) throw error;

      const retryable =
        !(error instanceof OpenAI.APIError) || (error.status ?? 500) >= 500 || error.status === 429;
      const message = error instanceof Error ? error.message : String(error);

      throw new MediaProcessingError(`Transcription failed: ${message}`, 'unknown', retryable, error);
    }
  }

  /**
   * Derives a [0,1] confidence from Whisper's segment statistics.
   *
   * Whisper returns no calibrated confidence. Two segment-level signals are available:
   * `avg_logprob` (mean token log-probability, typically −1.0 … 0) and `no_speech_prob`.
   * Mapping avg_logprob onto [0,1] and discounting by the chance the audio was not speech
   * gives a usable ordering — good enough to decide "act on this" versus "confirm first",
   * which is all the pipeline asks of it. It is an ordering, not a probability.
   */
  private deriveConfidence(transcription: {
    segments?: { avg_logprob: number; no_speech_prob: number }[];
    text: string;
  }): number {
    const segments = transcription.segments;

    if (segments === undefined || segments.length === 0) {
      // Without segment data there is no evidence either way; a mid-range value keeps the
      // result usable while flagging that it was not measured.
      return transcription.text.trim().length > 0 ? 0.7 : 0;
    }

    const meanLogprob = segments.reduce((total, segment) => total + segment.avg_logprob, 0) / segments.length;
    const meanNoSpeech =
      segments.reduce((total, segment) => total + segment.no_speech_prob, 0) / segments.length;

    // −1.0 and worse → 0; 0 → 1. Clamped because avg_logprob has no hard lower bound.
    const clarity = Math.max(0, Math.min(1, 1 + meanLogprob));

    return Math.max(0, Math.min(1, clarity * (1 - meanNoSpeech)));
  }
}
