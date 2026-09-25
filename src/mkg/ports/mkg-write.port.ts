import type {
  GraphChangeCommand,
  GraphMutationResult,
  MkgNodeModel,
} from '../domain/mkg-models';

export const MKG_WRITE_PORT = Symbol('MkgWritePort');

/**
 * Authoritative MKG Write Port (MKG TDR §12, §22, §26).
 * Only trusted application events derived from an approved GraphChangeDecision may cross this port.
 */
export interface MkgWritePort {
  /**
   * Applies an idempotent graph change command.
   * Validates topology, predicate semantics, and updates edge lifecycle.
   */
  applyGraphChange(command: GraphChangeCommand): Promise<GraphMutationResult>;

  /**
   * Upserts a node in the graph if it doesn't already exist.
   */
  upsertNode(node: {
    readonly id: string;
    readonly nodeType: string;
    readonly label: string;
    readonly aliases?: readonly string[];
    readonly description?: string | null;
    readonly properties?: Readonly<Record<string, unknown>>;
  }): Promise<MkgNodeModel>;
}
