import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  MEDIA_BATCH_TRACKER,
  MediaProcessingError,
  type MediaBatchTrackerPort,
  type MediaProcessingJob,
} from '../../../domain/ports/outbound/media.port';
import {
  MESSAGE_REPOSITORY,
  type MessageRepositoryPort,
} from '../../../domain/ports/outbound/message-repository.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../../domain/ports/outbound/stage-logger.port';
import { MediaProcessingService } from '../../../application/media/media-processing.service';
import { MessageIngestionService } from '../../../application/pipeline/message-ingestion.service';
import { MEDIA_QUEUE_NAME } from './media-queue.constants';

const COMPONENT = 'MCOS';
const STAGE = 'MediaProcessingWorker';

/**
 * Worker that runs media jobs off the webhook path (MCOS §20).
 *
 * When the last outstanding job for a message completes, it resumes the parked conversation
 * turn — which is how a voice note produces a reply without ever blocking Meta's webhook.
 */
@Processor(MEDIA_QUEUE_NAME)
export class MediaProcessingProcessor extends WorkerHost {
  constructor(
    private readonly media: MediaProcessingService,
    private readonly ingestion: MessageIngestionService,
    @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
    @Inject(MEDIA_BATCH_TRACKER) private readonly batches: MediaBatchTrackerPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
  ) {
    super();
  }

  async process(job: Job<MediaProcessingJob>): Promise<void> {
    const payload = job.data;

    try {
      const artifacts = await this.media.process(payload);
      await this.messages.appendArtifacts(payload.messageId, artifacts);
    } catch (error) {
      const retryable = error instanceof MediaProcessingError ? error.retryable : true;
      const attemptsMade = job.attemptsMade + 1;
      const attemptsAllowed = job.opts.attempts ?? 1;
      const willRetry = retryable && attemptsMade < attemptsAllowed;

      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { messageId: payload.messageId, mediaId: payload.part.mediaId, attempt: attemptsMade },
        action: willRetry
          ? 'Media job failed; BullMQ will retry with backoff'
          : 'Media job failed permanently; the turn will continue with whatever artifacts exist',
        error,
      });

      if (willRetry) throw error;

      // Out of retries. Continuing with partial artifacts is better than leaving the user
      // with no reply at all — the pipeline degrades to the fallback envelope if the message
      // turns out to carry no readable content.
      await this.resumeIfComplete(payload);
      return;
    }

    await this.resumeIfComplete(payload);
  }

  /**
   * Resumes the conversation turn once every media part of the message has settled.
   *
   * The tracker is atomic across workers, so exactly one caller proceeds even when two parts
   * of the same message finish simultaneously on different pods.
   */
  private async resumeIfComplete(payload: MediaProcessingJob): Promise<void> {
    const isLast = await this.batches.markSettled(
      payload.messageId,
      payload.partIndex,
      payload.totalMediaParts,
    );

    if (!isLast) return;

    try {
      const result = await this.ingestion.resumeAfterMedia(payload.messageId);

      await this.batches.clear(payload.messageId);

      if (result !== null) {
        this.logger.stage({
          component: COMPONENT,
          stage: STAGE,
          input: { messageId: payload.messageId },
          action: 'All media for the message is processed; resumed the parked conversation turn',
          output: { workflowId: result.workflowId, responded: result.response !== null },
        });
      }
    } catch (error) {
      // A failure here must not mark the media job failed and trigger another transcription.
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { messageId: payload.messageId },
        action: 'Media processed successfully but resuming the conversation turn failed',
        error,
      });
    }
  }
}
