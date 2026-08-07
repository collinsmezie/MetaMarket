import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AppConfigService } from '../../config/app-config.service';
import type { DomainEvent } from '../../domain/ports/outbound/event-publisher.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  VENDOR_REPOSITORY,
  type VendorRepositoryPort,
} from '../../domain/ports/outbound/vendor-repository.port';
import { WalletNotifier } from './wallet-notifier.service';
import { WalletService } from './wallet.service';

const COMPONENT = 'Wallet';
const STAGE = 'OnboardingGrant';

/**
 * Seeds every newly onboarded vendor with starting credits (Konnet Credits Recharge TDR §25.12).
 *
 * Subscribes to the existing `seller.onboarded` event rather than adding a call inside
 * onboarding. Two reasons: the Capability Discovery Engine has no business knowing the wallet
 * exists, and the event is already published exactly once and only on success (the vendor
 * reaching `active`), so "successfully onboarded" needs no second definition here.
 *
 * The outbox relay dispatches after commit, so a grant is never given for an onboarding that
 * rolled back.
 */
@Injectable()
export class WalletOnboardingGrantListener {
  constructor(
    @Inject(VENDOR_REPOSITORY) private readonly vendors: VendorRepositoryPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    private readonly wallet: WalletService,
    private readonly notifier: WalletNotifier,
    private readonly config: AppConfigService,
  ) {}

  @OnEvent('seller.onboarded', { async: true })
  async onSellerOnboarded(event: DomainEvent): Promise<void> {
    const vendorId = event?.vendorId;
    if (vendorId === undefined) return;

    try {
      // The event carries the vendor id but not the E.164 that keys the wallet. Resolving it
      // here keeps the grant off the producer's event contract.
      const vendor = await this.vendors.findById(vendorId);

      if (vendor === null) {
        this.logger.stageFailed({
          component: COMPONENT,
          stage: STAGE,
          input: { vendorId },
          action: 'Could not resolve the vendor; no grant given',
          error: new Error('vendor not found'),
        });
        return;
      }

      const credits = this.config.credits.onboardingGrant;

      const result = await this.wallet.grantOnboardingCredits({
        userId: vendor.userId,
        conversationId: vendor.conversationId,
        vendorId,
        amountCredits: credits,
      });

      // A redelivered event must not send a second welcome message either — the vendor would
      // reasonably read it as a second grant.
      if (result.outcome === 'duplicate') return;

      await this.notifier.notifyOnboardingCredit({
        userId: vendor.userId,
        conversationId: vendor.conversationId,
        credits,
        balanceAfter: result.balanceAfter,
      });
    } catch (error) {
      // A listener that throws would surface as an unhandled rejection on the relay, taking
      // unrelated subscribers down with it. The grant is retriable by replaying the event.
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { vendorId },
        action: 'Onboarding grant failed; the vendor is onboarded but unfunded',
        error,
      });
    }
  }
}
