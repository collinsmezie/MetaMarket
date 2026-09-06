'use client';

import React from 'react';
import { McosChatView } from '@/components/chat/McosChatView';

/**
 * The chat surface now speaks to MCOS over the web channel.
 *
 * The previous view (`WhatsAppChatView`) talked to the AMKE backend — `/amke/stream`,
 * `/amke/search`, client-side buyer/seller branching — which MCOS does not implement. Its
 * styling is preserved here; only the transport changed. It is left in the tree for
 * reference, and nothing routes to it.
 */
export default function HomePage() {
  return (
    <main className="h-[100dvh] w-full bg-[#0b141a] flex items-center justify-center overflow-hidden">
      <McosChatView />
    </main>
  );
}
