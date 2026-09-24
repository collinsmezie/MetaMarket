import { Module, type DynamicModule } from '@nestjs/common';
import { ConversationModule } from '../../config/conversation.module';
import { ConversationRuntimeModule } from '../../conversation/conversation-runtime.module';
import { DevTraceController } from './dev-trace.controller';
import { LiveTestController } from './live-test.controller';

/**
 * The development inspection surface, isolated in its own module (Final Lock §12) so that the
 * future authorization boundary wraps exactly these controllers and nothing else.
 *
 * `forRoot(false)` registers nothing at all: in production the routes do not exist.
 */
@Module({})
export class DevModule {
  static forRoot(enabled: boolean): DynamicModule {
    return {
      module: DevModule,
      imports: enabled ? [ConversationModule, ConversationRuntimeModule] : [],
      controllers: enabled ? [DevTraceController, LiveTestController] : [],
    };
  }
}
