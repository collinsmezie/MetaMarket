import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import type { DownloadedMedia, MediaStorePort, StoredMedia } from '../../../domain/ports/outbound/media.port';
import { MediaProcessingError } from '../../../domain/ports/outbound/media.port';

/**
 * S3-compatible object storage for inbound media (MCOS §18).
 *
 * MinIO locally, S3 in production — the same adapter, differing only by endpoint, so media
 * handling behaves identically in both.
 */
@Injectable()
export class S3MediaStore implements MediaStorePort, OnModuleInit {
  private readonly logger = new Logger(S3MediaStore.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfigService) {
    const storage = config.objectStorage;
    this.bucket = storage.bucket;

    this.client = new S3Client({
      region: storage.region,
      ...(storage.endpoint !== undefined ? { endpoint: storage.endpoint } : {}),
      // MinIO serves buckets as path segments rather than subdomains.
      forcePathStyle: storage.forcePathStyle,
      ...(storage.accessKeyId !== undefined && storage.secretAccessKey !== undefined
        ? {
            credentials: {
              accessKeyId: storage.accessKeyId,
              secretAccessKey: storage.secretAccessKey,
            },
          }
        : {}),
    });
  }

  /**
   * Verifies the bucket at boot, creating it when absent.
   *
   * Self-provisioning keeps local setup to `docker compose up` and makes a fresh
   * environment reproducible. Never fatal: text conversations must keep working even
   * without object storage, so a failure here degrades rather than blocks startup.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Object storage reachable (bucket "${this.bucket}")`);
      return;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;

      if (status !== 404) {
        this.logger.warn(
          `Object storage is not reachable (bucket "${this.bucket}"): ${error instanceof Error ? error.message : String(error)}. Media will fail to persist until this is fixed.`,
        );
        return;
      }
    }

    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created missing object storage bucket "${this.bucket}"`);
    } catch (error) {
      this.logger.warn(
        `Could not create bucket "${this.bucket}": ${error instanceof Error ? error.message : String(error)}. Media will fail to persist until this is fixed.`,
      );
    }
  }

  async put(params: { key: string; bytes: Buffer; mimeType: string }): Promise<StoredMedia> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: params.key,
          Body: params.bytes,
          ContentType: params.mimeType,
        }),
      );

      return { storageKey: params.key, mimeType: params.mimeType, byteSize: params.bytes.byteLength };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new MediaProcessingError(`Failed to store media: ${message}`, params.key, true, error);
    }
  }

  async get(storageKey: string): Promise<DownloadedMedia> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }));

      if (result.Body === undefined) {
        throw new MediaProcessingError(`Stored media ${storageKey} has no body`, storageKey, false);
      }

      const bytes = Buffer.from(await result.Body.transformToByteArray());

      return { bytes, mimeType: result.ContentType ?? 'application/octet-stream' };
    } catch (error) {
      if (error instanceof MediaProcessingError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new MediaProcessingError(`Failed to read media: ${message}`, storageKey, true, error);
    }
  }

  async presignedUrl(storageKey: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }), {
      expiresIn: expiresInSeconds,
    });
  }
}
