import { decodeStrictOutput, toStrictOutputSchema } from './strict-output-schema';

describe('toStrictOutputSchema', () => {
  it('strips conditionals and value constraints, requires every property and closes objects', () => {
    const source = {
      $id: 'https://metamarket.local/schemas/x-1.0.json',
      type: 'object',
      required: ['a'],
      properties: {
        a: { type: 'string', minLength: 1 },
        b: { type: 'number', minimum: 0, maximum: 1 },
        c: { type: ['string', 'null'] },
        d: { $ref: '#/$defs/inner' },
        e: { enum: ['X', 'Y'] },
      },
      allOf: [{ if: { properties: { a: { const: 'x' } } }, then: { required: ['b'] } }],
      $defs: {
        inner: { type: 'object', properties: { z: { type: 'string', format: 'uri' } } },
      },
    };

    const strict = toStrictOutputSchema(source) as Record<string, unknown>;

    expect(strict.allOf).toBeUndefined();
    expect(strict.$id).toBe(source.$id);
    expect(strict.required).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(strict.additionalProperties).toBe(false);

    const properties = strict.properties as Record<string, Record<string, unknown>>;
    expect(properties.a).toEqual({ type: 'string' });
    // Optional-in-source properties become nullable so "required" cannot force fabrication.
    expect(properties.b).toEqual({ type: ['number', 'null'] });
    expect(properties.c).toEqual({ type: ['string', 'null'] });
    expect(properties.d).toEqual({ anyOf: [{ $ref: '#/$defs/inner' }, { type: 'null' }] });
    expect(properties.e).toEqual({ enum: ['X', 'Y', null] });

    const inner = (strict.$defs as Record<string, Record<string, unknown>>).inner;
    expect(inner.required).toEqual(['z']);
    expect(inner.additionalProperties).toBe(false);
    expect((inner.properties as Record<string, unknown>).z).toEqual({ type: ['string', 'null'] });
  });

  it('maps const to enum and gives untyped "any" slots a scalar type so strict providers accept them', () => {
    const strict = toStrictOutputSchema({
      type: 'object',
      required: ['schema_version', 'value'],
      properties: { schema_version: { const: '4.0' }, value: {} },
    }) as Record<string, Record<string, Record<string, unknown>>>;
    expect(strict.properties.schema_version).toEqual({ enum: ['4.0'] });
    expect(strict.properties.value).toEqual({
      anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }],
    });
  });

  it('does not mutate the source schema', () => {
    const source = { type: 'object', properties: { a: { type: 'string', minLength: 2 } } };
    const copy = JSON.parse(JSON.stringify(source));
    toStrictOutputSchema(source);
    expect(source).toEqual(copy);
  });

  it('encodes free-form maps as entry lists for the provider and decodes them back to objects', () => {
    const source = {
      type: 'object',
      required: ['attributes', 'objects', 'meta'],
      properties: {
        attributes: {
          type: 'object',
          additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
        },
        objects: { type: 'array', items: { $ref: '#/$defs/object' } },
        meta: { type: ['object', 'null'] },
        tags: { type: 'array' },
      },
      $defs: {
        object: {
          type: 'object',
          required: ['id', 'attributes'],
          properties: { id: { type: 'string' }, attributes: { type: 'object' } },
        },
      },
    };

    const strict = toStrictOutputSchema(source) as Record<string, Record<string, Record<string, unknown>>>;
    expect(strict.properties.attributes.type).toBe('array');
    expect((strict.properties.attributes.items as Record<string, unknown>).required).toEqual([
      'key',
      'value',
    ]);
    expect(strict.properties.meta.anyOf).toBeDefined();
    expect((strict.properties.tags as Record<string, unknown>).items).toBeDefined();
    const inner = (strict.$defs as unknown as Record<string, Record<string, Record<string, unknown>>>).object;
    expect((inner.properties.attributes as Record<string, unknown>).type).toBe('array');

    const decoded = decodeStrictOutput(source, {
      attributes: [
        { key: 'color', value: 'red' },
        { key: 'capacity_litres', value: 20 },
      ],
      objects: [{ id: 'object_1', attributes: [{ key: 'brand_tier', value: 'premium' }] }],
      meta: null,
      tags: ['a'],
    });
    expect(decoded).toEqual({
      attributes: { color: 'red', capacity_litres: 20 },
      objects: [{ id: 'object_1', attributes: { brand_tier: 'premium' } }],
      meta: null,
      tags: ['a'],
    });

    // Payloads that never used the encoding are untouched.
    expect(
      decodeStrictOutput(source, { attributes: { x: 1 }, objects: [], meta: { a: 1 }, tags: [] }),
    ).toEqual({
      attributes: { x: 1 },
      objects: [],
      meta: { a: 1 },
      tags: [],
    });
  });
});
