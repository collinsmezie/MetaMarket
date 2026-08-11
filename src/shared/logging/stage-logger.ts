import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import pino from 'pino';
import { AppConfigService } from '../../config/app-config.service';
import type { StageLog, StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';

/**
 * Implements the mandated stage log format (Execution.md §3):
 *
 * ```
 * [<TIMESTAMP>] [<COMPONENT_NAME>] [<STAGE_NAME>]
 * Input  : <Formatted JSON / Data>
 * Action : <Brief description of logic/transformation>
 * Output : <Formatted JSON / Data>
 * ```
 *
 * In development this renders as readable terminal blocks. In production it emits
 * newline-delimited JSON on the same fields so log aggregation can query them.
 */

/** Keys whose values are replaced with a placeholder wherever they appear. */
const REDACTED_KEYS = new Set([
  'accesstoken',
  'access_token',
  'apikey',
  'api_key',
  'authorization',
  'appsecret',
  'app_secret',
  'authtoken',
  'auth_token',
  'password',
  'secret',
  'verifytoken',
  'verify_token',
]);

const REDACTION_PLACEHOLDER = '[redacted]';

/** Beyond this, logged payloads are truncated rather than flooding the terminal. */
const MAX_RENDERED_LENGTH = 2_000;

/** Guards against a cyclic object turning a log call into an infinite recursion. */
const MAX_DEPTH = 8;

/**
 * Strips credentials and bounds size before anything reaches a log sink.
 *
 * Stage logs deliberately include real inputs and outputs, which is exactly why they are
 * the most likely place to leak an access token.
 */
export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return '[truncated: max depth]';

  if (typeof value === 'string') {
    return value.length > MAX_RENDERED_LENGTH
      ? `${value.slice(0, MAX_RENDERED_LENGTH)}… [truncated ${value.length - MAX_RENDERED_LENGTH} chars]`
      : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };

  // Never log raw media bytes; their size is the only useful part.
  if (Buffer.isBuffer(value)) return `[Buffer ${value.byteLength} bytes]`;

  if (Array.isArray(value)) {
    const limit = 25;
    const items = value.slice(0, limit).map((item) => sanitizeForLog(item, depth + 1));
    return value.length > limit ? [...items, `… ${value.length - limit} more`] : items;
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      result[key] = REDACTED_KEYS.has(key.toLowerCase())
        ? REDACTION_PLACEHOLDER
        : sanitizeForLog(nested, depth + 1);
    }
    return result;
  }

  return String(value);
}

function render(value: unknown): string {
  const sanitized = sanitizeForLog(value);
  if (typeof sanitized === 'string') return sanitized;
  try {
    return JSON.stringify(sanitized);
  } catch {
    return '[unserializable]';
  }
}

@Injectable()
export class StageLogger implements StageLoggerPort {
  private readonly logger: Logger;
  private readonly pretty: boolean;
  /** Set only on correlated clones produced by {@link withCorrelation}. */
  private correlationId?: string;

  // Nest injects only AppConfigService. Correlated instances are clones, not injections,
  // so the constructor stays free of optional parameters the container cannot resolve.
  constructor(@Inject(AppConfigService) config: AppConfigService) {
    const { level, pretty } = config.logging;
    this.pretty = pretty;
    this.logger = pino({
      level,
      // The stage format is produced by this class, so pino only needs to carry the line.
      transport: pretty
        ? {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: false, ignore: 'pid,hostname,time' },
          }
        : undefined,
    });
  }

  withCorrelation(correlationId: string): StageLoggerPort {
    const clone = Object.create(this) as StageLogger;
    clone.correlationId = correlationId;
    return clone;
  }

  stage(log: StageLog): void {
    const correlationId = log.correlationId ?? this.correlationId;

    if (this.pretty) {
      this.logger.info(this.renderBlock(log, correlationId));
      return;
    }

    this.logger.info({
      component: log.component,
      stage: log.stage,
      action: log.action,
      input: sanitizeForLog(log.input),
      output: sanitizeForLog(log.output),
      correlationId,
      durationMs: log.durationMs,
    });
  }

  stageFailed(log: Omit<StageLog, 'output'> & { error: unknown }): void {
    const correlationId = log.correlationId ?? this.correlationId;
    const error = log.error;
    const rendered = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

    if (this.pretty) {
      const header = this.header(log.component, log.stage, correlationId, log.durationMs);
      this.logger.error(
        [header, `Input  : ${render(log.input)}`, `Action : ${log.action}`, `FAILED : ${rendered}`].join(
          '\n',
        ),
      );
      return;
    }

    this.logger.error({
      component: log.component,
      stage: log.stage,
      action: log.action,
      input: sanitizeForLog(log.input),
      // Named `error`, never `output`: a failure must not be readable as a result.
      error: sanitizeForLog(error),
      correlationId,
      durationMs: log.durationMs,
    });
  }

  private header(component: string, stage: string, correlationId?: string, durationMs?: number): string {
    const parts = [`[${new Date().toISOString()}]`, `[${component}]`, `[${stage}]`];
    if (correlationId !== undefined) parts.push(`(${correlationId})`);
    if (durationMs !== undefined) parts.push(`${durationMs}ms (${(durationMs / 1000).toFixed(2)}s)`);
    return parts.join(' ');
  }

  private renderBlock(log: StageLog, correlationId?: string): string {
    return [
      this.header(log.component, log.stage, correlationId, log.durationMs),
      `Input  : ${render(log.input)}`,
      `Action : ${log.action}`,
      `Output : ${render(log.output)}`,
    ].join('\n');
  }
}
