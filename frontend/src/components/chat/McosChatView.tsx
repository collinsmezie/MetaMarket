'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCheck, MoreVertical, Plus, Send } from 'lucide-react';
import {
  fetchHistory,
  openStream,
  resetSession,
  sendMessage,
  type McosAction,
  type McosVendor,
} from '@/lib/mcos';
import { BusinessCard } from './BusinessCard';

/**
 * MCOS chat surface.
 *
 * A transport, not a brain. It carries text up and renders canonical responses down, exactly
 * like the WhatsApp adapter — no notion of buyers, sellers, searches or onboarding lives here.
 * That is what makes this UI and WhatsApp genuinely the same client from MCOS's point of view,
 * and what makes a difference in behaviour between them a bug rather than a feature.
 */

interface Bubble {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  actions?: McosAction[];
  /** Matched sellers, rendered as cards rather than repeated in the text. */
  vendors?: McosVendor[];
  timestamp: string;
}

function clockOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function cleanBubbleText(text: string, hasVendors: boolean): string {
  if (!hasVendors || !text) return text;
  const parts = text.split(/\n\n(?:\*|\d+\.\s)/);
  if (parts.length > 1) {
    const header = parts[0];
    const lastPart = parts[parts.length - 1];
    const replyMatch = lastPart.match(/\n\n(Reply with [\s\S]*)$/);
    const trailing = replyMatch ? '\n\n' + replyMatch[1] : '';
    return (header + trailing).trim();
  }
  return text;
}

export function McosChatView() {
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [online, setOnline] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  /** Rehydrate the transcript MCOS holds, then attach the live stream. */
  const connect = useCallback(() => {
    let cancelled = false;

    void fetchHistory()
      .then(({ history }) => {
        if (cancelled) return;

        setMessages(
          history.map((entry, index) => ({
            id: `h${index}`,
            sender: entry.role === 'user' ? 'user' : 'bot',
            text: entry.content,
            timestamp: clockOf(entry.at),
          })),
        );
      })
      .catch(() => {
        // An empty transcript is indistinguishable from a first visit, so there is nothing
        // useful to say here.
      });

    const close = openStream({
      onOpen: () => setOnline(true),
      onError: () => setOnline(false),
      onTyping: () => {
        setIsLoading(true);

        // The indicator is a hint with no "stopped" signal, so it expires on its own rather
        // than hanging forever if the reply arrives by another route.
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setIsLoading(false), 30_000);
      },
      onMessage: (event) => {
        setIsLoading(false);

        setMessages((current) => [
          ...current,
          {
            id: `${event.at}_${current.length}`,
            sender: 'bot',
            text: event.response.text ?? '',
            actions: event.response.actions,
            vendors: event.response.metadata?.vendors,
            timestamp: clockOf(event.at),
          },
        ]);
      },
    });

    return () => {
      cancelled = true;
      close();
    };
  }, []);

  useEffect(connect, [connect]);

  const send = async (payload: { text?: string; actionPayload?: string; actionTitle?: string }) => {
    const shown = payload.text ?? payload.actionTitle ?? '';
    if (shown.trim().length === 0) return;

    setMessages((current) => [
      ...current,
      {
        id: `u${Date.now()}`,
        sender: 'user',
        text: shown,
        timestamp: clockOf(new Date().toISOString()),
      },
    ]);

    setInput('');
    setIsLoading(true);

    try {
      await sendMessage(payload);
    } catch (error) {
      setIsLoading(false);
      setMessages((current) => [
        ...current,
        {
          id: `err${Date.now()}`,
          sender: 'bot',
          text: `Could not reach MetaMarket. ${error instanceof Error ? error.message : ''}`,
          timestamp: clockOf(new Date().toISOString()),
        },
      ]);
    }
  };

  /** Abandons this conversation for a fresh one. The old one is left intact in MCOS. */
  const handleNewChat = () => {
    setShowMenu(false);
    resetSession();
    setMessages([]);
    setIsLoading(false);
    connect();
  };

  return (
    <div className="flex flex-col h-full w-full max-w-lg mx-auto bg-[#0b141a] text-slate-100 font-sans relative overflow-hidden">
      {/* Ultra-Clean WhatsApp Header with 3-Dot Options Menu */}
      <header className="bg-[#202c33] px-3.5 py-3 flex items-center justify-between border-b border-[#2a3942] z-30 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-emerald-600 flex items-center justify-center font-bold text-white text-sm shadow-sm">
            M
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-base text-slate-100 tracking-tight leading-none">
              MetaMarket
            </span>
            <span className="text-[11px] text-emerald-400 font-sans mt-0.5">
              {isLoading ? 'typing...' : online ? 'online' : 'connecting...'}
            </span>
          </div>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowMenu((prev) => !prev)}
            className="p-1.5 rounded-full hover:bg-[#2a3942] text-slate-300 hover:text-white transition cursor-pointer"
            title="Options"
          >
            <MoreVertical className="w-5 h-5" />
          </button>

          {showMenu && (
            <div className="absolute right-0 mt-2 w-48 bg-[#233138] rounded-xl shadow-xl border border-[#2a3942] py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
              <button
                type="button"
                onClick={handleNewChat}
                className="w-full text-left px-4 py-2.5 text-xs text-emerald-300 hover:bg-[#182229] flex items-center gap-2 font-medium transition cursor-pointer"
              >
                <Plus className="w-4 h-4 text-emerald-300" />
                <span>New Chat</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Message Chat Body (WhatsApp Wallpaper) */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-[#0b141a] relative">
        <div className="absolute inset-0 opacity-5 pointer-events-none bg-[radial-gradient(#222d34_1px,transparent_1px)] [background-size:16px_16px]" />

        {messages.map((msg) => {
          const isUser = msg.sender === 'user';
          return (
            <div
              key={msg.id}
              className={`flex flex-col relative z-10 ${isUser ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[88%] sm:max-w-[80%] rounded-xl px-3 py-2 text-[13px] leading-relaxed shadow-sm ${
                  isUser
                    ? 'bg-[#005c4b] text-slate-100 rounded-tr-none'
                    : 'bg-[#202c33] text-slate-100 rounded-tl-none border border-[#2a3942]/60'
                }`}
              >
                <p className="whitespace-pre-wrap">
                  {cleanBubbleText(msg.text, Boolean(msg.vendors && msg.vendors.length > 0))}
                </p>

                {msg.vendors && msg.vendors.length > 0 && (
                  <div className="mt-3 space-y-2.5 pt-2 border-t border-[#2a3942]/60">
                    {msg.vendors.map((vendor) => (
                      <BusinessCard key={vendor.vendorId} vendor={vendor} />
                    ))}
                  </div>
                )}

                {/* Interactive actions MCOS offered. The payload is opaque and echoed back
                    verbatim — it is the deterministic route home to the right workflow. */}
                {msg.actions && msg.actions.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5 pt-2 border-t border-[#2a3942]/60">
                    {msg.actions.map((action) => (
                      <button
                        key={action.payload}
                        type="button"
                        onClick={() =>
                          void send({ actionPayload: action.payload, actionTitle: action.title })
                        }
                        className="px-2.5 py-1 rounded-lg bg-[#111b21] border border-emerald-500/40 text-emerald-300 hover:border-emerald-400 hover:bg-emerald-950/40 font-semibold text-[11px] transition-all shadow-sm active:scale-95"
                      >
                        {action.title}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-slate-400">
                  <span>{msg.timestamp}</span>
                  {isUser && <CheckCheck className="w-3.5 h-3.5 text-teal-400" />}
                </div>
              </div>
            </div>
          );
        })}

        {/* WhatsApp-Style Bouncing Dots Typing Animation */}
        {isLoading && (
          <div className="flex items-center gap-2 bg-[#202c33] px-4 py-2.5 rounded-2xl rounded-tl-none max-w-[130px] border border-[#2a3942] shadow-sm my-1 relative z-10">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.3s]" />
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.15s]" />
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce" />
            </div>
            <span className="text-[11px] text-slate-400 font-mono italic ml-1">typing...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Bottom Single Input Box (Zero Button UI) */}
      <div className="bg-[#202c33] p-2.5 border-t border-[#2a3942] shrink-0 z-30">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send({ text: input });
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message MetaMarket..."
            className="flex-1 bg-[#2a3942] rounded-full px-4 py-2.5 text-sm text-slate-100 placeholder-slate-400 focus:outline-none border border-transparent focus:border-emerald-500"
          />

          <button
            type="submit"
            disabled={!input.trim()}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-transform shrink-0 ${
              input.trim()
                ? 'bg-[#00a884] hover:bg-[#029072] text-white active:scale-95 shadow'
                : 'bg-[#2a3942] text-slate-400 cursor-not-allowed'
            }`}
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
