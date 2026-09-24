import type { ComponentName } from '../registry/component-registry';
import { componentVersion } from '../registry/component-registry';
import { RequestContextStore, newRequestId } from '../correlation/request-context';

/**
 * Orchestration-side envelopes for specialist calls (MCOS §63.2, §65.2).
 *
 * The envelope is MCOS's correlation contract, not the specialist's business schema: a typed
 * adapter maps `input`/`output` to and from the specialist's canonical wire request/response.
 * The envelope is never passed verbatim to a specialist whose schema does not define these
 * fields (CSRE §31.2).
 */

export type SpecialistStatus = 'SUCCESS' | 'PARTIAL' | 'BLOCKED' | 'ERROR';

export interface SpecialistError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface SpecialistRequestEnvelope<T> {
  readonly schemaVersion: string;
  readonly requestId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly runId: string;
  readonly component: ComponentName;
  readonly componentVersion: string;
  readonly contextSnapshotId: string;
  readonly input: T;
}

export interface SpecialistResponseEnvelope<T> {
  readonly schemaVersion: string;
  readonly requestId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly runId: string;
  readonly component: ComponentName;
  readonly componentVersion: string;
  readonly status: SpecialistStatus;
  readonly output: T | null;
  readonly error: SpecialistError | null;
}

export interface EnvelopeIdentity {
  readonly conversationId: string;
  readonly turnId: string;
  readonly runId: string;
  readonly contextSnapshotId: string;
}

/**
 * Builds a request envelope from the active correlation context. The `requestId` is minted
 * fresh per specialist invocation (Overarching §25) unless the caller supplies one for a retry,
 * in which case it MUST be reused (CSRE §29.3 rule 3).
 */
export function specialistRequest<T>(
  component: ComponentName,
  schemaVersion: string,
  identity: EnvelopeIdentity,
  input: T,
  requestId?: string,
): SpecialistRequestEnvelope<T> {
  return {
    schemaVersion,
    requestId: requestId ?? RequestContextStore.current()?.requestId ?? newRequestId(),
    conversationId: identity.conversationId,
    turnId: identity.turnId,
    runId: identity.runId,
    component,
    componentVersion: componentVersion(component),
    contextSnapshotId: identity.contextSnapshotId,
    input,
  };
}

export function specialistSuccess<TIn, TOut>(
  request: SpecialistRequestEnvelope<TIn>,
  output: TOut,
  status: Exclude<SpecialistStatus, 'ERROR'> = 'SUCCESS',
): SpecialistResponseEnvelope<TOut> {
  return {
    schemaVersion: request.schemaVersion,
    requestId: request.requestId,
    conversationId: request.conversationId,
    turnId: request.turnId,
    runId: request.runId,
    component: request.component,
    componentVersion: request.componentVersion,
    status,
    output,
    error: null,
  };
}

export function specialistFailure<TIn, TOut>(
  request: SpecialistRequestEnvelope<TIn>,
  error: SpecialistError,
  status: 'ERROR' | 'BLOCKED' = 'ERROR',
): SpecialistResponseEnvelope<TOut> {
  return {
    schemaVersion: request.schemaVersion,
    requestId: request.requestId,
    conversationId: request.conversationId,
    turnId: request.turnId,
    runId: request.runId,
    component: request.component,
    componentVersion: request.componentVersion,
    status,
    output: null,
    error,
  };
}
