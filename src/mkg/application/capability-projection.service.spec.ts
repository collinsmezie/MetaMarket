import { CapabilityProjectionService } from './capability-projection.service';
import { MKG_PREDICATES } from '../domain/mkg-vocabulary';

describe('CapabilityProjectionService', () => {
  let service: CapabilityProjectionService;
  let mockPrisma: any;
  let mockMkgWrite: any;

  beforeEach(() => {
    mockPrisma = {
      vendor: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'v_phone_store_1',
          businessName: 'Computer Village Phones',
          contactPhone: '+2348090000001',
          city: 'Ikeja',
          state: 'Lagos',
          declaredProducts: ['phone cases', 'screen protectors'],
          capabilities: [
            {
              capabilityId: '10002220',
              capabilityName: 'Cellular Phone Accessories',
              capabilityDomain: 'product',
              confidence: 0.95,
            },
          ],
        }),
        findMany: jest.fn().mockResolvedValue([{ id: 'v_phone_store_1' }]),
      },
    };

    mockMkgWrite = {
      upsertNode: jest.fn().mockResolvedValue({}),
      applyGraphChange: jest.fn().mockResolvedValue({ success: true, operation: 'ADD', newState: 'ACTIVE' }),
    };

    service = new CapabilityProjectionService(mockPrisma, mockMkgWrite);
  });

  it('projects vendor, location, declared products, and resolved capabilities into MKG', async () => {
    const result = await service.projectVendor('v_phone_store_1');

    expect(result.projectedEdges).toBe(4); // 1 location + 2 declared products + 1 GPC capability

    // Verifies Actor node created
    expect(mockMkgWrite.upsertNode).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'actor:vendor:v_phone_store_1',
        nodeType: 'ACTOR',
        label: 'Computer Village Phones',
      }),
    );

    // Verifies location edge
    expect(mockMkgWrite.applyGraphChange).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: 'actor:vendor:v_phone_store_1',
        predicate: MKG_PREDICATES.LOCATED_IN,
        objectId: 'context:location:ikeja',
      }),
    );

    // Verifies declared product SUPPLIES edge
    expect(mockMkgWrite.applyGraphChange).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: 'actor:vendor:v_phone_store_1',
        predicate: MKG_PREDICATES.SUPPLIES,
        objectId: 'concept:phone_cases',
      }),
    );

    // Verifies GPC capability SUPPLIES edge
    expect(mockMkgWrite.applyGraphChange).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: 'actor:vendor:v_phone_store_1',
        predicate: MKG_PREDICATES.SUPPLIES,
        objectId: 'gpc:brick:10002220',
        beliefScore: 0.95,
      }),
    );
  });
});
