import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { ConversationModule } from './config/conversation.module';
import { InfrastructureModule } from './config/infrastructure.module';

/**
 * Composition root.
 *
 * Three layers, matching ADR-001: configuration, infrastructure adapters, and the
 * Conversation OS. The domain core has no module of its own because it has no framework
 * dependencies — it is assembled by factories in {@link ConversationModule}.
 */
@Module({
  imports: [AppConfigModule, InfrastructureModule, ConversationModule],
})
export class AppModule {}
