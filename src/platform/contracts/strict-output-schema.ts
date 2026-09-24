/**
 * Projects a full JSON Schema (draft 2020-12, as published in the TDRs) onto the subset that
 * provider "structured output" modes accept at generation time.
 *
 * OpenAI strict mode, for example, requires every object to list all properties in `required`
 * and to set `additionalProperties: false`, and rejects conditional keywords (`if/then`,
 * `allOf`) and most value constraints (`minLength`, `minimum`, `format`, …). Those keywords
 * still matter — they are enforced by the {@link SchemaRegistry} after the model answers — but
 * they cannot be sent to the provider.
 *
 * The projection is therefore deliberately *looser* than the source schema, never stricter:
 * anything the provider could not have enforced is enforced afterwards by the full schema.
 *
 * One construct cannot be loosened: a free-form map (`type: object` without `properties`, e.g.
 * CSRE `attributes`). Strict mode forbids open objects, so the projection encodes such a map as
 * an array of `{key, value}` entries at generation time, and {@link decodeStrictOutput} folds the
 * entries back into an object before the full schema sees the payload. The wire contract is
 * unchanged; only the model-facing shape differs.
 */

const CONDITIONAL_KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'allOf',
  'not',
  'dependentSchemas',
  'dependentRequired',
]);

const VALUE_CONSTRAINT_KEYWORDS = new Set([
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'format',
  'pattern',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'default',
  'examples',
  'title',
  '$comment',
  'deprecated',
  'readOnly',
  'writeOnly',
]);

const META_KEYWORDS = new Set(['$schema', '$id']);

const SCALAR_OR_NULL = {
  anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function typeIncludes(schema: Record<string, unknown>, type: string): boolean {
  return schema.type === type || (Array.isArray(schema.type) && (schema.type as string[]).includes(type));
}

/** A map with unknown keys: `type: object` (possibly nullable) and no declared `properties`. */
function isFreeFormMap(schema: Record<string, unknown>): boolean {
  return typeIncludes(schema, 'object') && !isObject(schema.properties);
}

/** Model-facing encoding of a free-form map: a list of `{key, value}` entries. */
function encodeFreeFormMap(schema: Record<string, unknown>): Record<string, unknown> {
  const valueSchema = isObject(schema.additionalProperties)
    ? project(schema.additionalProperties, false)
    : SCALAR_OR_NULL;
  const entries = {
    type: 'array',
    items: {
      type: 'object',
      properties: { key: { type: 'string' }, value: valueSchema },
      required: ['key', 'value'],
      additionalProperties: false,
    },
  };
  return typeIncludes(schema, 'null') ? { anyOf: [entries, { type: 'null' }] } : entries;
}

function project(node: unknown, isRoot: boolean): unknown {
  if (Array.isArray(node)) return node.map((item) => project(item, false));
  if (!isObject(node)) return node;

  if (isFreeFormMap(node) && !isRoot) return encodeFreeFormMap(node);

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(node)) {
    if (CONDITIONAL_KEYWORDS.has(key) || VALUE_CONSTRAINT_KEYWORDS.has(key)) continue;
    if (META_KEYWORDS.has(key) && !isRoot) continue;
    if (key === '$schema') continue;
    // Open maps are encoded above; a residual `additionalProperties` schema is meaningless here.
    if (key === 'additionalProperties') continue;

    if (key === 'const') {
      result.enum = [value];
      continue;
    }

    if (key === 'properties' && isObject(value)) {
      const properties: Record<string, unknown> = {};
      for (const [name, propertySchema] of Object.entries(value)) {
        properties[name] = project(propertySchema, false);
      }
      result.properties = properties;
      continue;
    }

    if (key === '$defs' && isObject(value)) {
      const defs: Record<string, unknown> = {};
      for (const [name, defSchema] of Object.entries(value)) defs[name] = project(defSchema, false);
      result.$defs = defs;
      continue;
    }

    result[key] = project(value, false);
  }

  // Strict mode: every property is required and no extra keys are allowed. Properties that the
  // source schema made optional are kept required here; the model must emit them (as null where
  // the source allows null), and the full-schema validation afterwards is the real arbiter.
  if (result.type === 'object' || isObject(result.properties)) {
    const properties = isObject(result.properties) ? result.properties : {};
    result.required = Object.keys(properties);
    result.additionalProperties = false;
    if (result.type === undefined) result.type = 'object';

    // An optional property that is not nullable in the source cannot be both required and
    // omitted, so allow null for it at generation time; the full schema decides afterwards.
    const originallyRequired = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
    for (const [name, propertySchema] of Object.entries(properties)) {
      if (originallyRequired.has(name)) continue;
      properties[name] = allowNull(propertySchema);
    }
  }

  // Strict mode needs `items` on every array; an untyped list generates scalars (the full schema
  // still accepts anything afterwards). Contracts that need structured items must declare them.
  if (typeIncludes(result, 'array') && result.items === undefined && result.prefixItems === undefined) {
    result.items = SCALAR_OR_NULL;
  }

  // An untyped "anything" schema (`{}`) has no `type` and is rejected by strict mode. Generate a
  // scalar (or null) there; the full schema still accepts any value afterwards. Contracts that
  // need structured values in such a slot must declare `type: object` with properties.
  if (isUntyped(result)) return SCALAR_OR_NULL;

  return result;
}

function isUntyped(schema: Record<string, unknown>): boolean {
  return (
    schema.type === undefined &&
    schema.enum === undefined &&
    schema.anyOf === undefined &&
    schema.oneOf === undefined &&
    schema.$ref === undefined &&
    schema.properties === undefined &&
    schema.items === undefined
  );
}

function allowNull(schema: unknown): unknown {
  if (!isObject(schema)) return schema;
  if (Array.isArray(schema.anyOf)) {
    const hasNull = (schema.anyOf as unknown[]).some((option) => isObject(option) && option.type === 'null');
    return hasNull ? schema : { ...schema, anyOf: [...(schema.anyOf as unknown[]), { type: 'null' }] };
  }
  if (typeof schema.type === 'string') {
    return schema.type === 'null' ? schema : { ...schema, type: [schema.type, 'null'] };
  }
  if (Array.isArray(schema.type)) {
    return (schema.type as string[]).includes('null')
      ? schema
      : { ...schema, type: [...schema.type, 'null'] };
  }
  if (Array.isArray(schema.enum)) {
    return (schema.enum as unknown[]).includes(null) ? schema : { ...schema, enum: [...schema.enum, null] };
  }
  if (schema.$ref !== undefined) {
    return { anyOf: [schema, { type: 'null' }] };
  }
  return schema;
}

/**
 * Returns a copy of `schema` suitable for provider-side structured output enforcement.
 * The `$id` is retained at the root so telemetry can name the contract.
 */
export function toStrictOutputSchema(schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return project(schema, true) as Record<string, unknown>;
}

// ── Decoding ─────────────────────────────────────────────────────────────────────────────────

function resolveRef(root: Record<string, unknown>, ref: string): Record<string, unknown> | null {
  if (!ref.startsWith('#/')) return null;
  let node: unknown = root;
  for (const segment of ref.slice(2).split('/')) {
    if (!isObject(node)) return null;
    node = node[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return isObject(node) ? node : null;
}

function isEntriesArray(value: unknown): value is Array<{ key: string; value: unknown }> {
  return (
    Array.isArray(value) &&
    value.every((entry) => isObject(entry) && typeof entry.key === 'string' && 'value' in entry)
  );
}

function branchMatches(
  schema: Record<string, unknown>,
  value: unknown,
  root: Record<string, unknown>,
): boolean {
  const resolved = typeof schema.$ref === 'string' ? resolveRef(root, schema.$ref) : schema;
  if (resolved === null) return false;
  if (value === null) return typeIncludes(resolved, 'null');
  if (Array.isArray(value)) return typeIncludes(resolved, 'array') || isFreeFormMap(resolved);
  if (isObject(value)) return typeIncludes(resolved, 'object') || isObject(resolved.properties);
  const primitive = typeof value === 'number' ? ['number', 'integer'] : [typeof value];
  return primitive.some((type) => typeIncludes(resolved, type)) || resolved.enum !== undefined;
}

function decode(schema: unknown, value: unknown, root: Record<string, unknown>): unknown {
  if (!isObject(schema) || value === null || value === undefined) return value;

  if (typeof schema.$ref === 'string') {
    const target = resolveRef(root, schema.$ref);
    return target === null ? value : decode(target, value, root);
  }

  for (const combinator of ['anyOf', 'oneOf'] as const) {
    const branches = schema[combinator];
    if (Array.isArray(branches)) {
      const branch = (branches as unknown[]).find(
        (candidate) => isObject(candidate) && branchMatches(candidate, value, root),
      );
      return branch === undefined ? value : decode(branch, value, root);
    }
  }

  if (isFreeFormMap(schema) && isEntriesArray(value)) {
    const valueSchema = isObject(schema.additionalProperties) ? schema.additionalProperties : undefined;
    const object: Record<string, unknown> = {};
    for (const entry of value) object[entry.key] = decode(valueSchema, entry.value, root);
    return object;
  }

  if (Array.isArray(value)) {
    if (isObject(schema.items)) return value.map((item) => decode(schema.items, item, root));
    return value;
  }

  if (isObject(value) && isObject(schema.properties)) {
    const properties = schema.properties;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = key in properties ? decode(properties[key], item, root) : item;
    }
    return result;
  }

  return value;
}

/**
 * Inverse of the free-form-map encoding: given the *source* schema and a payload produced under
 * {@link toStrictOutputSchema}, folds `{key, value}` entry lists back into objects wherever the
 * source declares an open map. Payloads that never used the encoding pass through unchanged.
 */
export function decodeStrictOutput(schema: Readonly<Record<string, unknown>>, payload: unknown): unknown {
  return decode(schema, payload, schema as Record<string, unknown>);
}
