import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

/**
 * Executable-contract registry (Overarching TDR §3.3 "Schema Before Action"; Directive §13).
 *
 * Every JSON Schema in the specification package is registered here by its `$id` and compiled
 * once. Components validate against the registry rather than against ad-hoc zod copies, so
 * the wire contract that the TDR publishes and the contract the code enforces are the same
 * document. Draft 2020-12 is used because the TDR schemas rely on `$defs`, `if/then` and
 * `const`.
 */

export interface SchemaValidationError {
  readonly path: string;
  readonly keyword: string;
  readonly message: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export type SchemaValidationResult =
  | { readonly valid: true; readonly errors: readonly [] }
  | { readonly valid: false; readonly errors: readonly SchemaValidationError[] };

export interface RegisteredSchema {
  readonly id: string;
  /** The `schema_version` a payload must declare, when the contract carries one. */
  readonly version: string;
  readonly schema: Readonly<Record<string, unknown>>;
}

export class SchemaNotRegisteredError extends Error {
  constructor(readonly schemaId: string) {
    super(`No schema registered with $id "${schemaId}"`);
    this.name = 'SchemaNotRegisteredError';
  }
}

export class SchemaContractViolation extends Error {
  constructor(
    readonly schemaId: string,
    readonly errors: readonly SchemaValidationError[],
  ) {
    super(
      `Payload violates schema "${schemaId}": ${errors
        .slice(0, 5)
        .map((error) => `${error.path || '/'} ${error.message}`)
        .join('; ')}${errors.length > 5 ? ` (+${errors.length - 5} more)` : ''}`,
    );
    this.name = 'SchemaContractViolation';
  }
}

function toValidationError(error: ErrorObject): SchemaValidationError {
  return {
    path: error.instancePath,
    keyword: error.keyword,
    message: error.message ?? 'invalid',
    params: error.params as Record<string, unknown>,
  };
}

export class SchemaRegistry {
  private readonly ajv: Ajv2020;
  private readonly schemas = new Map<string, RegisteredSchema>();
  private readonly validators = new Map<string, ValidateFunction>();

  constructor() {
    this.ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      // The TDR schemas declare `$id` as https URLs that are identifiers, not fetch targets.
      loadSchema: undefined,
      allowUnionTypes: true,
    });
    addFormats(this.ajv);
  }

  /**
   * Registers a schema document. Re-registering the same `$id` with byte-identical content is a
   * no-op; a different document under the same `$id` is a programming error because it means
   * two components disagree about a contract.
   */
  register(schema: Readonly<Record<string, unknown>>, options: { version?: string } = {}): RegisteredSchema {
    const id = schema.$id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('A registered schema must declare a string $id');
    }

    const existing = this.schemas.get(id);
    if (existing !== undefined) {
      if (JSON.stringify(existing.schema) !== JSON.stringify(schema)) {
        throw new Error(`Schema "${id}" is already registered with different content`);
      }
      return existing;
    }

    const version = options.version ?? inferVersion(schema);
    const registered: RegisteredSchema = { id, version, schema };

    this.ajv.addSchema(schema as object, id);
    this.schemas.set(id, registered);
    return registered;
  }

  has(schemaId: string): boolean {
    return this.schemas.has(schemaId);
  }

  get(schemaId: string): RegisteredSchema {
    const registered = this.schemas.get(schemaId);
    if (registered === undefined) throw new SchemaNotRegisteredError(schemaId);
    return registered;
  }

  all(): readonly RegisteredSchema[] {
    return [...this.schemas.values()];
  }

  validate(schemaId: string, payload: unknown): SchemaValidationResult {
    const validator = this.compile(schemaId);
    const valid = validator(payload);
    if (valid) return { valid: true, errors: [] };
    return { valid: false, errors: (validator.errors ?? []).map(toValidationError) };
  }

  /** Validates and returns the payload typed as `T`, or throws {@link SchemaContractViolation}. */
  assert<T>(schemaId: string, payload: unknown): T {
    const result = this.validate(schemaId, payload);
    if (!result.valid) throw new SchemaContractViolation(schemaId, result.errors);
    return payload as T;
  }

  private compile(schemaId: string): ValidateFunction {
    const cached = this.validators.get(schemaId);
    if (cached !== undefined) return cached;

    if (!this.schemas.has(schemaId)) throw new SchemaNotRegisteredError(schemaId);

    const validator = this.ajv.getSchema(schemaId);
    if (validator === undefined) throw new SchemaNotRegisteredError(schemaId);

    this.validators.set(schemaId, validator);
    return validator;
  }
}

/**
 * Reads the declared wire version from a schema that pins it (`schema_version: {const: "4.0"}`),
 * falling back to a trailing `-1.0` / `-v5` / `v4.1` in the `$id`.
 */
function inferVersion(schema: Readonly<Record<string, unknown>>): string {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const declared = properties?.schema_version?.const;
  if (typeof declared === 'string') return declared;

  const id = String(schema.$id);
  const match = /(?:-v?|v)(\d+(?:\.\d+)*)(?:\.json)?$/.exec(id);
  return match?.[1] ?? 'unversioned';
}
