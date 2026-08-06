import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { IdGeneratorPort } from '../../../domain/ports/outbound/system.port';

@Injectable()
export class UuidIdGenerator implements IdGeneratorPort {
  uuid(): string {
    return randomUUID();
  }

  /**
   * Short, prefixed identifier for things a human will read in logs or support threads.
   *
   * Not used for database keys — those stay UUIDs. The short suffix trades collision
   * resistance for legibility, which is the right trade only for display ids.
   */
  prefixed(prefix: string): string {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  }
}
