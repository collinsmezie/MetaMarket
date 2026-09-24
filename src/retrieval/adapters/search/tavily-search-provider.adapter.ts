import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import {
  SearchProviderError,
  type SearchProviderPort,
  type SearchRequest,
  type SearchResponse,
  type SearchResult,
} from '../../ports/search-provider.port';

/** Tavily's `country` filter takes lower-case country names, not ISO codes. */
const TAVILY_COUNTRY_NAMES: Record<string, string> = {
  NG: 'nigeria',
  GH: 'ghana',
  KE: 'kenya',
  ZA: 'south africa',
  EG: 'egypt',
  US: 'united states',
  GB: 'united kingdom',
  CA: 'canada',
  IN: 'india',
  CN: 'china',
  DE: 'germany',
  FR: 'france',
};

interface TavilyResult {
  url?: string;
  title?: string;
  content?: string;
  score?: number;
  published_date?: string | null;
}

/**
 * Tavily adapter for `SearchProviderPort` (final decision lock Q5: initial provider, replaceable
 * through `WRS_SEARCH_PROVIDER`). Speaks Tavily's `/search` API over the global fetch with a
 * bounded timeout; never reads the key from anywhere but configuration, never logs it.
 */
@Injectable()
export class TavilySearchProvider implements SearchProviderPort {
  readonly name = 'tavily';

  constructor(
    private readonly config: AppConfigService,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  available(): boolean {
    const wrs = this.config.wrs;
    return wrs.provider === 'tavily' && wrs.tavilyApiKey !== null && wrs.tavilyApiKey.length > 0;
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    const wrs = this.config.wrs;
    if (!this.available() || wrs.tavilyApiKey === null) {
      throw new SearchProviderError('Tavily is not configured (TAVILY_API_KEY missing)', this.name, false);
    }
    const startedAt = Date.now();
    const country =
      request.country === null ? null : (TAVILY_COUNTRY_NAMES[request.country.toUpperCase()] ?? null);
    const body: Record<string, unknown> = {
      query: request.query,
      topic: 'general',
      search_depth: request.depth === 'DEEP' ? 'advanced' : 'basic',
      max_results: request.maxResults,
      include_answer: false,
      include_raw_content: false,
      ...(request.recencyDays !== null
        ? { time_range: request.recencyDays <= 7 ? 'week' : request.recencyDays <= 31 ? 'month' : 'year' }
        : {}),
      ...(country !== null ? { country } : {}),
    };
    let response = await this.post(body, wrs.tavilyApiKey, wrs.timeoutMs);
    // Optional filters are best-effort: if Tavily rejects the request, retry once without them.
    if (response.status === 400 && (country !== null || request.recencyDays !== null)) {
      const plain = { ...body };
      delete plain.country;
      delete plain.time_range;
      response = await this.post(plain, wrs.tavilyApiKey, wrs.timeoutMs);
    }
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new SearchProviderError(`Tavily responded ${response.status}`, this.name, retryable);
    }
    const payload = (await response.json()) as { results?: TavilyResult[] };
    const results: SearchResult[] = (payload.results ?? [])
      .filter((result) => typeof result.url === 'string' && result.url.length > 0)
      .map((result) => ({
        url: String(result.url),
        title: String(result.title ?? result.url),
        snippet: String(result.content ?? '').slice(0, 1_200),
        publishedAt: result.published_date ?? null,
        score: Math.max(0, Math.min(1, Number(result.score ?? 0))),
      }));
    return { provider: this.name, query: request.query, results, latencyMs: Date.now() - startedAt };
  }

  private async post(body: Record<string, unknown>, apiKey: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(this.config.wrs.tavilyApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new SearchProviderError(
        aborted
          ? `Tavily timed out after ${timeoutMs}ms`
          : `Tavily request failed: ${error instanceof Error ? error.message : String(error)}`,
        this.name,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Selected when `WRS_SEARCH_PROVIDER=none`: WRS reports `PROVIDER_UNAVAILABLE`, never guessed evidence. */
@Injectable()
export class UnavailableSearchProvider implements SearchProviderPort {
  readonly name = 'none';

  available(): boolean {
    return false;
  }

  async search(): Promise<SearchResponse> {
    throw new SearchProviderError('No search provider is configured', this.name, false);
  }
}
