import { SchemaContractViolation, SchemaNotRegisteredError, SchemaRegistry } from './schema-registry';

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://metamarket.local/schemas/test-contract-v4.json',
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'status', 'clarification'],
  properties: {
    schema_version: { const: '4.0' },
    status: { enum: ['SUCCESS', 'ERROR'] },
    clarification: {
      type: 'object',
      additionalProperties: false,
      required: ['required', 'question'],
      properties: { required: { type: 'boolean' }, question: { type: ['string', 'null'] } },
    },
  },
  allOf: [
    {
      if: { properties: { clarification: { properties: { required: { const: true } } } } },
      then: { properties: { clarification: { properties: { question: { type: 'string', minLength: 1 } } } } },
    },
  ],
};

describe('SchemaRegistry', () => {
  it('registers by $id, infers the wire version and validates including conditionals', () => {
    const registry = new SchemaRegistry();
    const registered = registry.register(schema);

    expect(registered.version).toBe('4.0');
    expect(
      registry.validate(schema.$id, {
        schema_version: '4.0',
        status: 'SUCCESS',
        clarification: { required: false, question: null },
      }).valid,
    ).toBe(true);

    const failing = registry.validate(schema.$id, {
      schema_version: '4.0',
      status: 'SUCCESS',
      clarification: { required: true, question: null },
    });
    expect(failing.valid).toBe(false);
    if (!failing.valid) {
      expect(failing.errors.some((error) => error.path === '/clarification/question')).toBe(true);
    }
  });

  it('rejects unknown top-level fields and wrong enum values', () => {
    const registry = new SchemaRegistry();
    registry.register(schema);
    const result = registry.validate(schema.$id, {
      schema_version: '4.0',
      status: 'MAYBE',
      clarification: { required: false, question: null },
      extra: 1,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((error) => error.keyword).sort()).toEqual(['additionalProperties', 'enum']);
    }
  });

  it('assert throws a typed violation and unknown ids throw', () => {
    const registry = new SchemaRegistry();
    registry.register(schema);
    expect(() => registry.assert(schema.$id, {})).toThrow(SchemaContractViolation);
    expect(() => registry.validate('https://nope', {})).toThrow(SchemaNotRegisteredError);
  });

  it('refuses two different documents under one $id', () => {
    const registry = new SchemaRegistry();
    registry.register(schema);
    expect(() => registry.register({ ...schema, required: ['status'] })).toThrow(/already registered/);
    expect(registry.register(schema).id).toBe(schema.$id);
  });
});
