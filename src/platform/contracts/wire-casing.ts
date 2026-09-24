/**
 * Wire-format casing (IDCE §18.3, CSRE §27.1, MCOS §63.7).
 *
 * Every specialist contract is snake_case on the wire and camelCase inside TypeScript. The
 * conversion is done once at each adapter boundary by these two functions so no component
 * hand-maps field names — hand mapping is how a field silently goes missing.
 *
 * Only object keys are converted. Values (including string enums such as `RESOLVED`) are left
 * untouched, and keys that are already in the target casing pass through unchanged.
 */

const SNAKE_TO_CAMEL = /_([a-z0-9])/g;
const CAMEL_TO_SNAKE = /([a-z0-9])([A-Z])/g;

export function snakeToCamelKey(key: string): string {
  return key.replace(SNAKE_TO_CAMEL, (_match, char: string) => char.toUpperCase());
}

export function camelToSnakeKey(key: string): string {
  return key.replace(CAMEL_TO_SNAKE, '$1_$2').toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function convertKeys(value: unknown, convert: (key: string) => string): unknown {
  if (Array.isArray(value)) return value.map((item) => convertKeys(item, convert));
  if (value instanceof Date) return value;
  if (!isPlainObject(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    result[convert(key)] = convertKeys(nested, convert);
  }
  return result;
}

/** Deeply converts snake_case keys to camelCase. Used when a wire payload enters TypeScript. */
export function toCamelCaseKeys<T = unknown>(value: unknown): T {
  return convertKeys(value, snakeToCamelKey) as T;
}

/** Deeply converts camelCase keys to snake_case. Used when a TypeScript object leaves as wire. */
export function toSnakeCaseKeys<T = unknown>(value: unknown): T {
  return convertKeys(value, camelToSnakeKey) as T;
}
