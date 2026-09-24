import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/adapters/outbound/persistence/prisma.service';
import { AppConfigModule } from '../../src/config/config.module';
import { PrismaClarificationRepository } from '../../src/conversation/adapters/persistence/prisma-clarification.repository';
import { PrismaLogicalTurnRepository } from '../../src/conversation/adapters/persistence/prisma-logical-turn.repository';
import { decideBoundary, type AssemblyLimits } from '../../src/conversation/domain/assembly-policy';
import type { TurnMessage } from '../../src/conversation/domain/logical-turn';
import { ActiveClarificationExistsError } from '../../src/conversation/ports/clarification.repository.port';

/**
 * The atomic turn-assembly protocol against real Postgres (MCOS v4.4 §5A.3.4, §5A.10, §25A.0).
 *
 * Everything asserted here is a property of the database: the `FOR UPDATE` read of the open turn,
 * the partial unique index that forbids two OPEN turns, the compare-and-set seal, the ordered
 * per-conversation claim, and the one-active-clarification index.
 */
describe('Turn assembly protocol', () => {
  let prisma: PrismaService;
  let turns: PrismaLogicalTurnRepository;
  let clarifications: PrismaClarificationRepository;

  const limits: AssemblyLimits = { quietWindowMs: 2_000, maxAssemblyMs: 15_000, maxMessageCount: 8 };
  const t0 = new Date('2026-09-12T12:00:00.000Z');
  const at = (ms: number) => new Date(t0.getTime() + ms);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
      providers: [PrismaService, PrismaLogicalTurnRepository, PrismaClarificationRepository],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    turns = moduleRef.get(PrismaLogicalTurnRepository);
    clarifications = moduleRef.get(PrismaClarificationRepository);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.turnQueueEntry.deleteMany();
    await prisma.logicalTurn.deleteMany();
    await prisma.pendingClarification.deleteMany();
    await prisma.inboundMessage.deleteMany();
    await prisma.conversation.deleteMany();
  });

  afterAll(async () => {
    await prisma.turnQueueEntry.deleteMany();
    await prisma.logicalTurn.deleteMany();
    await prisma.pendingClarification.deleteMany();
    await prisma.$disconnect();
  });

  async function conversation(): Promise<string> {
    const row = await prisma.conversation.create({
      data: { userId: `user-${randomUUID()}`, lastChannel: 'whatsapp' },
    });
    return row.id;
  }

  function message(text: string, receivedAt: Date, payload: string | null = null): TurnMessage {
    return {
      messageId: randomUUID(),
      channel: 'whatsapp',
      senderId: 'user',
      text,
      receivedAt,
      providerEventId: null,
      interactivePayload: payload,
    };
  }

  async function accept(conversationId: string, msg: TurnMessage) {
    await prisma.inboundMessage.create({
      data: {
        id: msg.messageId,
        conversationId,
        userId: msg.senderId,
        channel: msg.channel,
        parts: [{ type: 'text', text: msg.text }],
        metadata: {},
        receivedAt: msg.receivedAt,
      },
    });
    return turns.acceptMessage({
      conversationId,
      channel: 'whatsapp',
      correlationId: 'corr_test',
      message: msg,
      limits,
      decide: (open) =>
        decideBoundary(
          open,
          {
            channel: msg.channel,
            text: msg.text,
            interactivePayload: msg.interactivePayload,
            receivedAt: msg.receivedAt,
          },
          limits,
        ),
    });
  }

  it('coalesces four rapid messages into one logical turn with accumulated text and links each message to it', async () => {
    const conversationId = await conversation();
    const texts = ['I need brake pads', 'Toyota Camry', '2018', 'near Warri'];
    let turnId: string | null = null;

    for (const [index, text] of texts.entries()) {
      const outcome = await accept(conversationId, message(text, at(index * 600)));
      turnId ??= outcome.turn.turnId;
      expect(outcome.turn.turnId).toBe(turnId);
      expect(outcome.turn.status).toBe('OPEN');
    }

    const turn = await turns.findById(turnId!);
    expect(turn!.messageIds).toHaveLength(4);
    expect(turn!.assembledText).toBe('I need brake pads\nToyota Camry\n2018\nnear Warri');
    expect(turn!.revision).toBe(3);
    // Quiet deadline moved with each message, never past the hard deadline.
    expect(turn!.quietDeadlineAt).toEqual(at(1_800 + 2_000));

    const linked = await prisma.inboundMessage.count({ where: { turnId: turnId! } });
    expect(linked).toBe(4);
  });

  it('seals with compare-and-set: exactly one of two concurrent sealers wins, and nothing seals early', async () => {
    const conversationId = await conversation();
    const { turn } = await accept(conversationId, message('I need a wall socket', at(0)));

    // Not due yet: the CAS must refuse.
    expect(await turns.sealIfDue(turn.turnId, turn.revision, at(1_000), 'QUIET_WINDOW_ELAPSED')).toBe(false);

    const [a, b] = await Promise.all([
      turns.sealIfDue(turn.turnId, turn.revision, at(2_100), 'QUIET_WINDOW_ELAPSED'),
      turns.sealIfDue(turn.turnId, turn.revision, at(2_100), 'QUIET_WINDOW_ELAPSED'),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);

    const sealed = await turns.findById(turn.turnId);
    expect(sealed!.status).toBe('SEALED');
    expect(sealed!.assemblyReason).toBe('SINGLE_MESSAGE');

    // A stale revision can never seal a turn that moved on.
    expect(await turns.sealIfDue(turn.turnId, turn.revision, at(5_000), 'QUIET_WINDOW_ELAPSED')).toBe(false);
  });

  it('an explicit retraction cancels the never-executed open turn and the new turn records what it supersedes', async () => {
    const conversationId = await conversation();
    const first = await accept(conversationId, message('I need brake pads', at(0)));
    const second = await accept(conversationId, message('Actually forget that', at(700)));
    const third = await accept(conversationId, message('Find me a plumber', at(1_200)));

    expect(second.cancelledTurnId).toBe(first.turn.turnId);
    expect(second.turn.supersedesTurnId).toBe(first.turn.turnId);
    expect((await turns.findById(first.turn.turnId))!.status).toBe('CANCELLED');
    // The plumber request coalesces with the retraction into the superseding turn.
    expect(third.turn.turnId).toBe(second.turn.turnId);
    expect(third.turn.assembledText).toBe('Actually forget that\nFind me a plumber');
  });

  it('a button tap seals the open turn and forms its own sealed single-message turn', async () => {
    const conversationId = await conversation();
    const open = await accept(conversationId, message('I need brake pads', at(0)));
    const tap = await accept(conversationId, message('Yes, continue', at(300), 'mm|wf-1|resume'));

    expect(tap.sealedTurnIds).toEqual([open.turn.turnId, tap.turn.turnId]);
    expect(tap.turn.status).toBe('SEALED');
    expect(tap.turn.boundaryReason).toBe('INTERACTIVE_PAYLOAD');
    expect((await turns.findById(open.turn.turnId))!.status).toBe('SEALED');
  });

  it('never opens two OPEN turns for one conversation under concurrent first messages', async () => {
    const conversationId = await conversation();
    const outcomes = await Promise.all(
      ['I need', 'wall socket', 'white one'].map((text, index) =>
        accept(conversationId, message(text, at(index * 10))),
      ),
    );
    const openTurns = await prisma.logicalTurn.count({ where: { conversationId, status: 'OPEN' } });
    expect(openTurns).toBe(1);
    expect(new Set(outcomes.map((outcome) => outcome.turn.turnId)).size).toBe(1);
  });

  it('enqueues idempotently with a monotonic sequence and claims strictly in order per conversation', async () => {
    const conversationId = await conversation();
    const other = await conversation();

    const a = await accept(conversationId, message('first', at(0), 'mm|x|a'));
    const b = await accept(conversationId, message('second', at(100), 'mm|x|b'));
    const c = await accept(other, message('elsewhere', at(50), 'mm|x|c'));

    const qa = await turns.enqueue(a.turn.turnId);
    const qaAgain = await turns.enqueue(a.turn.turnId);
    const qb = await turns.enqueue(b.turn.turnId);
    const qc = await turns.enqueue(c.turn.turnId);
    expect(qa!.queueId).toBe(qaAgain!.queueId);
    expect(qa!.sequence).toBe(1);
    expect(qb!.sequence).toBe(2);
    expect(qc!.sequence).toBe(1);

    // Two workers race: they get disjoint conversations, and conversation 1's second turn is never
    // claimable while its first is in flight.
    const [w1, w2, w3] = await Promise.all([
      turns.claimNext('w1'),
      turns.claimNext('w2'),
      turns.claimNext('w3'),
    ]);
    const claimed = [w1, w2, w3].filter((entry) => entry !== null);
    expect(claimed).toHaveLength(2);
    expect(new Set(claimed.map((entry) => entry!.conversationId)).size).toBe(2);
    expect(claimed.find((entry) => entry!.conversationId === conversationId)!.turnId).toBe(a.turn.turnId);

    expect(await turns.claimNext('w4', conversationId)).toBeNull();

    await turns.markProcessing(a.turn.turnId, `turn:${a.turn.turnId}`, randomUUID(), at(200));
    await turns.complete({
      turnId: a.turn.turnId,
      status: 'COMMITTED',
      completedAt: at(300),
      summary: {
        turnId: a.turn.turnId,
        outcome: 'COMMITTED',
        intentTypes: [],
        objectIds: [],
        workflowIds: [],
        summary: 'ok',
      },
      error: null,
    });

    const next = await turns.claimNext('w4', conversationId);
    expect(next!.turnId).toBe(b.turn.turnId);
    expect(await turns.latestSummaryBefore(conversationId, b.turn.firstMessageAt)).toMatchObject({
      outcome: 'COMMITTED',
    });
  });

  it('requeues a failed attempt and recovers stale claims without duplicating work', async () => {
    const conversationId = await conversation();
    const { turn } = await accept(conversationId, message('hello', at(0), 'mm|x|h'));
    await turns.enqueue(turn.turnId);

    const claimed = await turns.claimNext('w1');
    expect(claimed!.attempts).toBe(1);
    await turns.requeue(turn.turnId, 'boom');
    expect((await turns.queueEntry(turn.turnId))!.status).toBe('QUEUED');

    const again = await turns.claimNext('w2');
    expect(again!.attempts).toBe(2);
    // Simulate a dead worker: claim is older than the TTL.
    await prisma.turnQueueEntry.update({ where: { turnId: turn.turnId }, data: { claimedAt: at(-600_000) } });
    expect(await turns.recoverStaleClaims(at(-1), 3)).toBe(1);
    expect((await turns.queueEntry(turn.turnId))!.status).toBe('QUEUED');
    // Attempts exhausted → not recovered.
    await turns.claimNext('w3');
    await prisma.turnQueueEntry.update({
      where: { turnId: turn.turnId },
      data: { claimedAt: at(-600_000), attempts: 3 },
    });
    expect(await turns.recoverStaleClaims(at(-1), 3)).toBe(0);
  });

  it('allows exactly one active clarification per conversation and keeps history append-only', async () => {
    const conversationId = await conversation();
    const originating = await accept(conversationId, message('Find me a pump', at(0), 'mm|x|p'));
    const base = {
      conversationId,
      originatingTurnId: originating.turn.turnId,
      question: 'Is it for water or fuel?',
      targetActionIds: ['a1'],
      targetIntentIds: ['i1'],
      blocking: true,
      askedAt: at(100),
      expiresAt: null,
      expectedResolution: null,
      contextSnapshotId: null,
      issueKey: 'object:o1:referent',
    };

    const first = await clarifications.create({ ...base, clarificationId: randomUUID() });
    await expect(clarifications.create({ ...base, clarificationId: randomUUID() })).rejects.toBeInstanceOf(
      ActiveClarificationExistsError,
    );

    const answered = await clarifications.transition({
      clarificationId: first.clarificationId,
      expectedVersion: first.version,
      to: 'ANSWER_RECEIVED',
      at: at(5_000),
      answerMessageIds: ['m9'],
      answerTurnId: randomUUID(),
    });
    expect(answered!.status).toBe('ANSWER_RECEIVED');
    // A stale version loses the CAS.
    expect(
      await clarifications.transition({
        clarificationId: first.clarificationId,
        expectedVersion: first.version,
        to: 'RESOLVED',
        at: at(6_000),
      }),
    ).toBeNull();

    const resolved = await clarifications.transition({
      clarificationId: first.clarificationId,
      expectedVersion: answered!.version,
      to: 'RESOLVED',
      at: at(6_000),
    });
    expect(resolved!.status).toBe('RESOLVED');
    expect(resolved!.resolvedAt).toEqual(at(6_000));

    // Once resolved, a new question may be asked; history remains.
    await clarifications.create({ ...base, clarificationId: randomUUID(), question: 'Which brand?' });
    expect(await clarifications.listForConversation(conversationId, 10)).toHaveLength(2);
    expect(await clarifications.historyForIssue(conversationId, 'object:o1:referent', 5)).toHaveLength(2);
  });
});
