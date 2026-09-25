import { setDefaultResultOrder } from 'node:dns';
import { setDefaultAutoSelectFamily } from 'node:net';
import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import { AppConfigService } from '../../../config/app-config.service';
import type {
  LlmProviderPort,
  RawCompletion,
  StructuredRequest,
} from '../../../domain/ports/outbound/llm-provider.port';
import { LlmProviderError } from '../../../domain/ports/outbound/llm-provider.port';

// Enforce IPv4 resolution to prevent Node.js IPv6 routing timeouts to Google endpoints
try {
  setDefaultResultOrder('ipv4first');
  setDefaultAutoSelectFamily(false);
} catch {
  // Ignore in environments where network APIs differ
}

/**
 * First fallback provider (Execution.md §2.4).
 *
 * Gemini supports response schemas but with a narrower JSON Schema dialect than OpenAI, so
 * the schema is down-converted before use — see {@link toGeminiSchema}. The service still
 * validates the result, so an imperfect conversion degrades into a retry rather than
 * letting a malformed object through.
 */
@Injectable()
export class GeminiLlmAdapter implements LlmProviderPort {
  readonly name = 'gemini' as const;

  private readonly model: GenerativeModel | null;
  private readonly modelName: string;

  constructor(config: AppConfigService) {
    const { apiKey, model } = config.gemini;
    this.modelName = model;
    this.model = apiKey === undefined ? null : new GoogleGenerativeAI(apiKey).getGenerativeModel({ model });
  }

  isConfigured(): boolean {
    return this.model !== null;
  }

  async generateStructured(request: StructuredRequest, timeoutMs: number): Promise<RawCompletion> {
    if (this.model === null) {
      throw new LlmProviderError('GEMINI_API_KEY is not configured', this.name, false);
    }

    // Gemini has no system role; its system instruction is a separate field.
    const systemInstruction = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');

    const conversation = request.messages.filter((message) => message.role !== 'system');

    try {
      const result = await this.model.generateContent(
        {
          contents: conversation.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
          })),
          ...(systemInstruction.length > 0
            ? { systemInstruction: { role: 'system', parts: [{ text: systemInstruction }] } }
            : {}),
          generationConfig: {
            temperature: request.temperature ?? 0,
            maxOutputTokens: request.maxOutputTokens !== undefined ? Math.max(request.maxOutputTokens, 4096) : 4096,
            responseMimeType: 'application/json',
            // Cast: the SDK's Schema type is narrower than JSON Schema, and the conversion
            // below produces only the subset it accepts.
            responseSchema: toGeminiSchema(request.schema) as never,
          },
        },
        { timeout: timeoutMs },
      );

      const text = result.response.text();
      if (text.length === 0) {
        throw new LlmProviderError('Gemini returned an empty response', this.name, true);
      }

      const usage = result.response.usageMetadata;

      return {
        text,
        model: this.modelName,
        usage:
          usage === undefined
            ? undefined
            : { inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount },
      };
    } catch (error) {
      if (error instanceof LlmProviderError) throw error;
      throw this.translate(error);
    }
  }

  private translate(error: unknown): LlmProviderError {
    const message = error instanceof Error ? error.message : String(error);

    // The SDK surfaces HTTP failures as messages rather than typed errors, so the status
    // has to be recovered from the text.
    const status = /\[(\d{3})[^\]]*\]/.exec(message)?.[1];
    const code = status === undefined ? 0 : Number.parseInt(status, 10);
    const retryable = code === 0 || code === 429 || code >= 500;

    return new LlmProviderError(`Gemini failure: ${message}`, this.name, retryable, error);
  }
}

/**
 * Converts JSON Schema to the subset Gemini accepts.
 *
 * Gemini rejects `additionalProperties`, `$schema`, `$id`, `const` and several composite keywords
 * that OpenAI strict mode requires, so passing the schema through unchanged makes every
 * fallback call fail with a 400 — which would defeat the point of having a fallback.
 * References ($ref) are dereferenced and inlined so that $defs / definitions can be stripped cleanly.
 */
export function toGeminiSchema(schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const unsupported = new Set([
    '$schema',
    '$id',
    'additionalProperties',
    'default',
    'definitions',
    '$defs',
    'oneOf',
    'allOf',
    'not',
    'patternProperties',
    'unevaluatedProperties',
  ]);

  function resolveRef(root: Record<string, unknown>, ref: string): Record<string, unknown> | null {
    if (!ref.startsWith('#/')) return null;
    let node: unknown = root;
    for (const segment of ref.slice(2).split('/')) {
      if (node === null || typeof node !== 'object') return null;
      node = (node as Record<string, unknown>)[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
    }
    return node !== null && typeof node === 'object' ? (node as Record<string, unknown>) : null;
  }

  const convert = (node: unknown, seenRefs = new Set<string>()): unknown => {
    if (Array.isArray(node)) return node.map((entry) => convert(entry, seenRefs));
    if (node === null || typeof node !== 'object') return node;

    const record = node as Record<string, unknown>;

    // Dereference $ref before definitions are stripped
    if (typeof record.$ref === 'string') {
      const ref = record.$ref;
      if (seenRefs.has(ref)) {
        return { type: 'object' };
      }
      const target = resolveRef(schema as Record<string, unknown>, ref);
      if (target !== null) {
        const nextSeen = new Set(seenRefs);
        nextSeen.add(ref);
        return convert(target, nextSeen);
      }
    }

    // Simplify anyOf: [T, { type: 'null' }] into T with nullable: true
    if (Array.isArray(record.anyOf)) {
      const nonNull = record.anyOf.filter(
        (entry) => !(entry !== null && typeof entry === 'object' && (entry as Record<string, unknown>).type === 'null'),
      );
      if (nonNull.length === 1 && nonNull.length < record.anyOf.length) {
        const convertedInner = convert(nonNull[0], seenRefs);
        if (convertedInner !== null && typeof convertedInner === 'object') {
          return { ...(convertedInner as Record<string, unknown>), nullable: true };
        }
      }
    }

    const result: Record<string, unknown> = {};

    // Translate JSON Schema `const: X` into Gemini-compatible `enum: [X]`
    if ('const' in record) {
      result.enum = [record.const];
    }

    for (const [key, value] of Object.entries(record)) {
      if (unsupported.has(key) || key === 'const') continue;

      // Gemini expects `nullable: true` rather than a ["string","null"] type union.
      if (key === 'type' && Array.isArray(value)) {
        const types = value.filter((entry) => entry !== 'null');
        result.type = types[0] ?? 'string';
        if (types.length !== value.length) result.nullable = true;
        continue;
      }

      result[key] = convert(value, seenRefs);
    }

    // Gemini requires a type on every node; if enum was specified without an explicit type, infer string
    if (result.enum !== undefined && result.type === undefined) {
      result.type = 'string';
    }

    return result;
  };

  return convert(schema) as Record<string, unknown>;
}
