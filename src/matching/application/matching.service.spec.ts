import { MatchingService } from './matching.service';
import type { MkgCandidateRetrievalAdapter } from '../adapters/retrieval/mkg-candidate-retrieval.adapter';
import type { MatchCandidate, StructuredDemand } from '../domain/matching-models';

describe('MatchingService', () => {
  let service: MatchingService;
  let mockRetrieval: jest.Mocked<MkgCandidateRetrievalAdapter>;

  beforeEach(() => {
    mockRetrieval = {
      retrieveCandidates: jest.fn(),
    } as unknown as jest.Mocked<MkgCandidateRetrievalAdapter>;

    service = new MatchingService(mockRetrieval);
  });

  it('ranks direct suppliers higher than unrelated or distant suppliers', async () => {
    const candidates: MatchCandidate[] = [
      {
        vendorId: 'v_phone_store',
        businessName: 'Computer Village Phones',
        contactPhone: '+2348090000001',
        city: 'Ikeja',
        state: 'Lagos',
        matchedConcept: 'phone case',
        derivation: 'STORED_FACT',
        rawBelief: 0.95,
        pathDepth: 1,
        reasons: ['Directly supplies phone case'],
        finalScore: 0,
      },
      {
        vendorId: 'v_boutique',
        businessName: "Amaka's Boutique",
        contactPhone: '+2348090000013',
        city: 'Owerri',
        state: 'Imo',
        matchedConcept: 'Personal Bags',
        derivation: 'TAXONOMY_BACKBONE',
        rawBelief: 0.4,
        pathDepth: 1,
        reasons: ['Supplies bags'],
        finalScore: 0,
      },
    ];

    mockRetrieval.retrieveCandidates.mockResolvedValueOnce(candidates);

    const demand: StructuredDemand = {
      query: 'I nned pouch for phone',
      conceptLabel: 'phone case',
      gpcCode: '10002220',
      customerCity: 'Ikeja',
    };

    const result = await service.match(demand);

    expect(result.outcome).toBe('ranked');
    expect(result.vendors).toBeDefined();
    expect(result.vendors!.length).toBe(2);

    // Computer Village Phones must be Rank #1
    expect(result.vendors![0].vendorId).toBe('v_phone_store');
    expect(result.vendors![0].businessName).toBe('Computer Village Phones');
    expect(result.vendors![0].score).toBeGreaterThan(result.vendors![1].score);
    expect(result.vendors![0].phone).toBe('+2348090000001');
  });

  it('ranks 2-hop accessory suppliers when direct suppliers are unavailable', async () => {
    const candidates: MatchCandidate[] = [
      {
        vendorId: 'v_slot',
        businessName: 'Slot Systems',
        contactPhone: '+2348090000002',
        city: 'Lagos',
        state: 'Lagos',
        matchedConcept: 'phone case',
        derivation: 'GRAPH_DERIVED_INFERENCE',
        rawBelief: 0.85,
        pathDepth: 2,
        pathPredicate: 'mkg:ACCESSORY_OF',
        reasons: ['Supplies smartphone which has accessory phone case'],
        finalScore: 0,
      },
    ];

    mockRetrieval.retrieveCandidates.mockResolvedValueOnce(candidates);

    const demand: StructuredDemand = {
      query: 'phone case',
      conceptLabel: 'phone case',
    };

    const result = await service.match(demand);

    expect(result.outcome).toBe('ranked');
    expect(result.vendors![0].vendorId).toBe('v_slot');
    expect(result.vendors![0].score).toBeGreaterThan(1.0);
  });

  it('returns no_capability when no candidate is retrieved', async () => {
    mockRetrieval.retrieveCandidates.mockResolvedValueOnce([]);

    const result = await service.match({ query: 'space rocket parts' });

    expect(result.outcome).toBe('no_capability');
  });
});
