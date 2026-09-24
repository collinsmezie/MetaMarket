import { CHAOS_TRANSCRIPT } from '../harness/chaos-transcript';
import { ChaosHarness, formatScorecard, type Scorecard } from '../harness/conversation-harness';

/**
 * Chaos replay (MCOS TDR v4.4 §52): the canonical transcript driven through the real pipeline —
 * turn assembly, the LangGraph orchestrator, the workflow engine — on both channels with a
 * scripted-correct LLM.
 *
 * This is a *measurement*, not a acceptance suite — the scorecard it prints is what the two
 * branches are compared on (TDR §7). Deliberately few assertions: they pin the two facts that
 * must not drift silently, and the printed scorecard carries everything else.
 *
 * Every expectation here is a Definition-of-Done item for the orchestrator (MCOS §60).
 */

describe('Chaotic conversation replay', () => {
  const scorecards: Scorecard[] = [];

  beforeAll(async () => {
    for (const channel of ['whatsapp', 'web'] as const) {
      const harness = new ChaosHarness(channel);

      try {
        await harness.start();
        await harness.reset();
        scorecards.push(await harness.replay(CHAOS_TRANSCRIPT));
      } finally {
        await harness.stop();
      }
    }

    // Printed so a CI run is a measurement rather than just pass/fail.
    for (const scorecard of scorecards) console.log(formatScorecard(scorecard));
  });

  it('serves the same objectives on WhatsApp and web', () => {
    const [whatsapp, web] = scorecards;

    // No business rule may branch on the channel (MCOS §3.1). Reply *text* may legitimately
    // differ once formatting is channel-aware, so only the objectives are compared.
    expect(web.turns.map((turn) => turn.objectivesServed)).toEqual(
      whatsapp.turns.map((turn) => turn.objectivesServed),
    );
  });

  it('never goes silent, and never destroys the parked objective', () => {
    for (const scorecard of scorecards) {
      for (const turn of scorecard.turns) {
        expect(turn.reply.length).toBeGreaterThan(0);
      }

      // Suspension over destruction (MCOS §16): the onboarding survives the digression and the
      // multi-intent turn, whatever else those turns get wrong.
      for (const turn of scorecard.turns.slice(1)) {
        const onboarding = turn.instances.find((instance) => instance.type === 'VendorOnboarding');
        expect(onboarding?.status).toMatch(/^(active|suspended)$/);
      }
    }
  });

  it('answers a digression and offers the way back to the parked objective', () => {
    for (const scorecard of scorecards) {
      const digression = scorecard.turns[1];

      expect(digression.objectivesServed).toContain('PlatformInfo');
      expect(digression.replyMissing).toEqual([]);
      // Parked, not abandoned, and the user is told how to return to it.
      expect(digression.reply).toContain('carry on');
    }
  });

  it('serves both objectives in a multi-intent turn', () => {
    for (const scorecard of scorecards) {
      const multiIntent = scorecard.turns[2];

      expect(multiIntent.objectivesServed).toEqual(['VendorOnboarding', 'BuyerSearch']);
      expect(multiIntent.replyMissing).toEqual([]);

      // The mechanism, not just the outcome (MCOS §13, §65.3): one IDCE call and one CSRE call
      // per logical turn — understanding is joined, never re-run per fragment — and no legacy
      // segmentation. Asserting this stops a future change from producing the right answer by
      // luck, say by classifying the whole turn as a search.
      const specialist = (prefix: string) =>
        multiIntent.llmOperations.filter((operation) => operation.startsWith(prefix));
      expect(specialist('idce.master.discover@')).toHaveLength(1);
      expect(specialist('csre.runtime.resolve@')).toHaveLength(1);
      expect(multiIntent.llmOperations).not.toContain('utterance_segmentation');
    }
  });

  it('drops nothing across the transcript, at a bounded cost', () => {
    for (const scorecard of scorecards) {
      expect(scorecard.objectivesDropped).toEqual([]);

      // Segmentation multiplies the per-turn work, so cost is a first-class result (TDR §7).
      // The ceiling is here to catch a routing change that fans out without bound, not to
      // pin an exact number.
      expect(scorecard.llmCallCount).toBeLessThanOrEqual(20);
    }
  });
});
