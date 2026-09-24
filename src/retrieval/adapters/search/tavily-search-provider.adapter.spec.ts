import type { AppConfigService } from '../../../config/app-config.service';
import { TavilySearchProvider } from './tavily-search-provider.adapter';

const config = (key: string | null, provider: 'tavily' | 'none' = 'tavily') =>
  ({
    wrs: {
      provider,
      tavilyApiKey: key,
      tavilyApiUrl: 'https://api.tavily.com/search',
      maxQueries: 4,
      maxResultsPerQuery: 6,
      timeoutMs: 5_000,
    },
  }) as unknown as AppConfigService;

describe('TavilySearchProvider', () => {
  it('is unavailable without a key or when another provider is selected', () => {
    expect(new TavilySearchProvider(config(null)).available()).toBe(false);
    expect(new TavilySearchProvider(config('k', 'none')).available()).toBe(false);
    expect(new TavilySearchProvider(config('k')).available()).toBe(true);
  });

  it('sends the query with a bearer key and normalises results', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          results: [
            {
              url: 'https://jumia.com.ng/x',
              title: 'Steel wool',
              content: 'iron sponge for pots',
              score: 0.91,
              published_date: '2026-01-02',
            },
            { title: 'no url' },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const provider = new TavilySearchProvider(config('secret-key'), fetchImpl);
    const response = await provider.search({
      query: 'iron sponge Nigeria',
      maxResults: 5,
      recencyDays: null,
      country: 'NG',
      depth: 'BASIC',
    });
    expect(calls[0]!.url).toBe('https://api.tavily.com/search');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      query: 'iron sponge Nigeria',
      search_depth: 'basic',
      max_results: 5,
      country: 'nigeria',
    });
    expect(response.results).toEqual([
      {
        url: 'https://jumia.com.ng/x',
        title: 'Steel wool',
        snippet: 'iron sponge for pots',
        publishedAt: '2026-01-02',
        score: 0.91,
      },
    ]);
  });

  it('retries once without optional filters when Tavily rejects them', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      return 'country' in body
        ? new Response('bad country', { status: 400 })
        : new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new TavilySearchProvider(config('k'), fetchImpl);
    const response = await provider.search({
      query: 'q',
      maxResults: 3,
      recencyDays: null,
      country: 'NG',
      depth: 'BASIC',
    });
    expect(bodies.map((b) => 'country' in b)).toEqual([true, false]);
    expect(response.results).toEqual([]);
  });

  it('surfaces provider failures as typed, retryable-aware errors', async () => {
    const fetchImpl = (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    const provider = new TavilySearchProvider(config('k'), fetchImpl);
    await expect(
      provider.search({ query: 'q', maxResults: 3, recencyDays: null, country: null, depth: 'BASIC' }),
    ).rejects.toMatchObject({ name: 'SearchProviderError', retryable: true });
  });
});
