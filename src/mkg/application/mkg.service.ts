import { Inject, Injectable } from '@nestjs/common';
import type {
  KnowledgeQuery,
  MarketConceptKnowledge,
} from '../../enrichment/ports/mkg-read.port';
import type {
  GraphChangeCommand,
  GraphMutationResult,
  MkgNodeModel,
  MkgTraversalPath,
  MkgTraverseOptions,
} from '../domain/mkg-models';
import {
  type CapabilityContextResult,
  MKG_READ_PORT,
  type MkgReadPort,
} from '../ports/mkg-read.port';
import { MKG_WRITE_PORT, type MkgWritePort } from '../ports/mkg-write.port';

@Injectable()
export class MkgService implements MkgReadPort, MkgWritePort {
  constructor(
    @Inject(MKG_READ_PORT) private readonly readPort: MkgReadPort,
    @Inject(MKG_WRITE_PORT) private readonly writePort: MkgWritePort,
  ) {}

  async traverseGraph(options: MkgTraverseOptions): Promise<readonly MkgTraversalPath[]> {
    return this.readPort.traverseGraph(options);
  }

  async getNode(nodeId: string): Promise<MkgNodeModel | null> {
    return this.readPort.getNode(nodeId);
  }

  async getNodes(nodeIds: readonly string[]): Promise<readonly MkgNodeModel[]> {
    return this.readPort.getNodes(nodeIds);
  }

  async getCapabilityContext(conceptId: string, minBelief = 0.5): Promise<CapabilityContextResult> {
    return this.readPort.getCapabilityContext(conceptId, minBelief);
  }

  async knowledgeFor(query: KnowledgeQuery): Promise<readonly MarketConceptKnowledge[]> {
    return this.readPort.knowledgeFor(query);
  }

  async applyGraphChange(command: GraphChangeCommand): Promise<GraphMutationResult> {
    return this.writePort.applyGraphChange(command);
  }

  async upsertNode(node: {
    readonly id: string;
    readonly nodeType: string;
    readonly label: string;
    readonly aliases?: readonly string[];
    readonly description?: string | null;
    readonly properties?: Readonly<Record<string, unknown>>;
  }): Promise<MkgNodeModel> {
    return this.writePort.upsertNode(node);
  }
}
