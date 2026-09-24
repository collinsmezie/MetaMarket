import { camelToSnakeKey, snakeToCamelKey, toCamelCaseKeys, toSnakeCaseKeys } from './wire-casing';

describe('wire casing', () => {
  it('converts keys in both directions without touching values', () => {
    const wire = {
      resolution_status: 'RESOLVED',
      intents: [{ intent_id: 'i1', scope: { object_ids: ['object_1'], conversation_scope: false } }],
      model_metadata: { prompt_version: 'idce-1.2', schema_version: 'idce-resolution-1.0' },
    };

    const internal = toCamelCaseKeys<Record<string, unknown>>(wire);
    expect(internal).toEqual({
      resolutionStatus: 'RESOLVED',
      intents: [{ intentId: 'i1', scope: { objectIds: ['object_1'], conversationScope: false } }],
      modelMetadata: { promptVersion: 'idce-1.2', schemaVersion: 'idce-resolution-1.0' },
    });

    expect(toSnakeCaseKeys(internal)).toEqual(wire);
  });

  it('round-trips single keys', () => {
    expect(snakeToCamelKey('market_concept_id')).toBe('marketConceptId');
    expect(camelToSnakeKey('marketConceptId')).toBe('market_concept_id');
    expect(camelToSnakeKey('gpcCode')).toBe('gpc_code');
    expect(snakeToCamelKey('already')).toBe('already');
  });

  it('leaves dates and primitives alone', () => {
    const at = new Date('2026-09-12T00:00:00Z');
    expect(toSnakeCaseKeys({ occurredAt: at, count: 2, ok: true, nothing: null })).toEqual({
      occurred_at: at,
      count: 2,
      ok: true,
      nothing: null,
    });
  });
});
