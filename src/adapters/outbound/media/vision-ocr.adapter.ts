import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigService } from '../../../config/app-config.service';
import type { DownloadedMedia, OcrPort, OcrResult } from '../../../domain/ports/outbound/media.port';
import { MediaProcessingError } from '../../../domain/ports/outbound/media.port';

/**
 * Text extraction from images using a vision model (MCOS §5.2).
 *
 * Vendors photograph handwritten stock lists, price boards and product labels far more
 * readily than they type them, so a general vision model handles this better than classical
 * OCR: the input is rarely clean printed text.
 */
@Injectable()
export class VisionOcrAdapter implements OcrPort {
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor(config: AppConfigService) {
    const { apiKey, model } = config.openai;
    this.model = model;
    this.client = apiKey === undefined ? null : new OpenAI({ apiKey });
  }

  async extractText(media: DownloadedMedia): Promise<OcrResult> {
    if (this.client === null) {
      throw new MediaProcessingError(
        'OPENAI_API_KEY is not configured, so images cannot be read.',
        'unknown',
        false,
      );
    }

    const dataUrl = `data:${media.mimeType};base64,${media.bytes.toString('base64')}`;

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract the text content of this image.' },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ],
          },
        ],
      });

      const text = completion.choices[0]?.message.content?.trim() ?? '';

      // The model is instructed to answer with this exact token when there is no text,
      // which is a genuine outcome rather than a failure.
      if (text === NO_TEXT_MARKER || text.length === 0) {
        return { text: '', confidence: 0 };
      }

      return { text, confidence: 0.85 };
    } catch (error) {
      const retryable =
        !(error instanceof OpenAI.APIError) || (error.status ?? 500) >= 500 || error.status === 429;
      const message = error instanceof Error ? error.message : String(error);

      throw new MediaProcessingError(`Image text extraction failed: ${message}`, 'unknown', retryable, error);
    }
  }
}

const NO_TEXT_MARKER = 'NO_TEXT';

const SYSTEM_PROMPT = `You extract text from photographs sent by traders in informal markets: handwritten stock lists, price boards, invoices, product labels and packaging.

Rules:
- Return only the text you can actually read, preserving line breaks and ordering.
- Do not describe the image, and do not explain what you are doing.
- Do not correct spelling or expand abbreviations — traders use their own shorthand and it carries meaning.
- If the image contains no legible text, reply with exactly: ${NO_TEXT_MARKER}`;
