import { extractJson, JsonExtractionError } from './json-extraction';

describe('extractJson', () => {
  it('parses clean JSON', () => {
    expect(extractJson('{"intent":"buyer_product_search"}')).toEqual({ intent: 'buyer_product_search' });
  });

  it('unwraps a markdown code fence', () => {
    const raw = '```json\n{"product":"artist brush"}\n```';

    expect(extractJson(raw)).toEqual({ product: 'artist brush' });
  });

  it('recovers JSON surrounded by commentary', () => {
    const raw = 'Sure! Here is the result:\n{"ambiguity":false}\nHope that helps.';

    expect(extractJson(raw)).toEqual({ ambiguity: false });
  });

  it('does not truncate on braces inside string values', () => {
    // A naive lastIndexOf('}') scan mangles exactly this shape.
    const raw = '{"text":"price is {negotiable}","ok":true}';

    expect(extractJson(raw)).toEqual({ text: 'price is {negotiable}', ok: true });
  });

  it('handles escaped quotes inside string values', () => {
    const raw = '{"text":"he said \\"yes\\"","ok":true}';

    expect(extractJson(raw)).toEqual({ text: 'he said "yes"', ok: true });
  });

  it('parses a top-level array', () => {
    expect(extractJson('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('throws when there is no JSON at all', () => {
    expect(() => extractJson('I am not able to answer that.')).toThrow(JsonExtractionError);
  });

  it('throws when the JSON region is malformed', () => {
    expect(() => extractJson('{"unclosed": ')).toThrow(JsonExtractionError);
  });
});
