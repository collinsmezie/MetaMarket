import type { TurnContextSnapshot } from '../domain/turn-context';

export const TURN_CONTEXT_REPOSITORY = Symbol('TurnContextRepository');

/** Persistence for bounded per-turn context snapshots (Overarching §18.8). */
export interface TurnContextRepositoryPort {
  save(snapshot: TurnContextSnapshot): Promise<void>;
  findById(snapshotId: string): Promise<TurnContextSnapshot | null>;
  findByTurnId(turnId: string): Promise<TurnContextSnapshot | null>;
}
