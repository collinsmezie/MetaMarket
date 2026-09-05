import { RecordingStageLogger, RecordingWalletNotifier } from '@test/fakes';
import type { AppConfigService } from '../../config/app-config.service';
import type { Vendor } from '../../domain/models/vendor';
import type { DomainEvent } from '../../domain/ports/outbound/event-publisher.port';
import type { VendorRepositoryPort } from '../../domain/ports/outbound/vendor-repository.port';
import type { WalletNotifier } from './wallet-notifier.service';
import { WalletOnboardingGrantListener } from './wallet-onboarding-grant.listener';
import type { WalletService } from './wallet.service';

const VENDOR: Vendor = {
  id: 'vendor_1',
  userId: '+2348012345678',
  conversationId: 'conv_1',
  businessName: 'Top Hardware',
  contactPhone: '+2348012345678',
  location: null,
  status: 'active',
  conversationSummary: '',
  onboardedAt: new Date('2026-08-07T10:00:00Z'),
  createdAt: new Date('2026-08-07T09:00:00Z'),
  updatedAt: new Date('2026-08-07T10:00:00Z'),
};

function build(options: { vendor?: Vendor | null; grantThrows?: Error; duplicate?: boolean } = {}) {
  const grants: { vendorId: string; amountCredits: number }[] = [];

  const vendors = {
    async findById() {
      return options.vendor === undefined ? VENDOR : options.vendor;
    },
  } as unknown as VendorRepositoryPort;

  const wallet = {
    async grantOnboardingCredits(params: { vendorId: string; amountCredits: number }) {
      if (options.grantThrows !== undefined) throw options.grantThrows;
      grants.push(params);
      return options.duplicate === true
        ? ({ outcome: 'duplicate' } as const)
        : ({ outcome: 'credited', balanceAfter: params.amountCredits } as const);
    },
  } as unknown as WalletService;

  const notifier = new RecordingWalletNotifier();
  const logger = new RecordingStageLogger();
  const config = { credits: { onboardingGrant: 2_000 } } as unknown as AppConfigService;

  const listener = new WalletOnboardingGrantListener(
    vendors,
    logger,
    wallet,
    notifier as unknown as WalletNotifier,
    config,
  );

  return { listener, grants, notifier, logger };
}

const event = (): DomainEvent => ({
  eventId: 'evt_1',
  eventType: 'seller.onboarded',
  timestamp: new Date('2026-08-07T10:00:00Z'),
  producer: 'CapabilityDiscoveryEngine',
  vendorId: 'vendor_1',
  conversationId: 'conv_1',
  payload: { businessName: 'Top Hardware' },
});

/**
 * The onboarding grant (TDR §25.12).
 *
 * Subscribing to `seller.onboarded` rather than calling from onboarding is what makes
 * "successfully onboarded" mean the same thing here as it does everywhere else; these tests pin
 * the consequences of that choice, chiefly that a redelivery cannot hand out a second grant.
 */
describe('WalletOnboardingGrantListener', () => {
  it('funds a newly onboarded vendor and welcomes them', async () => {
    const { listener, grants, notifier } = build();

    await listener.onSellerOnboarded(event());

    expect(grants).toEqual([
      { userId: VENDOR.userId, conversationId: 'conv_1', vendorId: 'vendor_1', amountCredits: 2_000 },
    ]);
    expect(notifier.onboarding).toEqual([
      { userId: VENDOR.userId, conversationId: 'conv_1', credits: 2_000, balanceAfter: 2_000 },
    ]);
  });

  it('stays silent on a redelivered event: a second welcome would read as a second grant', async () => {
    const { listener, notifier } = build({ duplicate: true });

    await listener.onSellerOnboarded(event());

    expect(notifier.onboarding).toHaveLength(0);
  });

  it('records the failure and grants nothing when the vendor cannot be resolved', async () => {
    const { listener, grants, logger } = build({ vendor: null });

    await listener.onSellerOnboarded(event());

    expect(grants).toHaveLength(0);
    expect(logger.failures).toHaveLength(1);
  });

  it('never throws into the event relay, which would take unrelated subscribers down', async () => {
    const { listener, logger } = build({ grantThrows: new Error('database down') });

    await expect(listener.onSellerOnboarded(event())).resolves.toBeUndefined();
    expect(logger.failures).toHaveLength(1);
  });

  it('ignores an event without a vendor id rather than guessing one', async () => {
    const { listener, grants } = build();

    await listener.onSellerOnboarded({ ...event(), vendorId: undefined });

    expect(grants).toHaveLength(0);
  });
});
