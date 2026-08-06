import type { Channel } from '../../domain/models/channel';
import { MediaProcessingError, type MediaDownloaderPort } from '../../domain/ports/outbound/media.port';

export const MEDIA_DOWNLOADER_REGISTRY = Symbol('MediaDownloaderRegistry');

/**
 * Resolves the media downloader for a channel.
 *
 * Each channel fetches media differently — Meta needs a two-step authenticated exchange,
 * Twilio a signed URL — so the media pipeline resolves a downloader rather than branching
 * on channel itself.
 */
export class MediaDownloaderRegistry {
  private readonly byChannel: ReadonlyMap<Channel, MediaDownloaderPort>;

  constructor(downloaders: readonly MediaDownloaderPort[]) {
    this.byChannel = new Map(downloaders.map((downloader) => [downloader.channel, downloader]));
  }

  forChannel(channel: Channel): MediaDownloaderPort {
    const downloader = this.byChannel.get(channel);

    if (downloader === undefined) {
      throw new MediaProcessingError(
        `No media downloader is registered for channel "${channel}", so media on this channel cannot be processed.`,
        'unknown',
        false,
      );
    }

    return downloader;
  }

  supports(channel: Channel): boolean {
    return this.byChannel.has(channel);
  }
}
