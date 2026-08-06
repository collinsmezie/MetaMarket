import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { MediaProcessingJob, MediaProcessingQueuePort } from '../../../domain/ports/outbound/media.port';
import { MEDIA_JOB_OPTIONS, MEDIA_QUEUE_NAME } from './media-queue.constants';

@Injectable()
export class BullMediaQueue implements MediaProcessingQueuePort {
  constructor(@InjectQueue(MEDIA_QUEUE_NAME) private readonly queue: Queue<MediaProcessingJob>) {}

  async enqueue(job: MediaProcessingJob): Promise<void> {
    await this.queue.add(`${job.part.type}:${job.part.mediaId}`, job, {
      ...MEDIA_JOB_OPTIONS,
      // Deterministic job id: a duplicated webhook that slips past message-level
      // deduplication still cannot transcribe the same media twice.
      jobId: `${job.messageId}:${job.partIndex}`,
    });
  }
}
