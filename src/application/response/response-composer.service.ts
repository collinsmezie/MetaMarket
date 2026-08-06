import { Inject, Injectable } from '@nestjs/common';
import type { Action, Media, Response } from '../../domain/models/response';
import { fallbackWithReason } from '../../domain/models/response';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';

const COMPONENT = 'MCOS';
const STAGE = 'ResponseComposer';

/**
 * Produces channel-independent responses (MCOS §5.10).
 *
 * A single turn can emit several responses — a confirmation followed by a question — and
 * users experience a stream of separate messages as noise. Merging them into one coherent
 * reply is the composer's main job.
 */
@Injectable()
export class ResponseComposer {
  constructor(@Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort) {}

  /**
   * Merges the responses a turn produced into one.
   *
   * Returns the fallback envelope when a turn produced nothing at all, because silence
   * looks identical to a broken bot from the user's side (Execution.md §2.5).
   */
  compose(responses: readonly Response[], context: { workflowId: string | null }): Response {
    const meaningful = responses.filter(
      (response) =>
        (response.text !== undefined && response.text.trim().length > 0) ||
        (response.media !== undefined && response.media.length > 0) ||
        (response.actions !== undefined && response.actions.length > 0),
    );

    if (meaningful.length === 0) {
      const fallback = fallbackWithReason('no_response_produced');

      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { responseCount: responses.length, workflowId: context.workflowId },
        action: 'Turn produced no user-facing output; emitting the fallback envelope',
        error: new Error('Workflow execution completed without composing a response'),
      });

      return fallback;
    }

    const composed = meaningful.length === 1 ? meaningful[0] : this.merge(meaningful);

    const withMetadata: Response = {
      ...composed,
      metadata: {
        ...composed.metadata,
        ...(context.workflowId !== null ? { workflowId: context.workflowId } : {}),
      },
    };

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { responseCount: responses.length, workflowId: context.workflowId },
      action:
        meaningful.length === 1
          ? 'Composed a single canonical response'
          : `Merged ${meaningful.length} responses into one reply`,
      output: {
        textLength: withMetadata.text?.length ?? 0,
        actions: withMetadata.actions?.length ?? 0,
        media: withMetadata.media?.length ?? 0,
      },
    });

    return withMetadata;
  }

  private merge(responses: readonly Response[]): Response {
    const text = responses
      .map((response) => response.text?.trim())
      .filter((value): value is string => value !== undefined && value.length > 0)
      .join('\n\n');

    const media: Media[] = responses.flatMap((response) => [...(response.media ?? [])]);

    // Later actions win on payload collision: the most recent state's affordances are the
    // ones that still make sense to tap.
    const actionsByPayload = new Map<string, Action>();
    for (const response of responses) {
      for (const action of response.actions ?? []) actionsByPayload.set(action.payload, action);
    }

    const metadata = responses.reduce<Record<string, unknown>>(
      (accumulated, response) => ({ ...accumulated, ...response.metadata }),
      {},
    );

    return {
      ...(text.length > 0 ? { text } : {}),
      ...(media.length > 0 ? { media } : {}),
      ...(actionsByPayload.size > 0 ? { actions: [...actionsByPayload.values()] } : {}),
      metadata,
    };
  }
}
