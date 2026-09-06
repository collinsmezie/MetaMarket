import { CapabilityMatchingService } from './capability-matching.service';
import type { VendorRepositoryPort } from '../../domain/ports/outbound/vendor-repository.port';
import type { TaxonomyRepositoryPort } from '../../domain/ports/outbound/taxonomy-repository.port';
import type { StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import type { DemandUnderstandingService } from './demand-understanding.service';
import type { CapabilityResolver } from '../capability/capability-resolver.service';
import type { EvidenceQueryService } from '../evidence/evidence-query.service';
import type { VendorProfile } from '../../domain/models/vendor';

describe('CapabilityMatchingService Business Card Archetype Formatting', () => {
  let service: CapabilityMatchingService;
  let mockVendors: jest.Mocked<VendorRepositoryPort>;
  let mockTaxonomy: jest.Mocked<TaxonomyRepositoryPort>;
  let mockLogger: jest.Mocked<StageLoggerPort>;
  let mockUnderstanding: jest.Mocked<DemandUnderstandingService>;
  let mockResolver: jest.Mocked<CapabilityResolver>;
  let mockEvidence: jest.Mocked<EvidenceQueryService>;

  beforeEach(() => {
    mockVendors = {
      searchByDna: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<VendorRepositoryPort>;

    mockTaxonomy = {
      search: jest.fn().mockResolvedValue([]),
      nodeByCode: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<TaxonomyRepositoryPort>;

    mockLogger = {
      stage: jest.fn(),
      stageFailed: jest.fn(),
      withCorrelation: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<StageLoggerPort>;

    mockUnderstanding = {} as unknown as jest.Mocked<DemandUnderstandingService>;
    mockResolver = {} as unknown as jest.Mocked<CapabilityResolver>;

    mockEvidence = {
      getEvidenceScores: jest.fn().mockResolvedValue(new Map()),
    } as unknown as jest.Mocked<EvidenceQueryService>;

    service = new CapabilityMatchingService(
      mockVendors,
      mockTaxonomy,
      mockLogger,
      mockUnderstanding,
      mockResolver,
      mockEvidence,
    );
  });

  it('formats business card description using vendor archetype (e.g. Mobinco Bookshop)', async () => {
    const profile: VendorProfile = {
      vendor: {
        id: 'v-1',
        userId: '2349127834513',
        conversationId: 'c-1',
        businessName: 'Mobinco Bookshop',
        contactPhone: '+2348012345678',
        location: { city: 'Warri', state: 'Delta', country: 'Nigeria', confidence: 1 },
        status: 'active',
        conversationSummary:
          'books, stationery, educational materials, and related supplies Sells: notebooks, textbooks',
        onboardedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      dna: {
        vendorId: 'v-1',
        beliefs: [],
        declaredProducts: ['books', 'stationery'],
        declaredServices: [],
        brands: [],
        summary: 'books, stationery, educational materials, and related supplies',
        evidenceCount: 1,
        updatedAt: new Date(),
      },
    };

    // Access private rank method via any cast for testing
    const ranked = await (service as any).rank({
      resolved: {
        primaryCapabilities: [{ domain: 'product', id: '10001000', name: 'Books' }],
        expandedCapabilities: [],
        expandedTerms: [],
      },
      candidates: [profile],
      customerCity: 'Warri',
      limit: 5,
    });

    expect(ranked).toHaveLength(1);
    expect(ranked[0].description).toBe(
      'Mobinco specializes in books, stationery, educational materials, and related supplies.',
    );
  });
});
