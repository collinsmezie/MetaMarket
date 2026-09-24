import type { EnrichmentServiceRequest, EnrichmentServiceResponse } from '../domain/enrichment-resolution';

export const SEMANTIC_ENRICHMENT = Symbol('SemanticEnrichment');

/**
 * Enrichment inbound port (Overarching §7.1, §24.1; Enrichment TDR §28–§29).
 *
 * Only the canonical service request/response crosses this boundary. A provider, schema or
 * policy failure is an `ERROR` response with a typed error — never a guessed profile.
 */
export interface SemanticEnrichmentPort {
  enrich(request: EnrichmentServiceRequest): Promise<EnrichmentServiceResponse>;
}
