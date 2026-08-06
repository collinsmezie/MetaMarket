/**
 * Recovering JSON from model output.
 *
 * Providers differ in how faithfully they honour "respond with JSON only": OpenAI's
 * structured outputs are reliable, while a fallback provider may wrap the object in prose
 * or a markdown fence. Normalising here keeps that difference out of the domain and means
 * a fallback does not fail purely on formatting.
 */

export class JsonExtractionError extends Error {
  constructor(
    readonly raw: string,
    override readonly cause?: unknown,
  ) {
    super(`Could not extract JSON from model output: ${raw.slice(0, 300)}`);
    this.name = 'JsonExtractionError';
  }
}

/** Strips a ```json fence when the model wrapped its answer in one. */
function stripCodeFence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?\s*```\s*$/i.exec(text);
  return fenced === null ? text : fenced[1];
}

/**
 * Finds the outermost balanced JSON object or array in `text`.
 *
 * Brace counting is string-aware so a `{` inside a quoted value cannot unbalance the scan —
 * naive index-of slicing truncates exactly the payloads that contain user text.
 */
function findBalancedJson(text: string): string | null {
  const firstObject = text.indexOf('{');
  const firstArray = text.indexOf('[');

  const candidates = [firstObject, firstArray].filter((index) => index !== -1);
  if (candidates.length === 0) return null;

  const start = Math.min(...candidates);
  const opening = text[start];
  const closing = opening === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      if (inString) escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === opening) depth += 1;
    else if (char === closing) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * Parses model output into a plain value, tolerating fences and surrounding commentary.
 * Throws {@link JsonExtractionError} when no valid JSON can be recovered.
 */
export function extractJson(raw: string): unknown {
  const trimmed = stripCodeFence(raw.trim());

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to a balanced-region scan before giving up.
  }

  const candidate = findBalancedJson(trimmed);
  if (candidate === null) throw new JsonExtractionError(raw);

  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new JsonExtractionError(raw, error);
  }
}
