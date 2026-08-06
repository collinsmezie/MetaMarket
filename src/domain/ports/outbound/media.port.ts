import type { Artifact } from '../../models/artifact';
import type { Channel } from '../../models/channel';
import type { MediaPart } from '../../models/incoming-message';

/**
 * Media handling contracts (MCOS §5.2, §18, §20).
 *
 * Downloading, transcribing and OCR'ing are slow and failure-prone, so they sit behind
 * ports and execute asynchronously off the webhook path.
 */

export const MEDIA_STORE = Symbol('MediaStore');
export const MEDIA_DOWNLOADER = Symbol('MediaDownloader');
export const SPEECH_TO_TEXT = Symbol('SpeechToText');
export const OCR = Symbol('Ocr');
export const MEDIA_PROCESSING_QUEUE = Symbol('MediaProcessingQueue');

export interface StoredMedia {
  readonly storageKey: string;
  readonly mimeType: string;
  readonly byteSize: number;
}

export interface DownloadedMedia {
  readonly bytes: Buffer;
  readonly mimeType: string;
  readonly filename?: string;
}

/** Object storage for inbound media (MCOS §18 "Object Storage"). */
export interface MediaStorePort {
  put(params: { key: string; bytes: Buffer; mimeType: string }): Promise<StoredMedia>;

  get(storageKey: string): Promise<DownloadedMedia>;

  /** Time-limited URL, used when an outbound message must reference stored media. */
  presignedUrl(storageKey: string, expiresInSeconds: number): Promise<string>;
}

/**
 * Fetches media bytes from the originating channel.
 *
 * Provider-specific: Meta requires a two-step id → URL → bytes exchange with an auth
 * header, which is exactly the kind of detail that must not leak inward.
 */
export interface MediaDownloaderPort {
  readonly channel: Channel;
  download(mediaId: string): Promise<DownloadedMedia>;
}

export interface TranscriptionResult {
  readonly text: string;
  /**
   * Confidence in [0,1].
   *
   * Whisper does not return a calibrated score, so adapters derive one from available
   * signals (e.g. average logprob / no-speech probability) and must document the mapping
   * rather than hardcoding an optimistic constant.
   */
  readonly confidence: number;
  readonly language?: string;
  readonly durationSeconds?: number;
}

export interface SpeechToTextPort {
  transcribe(media: DownloadedMedia): Promise<TranscriptionResult>;
}

export interface OcrResult {
  readonly text: string;
  readonly confidence: number;
}

export interface OcrPort {
  extractText(media: DownloadedMedia): Promise<OcrResult>;
}

/** One unit of asynchronous media work, enqueued per media part. */
export interface MediaProcessingJob {
  readonly messageId: string;
  readonly conversationId: string;
  readonly channel: Channel;
  readonly partIndex: number;
  readonly part: MediaPart;
  /**
   * How many media parts the message carries in total.
   *
   * Carried on the job so a worker can tell whether it settled the *last* outstanding part
   * and may resume the conversation turn. Without it, a message containing two voice notes
   * would resume after the first one finished and answer on half the input.
   */
  readonly totalMediaParts: number;
}

export interface MediaProcessingQueuePort {
  enqueue(job: MediaProcessingJob): Promise<void>;
}

export const MEDIA_BATCH_TRACKER = Symbol('MediaBatchTracker');

/**
 * Tracks which media parts of a message have settled — succeeded or permanently failed.
 *
 * Must be atomic across workers: several parts of one message can settle simultaneously on
 * different pods, and exactly one of them may resume the turn.
 */
export interface MediaBatchTrackerPort {
  /**
   * Records a part as settled and reports whether it was the last one outstanding.
   * Returns true for exactly one caller per message.
   */
  markSettled(messageId: string, partIndex: number, totalParts: number): Promise<boolean>;

  /** Clears tracking state once the turn has resumed. */
  clear(messageId: string): Promise<void>;
}

/** Turns raw media parts into artifacts the understanding stages can read. */
export interface MediaProcessorPort {
  process(job: MediaProcessingJob): Promise<readonly Artifact[]>;
}

export class MediaProcessingError extends Error {
  constructor(
    message: string,
    readonly mediaId: string,
    readonly retryable: boolean,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MediaProcessingError';
  }
}
