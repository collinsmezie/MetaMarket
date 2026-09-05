import { CHAOS_TRANSCRIPT } from '../harness/chaos-transcript';
import { ChaosHarness, formatScorecard, type Scorecard } from '../harness/conversation-harness';

/**
 * Chaos replay: the transcript from Conversation-Core-Comparison TDR §3, driven through the
 * real pipeline on both channels with a scripted-correct LLM.
 *
 * This is a *measurement*, not a acceptance suite — the scorecard it prints is what the two
 * branches are compared on (TDR §7). Deliberately few assertions: they pin the two facts that
 * must not drift silently, and the printed scorecard carries everything else.
 *
 * The gaps recorded below are the baseline this branch starts from. When segmentation and the
 * PlatformInfo workflow land, these expectations invert — which is the point of writing them
 * down as code rather than prose.
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

  it('records the current gaps: an unanswerable digression and a dropped second objective', () => {
    for (const scorecard of scorecards) {
      const [, digression, multiIntent] = scorecard.turns;

      // GAP-1: nothing claims a pricing intent, so routing is unroutable and the turn gets the
      // fallback envelope instead of an answer.
      expect(digression.objectivesDropped).toEqual(['PlatformInfo']);
      expect(digression.reply).toContain('Welcome to MetaMarket');

      // GAP-2: one turn, one routing decision — the buyer search half is dropped entirely.
      expect(multiIntent.objectivesDropped).toEqual(['BuyerSearch']);

      // GAP-3: the cause. `needsUnderstanding = !isContinuing(...)` means a continuation never
      // reaches intent resolution, so the second objective is not merely mis-routed — it is
      // never classified at all.
      expect(multiIntent.llmOperations).not.toContain('intent_resolution');
    }
  });
});
