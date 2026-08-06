import type { Channel } from '../../../domain/models/channel';
import type {
  ChannelNotifierPort,
  ChannelNotifierRegistryPort,
} from '../../../domain/ports/outbound/channel-notifier.port';

/**
 * Resolves the outbound notifier for a channel.
 *
 * The indirection is what keeps the pipeline channel-agnostic: adding Telegram means
 * registering one more notifier here and changing nothing else (MCOS §24).
 */
export class ChannelNotifierRegistry implements ChannelNotifierRegistryPort {
  private readonly byChannel: ReadonlyMap<Channel, ChannelNotifierPort>;

  constructor(notifiers: readonly ChannelNotifierPort[]) {
    this.byChannel = new Map(notifiers.map((notifier) => [notifier.channel, notifier]));
  }

  forChannel(channel: Channel): ChannelNotifierPort {
    const notifier = this.byChannel.get(channel);

    if (notifier === undefined) {
      throw new Error(
        `No outbound notifier is registered for channel "${channel}". ` +
          `Registered channels: ${[...this.byChannel.keys()].join(', ') || '(none)'}.`,
      );
    }

    return notifier;
  }

  supports(channel: Channel): boolean {
    return this.byChannel.has(channel);
  }

  registeredChannels(): readonly Channel[] {
    return [...this.byChannel.keys()];
  }
}
