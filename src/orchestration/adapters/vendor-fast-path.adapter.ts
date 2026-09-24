import { Injectable } from '@nestjs/common';
import { ConversationContextManager } from '../../application/conversation/conversation-context.manager';
import { VendorResponseHandler } from '../../application/fulfilment/vendor-response-handler.service';
import type { Response } from '../../domain/models/response';
import type { FastPathInput, FastPathPort } from '../ports/fast-path.port';

/**
 * Vendor RFQ response fast path (MCOS TDR §30) over the existing deterministic handler: a vendor
 * replying to a fanned-out request with a known action or an unambiguous quote is handled without
 * understanding, planning or a model.
 */
@Injectable()
export class VendorFastPathAdapter implements FastPathPort {
  constructor(
    private readonly vendorResponses: VendorResponseHandler,
    private readonly conversations: ConversationContextManager,
  ) {}

  async tryHandle(input: FastPathInput): Promise<Response | null> {
    const loaded = await this.conversations.loadById(input.conversationId);
    if (loaded === null) return null;
    return this.vendorResponses.tryHandle({
      conversation: loaded.conversation,
      interactivePayload: input.interactivePayload,
      text: input.text,
    });
  }
}
