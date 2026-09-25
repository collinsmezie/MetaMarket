import { Injectable, Logger } from '@nestjs/common';
import type { MkgLifecycleState, Prisma } from '@prisma/client';
import { PrismaService } from '../../../adapters/outbound/persistence/prisma.service';
import type {
  KnowledgeQuery,
  MarketConceptKnowledge,
} from '../../../enrichment/ports/mkg-read.port';
import type {
  GraphChangeCommand,
  GraphMutationResult,
  MkgEdgeModel,
  MkgNodeModel,
  MkgTraversalPath,
  MkgTraversalStep,
  MkgTraverseOptions,
} from '../../domain/mkg-models';
import {
  computeMkgIdempotencyKey,
  MKG_PREDICATES,
  PREDICATE_PRIOR_WEIGHTS,
} from '../../domain/mkg-vocabulary';
import type {
  CapabilityContextResult,
  CapabilityContextVendor,
  MkgReadPort,
} from '../../ports/mkg-read.port';
import type { MkgWritePort } from '../../ports/mkg-write.port';

const ACTIVE_LIFECYCLE_STATES: MkgLifecycleState[] = ['ACTIVE', 'REINFORCED'];

function roundBelief(score: number): number {
  return Math.round(score * 10000) / 10000;
}

@Injectable()
export class PrismaMkgAdapter implements MkgReadPort, MkgWritePort {
  private readonly logger = new Logger(PrismaMkgAdapter.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Write Port Implementation
  // ─────────────────────────────────────────────────────────────────────────────

  async upsertNode(node: {
    readonly id: string;
    readonly nodeType: string;
    readonly label: string;
    readonly aliases?: readonly string[];
    readonly description?: string | null;
    readonly properties?: Readonly<Record<string, unknown>>;
  }): Promise<MkgNodeModel> {
    const row = await this.prisma.mkgNode.upsert({
      where: { id: node.id },
      create: {
        id: node.id,
        nodeType: node.nodeType,
        label: node.label,
        aliases: node.aliases ? [...node.aliases] : [],
        description: node.description ?? null,
        properties: (node.properties as Prisma.InputJsonValue) ?? {},
        status: 'ACTIVE',
      },
      update: {
        label: node.label,
        aliases: node.aliases ? [...node.aliases] : undefined,
        description: node.description !== undefined ? node.description : undefined,
        properties: (node.properties as Prisma.InputJsonValue) ?? undefined,
      },
    });

    return this.mapNode(row);
  }

  async applyGraphChange(command: GraphChangeCommand): Promise<GraphMutationResult> {
    const idempotencyKey = computeMkgIdempotencyKey(
      command.decisionId,
      command.operation,
      command.subjectId,
      command.predicate,
      command.objectId,
    );

    // 1. Idempotency Check
    const existingByIdempotency = await this.prisma.mkgEdge.findUnique({
      where: { idempotencyKey },
    });
    if (existingByIdempotency) {
      this.logger.debug(
        `[applyGraphChange] Idempotent duplicate command detected for key ${idempotencyKey}`,
      );
      return {
        success: true,
        edgeId: existingByIdempotency.id,
        operation: command.operation,
        previousState: existingByIdempotency.lifecycleState,
        newState: existingByIdempotency.lifecycleState,
        idempotencyKey,
        detail: 'Idempotent duplicate command acknowledged without modification',
      };
    }

    // 2. Sovereign GPC Immutability Guard (§17, §29)
    if (
      command.subjectId.startsWith('gpc:') &&
      command.objectId.startsWith('gpc:') &&
      ['BELONGS_TO', 'skos:broader', 'skos:narrower'].includes(command.predicate)
    ) {
      this.logger.warn(
        `[applyGraphChange] REJECTED: Attempted to mutate sovereign GPC internal hierarchy: ${command.subjectId} -> ${command.predicate} -> ${command.objectId}`,
      );
      await this.markDecisionStatus(command.decisionId, 'REJECTED', 'Cannot mutate sovereign GPC');
      return {
        success: false,
        operation: command.operation,
        newState: 'REJECTED',
        idempotencyKey,
        detail: 'Sovereign GPC hierarchy is immutable',
      };
    }

    // 3. Ensure Subject and Object Nodes Exist in mkg_nodes
    await this.ensureNodeExists(command.subjectId);
    await this.ensureNodeExists(command.objectId);

    // 4. Query Existing Relationship
    const existing = await this.prisma.mkgEdge.findUnique({
      where: {
        mkg_edge_unique_triple: {
          subjectId: command.subjectId,
          predicate: command.predicate,
          objectId: command.objectId,
        },
      },
    });

    const previousState = existing?.lifecycleState ?? null;
    const belief = command.beliefScore ?? existing?.beliefScore ?? 1.0;
    const prior =
      command.priorScore ??
      existing?.priorScore ??
      PREDICATE_PRIOR_WEIGHTS[command.predicate] ??
      0.8;
    const evidenceIds = Array.from(
      new Set([...(existing?.evidenceIds ?? []), ...(command.evidenceIds ?? [])]),
    );

    let newState: MkgLifecycleState = 'ACTIVE';
    let edgeId: string | undefined = existing?.id;

    switch (command.operation) {
      case 'ADD': {
        newState = 'ACTIVE';
        if (existing) {
          const updated = await this.prisma.mkgEdge.update({
            where: { id: existing.id },
            data: {
              beliefScore: belief,
              priorScore: prior,
              lifecycleState: newState,
              evidenceIds,
              decisionId: command.decisionId,
              policyVersion: command.policyVersion ?? '1.0',
              locality: command.locality ?? existing.locality,
              idempotencyKey,
            },
          });
          edgeId = updated.id;
        } else {
          const created = await this.prisma.mkgEdge.create({
            data: {
              subjectId: command.subjectId,
              predicate: command.predicate,
              objectId: command.objectId,
              beliefScore: belief,
              priorScore: prior,
              lifecycleState: newState,
              evidenceIds,
              decisionId: command.decisionId,
              policyVersion: command.policyVersion ?? '1.0',
              locality: command.locality ?? null,
              idempotencyKey,
            },
          });
          edgeId = created.id;
        }
        break;
      }

      case 'REINFORCE': {
        newState = 'REINFORCED';
        const reinforcedBelief = roundBelief(Math.min(1.0, belief + 0.05));
        if (existing) {
          const updated = await this.prisma.mkgEdge.update({
            where: { id: existing.id },
            data: {
              beliefScore: reinforcedBelief,
              lifecycleState: newState,
              evidenceIds,
              decisionId: command.decisionId,
              policyVersion: command.policyVersion ?? '1.0',
              idempotencyKey,
            },
          });
          edgeId = updated.id;
        } else {
          const created = await this.prisma.mkgEdge.create({
            data: {
              subjectId: command.subjectId,
              predicate: command.predicate,
              objectId: command.objectId,
              beliefScore: reinforcedBelief,
              priorScore: prior,
              lifecycleState: newState,
              evidenceIds,
              decisionId: command.decisionId,
              policyVersion: command.policyVersion ?? '1.0',
              locality: command.locality ?? null,
              idempotencyKey,
            },
          });
          edgeId = created.id;
        }
        break;
      }

      case 'DECAY': {
        const decayedBelief = roundBelief(Math.max(0.0, belief - 0.15));
        newState = decayedBelief < 0.4 ? 'WEAKENING' : (existing?.lifecycleState ?? 'ACTIVE');
        if (existing) {
          const updated = await this.prisma.mkgEdge.update({
            where: { id: existing.id },
            data: {
              beliefScore: decayedBelief,
              lifecycleState: newState,
              decisionId: command.decisionId,
              idempotencyKey,
            },
          });
          edgeId = updated.id;
        }
        break;
      }

      case 'DEACTIVATE': {
        newState = 'INACTIVE';
        if (existing) {
          const updated = await this.prisma.mkgEdge.update({
            where: { id: existing.id },
            data: {
              lifecycleState: newState,
              decisionId: command.decisionId,
              idempotencyKey,
            },
          });
          edgeId = updated.id;
        }
        break;
      }

      case 'PRUNE': {
        newState = 'PRUNED';
        if (existing) {
          const updated = await this.prisma.mkgEdge.update({
            where: { id: existing.id },
            data: {
              lifecycleState: newState,
              decisionId: command.decisionId,
              idempotencyKey,
            },
          });
          edgeId = updated.id;
        }
        break;
      }

      case 'REJECT': {
        newState = 'REJECTED';
        if (existing) {
          const updated = await this.prisma.mkgEdge.update({
            where: { id: existing.id },
            data: {
              lifecycleState: newState,
              decisionId: command.decisionId,
              idempotencyKey,
            },
          });
          edgeId = updated.id;
        }
        break;
      }
    }

    // 5. Update Status in Evidence GraphChangeDecision table
    await this.markDecisionStatus(command.decisionId, 'APPLIED');

    this.logger.log(
      `[applyGraphChange] Applied ${command.operation} on (${command.subjectId} -> ${command.predicate} -> ${command.objectId}) state=${newState}`,
    );

    return {
      success: true,
      edgeId,
      operation: command.operation,
      previousState,
      newState,
      idempotencyKey,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Read Port Implementation
  // ─────────────────────────────────────────────────────────────────────────────

  async getNode(nodeId: string): Promise<MkgNodeModel | null> {
    const row = await this.prisma.mkgNode.findUnique({ where: { id: nodeId } });
    return row ? this.mapNode(row) : null;
  }

  async getNodes(nodeIds: readonly string[]): Promise<readonly MkgNodeModel[]> {
    if (!nodeIds.length) return [];
    const rows = await this.prisma.mkgNode.findMany({
      where: { id: { in: [...nodeIds] } },
    });
    return rows.map((r) => this.mapNode(r));
  }

  async traverseGraph(options: MkgTraverseOptions): Promise<readonly MkgTraversalPath[]> {
    const startNode = await this.getNode(options.startNodeId);
    if (!startNode) return [];

    const maxDepth = Math.min(3, Math.max(1, options.maxDepth ?? 2));
    const minBelief = options.minBelief ?? 0.5;
    const direction = options.direction ?? 'BOTH';
    const states = options.includeInactive ? undefined : ACTIVE_LIFECYCLE_STATES;

    const paths: MkgTraversalPath[] = [];

    // Hop 1 Traversal
    const hop1Edges = await this.fetchEdgesForNode(
      options.startNodeId,
      direction,
      options.predicates,
      states,
      minBelief,
    );

    const hop1TargetIds = new Set<string>();
    for (const { targetId } of hop1Edges) {
      if (targetId === options.startNodeId) continue;
      hop1TargetIds.add(targetId);
    }

    const hop1TargetNodes = await this.getNodes(Array.from(hop1TargetIds));
    const nodeMap = new Map<string, MkgNodeModel>();
    nodeMap.set(startNode.id, startNode);
    for (const n of hop1TargetNodes) {
      nodeMap.set(n.id, n);
    }

    // Build Hop 1 Paths
    interface ActivePath {
      steps: MkgTraversalStep[];
      visited: Set<string>;
      cumulativeBelief: number;
      lastNodeId: string;
    }

    const activePaths: ActivePath[] = [];

    for (const { edge, targetId, dir } of hop1Edges) {
      const targetNode = nodeMap.get(targetId);
      if (!targetNode) continue;

      const edgeModel = this.mapEdge(edge);
      const step: MkgTraversalStep = {
        edge: edgeModel,
        targetNode,
        direction: dir,
      };

      const pathBelief = edgeModel.beliefScore * edgeModel.priorScore;
      const path: MkgTraversalPath = {
        startNode,
        steps: [step],
        depth: 1,
        cumulativeBelief: pathBelief,
        derivation: 'STORED_FACT',
        endNode: targetNode,
      };
      paths.push(path);

      if (maxDepth > 1) {
        activePaths.push({
          steps: [step],
          visited: new Set([startNode.id, targetId]),
          cumulativeBelief: pathBelief,
          lastNodeId: targetId,
        });
      }
    }

    // Hop 2 Traversal (if requested)
    if (maxDepth >= 2 && activePaths.length > 0) {
      for (const p of activePaths) {
        const hop2Edges = await this.fetchEdgesForNode(
          p.lastNodeId,
          direction,
          options.predicates,
          states,
          minBelief,
        );

        const newTargetIds = hop2Edges
          .map((h) => h.targetId)
          .filter((id) => !p.visited.has(id));

        if (!newTargetIds.length) continue;

        const newNodes = await this.getNodes(newTargetIds);
        for (const nn of newNodes) {
          nodeMap.set(nn.id, nn);
        }

        for (const { edge, targetId, dir } of hop2Edges) {
          if (p.visited.has(targetId)) continue; // Cycle protection
          const endNode = nodeMap.get(targetId);
          if (!endNode) continue;

          const edgeModel = this.mapEdge(edge);
          const nextBelief = p.cumulativeBelief * edgeModel.beliefScore * edgeModel.priorScore * 0.9;
          if (nextBelief < minBelief) continue;

          const step: MkgTraversalStep = {
            edge: edgeModel,
            targetNode: endNode,
            direction: dir,
          };

          paths.push({
            startNode,
            steps: [...p.steps, step],
            depth: 2,
            cumulativeBelief: nextBelief,
            derivation: 'GRAPH_DERIVED_INFERENCE',
            endNode,
          });
        }
      }
    }

    return paths;
  }

  async getCapabilityContext(conceptId: string, minBelief = 0.5): Promise<CapabilityContextResult> {
    const node = await this.getNode(conceptId);
    const conceptLabel = node?.label ?? conceptId;

    // 1. Direct suppliers: Actor ──mkg:SUPPLIES──> Concept
    const directSupplierEdges = await this.prisma.mkgEdge.findMany({
      where: {
        objectId: conceptId,
        predicate: MKG_PREDICATES.SUPPLIES,
        lifecycleState: { in: ACTIVE_LIFECYCLE_STATES },
        beliefScore: { gte: minBelief },
      },
      include: { subject: true },
    });

    const directVendors: CapabilityContextVendor[] = directSupplierEdges.map((e) => ({
      vendorId: e.subjectId.replace(/^actor:vendor:/, '').replace(/^actor:/, ''),
      businessName: e.subject.label,
      beliefScore: e.beliefScore,
      pathDepth: 1,
      pathPredicate: e.predicate,
      derivation: 'STORED_FACT',
      locality: e.locality,
    }));

    // 2. Accessories & Substitutes
    const relatedEdges = await this.prisma.mkgEdge.findMany({
      where: {
        OR: [
          { subjectId: conceptId, predicate: { in: [MKG_PREDICATES.ACCESSORY_OF, MKG_PREDICATES.SUBSTITUTE_FOR] } },
          { objectId: conceptId, predicate: { in: [MKG_PREDICATES.ACCESSORY_OF, MKG_PREDICATES.SUBSTITUTE_FOR] } },
        ],
        lifecycleState: { in: ACTIVE_LIFECYCLE_STATES },
        beliefScore: { gte: minBelief },
      },
      include: { subject: true, object: true },
    });

    const accessories: { conceptId: string; label: string; beliefScore: number }[] = [];
    const substitutes: { conceptId: string; label: string; beliefScore: number }[] = [];
    const relatedConceptIds = new Set<string>();

    for (const edge of relatedEdges) {
      const isSubject = edge.subjectId === conceptId;
      const otherNode = isSubject ? edge.object : edge.subject;

      if (edge.predicate === MKG_PREDICATES.ACCESSORY_OF) {
        accessories.push({
          conceptId: otherNode.id,
          label: otherNode.label,
          beliefScore: edge.beliefScore,
        });
        relatedConceptIds.add(otherNode.id);
      } else if (edge.predicate === MKG_PREDICATES.SUBSTITUTE_FOR) {
        substitutes.push({
          conceptId: otherNode.id,
          label: otherNode.label,
          beliefScore: edge.beliefScore,
        });
        relatedConceptIds.add(otherNode.id);
      }
    }

    // 3. Related vendors (Suppliers of accessories/substitutes)
    const relatedVendors: CapabilityContextVendor[] = [];
    if (relatedConceptIds.size > 0) {
      const indirectSupplierEdges = await this.prisma.mkgEdge.findMany({
        where: {
          objectId: { in: Array.from(relatedConceptIds) },
          predicate: MKG_PREDICATES.SUPPLIES,
          lifecycleState: { in: ACTIVE_LIFECYCLE_STATES },
          beliefScore: { gte: minBelief },
        },
        include: { subject: true },
      });

      for (const e of indirectSupplierEdges) {
        relatedVendors.push({
          vendorId: e.subjectId.replace(/^actor:vendor:/, '').replace(/^actor:/, ''),
          businessName: e.subject.label,
          beliefScore: e.beliefScore * 0.85,
          pathDepth: 2,
          pathPredicate: e.predicate,
          derivation: 'GRAPH_DERIVED_INFERENCE',
          locality: e.locality,
        });
      }
    }

    return {
      conceptId,
      conceptLabel,
      directVendors,
      relatedVendors,
      accessories,
      substitutes,
    };
  }

  async knowledgeFor(query: KnowledgeQuery): Promise<readonly MarketConceptKnowledge[]> {
    if (!query.marketConceptIds.length && !query.labels.length) {
      return [];
    }

    const concepts = await this.prisma.mkgNode.findMany({
      where: {
        OR: [
          query.marketConceptIds.length ? { id: { in: [...query.marketConceptIds] } } : {},
          query.labels.length ? { label: { in: [...query.labels], mode: 'insensitive' } } : {},
        ],
      },
      include: {
        outgoingEdges: {
          where: { lifecycleState: { in: ACTIVE_LIFECYCLE_STATES } },
          include: { object: true },
        },
        incomingEdges: {
          where: { lifecycleState: { in: ACTIVE_LIFECYCLE_STATES } },
          include: { subject: true },
        },
      },
    });

    const results: MarketConceptKnowledge[] = [];

    for (const c of concepts) {
      const broader: string[] = [];
      const narrower: string[] = [];
      const relationships: { type: string; target: string; belief: number }[] = [];
      const gpcLineage: { gpcCode: string; title: string; belief: number }[] = [];
      const evidenceIds = new Set<string>();

      for (const edge of c.outgoingEdges) {
        for (const ev of edge.evidenceIds) evidenceIds.add(ev);

        if (edge.predicate === 'skos:broader') {
          broader.push(edge.object.label);
        } else if (edge.predicate === 'skos:narrower') {
          narrower.push(edge.object.label);
        } else if (edge.predicate === MKG_PREDICATES.MAPPED_TO_GPC) {
          gpcLineage.push({
            gpcCode: edge.objectId.replace(/^gpc:class:/, '').replace(/^gpc:brick:/, ''),
            title: edge.object.label,
            belief: edge.beliefScore,
          });
        } else {
          relationships.push({
            type: edge.predicate,
            target: edge.object.label,
            belief: edge.beliefScore,
          });
        }
      }

      for (const edge of c.incomingEdges) {
        for (const ev of edge.evidenceIds) evidenceIds.add(ev);

        if (edge.predicate === 'skos:broader') {
          narrower.push(edge.subject.label);
        } else if (edge.predicate === 'skos:narrower') {
          broader.push(edge.subject.label);
        } else {
          relationships.push({
            type: `${edge.predicate}_INVERSE`,
            target: edge.subject.label,
            belief: edge.beliefScore,
          });
        }
      }

      results.push({
        marketConceptId: c.id,
        prefLabel: c.label,
        altLabels: c.aliases,
        broader,
        narrower,
        relationships,
        gpcLineage,
        derivation: 'STORED',
        evidenceIds: Array.from(evidenceIds),
      });
    }

    return results;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private async fetchEdgesForNode(
    nodeId: string,
    direction: 'OUTGOING' | 'INCOMING' | 'BOTH',
    predicates?: readonly string[],
    states?: MkgLifecycleState[],
    minBelief = 0.5,
  ): Promise<{ edge: any; targetId: string; dir: 'OUTGOING' | 'INCOMING' }[]> {
    const results: { edge: any; targetId: string; dir: 'OUTGOING' | 'INCOMING' }[] = [];

    const baseWhere: Prisma.MkgEdgeWhereInput = {
      ...(states ? { lifecycleState: { in: states } } : {}),
      beliefScore: { gte: minBelief },
      ...(predicates?.length ? { predicate: { in: [...predicates] } } : {}),
    };

    if (direction === 'OUTGOING' || direction === 'BOTH') {
      const outgoing = await this.prisma.mkgEdge.findMany({
        where: { ...baseWhere, subjectId: nodeId },
      });
      for (const e of outgoing) {
        results.push({ edge: e, targetId: e.objectId, dir: 'OUTGOING' });
      }
    }

    if (direction === 'INCOMING' || direction === 'BOTH') {
      const incoming = await this.prisma.mkgEdge.findMany({
        where: { ...baseWhere, objectId: nodeId },
      });
      for (const e of incoming) {
        results.push({ edge: e, targetId: e.subjectId, dir: 'INCOMING' });
      }
    }

    return results;
  }

  private async ensureNodeExists(nodeId: string): Promise<void> {
    const existing = await this.prisma.mkgNode.findUnique({
      where: { id: nodeId },
      select: { id: true },
    });
    if (existing) return;

    let nodeType = 'CONCEPT';
    let label = nodeId;

    if (nodeId.startsWith('actor:')) {
      nodeType = 'ACTOR';
      label = nodeId.replace(/^actor:(vendor:)?/, '');
    } else if (nodeId.startsWith('phrase:')) {
      nodeType = 'PHRASE';
      label = nodeId.replace(/^phrase:/, '');
    } else if (nodeId.startsWith('gpc:brick:')) {
      nodeType = 'GPC_BRICK';
      label = nodeId.replace(/^gpc:brick:/, '');
    } else if (nodeId.startsWith('gpc:class:')) {
      nodeType = 'GPC_CLASS';
      label = nodeId.replace(/^gpc:class:/, '');
    } else if (nodeId.startsWith('concept:')) {
      nodeType = 'CONCEPT';
      label = nodeId.replace(/^concept:/, '');
    }

    await this.prisma.mkgNode.upsert({
      where: { id: nodeId },
      create: {
        id: nodeId,
        nodeType,
        label,
        status: 'ACTIVE',
      },
      update: {},
    });
  }

  private async markDecisionStatus(
    decisionId: string,
    status: 'APPLIED' | 'REJECTED' | 'FAILED',
    failure?: string,
  ): Promise<void> {
    try {
      await this.prisma.graphChangeDecision.updateMany({
        where: { decisionId },
        data: {
          status,
          appliedAt: new Date(),
          failure: failure ?? null,
        },
      });
    } catch (err) {
      this.logger.debug(
        `[markDecisionStatus] Could not update decision status for ${decisionId}: ${(err as Error).message}`,
      );
    }
  }

  private mapNode(row: any): MkgNodeModel {
    return {
      id: row.id,
      nodeType: row.nodeType,
      label: row.label,
      aliases: row.aliases ?? [],
      description: row.description,
      properties: (row.properties as Record<string, unknown>) ?? {},
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapEdge(row: any): MkgEdgeModel {
    return {
      id: row.id,
      subjectId: row.subjectId,
      predicate: row.predicate,
      objectId: row.objectId,
      beliefScore: row.beliefScore,
      priorScore: row.priorScore,
      lifecycleState: row.lifecycleState,
      evidenceIds: row.evidenceIds ?? [],
      decisionId: row.decisionId,
      policyVersion: row.policyVersion,
      locality: row.locality,
      properties: (row.properties as Record<string, unknown>) ?? {},
      idempotencyKey: row.idempotencyKey,
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
