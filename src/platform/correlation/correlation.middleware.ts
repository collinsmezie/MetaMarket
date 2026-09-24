import type { NextFunction, Request, Response } from 'express';
import { newCorrelationId, newRequestId, RequestContextStore } from './request-context';

const CORRELATION_HEADER = 'x-correlation-id';
const REQUEST_HEADER = 'x-request-id';

/**
 * Establishes the root correlation context for every inbound HTTP request (Overarching §25).
 *
 * A caller may supply `x-correlation-id` to stitch its own trace to ours; otherwise one is
 * minted. Both ids are echoed on the response so a live-test operator can look the run up
 * without parsing logs.
 */
export function correlationMiddleware(request: Request, response: Response, next: NextFunction): void {
  const supplied = request.header(CORRELATION_HEADER);
  const correlationId =
    supplied !== undefined && supplied.trim().length > 0 && supplied.length <= 128
      ? supplied.trim()
      : newCorrelationId();
  const requestId = newRequestId();

  response.setHeader(CORRELATION_HEADER, correlationId);
  response.setHeader(REQUEST_HEADER, requestId);

  RequestContextStore.root({ correlationId, requestId, component: 'HTTP' }, () => next());
}
