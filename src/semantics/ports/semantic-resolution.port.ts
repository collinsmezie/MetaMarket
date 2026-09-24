import type { CSREServiceRequest, CSREServiceResponse } from '../domain/csre-resolution';

export const SEMANTIC_RESOLUTION = Symbol('SemanticResolution');

/**
 * CSRE inbound port (Overarching §7.1 `ResolveCommercialSemantics`; CSRE §29, §31).
 *
 * Only the canonical service request/response crosses this boundary. A provider, schema or
 * policy failure is an `ERROR` response with a typed error — never a fabricated object (§20
 * rule 1, §31.3).
 */
export interface SemanticResolutionPort {
  resolve(request: CSREServiceRequest): Promise<CSREServiceResponse>;
}
