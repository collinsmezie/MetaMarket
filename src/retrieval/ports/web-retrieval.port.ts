import type { WrsServiceRequest, WrsServiceResponse } from '../domain/wrs-evidence';

export const WEB_RETRIEVAL = Symbol('WebRetrieval');

/**
 * WRS inbound port (Overarching §24.1 `POST /v1/wrs/retrieve`; WRS TDR §18, §20).
 *
 * Returns the stable evidence envelope. `NO_RELIABLE_EVIDENCE` is a valid, schema-valid result;
 * a provider outage or model failure is a service-level `ERROR` with a machine-readable code
 * (§20.6) — never a fabricated fact.
 */
export interface WebRetrievalPort {
  retrieve(request: WrsServiceRequest): Promise<WrsServiceResponse>;
}
