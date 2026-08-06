/**
 * Structured artifacts produced by the Media Processing Service (MCOS §5.2).
 *
 * Once media has been processed, every downstream component works with artifacts —
 * predominantly text — and never with audio or image bytes (MCOS Stage 2).
 */

export const ARTIFACT_SOURCES = [
  'user_text',
  'speech_to_text',
  'ocr',
  'vision',
  'document_parse',
  'video_analysis',
  'location_parse',
  'interactive_reply',
] as const;

export type ArtifactSource = (typeof ARTIFACT_SOURCES)[number];

interface ArtifactBase {
  readonly type: string;
  /** Which extraction path produced this artifact. */
  readonly source: ArtifactSource;
  /**
   * Extraction confidence in [0,1].
   *
   * 1 for text the user literally typed; a model score for transcription or OCR.
   * Low-confidence artifacts must not be treated as facts — the pipeline degrades to
   * asking the user rather than acting on a bad transcription.
   */
  readonly confidence: number;
  /** The message part this artifact was derived from, when applicable. */
  readonly originPartIndex?: number;
}

export interface TextArtifact extends ArtifactBase {
  readonly type: 'text';
  readonly content: string;
  /** BCP-47 tag when the extractor reported one, e.g. `en`, `pcm`. */
  readonly language?: string;
}

export interface LocationArtifact extends ArtifactBase {
  readonly type: 'location';
  readonly latitude: number;
  readonly longitude: number;
  readonly label?: string;
}

export interface ContactArtifact extends ArtifactBase {
  readonly type: 'contact';
  readonly name: string;
  readonly phones: readonly string[];
}

/** A stored media reference, retained so evidence can point back at the original file. */
export interface MediaReferenceArtifact extends ArtifactBase {
  readonly type: 'media_reference';
  readonly storageKey: string;
  readonly mimeType: string;
  readonly byteSize: number;
}

export type Artifact = TextArtifact | LocationArtifact | ContactArtifact | MediaReferenceArtifact;

export function isTextArtifact(artifact: Artifact): artifact is TextArtifact {
  return artifact.type === 'text';
}

/**
 * Flattens the text an incoming message contributed, in part order.
 *
 * This is the single input the understanding stages read, which is what makes a typed
 * message and a transcribed voice note genuinely interchangeable.
 */
export function collectText(artifacts: readonly Artifact[]): string {
  return artifacts
    .filter(isTextArtifact)
    .map((artifact) => artifact.content.trim())
    .filter((content) => content.length > 0)
    .join('\n');
}

/**
 * Lowest confidence among the text artifacts, or 1 when there are none.
 *
 * Used to decide whether the platform trusts what it heard well enough to act, or
 * should confirm before spending the user's patience.
 */
export function lowestTextConfidence(artifacts: readonly Artifact[]): number {
  const confidences = artifacts.filter(isTextArtifact).map((artifact) => artifact.confidence);
  return confidences.length === 0 ? 1 : Math.min(...confidences);
}
