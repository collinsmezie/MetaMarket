import type { CapabilityBelief, EvidenceObject } from '../../models/capability';
import type { NormalizedLocation, Vendor, VendorProfile } from '../../models/vendor';

/**
 * Persistence for vendors and their Capability DNA.
 *
 * Evidence is append-only by contract: there is deliberately no update or delete for it, so
 * no caller can quietly rewrite history the beliefs were derived from (CDE §11).
 */

export const VENDOR_REPOSITORY = Symbol('VendorRepository');

export interface CreateVendorInput {
  readonly id: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly businessName: string;
  /** WhatsApp number for request fan-out. Null only for legacy records. */
  readonly contactPhone: string | null;
  readonly location: NormalizedLocation | null;
  readonly conversationSummary: string;
}

export interface VendorMutation {
  readonly businessName?: string;
  readonly contactPhone?: string | null;
  readonly location?: NormalizedLocation | null;
  readonly status?: Vendor['status'];
  readonly conversationSummary?: string;
  readonly declaredProducts?: readonly string[];
  readonly declaredServices?: readonly string[];
  readonly brands?: readonly string[];
  readonly onboardedAt?: Date | null;
  readonly dnaEmbedding?: readonly number[] | null;
}

export interface VendorSimilarityMatch {
  readonly vendorId: string;
  readonly similarity: number;
}

export interface VendorRepositoryPort {
  create(input: CreateVendorInput): Promise<Vendor>;

  findById(vendorId: string): Promise<Vendor | null>;

  /** Looks up the vendor behind a conversation identity (their phone number). */
  findByUserId(userId: string): Promise<Vendor | null>;

  update(vendorId: string, mutation: VendorMutation): Promise<Vendor>;

  /** The vendor together with its current beliefs. */
  loadProfile(vendorId: string): Promise<VendorProfile | null>;

  /** Appends immutable evidence. There is no counterpart that modifies or removes it. */
  appendEvidence(evidence: readonly EvidenceObject[]): Promise<void>;

  /** Full evidence history, oldest first, for recomputing beliefs. */
  loadEvidence(vendorId: string): Promise<readonly EvidenceObject[]>;

  /**
   * Replaces the materialised beliefs for a vendor.
   *
   * Beliefs are derived from evidence, so a wholesale replace is correct here: a partial
   * update could leave a capability whose supporting evidence no longer implies it.
   */
  replaceBeliefs(vendorId: string, beliefs: readonly CapabilityBelief[]): Promise<void>;

  /**
   * Vendors believed to have a capability at or above `minConfidence`.
   *
   * The demand-side entry point that Phase 4 ranking builds on.
   */
  findByCapability(params: {
    capabilityId: string;
    minConfidence: number;
    limit: number;
  }): Promise<readonly VendorProfile[]>;

  /** Vendors whose DNA embedding is nearest a query vector. */
  findSimilarByDna(params: {
    embedding: readonly number[];
    limit: number;
    minSimilarity: number;
  }): Promise<readonly VendorSimilarityMatch[]>;
}
