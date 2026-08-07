import { Module } from '@nestjs/common';
import { PaystackWebhookController } from '../adapters/inbound/paystack/paystack-webhook.controller';
import { ConversationContextManager } from '../application/conversation/conversation-context.manager';
import { PaymentProcessor } from '../application/wallet/payment-processor.service';
import { WalletNotifier } from '../application/wallet/wallet-notifier.service';
import { WalletService } from '../application/wallet/wallet.service';
import { HANDLE_PAYMENT_NOTIFICATION } from '../domain/ports/inbound/handle-payment-notification.port';

/**
 * The credits wallet feature (Konnet Credits Recharge TDR §16.2).
 *
 * A self-contained feature module: its own inbound adapter and application services, with every
 * outbound port resolved from the global infrastructure module. `WalletService` is exported so
 * the Conversation OS can hand it to the CreditRecharge workflow.
 */
@Module({
  controllers: [PaystackWebhookController],
  providers: [
    WalletService,
    PaymentProcessor,
    WalletNotifier,
    // The notifier records the confirmation in conversation history.
    ConversationContextManager,
    { provide: HANDLE_PAYMENT_NOTIFICATION, useExisting: PaymentProcessor },
  ],
  exports: [WalletService, PaymentProcessor, HANDLE_PAYMENT_NOTIFICATION],
})
export class WalletModule {}
