import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, BusinessAccount } from '@/lib/types';
import {
  ingestMarketStream,
  searchBuyerMarketplace,
  evaluateHydration,
  synthesizeIntent,
  resolveBusinessAccount,
  fetchAdminSession,
} from '@/lib/api';
import {
  Send,
  Loader2,
  CheckCheck,
  Sparkles,
  MoreVertical,
  Trash2,
  Radio,
  Activity,
  Compass,
  Bell,
} from 'lucide-react';
import { BusinessCard } from './BusinessCard';

function sanitizeText(str: string): string {
  if (!str) return '';
  return str
    .replace(/\(GPC\s*\d+\)/gi, '')
    .replace(/\[GPC\s*\d+\]\s*/gi, '')
    .replace(/GPC Vector Score:\s*\d+%/gi, '')
    .replace(/via GS1 GPC taxonomy/gi, 'in market')
    .trim();
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

const DEFAULT_WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome_msg_default',
  sender: 'bot',
  role: 'BUYER',
  text: '👋 Welcome to MetaMarket!\n\nType what you are looking for to find verified sellers, or mention what you sell for customers to find you.',
  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  sessionId: '',
};

type ResolutionHistoryTurn = {
  sender: 'user' | 'assistant';
  text: string;
  role?: string;
};

export function WhatsAppChatView() {
  const [messages, setMessages] = useState<ChatMessage[]>([DEFAULT_WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  // Business Account state & Anonymous Session ID
  const [businessAccount, setBusinessAccount] = useState<BusinessAccount | null>(null);
  const [sessionId, setSessionId] = useState<string>('');

  const [activeHydration, setActiveHydration] = useState<{
    originalInput: string;
    probingQuestion: string;
    actorId: string;
    sessionId: string;
    detectedIntent?: 'SELLER' | 'BUYER';
    resolutionHistory: ResolutionHistoryTurn[];
  } | null>(null);

  // Turn-Driven Seller Onboarding State Machine
  const [sellerOnboarding, setSellerOnboarding] = useState<{
    step: 'COLLECT_ITEMS' | 'COLLECT_BIZ_NAME' | 'COLLECT_LOCATION' | 'COLLECT_PHONE';
    items?: string;
    businessName?: string;
    location?: string;
    phone?: string;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleClearHistory = () => {
    try {
      if (sessionId) {
        localStorage.removeItem(`amke_chat_msgs_${sessionId}`);
        localStorage.removeItem(`amke_active_hydration_${sessionId}`);
        localStorage.removeItem(`amke_seller_onboarding_${sessionId}`);
      }
      localStorage.removeItem('amke_chat_session_id');
      const newSession = `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      localStorage.setItem('amke_chat_session_id', newSession);
      setSessionId(newSession);
      setMessages([DEFAULT_WELCOME_MESSAGE]);
      setActiveHydration(null);
      setSellerOnboarding(null);
    } catch (err) {
      console.warn('Error clearing chat history:', err);
    } finally {
      setShowMenu(false);
    }
  };

  const syncChatHistory = async (session: string) => {
    try {
      const saved = localStorage.getItem(`amke_chat_msgs_${session}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          return;
        }
      }
      const details = await fetchAdminSession(session);
      if (details && details.messages && details.messages.length > 0) {
        const history: ChatMessage[] = [DEFAULT_WELCOME_MESSAGE];

        for (const m of details.messages) {
          const isBot = m.actorId === 'amke_assistant' || m.actorRole === 'SYSTEM' || (m.metadata as any)?.isBotResponse;
          const cleanText = sanitizeText(m.rawText);
          if (!cleanText) continue;

          history.push({
            id: m.id || `msg_${Math.random()}`,
            sender: isBot ? 'bot' : 'user',
            role: m.actorRole === 'SELLER' ? 'SELLER' : 'BUYER',
            chatMode: m.chatMode || (m.actorRole === 'SELLER' ? 'VENDOR' : 'BUYER'),
            text: cleanText,
            timestamp: new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            sessionId: session,
            matchingSuppliers: (m.metadata as any)?.matchingSuppliers || undefined,
          });
        }

        setMessages(history);
      } else {
        setMessages([DEFAULT_WELCOME_MESSAGE]);
      }
    } catch (err) {
      console.warn('Could not sync chat history from backend:', err);
      setMessages([DEFAULT_WELCOME_MESSAGE]);
    }
  };

  // Initialize persistent session ID, resolve business account, and sync backend chat history
  useEffect(() => {
    let currentSession = localStorage.getItem('amke_chat_session_id');
    if (!currentSession) {
      currentSession = `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      localStorage.setItem('amke_chat_session_id', currentSession);
    }
    setSessionId(currentSession);

    try {
      const savedHydration = localStorage.getItem(`amke_active_hydration_${currentSession}`);
      if (savedHydration) setActiveHydration(JSON.parse(savedHydration));
      const savedOnboarding = localStorage.getItem(`amke_seller_onboarding_${currentSession}`);
      if (savedOnboarding) setSellerOnboarding(JSON.parse(savedOnboarding));
    } catch {}

    const initBusinessAccount = async (session: string) => {
      try {
        const savedAccount = localStorage.getItem('amke_business_account');
        if (savedAccount) {
          const parsed = JSON.parse(savedAccount);
          if (parsed && parsed.uniqueBusinessName) {
            setBusinessAccount(parsed);
            return;
          }
        }
        const resolved = await resolveBusinessAccount('Balogun Traders', session);
        setBusinessAccount(resolved);
        localStorage.setItem('amke_business_account', JSON.stringify(resolved));
      } catch (err) {
        console.warn('Failed to resolve initial business account:', err);
      }
    };
    initBusinessAccount(currentSession);
    syncChatHistory(currentSession);
  }, []);

  // Persist pending clarification/onboarding state so a page reload doesn't lose conversation context
  useEffect(() => {
    if (!sessionId) return;
    try {
      if (activeHydration) {
        localStorage.setItem(`amke_active_hydration_${sessionId}`, JSON.stringify(activeHydration));
      } else {
        localStorage.removeItem(`amke_active_hydration_${sessionId}`);
      }
    } catch {}
  }, [activeHydration, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    try {
      if (sellerOnboarding) {
        localStorage.setItem(`amke_seller_onboarding_${sessionId}`, JSON.stringify(sellerOnboarding));
      } else {
        localStorage.removeItem(`amke_seller_onboarding_${sessionId}`);
      }
    } catch {}
  }, [sellerOnboarding, sessionId]);

  // Persist messages & scroll smoothly to latest turn
  useEffect(() => {
    if (sessionId && messages.length > 0) {
      try {
        localStorage.setItem(`amke_chat_msgs_${sessionId}`, JSON.stringify(messages));
      } catch {}
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSend = async (customText?: string) => {
    const textToSend = (customText || input).trim();
    if (!textToSend || isLoading) return;

    const currentSession = sessionId || `user_${Date.now().toString(36)}`;
    const userMsgId = `msg_${Date.now()}`;
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const actorId = `user_${currentSession.slice(-6)}`;

    // 1. Clarification loop (turn-by-turn turn response)
    if (activeHydration) {
      const userMsg: ChatMessage = {
        id: userMsgId,
        sender: 'user',
        role: activeHydration.detectedIntent || 'BUYER',
        text: textToSend,
        timestamp,
        sessionId: currentSession,
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setIsLoading(true);
      let keepHydrationPending = false;

      try {
        const resolutionHistory: ResolutionHistoryTurn[] = [
          ...activeHydration.resolutionHistory,
          { sender: 'user', role: activeHydration.detectedIntent || 'BUYER', text: textToSend },
        ];
        const synthRes = await synthesizeIntent({
          originalInput: activeHydration.originalInput,
          probingQuestion: activeHydration.probingQuestion,
          userClarification: textToSend,
        });

        const synthesizedText = synthRes.synthesizedSearchText;
        const finalIntent = synthRes.detectedIntent === 'SELL'
          ? 'SELLER'
          : synthRes.detectedIntent === 'BUY'
          ? 'BUYER'
          : activeHydration.detectedIntent || 'BUYER';

        if (finalIntent === 'SELLER') {
          const streamRes = await ingestMarketStream({
            actorId: activeHydration.actorId,
            actorType: 'SELLER',
            rawMessySpeech: synthesizedText || `${activeHydration.originalInput} (${synthesizedText})`,
            businessName: businessAccount?.uniqueBusinessName,
            businessAccountId: businessAccount?.id,
            chatMode: 'VENDOR',
            sessionId: currentSession,
            chatHistory: resolutionHistory,
          });

          const addedList = streamRes.resolvedConcepts
            ?.map((c: any) => c.resolvedConcept || c.normalizedName)
            .join(', ');
          const botMsg: ChatMessage = {
            id: `bot_${Date.now()}`,
            sender: 'bot',
            role: 'SELLER',
            chatMode: 'VENDOR',
            text: `✅ **Stock recorded:**\n${addedList ? `• ${addedList}` : 'Inventory recorded.'}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            sessionId: currentSession,
          };
          setMessages((prev) => [...prev, botMsg]);
        } else {
          const searchRes = await searchBuyerMarketplace({
            buyerId: activeHydration.actorId,
            rawSearchQuery: synthesizedText,
            buyerLocation: 'Surulere',
            businessName: businessAccount?.uniqueBusinessName,
            businessAccountId: businessAccount?.id,
            chatMode: 'BUYER',
            sessionId: currentSession,
            chatHistory: resolutionHistory,
          });

          if (searchRes.hydrationTriggered && searchRes.hydrationQuestion) {
            const nextResolutionHistory: ResolutionHistoryTurn[] = [
              ...resolutionHistory,
              { sender: 'assistant', text: searchRes.hydrationQuestion },
            ];
            keepHydrationPending = true;
            setActiveHydration({
              originalInput: activeHydration.originalInput,
              probingQuestion: searchRes.hydrationQuestion,
              actorId: activeHydration.actorId,
              sessionId: currentSession,
              detectedIntent: finalIntent,
              resolutionHistory: nextResolutionHistory,
            });
            const botMsg: ChatMessage = {
              id: `bot_${Date.now()}`,
              sender: 'bot',
              role: 'BUYER',
              chatMode: 'BUYER',
              text: `💡 ${searchRes.hydrationQuestion}`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              sessionId: currentSession,
              hydrationTriggered: true,
              hydrationQuestion: searchRes.hydrationQuestion,
            };
            setMessages((prev) => [...prev, botMsg]);
            return;
          }

          const suppliers = searchRes.matchingSuppliers || searchRes.matchedSuppliers || [];
          const matchCount = suppliers.length;
          const botMsg: ChatMessage = {
            id: `bot_${Date.now()}`,
            sender: 'bot',
            role: 'BUYER',
            chatMode: 'BUYER',
            text:
              matchCount > 0
                ? `🔍 Found **${matchCount} verified seller(s)** matching "${synthesizedText}":`
                : `📡 Searching the market for **"${synthesizedText}"**...\n\nWe are actively checking with local sellers for you. You'll get an alert here as soon as a matching seller is available!`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            sessionId: currentSession,
            synthesizedText,
            matchingSuppliers: suppliers,
            isContinuousSearchActive: matchCount === 0,
            radarTarget: synthesizedText,
          };
          setMessages((prev) => [...prev, botMsg]);
        }
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          {
            id: `err_${Date.now()}`,
            sender: 'bot',
            role: 'BUYER',
            text: `⚠️ Could not complete request: ${err.message}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            sessionId: currentSession,
          },
        ]);
      } finally {
        if (!keepHydrationPending) setActiveHydration(null);
        setIsLoading(false);
      }
      return;
    }

    // 1b. Turn-Driven Seller Onboarding Workflow State Machine
    if (sellerOnboarding) {
      const userMsg: ChatMessage = {
        id: userMsgId,
        sender: 'user',
        role: 'SELLER',
        chatMode: 'VENDOR',
        text: textToSend,
        timestamp,
        sessionId: currentSession,
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setIsLoading(true);

      try {
        if (sellerOnboarding.step === 'COLLECT_ITEMS') {
          const updated = { ...sellerOnboarding, items: textToSend, step: 'COLLECT_BIZ_NAME' as const };
          setSellerOnboarding(updated);
          setMessages((prev) => [
            ...prev,
            {
              id: `bot_${Date.now()}`,
              sender: 'bot',
              role: 'SELLER',
              chatMode: 'VENDOR',
              text: `📦 Noted items: **"${textToSend}"**.\n\nNext, what is your **business or store name**?`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              sessionId: currentSession,
            },
          ]);
        } else if (sellerOnboarding.step === 'COLLECT_BIZ_NAME') {
          const updated = { ...sellerOnboarding, businessName: textToSend, step: 'COLLECT_LOCATION' as const };
          setSellerOnboarding(updated);
          setMessages((prev) => [
            ...prev,
            {
              id: `bot_${Date.now()}`,
              sender: 'bot',
              role: 'SELLER',
              chatMode: 'VENDOR',
              text: `🏢 Store name set to **"${textToSend}"**.\n\nWhere is your **market location or address** (e.g. Balogun Market, Lagos)?`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              sessionId: currentSession,
            },
          ]);
        } else if (sellerOnboarding.step === 'COLLECT_LOCATION') {
          const updated = { ...sellerOnboarding, location: textToSend, step: 'COLLECT_PHONE' as const };
          setSellerOnboarding(updated);
          setMessages((prev) => [
            ...prev,
            {
              id: `bot_${Date.now()}`,
              sender: 'bot',
              role: 'SELLER',
              chatMode: 'VENDOR',
              text: `📍 Location set to **"${textToSend}"**.\n\nFinally, what is your **contact phone number** for buyers to reach you?`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              sessionId: currentSession,
            },
          ]);
        } else if (sellerOnboarding.step === 'COLLECT_PHONE') {
          const finalPhone = textToSend;
          const finalBizName = sellerOnboarding.businessName || 'Market Merchant';
          const finalItems = sellerOnboarding.items || 'General stock';
          const finalLoc = sellerOnboarding.location || 'Lagos Market';

          const resolvedBiz = await resolveBusinessAccount(finalBizName, currentSession);
          setBusinessAccount(resolvedBiz);
          localStorage.setItem('amke_business_account', JSON.stringify(resolvedBiz));

          const res = await ingestMarketStream({
            actorId,
            actorType: 'SELLER',
            actorName: finalBizName,
            actorLocation: finalLoc,
            actorPhone: finalPhone,
            rawMessySpeech: finalItems,
            businessName: resolvedBiz.uniqueBusinessName,
            businessAccountId: resolvedBiz.id,
            chatMode: 'VENDOR',
            sessionId: currentSession,
          });

          const addedList = res.resolvedConcepts
            ?.map((c: any) => c.resolvedConcept || c.normalizedName)
            .join(', ');

          const registrationText = addedList
            ? `🎉 **Seller Registration Complete!**\n\n• Store: **${resolvedBiz.uniqueBusinessName}**\n• Location: **${finalLoc}**\n• Contact: **${finalPhone}**\n• Indexed Stock: **${addedList}**\n\nVerified buyers can now discover your products in real-time!`
            : `⚠️ **Store saved, but no category was indexed yet.**\n\n• Store: **${resolvedBiz.uniqueBusinessName}**\n• Location: **${finalLoc}**\n• Contact: **${finalPhone}**\n\nBuyers cannot find you until your stock is matched to a category. Please describe the specific products you sell (e.g. "detergent, bleach, washing soap").`;

          setMessages((prev) => [
            ...prev,
            {
              id: `bot_${Date.now()}`,
              sender: 'bot',
              role: 'SELLER',
              chatMode: 'VENDOR',
              text: registrationText,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              sessionId: currentSession,
            },
          ]);
          setSellerOnboarding(null);
        }
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          {
            id: `err_${Date.now()}`,
            sender: 'bot',
            role: 'SELLER',
            text: `⚠️ Onboarding step error: ${err.message}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            sessionId: currentSession,
          },
        ]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // 2. Pure Natural Text Submit -> Dynamic LLM Intent Recognition
    const userMsg: ChatMessage = {
      id: userMsgId,
      sender: 'user',
      role: 'BUYER',
      text: textToSend,
      timestamp,
      sessionId: currentSession,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      // Evaluate intent & hydration via backend cognitive engine
      const evalRes = await evaluateHydration(textToSend);
      const detectedIntent: 'SELLER' | 'BUYER' = evalRes.detectedIntent || 'BUYER';

      if (evalRes.isHydrationRequired && evalRes.localizedProbingQuestion) {
        setActiveHydration({
          originalInput: textToSend,
          probingQuestion: evalRes.localizedProbingQuestion,
          actorId,
          sessionId: currentSession,
          detectedIntent,
          resolutionHistory: [
            { sender: 'user', role: detectedIntent, text: textToSend },
            { sender: 'assistant', text: evalRes.localizedProbingQuestion },
          ],
        });

        setMessages((prev) => [
          ...prev,
          {
            id: `bot_${Date.now()}`,
            sender: 'bot',
            role: detectedIntent,
            chatMode: detectedIntent === 'SELLER' ? 'VENDOR' : 'BUYER',
            text: `💡 ${evalRes.localizedProbingQuestion}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            sessionId: currentSession,
            hydrationTriggered: true,
            hydrationQuestion: evalRes.localizedProbingQuestion,
            quickActionChips: evalRes.quickActionChips || [],
          },
        ]);
      } else if (detectedIntent === 'SELLER') {
        // Trigger Turn-Driven Seller Onboarding Workflow
        setSellerOnboarding({ step: 'COLLECT_BIZ_NAME', items: textToSend });
        setMessages((prev) => [
          ...prev,
          {
            id: `bot_${Date.now()}`,
            sender: 'bot',
            role: 'SELLER',
            chatMode: 'VENDOR',
            text: `📦 Noted inventory: **"${textToSend}"**.\n\nWhat is your **business or store name**?`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            sessionId: currentSession,
          },
        ]);
      } else {
        const res = await searchBuyerMarketplace({
          buyerId: actorId,
          rawSearchQuery: textToSend,
          buyerLocation: 'Surulere',
          businessName: businessAccount?.uniqueBusinessName,
          businessAccountId: businessAccount?.id,
          chatMode: 'BUYER',
          sessionId: currentSession,
        });

        if (res.hydrationTriggered) {
          const cleanQ = sanitizeText(res.hydrationQuestion || 'Could you specify the exact brand or type?');
          setActiveHydration({
            originalInput: textToSend,
            probingQuestion: cleanQ,
            actorId,
            sessionId: currentSession,
            detectedIntent: 'BUYER',
            resolutionHistory: [
              { sender: 'user', role: 'BUYER', text: textToSend },
              { sender: 'assistant', text: cleanQ },
            ],
          });

          setMessages((prev) => [
            ...prev,
            {
              id: `bot_${Date.now()}`,
              sender: 'bot',
              role: 'BUYER',
              chatMode: 'BUYER',
              text: `💡 ${cleanQ}`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              sessionId: currentSession,
              hydrationTriggered: true,
              hydrationQuestion: cleanQ,
            },
          ]);
        } else {
          const suppliers = res.matchingSuppliers || res.matchedSuppliers || [];
          const matchCount = suppliers.length;
          setMessages((prev) => [
            ...prev,
            {
              id: `bot_${Date.now()}`,
              sender: 'bot',
              role: 'BUYER',
              chatMode: 'BUYER',
              text:
                matchCount > 0
                  ? `🔍 Found **${matchCount} verified seller(s)**:`
                  : `📡 Searching the market for *"${textToSend}"*...\n\nWe are actively checking with local sellers for you. You'll get an alert here as soon as a matching seller is available!`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              sessionId: currentSession,
              matchingSuppliers: suppliers,
              isContinuousSearchActive: matchCount === 0,
              radarTarget: textToSend,
            },
          ]);
        }
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          sender: 'bot',
          role: 'BUYER',
          text: `⚠️ Request failed: ${err.message}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          sessionId: currentSession,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full max-w-lg mx-auto bg-[#0b141a] text-slate-100 font-sans relative overflow-hidden">
      {/* Ultra-Clean WhatsApp Header with 3-Dot Options Menu */}
      <header className="bg-[#202c33] px-3.5 py-3 flex items-center justify-between border-b border-[#2a3942] z-30 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          {/* Profile Circle Avatar */}
          <div className="w-9 h-9 rounded-full bg-emerald-600 flex items-center justify-center font-bold text-white text-sm shadow-sm">
            M
          </div>
          {/* Simple Clean Title & Status */}
          <div className="flex flex-col">
            <span className="font-semibold text-base text-slate-100 tracking-tight leading-none">
              MetaMarket
            </span>
            <span className="text-[11px] text-emerald-400 font-sans mt-0.5">
              {isLoading ? 'typing...' : 'online'}
            </span>
          </div>
        </div>

        {/* Right 3-Dot Options Menu */}
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
                onClick={handleClearHistory}
                className="w-full text-left px-4 py-2.5 text-xs text-red-400 hover:bg-[#182229] flex items-center gap-2 font-medium transition cursor-pointer"
              >
                <Trash2 className="w-4 h-4 text-red-400" />
                <span>Delete Chat History</span>
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
                {/* Message Text */}
                <p className="whitespace-pre-wrap">
                  {cleanBubbleText(msg.text, Boolean(msg.matchingSuppliers && msg.matchingSuppliers.length > 0))}
                </p>

                {/* Verified Supplier Cards for Buyers */}
                {msg.matchingSuppliers && msg.matchingSuppliers.length > 0 && (
                  <div className="mt-3 space-y-2.5 pt-2 border-t border-[#2a3942]/60">
                    {msg.matchingSuppliers.map((supp, idx) => (
                      <BusinessCard
                        key={idx}
                        vendor={{
                          vendorId: supp.vendorId,
                          vendorName: supp.vendorName,
                          location: supp.location,
                          phone: supp.phone,
                          matchedConcept: supp.matchedConcept,
                          description: supp.description,
                          rating: supp.rating != null ? String(supp.rating) : null,
                          score: supp.similarityScore,
                        }}
                        tier={supp.matchAccuracyTier}
                      />
                    ))}
                  </div>
                )}

                {/* Simple Live Market Search Status Card */}
                {(!isUser && (msg.isContinuousSearchActive || (msg.role === 'BUYER' && (!msg.matchingSuppliers || msg.matchingSuppliers.length === 0) && !msg.hydrationTriggered && !msg.id.startsWith('welcome') && !msg.id.startsWith('err')))) && (
                  <div className="mt-2.5 p-3 rounded-xl bg-[#111b21] border border-[#2a3942] text-xs space-y-1.5 animate-in fade-in duration-200">
                    <div className="flex items-center gap-2 text-emerald-400 font-semibold text-[11px]">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                      <span>Searching for available sellers in the market...</span>
                    </div>
                    <p className="text-slate-300 text-[11px] leading-relaxed">
                      We&apos;re actively checking with nearby suppliers. You&apos;ll get an instant alert here as soon as a seller is available!
                    </p>
                  </div>
                )}

                {/* Timestamp & Delivery Checkmarks */}
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
        {activeHydration && (
          <div className="mb-2 p-2 rounded-lg bg-amber-950/70 border border-amber-500/40 flex items-center justify-between text-xs text-amber-200">
            <div className="flex items-center gap-1.5 truncate">
              <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="truncate italic font-medium">
                &ldquo;{activeHydration.originalInput}&rdquo;
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveHydration(null)}
              className="text-[11px] text-amber-400 hover:underline font-semibold ml-2 shrink-0"
            >
              ✕ Cancel
            </button>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              activeHydration ? 'Type clarification...' : 'Message MetaMarket...'
            }
            disabled={isLoading}
            className="flex-1 bg-[#2a3942] rounded-full px-4 py-2.5 text-sm text-slate-100 placeholder-slate-400 focus:outline-none border border-transparent focus:border-emerald-500"
          />

          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-transform shrink-0 ${
              input.trim() && !isLoading
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
