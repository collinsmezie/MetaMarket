/**
 * BullMQ queue configuration for asynchronous media work (MCOS §20).
 */

export const MEDIA_QUEUE_NAME = 'media-processing';

/**
 * Retry policy for media jobs.
 *
 * Three attempts with exponential backoff matches the external-API retry rule
 * (Execution.md §2.5). Meta's media URLs are short-lived, so waiting minutes between
 * attempts would guarantee failure; the backoff is deliberately tight.
 */
export const MEDIA_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1_000 },
  // Keep a bounded history so a stuck media pipeline is diagnosable without unbounded growth.
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1_000 },
};
