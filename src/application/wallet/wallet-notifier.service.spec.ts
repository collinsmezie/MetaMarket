import { RecordingStageLogger } from '@test/fakes';
import type { Response } from '../../domain/models/response';
import type {
  ChannelNotifierRegistryPort,
  DeliveryResult,
  DeliveryTarget,
} from '../../domain/ports/outbound/channel-notifier.port';
import type { ConversationContextManager } from '../conversation/conversation-context.manager';
import { WalletNotifier } from './wallet-notifier.service';

/**
 * Wallet pushes (TDR §12, §25.7, §25.12).
 *
 * Two properties are worth testing here and nothing else really is. First the copy has to match
 * what actually happened — a vendor who was charged, skipped, or given a freebie must not be
 * told one of the other two stories. Second, none of these may throw: every one of them fires
 * after money has already moved, so a failed message must stay a failed message.
 */
function build(options: { supported?: boolean; result?: DeliveryResult; throws?: Error } = {}) {
  const sent: { address: string; response: Response }[] = [];
  const recorded: string[] = [];

  const notifiers: ChannelNotifierRegistryPort = {
    supports: () => options.supported ?? true,
    forChannel: () => ({
      channel: 'whatsapp',
      async send(target: DeliveryTarget, response: Response) {
        if (options.throws !== undefined) throw options.throws;
        sent.push({ address: target.address, response });
        return options.result ?? { delivered: true, providerMessageId: 'wamid.1' };
      },
    }),
  } as unknown as ChannelNotifierRegistryPort;

  const context = {
    async recordAssistantTurn(params: { content: string }) {
      recorded.push(params.content);
    },
  } as unknown as ConversationContextManager;

  const logger = new RecordingStageLogger();

  return { notifier: new WalletNotifier(notifiers, logger, context), sent, recorded, logger };
}

const target = { userId: '+2348012345678', conversationId: 'conv_1' };

describe('WalletNotifier.notifyInsufficient', () => {
  it('tells a skipped vendor they missed a lead, and what it would have cost', async () => {
    const { notifier, sent } = build();

    await notifier.notifyInsufficient({
      ...target,
      capabilityName: 'Hammers',
      requiredCredits: 100,
      balance: 40,
      variant: 'lead',
    });

    const text = sent[0].response.text ?? '';
    expect(text).toContain('You missed a lead');
    expect(text).toContain('Hammers');
    expect(text).toContain('40 credits');
    expect(text).toContain('100-credit visibility fee');
  });

  it('tells a responder their yes did not reach the customer, not that they missed a lead', async () => {
    // A vendor who knows they answered would read "you missed a lead" as a platform bug.
    const { notifier, sent } = build();

    await notifier.notifyInsufficient({
      ...target,
      capabilityName: 'Hammers',
      requiredCredits: 100,
      balance: 0,
      variant: 'responder',
    });

    const text = sent[0].response.text ?? '';
    expect(text).toContain('You said yes');
    expect(text).not.toContain('You missed a lead');
  });

  it('offers the recharge action with the reserved system payload', async () => {
    // `system` is what makes the tap start a fresh CreditRecharge rather than resume anything.
    const { notifier, sent } = build();

    await notifier.notifyInsufficient({
      ...target,
      capabilityName: 'Hammers',
      requiredCredits: 100,
      balance: 0,
      variant: 'lead',
    });

    expect(sent[0].response.actions).toEqual([
      { type: 'quick_reply', title: '⚡ Recharge Now', payload: 'mm|system|recharge' },
    ]);
  });
});

describe('WalletNotifier.notifyConnected', () => {
  it('names the deduction and the new balance, so the charge is never a surprise', async () => {
    const { notifier, sent } = build();

    await notifier.notifyConnected({
      ...target,
      capabilityName: 'Hammers',
      credits: 100,
      balanceAfter: 1_900,
    });

    const text = sent[0].response.text ?? '';
    expect(text).toContain("You're in — your profile has been sent to the customer.");
    expect(text).toContain('1900 Credits');
  });
});

describe('WalletNotifier.notifyFreeTrial', () => {
  it('says the lead was free and that the trial is temporary', async () => {
    const { notifier, sent } = build();

    await notifier.notifyFreeTrial({ ...target, capabilityName: 'Hammers' });

    const text = sent[0].response.text ?? '';
    expect(text).toContain('Free trial');
    expect(text).toContain('free of charge');
    expect(text).not.toContain('deducted');
    expect(sent[0].response.actions).toHaveLength(1);
  });
});

describe('WalletNotifier.notifyOnboardingCredit', () => {
  it('welcomes the vendor with their starting balance and no recharge prompt', async () => {
    // They are funded; a recharge button here would be noise.
    const { notifier, sent } = build();

    await notifier.notifyOnboardingCredit({ ...target, credits: 2_000, balanceAfter: 2_000 });

    const text = sent[0].response.text ?? '';
    expect(text).toContain('Welcome, Grant Received!');
    expect(text).toContain('2000 free visibility credits');
    expect(sent[0].response.actions).toBeUndefined();
  });
});

describe('WalletNotifier failure handling', () => {
  it('records the failure without throwing when no channel is registered', async () => {
    const { notifier, logger } = build({ supported: false });

    await expect(
      notifier.notifyConnected({ ...target, capabilityName: 'Hammers', credits: 100, balanceAfter: 0 }),
    ).resolves.toBeUndefined();
    expect(logger.failures.length).toBe(1);
  });

  it('records the failure without throwing when the channel rejects the push', async () => {
    const { notifier, logger } = build({ result: { delivered: false, error: 're-engagement window' } });

    await notifier.notifyFreeTrial({ ...target, capabilityName: 'Hammers' });

    expect(logger.failures.length).toBe(1);
  });

  it('swallows an unexpected throw: the money it describes is already committed', async () => {
    const { notifier, logger } = build({ throws: new Error('socket hang up') });

    await expect(
      notifier.notifyOnboardingCredit({ ...target, credits: 2_000, balanceAfter: 2_000 }),
    ).resolves.toBeUndefined();
    expect(logger.failures.length).toBe(1);
  });

  it('records a delivered push in conversation history so the next turn has the context', async () => {
    const { notifier, recorded } = build();

    await notifier.notifyConnected({
      ...target,
      capabilityName: 'Hammers',
      credits: 100,
      balanceAfter: 900,
    });

    expect(recorded[0]).toContain("You're in — your profile has been sent to the customer.");
  });
});
