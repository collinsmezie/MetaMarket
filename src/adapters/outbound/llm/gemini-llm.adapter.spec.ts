import { toGeminiSchema } from './gemini-llm.adapter';

describe('toGeminiSchema', () => {
  it('strips $schema, $id, additionalProperties, and unsupported keywords', () => {
    const input = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://example.com/test.schema.json',
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', const: 'fixed' },
        status: { enum: ['ACTIVE', 'INACTIVE'] },
      },
      required: ['name', 'status'],
    };

    const output = toGeminiSchema(input);

    expect(output).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string', enum: ['fixed'] },
        status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
      },
      required: ['name', 'status'],
    });
    expect(output).not.toHaveProperty('$id');
    expect(output).not.toHaveProperty('$schema');
    expect(output).not.toHaveProperty('additionalProperties');
  });

  it('converts nullable type unions into nullable: true', () => {
    const input = {
      type: 'object',
      properties: {
        description: { type: ['string', 'null'] },
      },
    };

    const output = toGeminiSchema(input);

    expect(output).toEqual({
      type: 'object',
      properties: {
        description: { type: 'string', nullable: true },
      },
    });
  });

  it('converts anyOf with null into nullable: true', () => {
    const input = {
      type: 'object',
      properties: {
        notes: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
        },
      },
    };

    const output = toGeminiSchema(input);

    expect(output).toEqual({
      type: 'object',
      properties: {
        notes: { type: 'string', nullable: true },
      },
    });
  });

  it('dereferences $ref from $defs and removes $defs', () => {
    const input = {
      $id: 'test-with-refs',
      type: 'object',
      $defs: {
        item: {
          type: 'object',
          properties: {
            sku: { type: 'string' },
          },
          required: ['sku'],
        },
      },
      properties: {
        items: {
          type: 'array',
          items: { $ref: '#/$defs/item' },
        },
      },
    };

    const output = toGeminiSchema(input);

    expect(output).toEqual({
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string' },
            },
            required: ['sku'],
          },
        },
      },
    });
    expect(output).not.toHaveProperty('$defs');
    expect(output).not.toHaveProperty('$id');
  });
});
