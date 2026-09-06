'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ActorRole, ChatMessage } from '@/lib/types';
import { ingestMarketStream, searchBuyerMarketplace, synthesizeIntent } from '@/lib/api';
import { MessageBubble } from './MessageBubble';
import { DemoScenarios } from './DemoScenarios';
import { Send, Loader2, RefreshCw, Store, Plus, MapPin, Briefcase } from 'lucide-react';

const PRESET_VENDORS = [
  { name: 'Mama Gift Provisions', location: 'Surulere', role: 'provisions store' },
  { name: 'Mobinco Bookshop', location: 'Warri', role: 'bookshop & stationery store' },
  { name: 'AutoParts Hub Lagos', location: 'Ikeja', role: 'automotive spare parts & fluids store' },
  { name: 'Edochie & Sons Plumbing', location: 'Warri', role: 'plumbing & sanitary ware store' },
  { name: 'Alaba Wholesalers Ltd', location: 'Surulere', role: 'provisions & food wholesale store' },
];

interface ChatContainerProps {
  activeRole: ActorRole;
  setActiveRole: (role: ActorRole) => void;
}

export function ChatContainer({ activeRole, setActiveRole }: ChatContainerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome_1',
      sender: 'bot',
      role: 'SELLER',
      text: '👋 Welcome to the Autonomous Market Knowledge Engine (AMKE)!\n\n• **Seller Intake Mode**: Select or create a vendor profile, then type what you stock (e.g. "We sell steering covers, brake pads, and engine oil") to sprout graph nodes.\n• **Buyer Search Mode**: Search naturally for products (e.g. "I need a steering cover", "Who has milk powder?") to trigger vector search and 2-tier cluster traversal.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      sessionId: 'sess_init',
    },
  ]);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sellerName, setSellerName] = useState('Mama Gift Provisions');
  const [sellerLocation, setSellerLocation] = useState('Surulere');
  const [sellerRole, setSellerRole] = useState('provisions store');
  const [sellerPhone, setSellerPhone] = useState('+234 803 000 1111');
  const [isCustomVendor, setIsCustomVendor] = useState(false);

  // Hydrate from localStorage on client mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('amke_chat_messages_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch {}
  }, []);

  // Persist messages to localStorage
  useEffect(() => {
    try {
      if (messages.length > 0) {
        localStorage.setItem('amke_chat_messages_v1', JSON.stringify(messages));
      }
    } catch {}
  }, [messages]);

  const [activeHydration, setActiveHydration] = useState<{
    originalInput: string;
    probingQuestion: string;
    role: ActorRole;
    actorId: string;
    sessionId: string;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSend = async (customText?: string, overrideRole?: ActorRole) => {
    const textToSend = customText || input;
    if (!textToSend.trim() || isLoading) return;

    const currentRole = overrideRole || activeRole;
    const sessionId = `sess_${Date.now().toString(36)}`;
    const actorId = currentRole === 'SELLER' ? `seller_${sellerName.toLowerCase().replace(/[^\w]/g, '_')}` : `buyer_${Date.now().toString(36)}`;

    // Add user message
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      sender: 'user',
      role: currentRole,
      text: textToSend,
      actorName: currentRole === 'SELLER' ? sellerName : undefined,
      actorLocation: currentRole === 'SELLER' ? sellerLocation : undefined,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      sessionId,
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!customText) setInput('');
    setIsLoading(true);

    try {
      // -------------------------------------------------------------
      // PATH A: User is answering an active Hydration Probing Question
      // -------------------------------------------------------------
      if (activeHydration) {
        const hydrationContext = { ...activeHydration };
        setActiveHydration(null); // Clear active hydration

        // 1. Synthesize conversational dialogue into dense vector target (FR-1.1)
        const synthesisRes = await synthesizeIntent({
          originalInput: hydrationContext.originalInput,
          probingQuestion: hydrationContext.probingQuestion,
          userClarification: textToSend,
        });

        const synthesizedTarget = synthesisRes.synthesizedSearchText || `${hydrationContext.originalInput} ${textToSend}`;
        const finalRole = synthesisRes.detectedIntent === 'SELL'
          ? 'SELLER'
          : synthesisRes.detectedIntent === 'BUY'
          ? 'BUYER'
          : hydrationContext.role || 'BUYER';

        // 2. Execute Graph Stream / Search with synthesized target
        if (finalRole === 'SELLER') {
          const res = await ingestMarketStream({
            actorId: hydrationContext.actorId,
            actorType: 'SELLER',
            actorName: sellerName,
            actorLocation: sellerLocation,
            actorPhone: sellerPhone,
            businessRole: sellerRole,
            rawMessySpeech: synthesizedTarget,
            sessionId: hydrationContext.sessionId,
          });

          const botMsg: ChatMessage = {
            id: `bot_${Date.now()}`,
            sender: 'bot',
            role: 'SELLER',
            text: `🎯 Hydrated & Synthesized! Successfully linked ${res.resolvedConcepts.length} product concept node(s) to "${sellerName}" in Neo4j with 1536-dim vector embedding.`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            sessionId: hydrationContext.sessionId,
            synthesizedText: synthesizedTarget,
            resolvedConcepts: res.resolvedConcepts,
            isolatedNoise: res.isolatedNoise,
          };
          setMessages((prev) => [...prev, botMsg]);
        } else {
          const res = await searchBuyerMarketplace({
            buyerId: hydrationContext.actorId,
            rawSearchQuery: synthesizedTarget,
            buyerLocation: 'Surulere',
            sessionId: hydrationContext.sessionId,
          });

          const botMsg: ChatMessage = {
            id: `bot_${Date.now()}`,
            sender: 'bot',
            role: 'BUYER',
            text: res.resolutionSummary,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            sessionId: hydrationContext.sessionId,
            synthesizedText: synthesizedTarget,
            parsedConcepts: res.parsedConcepts,
            matchingSuppliers: res.matchingSuppliers,
            isolatedNoise: res.isolatedNoise,
          };
          setMessages((prev) => [...prev, botMsg]);
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('amke:graph-refresh', { detail: { sessionId: hydrationContext.sessionId } }));
        }

        return;
      }

      // -------------------------------------------------------------
      // PATH B: Fresh Message (Check Hydration or Ingest/Search)
      // -------------------------------------------------------------
      if (currentRole === 'SELLER') {
        // AMKE Seller Intake Stream
        const res = await ingestMarketStream({
          actorId,
          actorType: 'SELLER',
          actorName: sellerName,
          actorLocation: sellerLocation,
          actorPhone: sellerPhone,
          businessRole: sellerRole,
          rawMessySpeech: textToSend,
          sessionId,
        });

        // FR-1: Hydration Intercept
        if (res.hydrationTriggered) {
          setActiveHydration({
            originalInput: textToSend,
            probingQuestion: res.hydrationQuestion,
            role: 'SELLER',
            actorId,
            sessionId,
          });

          const botMsg: ChatMessage = {
            id: `bot_${Date.now()}`,
            sender: 'bot',
            role: 'SELLER',
            text: `🧠 AMKE Intent Hydration Required:\nYour product description is brief or broad. Please answer the clarification question below to generate a high-precision vector embedding.`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            sessionId,
            hydrationTriggered: true,
            hydrationQuestion: res.hydrationQuestion,
            originalInput: textToSend,
          };
          setMessages((prev) => [...prev, botMsg]);
          return;
        }

        const hasSevered = res.resolvedConcepts.some((c: any) => !c.isAvailable);
        let botText = `✅ Processed inventory stream for "${sellerName}".`;
        if (hasSevered) {
          botText = `⚠️ Inventory updated! Severed active [:SUPPLIES] relationships for out-of-stock items.`;
        } else if (res.resolvedConcepts.length === 0) {
          botText = `💬 Conversational noise detected. No product entities were altered in the market knowledge graph.`;
        } else {
          botText = `✨ Successfully linked ${res.resolvedConcepts.length} product concept node(s) to "${sellerName}" in Neo4j!`;
        }

        const botMsg: ChatMessage = {
          id: `bot_${Date.now()}`,
          sender: 'bot',
          role: 'SELLER',
          text: botText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          sessionId,
          resolvedConcepts: res.resolvedConcepts,
          isolatedNoise: res.isolatedNoise,
        };
        setMessages((prev) => [...prev, botMsg]);
      } else {
        // AMKE Buyer Semantic Vector Search
        const res = await searchBuyerMarketplace({
          buyerId: actorId,
          rawSearchQuery: textToSend,
          buyerLocation: 'Surulere',
          sessionId,
        });

        // FR-1: Hydration Intercept
        if (res.hydrationTriggered) {
          setActiveHydration({
            originalInput: textToSend,
            probingQuestion: res.hydrationQuestion,
            role: 'BUYER',
            actorId,
            sessionId,
          });

          const botMsg: ChatMessage = {
            id: `bot_${Date.now()}`,
            sender: 'bot',
            role: 'BUYER',
            text: res.resolutionSummary,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            sessionId,
            hydrationTriggered: true,
            hydrationQuestion: res.hydrationQuestion,
            originalInput: textToSend,
          };
          setMessages((prev) => [...prev, botMsg]);
          return;
        }

        const botMsg: ChatMessage = {
          id: `bot_${Date.now()}`,
          sender: 'bot',
          role: 'BUYER',
          text: res.resolutionSummary,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          sessionId,
          parsedConcepts: res.parsedConcepts,
          matchingSuppliers: res.matchingSuppliers,
          isolatedNoise: res.isolatedNoise,
        };
        setMessages((prev) => [...prev, botMsg]);
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('amke:graph-refresh', { detail: { sessionId } }));
      }
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        sender: 'bot',
        role: currentRole,
        text: `❌ Processing Error: ${err.message || 'Pipeline execution failed'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sessionId,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleScenarioClick = (text: string, role: ActorRole) => {
    setActiveRole(role);
    handleSend(text, role);
  };

  const clearChat = () => {
    try {
      localStorage.removeItem('amke_chat_messages_v1');
    } catch {}
    setMessages([
      {
        id: 'welcome_1',
        sender: 'bot',
        role: 'SELLER',
        text: '👋 Welcome to the Autonomous Market Knowledge Engine (AMKE)!\n\n• **Seller Intake Mode**: Select or create a vendor profile, then type what you stock (e.g. "We sell steering covers, brake pads, and engine oil") to sprout graph nodes.\n• **Buyer Search Mode**: Search naturally for products (e.g. "I need a steering cover", "Who has milk powder?") to trigger vector search and 2-tier cluster traversal.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sessionId: 'sess_init',
      },
    ]);
  };

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* Benchmark Demo Pills */}
      <DemoScenarios onSelectScenario={handleScenarioClick} />

      {/* Seller Intake Configuration Panel (Visible in SELLER Mode) */}
      {activeRole === 'SELLER' && (
        <div className="p-3 rounded-2xl bg-surface/80 border border-surface-border backdrop-blur-md space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs font-bold text-emerald-400">
              <Store className="w-4 h-4" />
              <span>Merchant Intake Profile:</span>
            </div>
            <button
              onClick={() => {
                setIsCustomVendor(!isCustomVendor);
                if (!isCustomVendor) {
                  setSellerName('');
                  setSellerLocation('Lagos');
                  setSellerRole('retail merchant');
                }
              }}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-surface-border/50 hover:bg-surface-border text-xs text-slate-300 transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>{isCustomVendor ? 'Select Preset Store' : '+ New Custom Store'}</span>
            </button>
          </div>

          {!isCustomVendor ? (
            <div className="flex flex-wrap gap-1.5">
              {PRESET_VENDORS.map((v) => (
                <button
                  key={v.name}
                  onClick={() => {
                    setSellerName(v.name);
                    setSellerLocation(v.location);
                    setSellerRole(v.role);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                    sellerName === v.name
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm shadow-emerald-500/10'
                      : 'bg-background/60 text-slate-400 border border-surface-border hover:text-slate-200'
                  }`}
                >
                  {v.name} ({v.location})
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
              <div className="flex items-center bg-background rounded-xl px-2.5 py-1.5 border border-surface-border">
                <Store className="w-3.5 h-3.5 text-slate-500 mr-2" />
                <input
                  type="text"
                  placeholder="Store Name (e.g. Kemi Fabrics)"
                  value={sellerName}
                  onChange={(e) => setSellerName(e.target.value)}
                  className="bg-transparent text-white placeholder-slate-500 w-full focus:outline-none"
                />
              </div>

              <div className="flex items-center bg-background rounded-xl px-2.5 py-1.5 border border-surface-border">
                <MapPin className="w-3.5 h-3.5 text-slate-500 mr-2" />
                <input
                  type="text"
                  placeholder="Location (e.g. Balogun, Lagos)"
                  value={sellerLocation}
                  onChange={(e) => setSellerLocation(e.target.value)}
                  className="bg-transparent text-white placeholder-slate-500 w-full focus:outline-none"
                />
              </div>

              <div className="flex items-center bg-background rounded-xl px-2.5 py-1.5 border border-surface-border">
                <Briefcase className="w-3.5 h-3.5 text-slate-500 mr-2" />
                <input
                  type="text"
                  placeholder="Business Role (e.g. textile dealer)"
                  value={sellerRole}
                  onChange={(e) => setSellerRole(e.target.value)}
                  className="bg-transparent text-white placeholder-slate-500 w-full focus:outline-none"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 rounded-3xl bg-surface/40 border border-surface-border backdrop-blur-md space-y-2">
        {/* Chat Header Bar */}
        <div className="flex items-center justify-between px-2 pb-2 border-b border-surface-border/50 text-xs text-slate-400">
          <div className="flex items-center space-x-2">
            <span
              className={`w-2 h-2 rounded-full ${
                activeRole === 'SELLER' ? 'bg-emerald-400 animate-pulse' : 'bg-blue-400 animate-pulse'
              }`}
            />
            <span className="font-semibold text-white">
              {activeRole === 'SELLER'
                ? `Seller Intake: Active Store "${sellerName || 'Custom Merchant'}" (${sellerLocation})`
                : 'Buyer Search: Vector Matching (> 0.88 Cosine Similarity)'}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={clearChat}
              className="flex items-center space-x-1 text-slate-400 hover:text-white transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Clear</span>
            </button>
          </div>
        </div>

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isLoading && (
          <div className="flex items-center space-x-3 p-3 bg-surface rounded-2xl border border-surface-border max-w-sm animate-pulse">
            <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
            <span className="text-xs text-slate-300 font-medium">
              Executing AMKE Vector Resolution & Neo4j Traversal...
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Active Hydration Clarification Bar */}
      {activeHydration && (
        <div className="flex items-center justify-between p-2.5 px-3.5 rounded-xl bg-amber-950/70 border border-amber-500/50 shadow-lg text-xs animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center gap-2 text-amber-200">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span className="font-bold uppercase tracking-wider text-[10px] text-amber-400">AMKE Hydration Active:</span>
            <span className="truncate max-w-md text-amber-100 font-medium">Clarifying &ldquo;{activeHydration.originalInput}&rdquo;</span>
          </div>
          <button
            type="button"
            onClick={() => setActiveHydration(null)}
            className="text-[11px] text-amber-400/80 hover:text-amber-200 hover:underline ml-2 shrink-0 font-medium"
          >
            ✕ Cancel
          </button>
        </div>
      )}

      {/* Input Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className={`flex items-center gap-2 p-2 rounded-2xl bg-surface border shadow-2xl transition-all ${
          activeHydration
            ? 'border-amber-500/60 focus-within:border-amber-400 shadow-amber-500/10'
            : 'border-surface-border focus-within:border-purple-500'
        }`}
      >
        <div
          className={`px-3 py-2 rounded-xl text-xs font-mono font-bold ${
            activeHydration
              ? 'bg-amber-950/80 border border-amber-500/40 text-amber-300'
              : 'bg-background text-slate-400'
          }`}
        >
          {activeHydration ? '🧠 HYDRATING' : activeRole}
        </div>

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            activeHydration
              ? `Type your clarification (e.g. "Size 5 match balls and soccer boots" or "thick nylon for shoe packaging")...`
              : activeRole === 'SELLER'
              ? `e.g. "We sell steering covers, brake pads, and gear oil" or "peak milk is finished"`
              : 'e.g. "I need a steering cover", "Who has milk powder for tea?", "I need bibles"'
          }
          className="flex-1 bg-transparent px-2 py-2 text-sm text-white placeholder-slate-500 focus:outline-none"
          disabled={isLoading}
        />

        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className={`flex items-center space-x-1.5 px-4 py-2.5 rounded-xl font-bold text-xs transition-all shadow-lg ${
            input.trim() && !isLoading
              ? activeHydration
                ? 'bg-amber-500 text-black hover:bg-amber-400 shadow-amber-500/20 active:scale-95'
                : activeRole === 'SELLER'
                ? 'bg-emerald-500 text-black hover:bg-emerald-400 shadow-emerald-500/20 active:scale-95'
                : 'bg-blue-500 text-white hover:bg-blue-400 shadow-blue-500/20 active:scale-95'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
          }`}
        >
          <span>{activeHydration ? 'Clarify' : 'Send'}</span>
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}
export default ChatContainer;
