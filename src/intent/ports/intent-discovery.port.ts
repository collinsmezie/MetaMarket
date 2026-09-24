import type { IDCEServiceRequest, IDCEServiceResponse } from '../domain/idce-resolution';

export const INTENT_DISCOVERY = Symbol('IntentDiscovery');

/**
 * IDCE inbound port (IDCE TDR v1.6 §29, §22).
 *
 * The service-level envelope is the only thing that crosses this boundary. A provider or schema
 * failure is an `ERROR` envelope with a typed error — never a fabricated `UNKNOWN_INTENT` (§29A,
 * §31 rule 8).
 */
export interface IntentDiscoveryPort {
  discover(request: IDCEServiceRequest): Promise<IDCEServiceResponse>;
}
