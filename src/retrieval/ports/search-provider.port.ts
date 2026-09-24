export const SEARCH_PROVIDER = Symbol('SearchProvider');

export interface SearchRequest {
  readonly query: string;
  readonly maxResults: number;
  /** Prefer recent material (§7 "for current commercial conditions, prioritize current sources"). */
  readonly recencyDays: number | null;
  /** ISO country hint for locality-sensitive queries (§6 step 3). */
  readonly country: string | null;
  readonly depth: 'BASIC' | 'DEEP';
}

export interface SearchResult {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  readonly publishedAt: string | null;
  /** Provider relevance score in [0,1]. Ranking input only, never evidence quality (§7). */
  readonly score: number;
}

export interface SearchResponse {
  readonly provider: string;
  readonly query: string;
  readonly results: readonly SearchResult[];
  readonly latencyMs: number;
}

export class SearchProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'SearchProviderError';
  }
}

/**
 * `SearchProviderPort` (final decision lock Q5; Overarching §13.2): one replaceable retrieval
 * adapter behind WRS. Tavily is the initial provider; the evidence contract is never coupled to
 * the provider. `available()` false means WRS reports `PROVIDER_UNAVAILABLE` honestly (§20.6).
 */
export interface SearchProviderPort {
  readonly name: string;
  available(): boolean;
  search(request: SearchRequest): Promise<SearchResponse>;
}
