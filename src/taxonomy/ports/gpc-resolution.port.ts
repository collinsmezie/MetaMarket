import type { GpcResolverServiceRequest, GpcResolverServiceResponse } from '../domain/gpc-mapping';

export const GPC_RESOLUTION = Symbol('GpcResolution');

/**
 * GPC Resolver inbound port (Overarching §24.1; GPC Resolver TDR §75.1, §93).
 *
 * Only the canonical service request/response crosses this boundary. A provider, schema or
 * policy failure is an `ERROR` response with a typed error — never a manufactured code.
 */
export interface GpcResolutionPort {
  resolve(request: GpcResolverServiceRequest): Promise<GpcResolverServiceResponse>;
}
