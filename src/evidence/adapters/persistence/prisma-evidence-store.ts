import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type BeliefHistory as HistoryRow,
  type Evidence as EvidenceRow,
  type EvidenceAssertion as AssertionRow,
  type GraphChangeDecision as DecisionRow,
  type Knowledge as KnowledgeRow,
  type Observation as ObservationRow,
} from '@prisma/client';
import { PrismaService } from '../../../adapters/outbound/persistence/prisma.service';
import type {
  ActorRole,
  AssertionContext,
  BeliefDirection,
  EvidenceKind,
  GraphChangeDecision,
  GraphOperation,
  KnowledgeState,
  NodeType,
  NormalizedEvidence,
  ObservationInput,
  ObservationType,
  Polarity,
  Provenance,
  RelevanceDecision,
} from '../../domain/evidence-model';
import type {
  AssertionRecord,
  AssertionUpsert,
  BeliefHistoryEntry,
  EvidenceRecord,
  EvidenceStorePort,
  GraphChangeDecisionRecord,
  GraphChangeDecisionStatus,
  KnowledgeRecord,
  KnowledgeUpsert,
  ObservationRecord,
  ObservationStatus,
} from '../../ports/evidence-store.port';

type Wire = Record<string, unknown>;
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const jsonOrNull = (value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull =>
  value === null || value === undefined ? Prisma.JsonNull : json(value);

/**
 * Append-only persistence for observations, evidence, belief history and decisions; upsert for
 * the derived assertion and knowledge views (Evidence TDR §15, §24, §40, §44). Observation and
 * evidence identity is deterministic, so duplicate delivery is a no-op at the unique index.
 */
@Injectable()
export class PrismaEvidenceStore implements EvidenceStorePort {
  constructor(private readonly prisma: PrismaService) {}

  async recordObservation(observation: ObservationInput): Promise<ObservationRecord | null> {
    try {
      const row = await this.prisma.observation.create({
        data: {
          observationId: observation.observationId,
          observationType: observation.observationType,
          sourceComponent: observation.source.component,
          sourceVersion: observation.source.version,
          sourceEventId: observation.source.eventId,
          requestId: observation.source.requestId,
          conversationId: observation.interaction.conversationId,
          turnId: observation.interaction.turnId,
          runId: observation.interaction.runId,
          workflowId: observation.interaction.workflowId,
          actionId: observation.interaction.actionId,
          interactionId: observation.interaction.interactionId,
          actorId: observation.actor?.id ?? null,
          actorRole: observation.actor?.role ?? null,
          channel: observation.channel,
          country: observation.context.country ?? null,
          region: observation.context.region ?? null,
          context: json(observation.context),
          payload: json(observation.payload),
          rawText: observation.rawText,
          observedAt: observation.observedAt,
        },
      });
      return toObservation(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
      throw error;
    }
  }

  async findObservation(observationId: string) {
    const row = await this.prisma.observation.findUnique({ where: { observationId } });
    return row === null ? null : toObservation(row);
  }

  async completeObservation(
    observationId: string,
    status: ObservationStatus,
    evidenceCount: number,
    error: { code: string; message: string } | null,
  ) {
    await this.prisma.observation.update({
      where: { observationId },
      data: { status, evidenceCount, error: error === null ? Prisma.JsonNull : error },
    });
  }

  async appendEvidence(items: readonly NormalizedEvidence[]) {
    if (items.length === 0) return [];
    await this.prisma.evidence.createMany({
      data: items.map((item) => ({
        evidenceId: item.evidenceId,
        observationId: item.observationId,
        assertionId: item.assertionId,
        subject: item.assertion.subject,
        predicate: item.assertion.predicate,
        object: item.assertion.object,
        subjectType: item.subjectType,
        objectType: item.objectType,
        subjectLabel: item.subjectLabel,
        objectLabel: item.objectLabel,
        polarity: item.polarity,
        strength: item.strength,
        kind: item.kind,
        claim: item.claim,
        supports: [...item.supports],
        contradicts: [...item.contradicts],
        provenance: json(item.provenance),
        independenceKey: item.independenceKey,
        observedAt: item.observedAt,
        validFrom: item.validFrom,
        validUntil: item.validUntil,
        country: item.context.country,
        region: item.context.region,
        sourcePayload: json(item.sourcePayload),
      })),
      skipDuplicates: true,
    });
    const rows = await this.prisma.evidence.findMany({
      where: { evidenceId: { in: items.map((item) => item.evidenceId) } },
      orderBy: { evidenceId: 'asc' },
    });
    return rows.map(toEvidence);
  }

  async evidenceForAssertion(assertionId: string) {
    return (
      await this.prisma.evidence.findMany({ where: { assertionId }, orderBy: { observedAt: 'asc' } })
    ).map(toEvidence);
  }

  async evidenceForObservation(observationId: string) {
    return (
      await this.prisma.evidence.findMany({ where: { observationId }, orderBy: { evidenceId: 'asc' } })
    ).map(toEvidence);
  }

  async evidenceForRequest(requestId: string) {
    return (
      await this.prisma.evidence.findMany({
        where: { observation: { requestId } },
        orderBy: { observedAt: 'asc' },
      })
    ).map(toEvidence);
  }

  async findAssertion(assertionId: string) {
    const row = await this.prisma.evidenceAssertion.findUnique({ where: { assertionId } });
    return row === null ? null : toAssertion(row);
  }

  async findAssertions(assertionIds: readonly string[]) {
    if (assertionIds.length === 0) return [];
    return (
      await this.prisma.evidenceAssertion.findMany({ where: { assertionId: { in: [...assertionIds] } } })
    ).map(toAssertion);
  }

  async assertionsForNode(nodeId: string, predicates: readonly string[] | null) {
    const rows = await this.prisma.evidenceAssertion.findMany({
      where: {
        OR: [{ subject: nodeId }, { object: nodeId }],
        ...(predicates === null ? {} : { predicate: { in: [...predicates] } }),
      },
      orderBy: { belief: 'desc' },
      take: 200,
    });
    return rows.map(toAssertion);
  }

  async upsertAssertion(assertion: AssertionUpsert) {
    const data = {
      subject: assertion.assertion.subject,
      predicate: assertion.assertion.predicate,
      object: assertion.assertion.object,
      subjectType: assertion.subjectType,
      objectType: assertion.objectType,
      subjectLabel: assertion.subjectLabel,
      objectLabel: assertion.objectLabel,
      country: assertion.context.country,
      region: assertion.context.region,
      knowledgeType: assertion.knowledgeType,
      prior: assertion.prior,
      belief: assertion.belief,
      direction: assertion.direction,
      state: assertion.state,
      observationCount: assertion.observationCount,
      evidenceCount: assertion.evidenceCount,
      independentSourceCount: assertion.independentSourceCount,
      positiveCount: assertion.counts.POSITIVE,
      negativeCount: assertion.counts.NEGATIVE,
      neutralCount: assertion.counts.NEUTRAL,
      contradictoryCount: assertion.counts.CONTRADICTORY,
      requiresMoreEvidence: assertion.requiresMoreEvidence,
      firstObservedAt: assertion.firstObservedAt,
      lastObservedAt: assertion.lastObservedAt,
      lastFusedAt: assertion.lastFusedAt,
      policyVersion: assertion.policyVersion,
      fusion: json(assertion.fusion),
    };
    const row = await this.prisma.evidenceAssertion.upsert({
      where: { assertionId: assertion.assertionId },
      create: { assertionId: assertion.assertionId, ...data },
      update: data,
    });
    return toAssertion(row);
  }

  async appendBeliefHistory(entry: BeliefHistoryEntry) {
    await this.prisma.beliefHistory.create({
      data: {
        assertionId: entry.assertionId,
        score: entry.score,
        previousScore: entry.previousScore,
        reason: entry.reason,
        evidenceIds: [...entry.evidenceIds],
        policyVersion: entry.policyVersion,
        recordedAt: entry.recordedAt,
      },
    });
  }

  async beliefHistory(assertionId: string) {
    return (
      await this.prisma.beliefHistory.findMany({ where: { assertionId }, orderBy: { recordedAt: 'asc' } })
    ).map(toHistory);
  }

  async upsertKnowledge(knowledge: KnowledgeUpsert) {
    const data = {
      assertionId: knowledge.assertionId,
      type: knowledge.type,
      claim: json(knowledge.claim),
      scope: json(knowledge.scope),
      confidence: knowledge.confidence,
      state: knowledge.state,
      supportedBy: [...knowledge.supportedBy],
      contradictedBy: [...knowledge.contradictedBy],
      lastValidatedAt: knowledge.lastValidatedAt,
    };
    const row = await this.prisma.knowledge.upsert({
      where: { knowledgeId: knowledge.knowledgeId },
      create: { knowledgeId: knowledge.knowledgeId, ...data },
      update: data,
    });
    return toKnowledge(row);
  }

  async knowledgeForAssertions(assertionIds: readonly string[]) {
    if (assertionIds.length === 0) return [];
    return (await this.prisma.knowledge.findMany({ where: { assertionId: { in: [...assertionIds] } } })).map(
      toKnowledge,
    );
  }

  async knowledgeByType(type: string, states: readonly KnowledgeState[], limit: number) {
    return (
      await this.prisma.knowledge.findMany({
        where: { type, state: { in: [...states] } },
        orderBy: { confidence: 'desc' },
        take: limit,
      })
    ).map(toKnowledge);
  }

  async knowledgeForNodes(nodeIds: readonly string[], states: readonly KnowledgeState[]) {
    if (nodeIds.length === 0) return [];
    const assertions = await this.prisma.evidenceAssertion.findMany({
      where: { OR: [{ subject: { in: [...nodeIds] } }, { object: { in: [...nodeIds] } }] },
      select: { assertionId: true },
    });
    if (assertions.length === 0) return [];
    return (
      await this.prisma.knowledge.findMany({
        where: { assertionId: { in: assertions.map((a) => a.assertionId) }, state: { in: [...states] } },
        orderBy: { confidence: 'desc' },
      })
    ).map(toKnowledge);
  }

  async recordDecision(decision: GraphChangeDecision) {
    const row = await this.prisma.graphChangeDecision.upsert({
      where: { decisionId: decision.decisionId },
      create: {
        decisionId: decision.decisionId,
        assertionId: decision.assertionId,
        operation: decision.operation,
        relevanceDecision: decision.relevanceDecision,
        subjectId: decision.subjectId,
        predicate: decision.predicate,
        objectId: decision.objectId,
        beliefScore: decision.beliefScore,
        reasonCodes: [...decision.reasonCodes],
        evidenceIds: [...decision.evidenceIds],
        policyVersion: decision.policyVersion,
        correlationId: decision.correlationId,
        runId: decision.runId,
        createdAt: decision.createdAt,
      },
      update: {},
    });
    await this.prisma.evidenceAssertion
      .update({ where: { assertionId: decision.assertionId }, data: { decisionCount: { increment: 1 } } })
      .catch(() => undefined);
    return toDecision(row);
  }

  async markDecision(
    decisionId: string,
    status: GraphChangeDecisionStatus,
    failure: string | null,
    at: Date,
  ) {
    await this.prisma.graphChangeDecision.update({
      where: { decisionId },
      data: { status, failure, appliedAt: status === 'APPLIED' ? at : null },
    });
  }

  async decisionsForAssertion(assertionId: string) {
    return (
      await this.prisma.graphChangeDecision.findMany({
        where: { assertionId },
        orderBy: { createdAt: 'asc' },
      })
    ).map(toDecision);
  }

  async decisionsForRun(runId: string) {
    return (
      await this.prisma.graphChangeDecision.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } })
    ).map(toDecision);
  }

  async pendingDecisions(limit: number) {
    return (
      await this.prisma.graphChangeDecision.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: limit,
      })
    ).map(toDecision);
  }

  async observationsForRun(runId: string) {
    return (await this.prisma.observation.findMany({ where: { runId }, orderBy: { observedAt: 'asc' } })).map(
      toObservation,
    );
  }

  async observationsForRequest(requestId: string) {
    return (
      await this.prisma.observation.findMany({ where: { requestId }, orderBy: { observedAt: 'asc' } })
    ).map(toObservation);
  }
}

function toObservation(row: ObservationRow): ObservationRecord {
  return {
    id: row.id,
    observationId: row.observationId,
    observationType: row.observationType as ObservationType,
    source: {
      component: row.sourceComponent,
      version: row.sourceVersion,
      eventId: row.sourceEventId,
      requestId: row.requestId,
    },
    actor: row.actorId === null ? null : { id: row.actorId, role: (row.actorRole ?? 'UNKNOWN') as ActorRole },
    channel: row.channel,
    interaction: {
      conversationId: row.conversationId,
      turnId: row.turnId,
      runId: row.runId,
      workflowId: row.workflowId,
      actionId: row.actionId,
      interactionId: row.interactionId,
    },
    observedAt: row.observedAt,
    context: { ...((row.context as Wire) ?? {}), country: row.country, region: row.region },
    payload: (row.payload as Wire) ?? {},
    rawText: row.rawText,
    status: row.status as ObservationStatus,
    evidenceCount: row.evidenceCount,
    error: (row.error as { code: string; message: string } | null) ?? null,
    ingestedAt: row.ingestedAt,
  };
}

function toEvidence(row: EvidenceRow): EvidenceRecord {
  return {
    id: row.id,
    evidenceId: row.evidenceId,
    observationId: row.observationId,
    assertion: { subject: row.subject, predicate: row.predicate, object: row.object },
    assertionId: row.assertionId,
    subjectType: row.subjectType as NodeType,
    objectType: row.objectType as NodeType,
    subjectLabel: row.subjectLabel,
    objectLabel: row.objectLabel,
    polarity: row.polarity as Polarity,
    strength: row.strength,
    kind: row.kind as EvidenceKind,
    claim: row.claim,
    supports: row.supports,
    contradicts: row.contradicts,
    provenance: row.provenance as unknown as Provenance,
    independenceKey: row.independenceKey,
    observedAt: row.observedAt,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    context: { country: row.country, region: row.region },
    sourcePayload: (row.sourcePayload as Wire) ?? {},
    createdAt: row.createdAt,
  };
}

function toAssertion(row: AssertionRow): AssertionRecord {
  const context: AssertionContext = { country: row.country, region: row.region };
  return {
    id: row.id,
    assertionId: row.assertionId,
    assertion: { subject: row.subject, predicate: row.predicate, object: row.object },
    subjectType: row.subjectType as NodeType,
    objectType: row.objectType as NodeType,
    subjectLabel: row.subjectLabel,
    objectLabel: row.objectLabel,
    context,
    knowledgeType: row.knowledgeType,
    prior: row.prior,
    belief: row.belief,
    direction: row.direction as BeliefDirection,
    state: row.state as KnowledgeState,
    observationCount: row.observationCount,
    evidenceCount: row.evidenceCount,
    independentSourceCount: row.independentSourceCount,
    counts: {
      POSITIVE: row.positiveCount,
      NEGATIVE: row.negativeCount,
      NEUTRAL: row.neutralCount,
      CONTRADICTORY: row.contradictoryCount,
    },
    requiresMoreEvidence: row.requiresMoreEvidence,
    firstObservedAt: row.firstObservedAt,
    lastObservedAt: row.lastObservedAt,
    lastFusedAt: row.lastFusedAt,
    policyVersion: row.policyVersion,
    fusion: (row.fusion as Wire | null) ?? null,
    decisionCount: row.decisionCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toHistory(row: HistoryRow): BeliefHistoryEntry & { id: string } {
  return {
    id: row.id,
    assertionId: row.assertionId,
    score: row.score,
    previousScore: row.previousScore,
    reason: row.reason,
    evidenceIds: row.evidenceIds,
    policyVersion: row.policyVersion,
    recordedAt: row.recordedAt,
  };
}

function toKnowledge(row: KnowledgeRow): KnowledgeRecord {
  return {
    id: row.id,
    knowledgeId: row.knowledgeId,
    assertionId: row.assertionId,
    type: row.type,
    claim: (row.claim as Wire) ?? {},
    scope: (row.scope as Wire) ?? {},
    confidence: row.confidence,
    state: row.state as KnowledgeState,
    supportedBy: row.supportedBy,
    contradictedBy: row.contradictedBy,
    createdAt: row.createdAt,
    lastValidatedAt: row.lastValidatedAt,
    updatedAt: row.updatedAt,
  };
}

function toDecision(row: DecisionRow): GraphChangeDecisionRecord {
  return {
    id: row.id,
    decisionId: row.decisionId,
    assertionId: row.assertionId,
    operation: row.operation as GraphOperation,
    relevanceDecision: row.relevanceDecision as RelevanceDecision,
    subjectId: row.subjectId,
    predicate: row.predicate,
    objectId: row.objectId,
    beliefScore: row.beliefScore,
    reasonCodes: row.reasonCodes,
    evidenceIds: row.evidenceIds,
    policyVersion: row.policyVersion,
    correlationId: row.correlationId,
    runId: row.runId,
    createdAt: row.createdAt,
    status: row.status as GraphChangeDecisionStatus,
    appliedAt: row.appliedAt,
    failure: row.failure,
  };
}

export { jsonOrNull };
