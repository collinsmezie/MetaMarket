import { CapabilityResolver } from './capability-resolver.service';
import type { TaxonomyRepositoryPort } from '../../domain/ports/outbound/taxonomy-repository.port';
import type { ServiceCapabilityRepositoryPort } from '../../domain/ports/outbound/service-capability-repository.port';
import type { EmbeddingProviderPort } from '../../domain/ports/outbound/embedding-provider.port';
import type { LlmService } from '../../domain/ports/outbound/llm-provider.port';
import type { StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';

describe('CapabilityResolver (Generalized Domain Resolution)', () => {
  let resolver: CapabilityResolver;
  let mockTaxonomy: jest.Mocked<TaxonomyRepositoryPort>;
  let mockServices: jest.Mocked<ServiceCapabilityRepositoryPort>;
  let mockEmbeddings: jest.Mocked<EmbeddingProviderPort>;
  let mockLlm: jest.Mocked<LlmService>;
  let mockLogger: jest.Mocked<StageLoggerPort>;

  beforeEach(() => {
    mockTaxonomy = {
      search: jest.fn().mockResolvedValue([
        {
          node: { code: '10008064', title: 'Masonry Blocks', definition: 'Concrete building blocks' },
          similarity: 0.85,
        },
      ]),
      nodeByCode: jest.fn(),
      ancestorsOf: jest.fn(),
    } as unknown as jest.Mocked<TaxonomyRepositoryPort>;

    mockServices = {
      register: jest.fn(),
      searchNearest: jest.fn(),
    } as unknown as jest.Mocked<ServiceCapabilityRepositoryPort>;

    mockEmbeddings = {
      embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    } as unknown as jest.Mocked<EmbeddingProviderPort>;

    mockLlm = {
      complete: jest.fn().mockResolvedValue({
        data: {
          selections: [
            { code: '10008064', confidence: 0.9, reasoning: 'Direct match for building materials' },
          ],
        },
        rawText: '{}',
      }),
    };

    mockLogger = {
      stage: jest.fn(),
      stageFailed: jest.fn(),
      withCorrelation: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<StageLoggerPort>;

    resolver = new CapabilityResolver(
      mockTaxonomy,
      mockServices,
      mockEmbeddings,
      mockLlm,
      mockLogger,
    );
  });

  it('uses contextualized query embedding when archetype is provided', async () => {
    await resolver.resolveProducts(['blocks'], {
      archetype: 'building materials dealer',
      statement: 'I sell building materials and blocks',
    });

    expect(mockEmbeddings.embed).toHaveBeenCalledWith('building materials dealer: blocks');
  });

  it('passes merchant context to LLM candidate ranker prompt', async () => {
    await resolver.resolveProducts(['plaster'], {
      archetype: 'chemist / patent medicine',
      statement: 'I sell drugs and adhesive plaster',
    });

    expect(mockLlm.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('VENDOR ARCHETYPE: chemist / patent medicine'),
          }),
        ]),
      }),
      expect.any(Function),
    );
  });
});
