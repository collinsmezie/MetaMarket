import type { MkgLifecycleState } from '@prisma/client';
import { PrismaMkgAdapter } from './prisma-mkg.adapter';
import { MKG_PREDICATES } from '../../domain/mkg-vocabulary';

describe('PrismaMkgAdapter', () => {
  let adapter: PrismaMkgAdapter;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      mkgNode: {
        upsert: jest.fn().mockImplementation(({ create }) => ({
          ...create,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 'concept:phone_case') {
            return {
              id: 'concept:phone_case',
              nodeType: 'CONCEPT',
              label: 'Phone Case',
              aliases: ['phone pouch', 'pouch'],
              properties: {},
              status: 'ACTIVE',
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          }
          if (where.id === 'actor:vendor_1') {
            return {
              id: 'actor:vendor_1',
              nodeType: 'ACTOR',
              label: 'Computer Village Phones',
              aliases: [],
              properties: {},
              status: 'ACTIVE',
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          }
          return null;
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      mkgEdge: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'edge_uuid_1',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        update: jest.fn().mockImplementation(({ where, data }) => ({
          id: where.id ?? 'edge_uuid_1',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      },
      graphChangeDecision: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    adapter = new PrismaMkgAdapter(mockPrisma);
  });

  describe('upsertNode', () => {
    it('creates or updates a node in mkg_nodes', async () => {
      const node = await adapter.upsertNode({
        id: 'concept:vacuum_flask',
        nodeType: 'CONCEPT',
        label: 'Vacuum Flask',
        aliases: ['hot flask'],
      });

      expect(node.id).toBe('concept:vacuum_flask');
      expect(node.label).toBe('Vacuum Flask');
      expect(node.aliases).toContain('hot flask');
      expect(mockPrisma.mkgNode.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'concept:vacuum_flask' },
        }),
      );
    });
  });

  describe('applyGraphChange', () => {
    it('applies ADD operation creating an ACTIVE edge', async () => {
      const result = await adapter.applyGraphChange({
        decisionId: 'dec_1',
        operation: 'ADD',
        subjectId: 'actor:vendor_1',
        predicate: MKG_PREDICATES.SUPPLIES,
        objectId: 'concept:phone_case',
        beliefScore: 0.95,
        evidenceIds: ['ev_1'],
        policyVersion: '1.0',
      });

      expect(result.success).toBe(true);
      expect(result.newState).toBe('ACTIVE');
      expect(mockPrisma.mkgEdge.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subjectId: 'actor:vendor_1',
            predicate: MKG_PREDICATES.SUPPLIES,
            objectId: 'concept:phone_case',
            beliefScore: 0.95,
            lifecycleState: 'ACTIVE',
          }),
        }),
      );
      expect(mockPrisma.graphChangeDecision.updateMany).toHaveBeenCalledWith({
        where: { decisionId: 'dec_1' },
        data: expect.objectContaining({ status: 'APPLIED' }),
      });
    });

    it('rejects attempt to mutate sovereign GPC internal hierarchy', async () => {
      const result = await adapter.applyGraphChange({
        decisionId: 'dec_invalid_gpc',
        operation: 'ADD',
        subjectId: 'gpc:class:10001096',
        predicate: 'BELONGS_TO',
        objectId: 'gpc:family:50000000',
        beliefScore: 1.0,
        evidenceIds: [],
        policyVersion: '1.0',
      });

      expect(result.success).toBe(false);
      expect(result.newState).toBe('REJECTED');
      expect(result.detail).toContain('Sovereign GPC hierarchy is immutable');
      expect(mockPrisma.mkgEdge.create).not.toHaveBeenCalled();
      expect(mockPrisma.graphChangeDecision.updateMany).toHaveBeenCalledWith({
        where: { decisionId: 'dec_invalid_gpc' },
        data: expect.objectContaining({ status: 'REJECTED' }),
      });
    });

    it('handles idempotent duplicate command without re-executing write', async () => {
      mockPrisma.mkgEdge.findUnique.mockResolvedValueOnce({
        id: 'existing_edge_uuid',
        lifecycleState: 'ACTIVE' as MkgLifecycleState,
      });

      const result = await adapter.applyGraphChange({
        decisionId: 'dec_duplicate',
        operation: 'ADD',
        subjectId: 'actor:vendor_1',
        predicate: MKG_PREDICATES.SUPPLIES,
        objectId: 'concept:phone_case',
      });

      expect(result.success).toBe(true);
      expect(result.detail).toContain('Idempotent duplicate command');
      expect(mockPrisma.mkgEdge.create).not.toHaveBeenCalled();
    });

    it('applies REINFORCE operation on an existing edge', async () => {
      mockPrisma.mkgEdge.findUnique
        .mockResolvedValueOnce(null) // idempotency check
        .mockResolvedValueOnce({
          id: 'existing_edge_1',
          subjectId: 'actor:vendor_1',
          predicate: MKG_PREDICATES.SUPPLIES,
          objectId: 'concept:phone_case',
          beliefScore: 0.85,
          priorScore: 0.95,
          lifecycleState: 'ACTIVE',
          evidenceIds: ['ev_1'],
        });

      const result = await adapter.applyGraphChange({
        decisionId: 'dec_reinforce_1',
        operation: 'REINFORCE',
        subjectId: 'actor:vendor_1',
        predicate: MKG_PREDICATES.SUPPLIES,
        objectId: 'concept:phone_case',
        beliefScore: 0.85,
        evidenceIds: ['ev_2'],
      });

      expect(result.success).toBe(true);
      expect(result.newState).toBe('REINFORCED');
      expect(mockPrisma.mkgEdge.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'existing_edge_1' },
          data: expect.objectContaining({
            beliefScore: 0.9, // 0.85 + 0.05
            lifecycleState: 'REINFORCED',
            evidenceIds: ['ev_1', 'ev_2'],
          }),
        }),
      );
    });

    it('applies DECAY operation reducing belief and transitioning to WEAKENING if low', async () => {
      mockPrisma.mkgEdge.findUnique
        .mockResolvedValueOnce(null) // idempotency check
        .mockResolvedValueOnce({
          id: 'existing_edge_1',
          subjectId: 'concept:old',
          predicate: MKG_PREDICATES.SUBSTITUTE_FOR,
          objectId: 'concept:new',
          beliefScore: 0.45,
          priorScore: 0.8,
          lifecycleState: 'ACTIVE',
          evidenceIds: [],
        });

      const result = await adapter.applyGraphChange({
        decisionId: 'dec_decay_1',
        operation: 'DECAY',
        subjectId: 'concept:old',
        predicate: MKG_PREDICATES.SUBSTITUTE_FOR,
        objectId: 'concept:new',
        beliefScore: 0.45,
      });

      expect(result.success).toBe(true);
      expect(result.newState).toBe('WEAKENING'); // 0.45 - 0.15 = 0.30 < 0.4
      expect(mockPrisma.mkgEdge.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'existing_edge_1' },
          data: expect.objectContaining({
            beliefScore: 0.3,
            lifecycleState: 'WEAKENING',
          }),
        }),
      );
    });
  });

  describe('traverseGraph', () => {
    it('returns empty if start node does not exist', async () => {
      mockPrisma.mkgNode.findUnique.mockResolvedValueOnce(null);
      const paths = await adapter.traverseGraph({ startNodeId: 'non_existent' });
      expect(paths).toEqual([]);
    });

    it('executes 1-hop traversal with STORED_FACT derivation', async () => {
      const startNode = {
        id: 'concept:drill',
        nodeType: 'CONCEPT',
        label: 'Rotary Drill',
        aliases: [],
        status: 'ACTIVE',
      };
      const accessoryNode = {
        id: 'concept:drill_bit',
        nodeType: 'CONCEPT',
        label: 'Drill Bit',
        aliases: [],
        status: 'ACTIVE',
      };

      mockPrisma.mkgNode.findUnique.mockResolvedValueOnce(startNode);
      mockPrisma.mkgEdge.findMany.mockResolvedValueOnce([
        {
          id: 'edge_1',
          subjectId: 'concept:drill_bit',
          predicate: MKG_PREDICATES.ACCESSORY_OF,
          objectId: 'concept:drill',
          beliefScore: 0.9,
          priorScore: 0.85,
          lifecycleState: 'ACTIVE',
          evidenceIds: ['ev_1'],
        },
      ]);
      mockPrisma.mkgNode.findMany.mockResolvedValueOnce([accessoryNode]);

      const paths = await adapter.traverseGraph({
        startNodeId: 'concept:drill',
        direction: 'INCOMING',
        maxDepth: 1,
      });

      expect(paths.length).toBe(1);
      expect(paths[0].depth).toBe(1);
      expect(paths[0].derivation).toBe('STORED_FACT');
      expect(paths[0].endNode.id).toBe('concept:drill_bit');
      expect(paths[0].cumulativeBelief).toBeCloseTo(0.9 * 0.85);
    });
  });

  describe('getCapabilityContext', () => {
    it('retrieves direct suppliers and accessory suppliers', async () => {
      const conceptNode = {
        id: 'concept:phone_case',
        nodeType: 'CONCEPT',
        label: 'Phone Case',
      };
      mockPrisma.mkgNode.findUnique.mockResolvedValueOnce(conceptNode);

      // 1. Direct suppliers
      mockPrisma.mkgEdge.findMany.mockResolvedValueOnce([
        {
          id: 'supplies_edge_1',
          subjectId: 'actor:vendor:comp_village',
          predicate: MKG_PREDICATES.SUPPLIES,
          objectId: 'concept:phone_case',
          beliefScore: 0.95,
          locality: 'Computer Village, Ikeja',
          subject: {
            id: 'actor:vendor:comp_village',
            label: 'Computer Village Phones',
          },
        },
      ]);

      // 2. Accessories & Substitutes
      mockPrisma.mkgEdge.findMany.mockResolvedValueOnce([
        {
          id: 'acc_edge_1',
          subjectId: 'concept:phone_case',
          predicate: MKG_PREDICATES.ACCESSORY_OF,
          objectId: 'concept:smartphone',
          beliefScore: 0.9,
          subject: conceptNode,
          object: {
            id: 'concept:smartphone',
            label: 'Smartphone',
          },
        },
      ]);

      // 3. Indirect suppliers
      mockPrisma.mkgEdge.findMany.mockResolvedValueOnce([
        {
          id: 'supplies_edge_2',
          subjectId: 'actor:vendor:slot',
          predicate: MKG_PREDICATES.SUPPLIES,
          objectId: 'concept:smartphone',
          beliefScore: 0.9,
          locality: 'Lagos',
          subject: {
            id: 'actor:vendor:slot',
            label: 'Slot Systems',
          },
        },
      ]);

      const context = await adapter.getCapabilityContext('concept:phone_case');

      expect(context.conceptId).toBe('concept:phone_case');
      expect(context.directVendors.length).toBe(1);
      expect(context.directVendors[0].vendorId).toBe('comp_village');
      expect(context.directVendors[0].derivation).toBe('STORED_FACT');

      expect(context.accessories.length).toBe(1);
      expect(context.accessories[0].label).toBe('Smartphone');

      expect(context.relatedVendors.length).toBe(1);
      expect(context.relatedVendors[0].vendorId).toBe('slot');
      expect(context.relatedVendors[0].derivation).toBe('GRAPH_DERIVED_INFERENCE');
    });
  });
});
