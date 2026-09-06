'use client';

import React from 'react';
import { ChatMessage } from '@/lib/types';
import {
  Store,
  ShoppingBag,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Volume2,
  FolderTree,
  Tag,
  Radio,
  Activity,
  Compass,
  Bell,
} from 'lucide-react';
import { BusinessCard } from './BusinessCard';

interface MessageBubbleProps {
  message: ChatMessage;
  onSelectSuggestion?: (suggestion: string) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onSelectSuggestion }) => {
  const isUser = message.sender === 'user';

  return (
    <div className={`flex items-start gap-3 my-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-md ${
          isUser
            ? message.role === 'SELLER'
              ? 'bg-emerald-500 text-black font-bold'
              : 'bg-blue-500 text-white font-bold'
            : 'bg-purple-600/30 border border-purple-500/40 text-purple-300'
        }`}
      >
        {isUser ? (
          message.role === 'SELLER' ? <Store className="w-4 h-4" /> : <ShoppingBag className="w-4 h-4" />
        ) : (
          <Sparkles className="w-4 h-4 text-purple-400" />
        )}
      </div>

      {/* Message Bubble Container */}
      <div className={`flex flex-col max-w-2xl ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? message.role === 'SELLER'
                ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-100 rounded-tr-none'
                : 'bg-blue-950/60 border border-blue-500/40 text-blue-100 rounded-tr-none'
              : 'bg-surface border border-surface-border text-slate-100 rounded-tl-none shadow-lg'
          }`}
        >
          {/* Header title if seller/buyer */}
          {isUser && message.actorName && (
            <div className="text-[11px] font-bold text-slate-400 mb-1 flex items-center gap-1.5">
              <span>{message.actorName}</span>
              {message.actorLocation && (
                <span className="text-[10px] bg-slate-800/80 px-1.5 py-0.2 rounded text-slate-300 font-normal">
                  📍 {message.actorLocation}
                </span>
              )}
            </div>
          )}

          <p className="whitespace-pre-wrap font-sans text-sm">{message.text}</p>

          {/* FR-1: Hydration Phase Clarification Card */}
          {message.hydrationTriggered && message.hydrationQuestion && (
            <div className="mt-3 p-3 rounded-xl bg-amber-950/60 border border-amber-500/50 shadow-inner">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  🧠 HYDRATION PHASE &bull; AMKE VECTOR GUARD
                </span>
              </div>
              <p className="text-sm font-semibold text-amber-100 italic bg-amber-900/40 border-l-2 border-amber-400 pl-2.5 py-1.5 rounded-r">
                &ldquo;{message.hydrationQuestion}&rdquo;
              </p>
              <span className="text-[11px] text-amber-300/80 mt-2 block font-sans">
                💡 <span className="font-semibold">Brevity penalty prevented:</span> Type your answer below to clarify functional use case, specific type, or material characteristics.
              </span>
            </div>
          )}

          {/* FR-1.1: Semantics-Rich Vector Target Synthesis Badge */}
          {message.synthesizedText && (
            <div className="mt-2.5 px-3 py-1.5 rounded-lg bg-purple-950/50 border border-purple-500/40 flex items-start gap-2">
              <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
              <div className="text-xs text-purple-200">
                <span className="font-bold text-purple-300">FR-1.1 Synthesized Vector Target: </span>
                <span className="font-mono text-purple-100">&ldquo;{message.synthesizedText}&rdquo;</span>
              </div>
            </div>
          )}

          {/* Resolved Dynamic Concept Badges with Macro-Family Clustering */}
          {((message.resolvedConcepts && message.resolvedConcepts.length > 0) || (message.parsedConcepts && message.parsedConcepts.length > 0)) && (
            <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                AMKE Vector Concept & Semantic Cluster Resolution:
              </span>
              <div className="flex flex-wrap gap-2">
                {(message.resolvedConcepts || message.parsedConcepts || []).map((c: any, i: number) => (
                  <div
                    key={i}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${
                      c.isAvailable === false
                        ? 'bg-red-950/70 border-red-500/50 text-red-300'
                        : c.isNewConcept
                        ? 'bg-purple-950/70 border-purple-500/50 text-purple-200'
                        : 'bg-cyan-950/70 border-cyan-500/50 text-cyan-200'
                    }`}
                  >
                    {c.isAvailable === false ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                    ) : c.isNewConcept ? (
                      <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
                    )}

                    <span className="font-bold">{c.resolvedConcept || c.normalizedProductName}</span>

                    {c.parentMacroFamily && (
                      <span className="text-[10px] bg-purple-900/60 border border-purple-500/40 text-purple-200 px-1.5 py-0.2 rounded font-sans flex items-center gap-0.5">
                        <FolderTree className="w-2.5 h-2.5" />
                        {c.parentMacroFamily}
                      </span>
                    )}

                    {(c.unit || c.localUnit) && (
                      <span className="text-[10px] opacity-75 font-mono">
                        ({c.unit || c.localUnit})
                      </span>
                    )}

                    <span
                      className={`text-[9px] px-1 py-0.2 rounded font-mono ${
                        c.isAvailable === false
                          ? 'bg-red-900/60 text-red-200'
                          : c.isNewConcept
                          ? 'bg-purple-900/60 text-purple-200'
                          : 'bg-cyan-900/60 text-cyan-200'
                      }`}
                    >
                      {c.isAvailable === false ? 'SEVERED' : c.isNewConcept ? 'NEW CONCEPT' : `${((c.score || c.vectorScore || 1) * 100).toFixed(0)}% MATCH`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Isolated Transactional Noise Tag */}
          {message.isolatedNoise && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-300/80 bg-amber-950/40 border border-amber-500/30 rounded-lg px-2.5 py-1">
              <Volume2 className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              <span className="font-mono text-[11px]">Filtered Noise: &quot;{message.isolatedNoise}&quot;</span>
            </div>
          )}

          {/* Matching Suppliers Fulfillment Cards with 3-Tier Proximity Hierarchy (FR-5 & FR-6) */}
          {message.matchingSuppliers && message.matchingSuppliers.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
              <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Active Marketplace Suppliers ({message.matchingSuppliers.length}) &bull; Tier-Ordered:
              </span>
              <div className="grid grid-cols-1 gap-2">
                {message.matchingSuppliers.map((supp, i) => (
                  <BusinessCard
                    key={i}
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
            </div>
          )}

          {/* Simple Market Searching Status Card */}
          {(!isUser && message.role === 'BUYER' && (!message.matchingSuppliers || message.matchingSuppliers.length === 0) && !message.hydrationTriggered && !message.id.startsWith('welcome') && !message.id.startsWith('err')) && (
            <div className="mt-2.5 p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-xs space-y-1.5 animate-in fade-in duration-200">
              <div className="flex items-center gap-2 text-emerald-300 font-semibold text-xs">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span>Searching for available sellers in the market...</span>
              </div>
              <p className="text-slate-300 text-[11.5px] leading-relaxed">
                We are actively checking with local suppliers. We&apos;ll notify you right here as soon as a verified seller is available!
              </p>
            </div>
          )}

          {/* Quick Action Chips for Low-Tech Mobile Users (1-Tap Resolution) */}
          {message.quickActionChips && message.quickActionChips.length > 0 && (
            <div className="mt-3 pt-2 border-t border-slate-700/50 flex flex-wrap gap-2">
              {message.quickActionChips.map((chip, idx) => (
                <button
                  key={idx}
                  onClick={() => onSelectSuggestion && onSelectSuggestion(chip)}
                  className="px-3 py-1.5 bg-emerald-900/40 hover:bg-emerald-800/60 active:scale-95 transition text-emerald-300 text-xs font-semibold rounded-lg border border-emerald-500/40 shadow-sm flex items-center gap-1.5 cursor-pointer"
                >
                  <span>{chip}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Timestamp */}
        <span className="text-[10px] text-slate-500 mt-1 px-1 font-mono">
          {message.timestamp}
        </span>
      </div>
    </div>
  );
};
