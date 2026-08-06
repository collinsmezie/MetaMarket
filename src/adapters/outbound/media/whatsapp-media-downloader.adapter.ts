import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import type { Channel } from '../../../domain/models/channel';
import type { DownloadedMedia, MediaDownloaderPort } from '../../../domain/ports/outbound/media.port';
import { MediaProcessingError } from '../../../domain/ports/outbound/media.port';

/**
 * Fetches media from the Meta Cloud API.
 *
 * Meta requires two authenticated calls — media id → temporary URL, then URL → bytes — and
 * the URL is short-lived and only usable with a bearer token. Keeping that dance here is
 * why nothing inward knows Meta exists.
 */

/** Ceiling on downloaded media; WhatsApp caps documents at 100 MB. */
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

const DOWNLOAD_TIMEOUT_MS = 30_000;

@Injectable()
export class WhatsAppMediaDownloader implements MediaDownloaderPort {
  readonly channel: Channel = 'whatsapp';

  private readonly accessToken: string | undefined;
  private readonly graphVersion: string;

  constructor(config: AppConfigService) {
    const { accessToken, graphApiVersion } = config.whatsapp;
    this.accessToken = accessToken;
    this.graphVersion = graphApiVersion;
  }

  async download(mediaId: string): Promise<DownloadedMedia> {
    if (this.accessToken === undefined) {
      throw new MediaProcessingError(
        'WHATSAPP_ACCESS_TOKEN is not configured, so media cannot be downloaded.',
        mediaId,
        false,
      );
    }

    const metadata = await this.fetchMetadata(mediaId);
    return this.fetchBytes(mediaId, metadata);
  }

  private async fetchMetadata(mediaId: string): Promise<{ url: string; mimeType: string; fileSize: number }> {
    const response = await this.request(
      `https://graph.facebook.com/${this.graphVersion}/${mediaId}`,
      mediaId,
    );

    const body = (await response.json()) as {
      url?: string;
      mime_type?: string;
      file_size?: number;
    };

    if (body.url === undefined) {
      throw new MediaProcessingError(`Meta returned no download URL for media ${mediaId}`, mediaId, false);
    }

    if (body.file_size !== undefined && body.file_size > MAX_MEDIA_BYTES) {
      // Rejected before download so an oversized file cannot exhaust worker memory.
      throw new MediaProcessingError(
        `Media ${mediaId} is ${body.file_size} bytes, above the ${MAX_MEDIA_BYTES}-byte limit.`,
        mediaId,
        false,
      );
    }

    return {
      url: body.url,
      mimeType: body.mime_type ?? 'application/octet-stream',
      fileSize: body.file_size ?? 0,
    };
  }

  private async fetchBytes(
    mediaId: string,
    metadata: { url: string; mimeType: string },
  ): Promise<DownloadedMedia> {
    // The media URL is on a Meta CDN host but still requires the bearer token.
    const response = await this.request(metadata.url, mediaId);
    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.byteLength > MAX_MEDIA_BYTES) {
      throw new MediaProcessingError(
        `Media ${mediaId} exceeded the ${MAX_MEDIA_BYTES}-byte limit after download.`,
        mediaId,
        false,
      );
    }

    return { bytes: buffer, mimeType: metadata.mimeType };
  }

  private async request(url: string, mediaId: string): Promise<globalThis.Response> {
    let response: globalThis.Response;

    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      // Network failures and timeouts are transient; the queue should retry them.
      const message = error instanceof Error ? error.message : String(error);
      throw new MediaProcessingError(`Media fetch failed: ${message}`, mediaId, true, error);
    }

    if (!response.ok) {
      // 4xx means the id or token is wrong and retrying cannot help; 5xx and 429 can.
      const retryable = response.status === 429 || response.status >= 500;
      throw new MediaProcessingError(
        `Meta media request failed with HTTP ${response.status}`,
        mediaId,
        retryable,
      );
    }

    return response;
  }
}
