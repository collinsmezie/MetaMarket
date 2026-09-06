'use client';

import React, { useState, useEffect } from 'react';
import { AdminChatSessionItem } from '@/lib/types';
import { fetchAdminChats } from '@/lib/api';
import {
  Search,
  Calendar,
  Filter,
  MessageSquare,
  Clock,
  Store,
  ShoppingBag,
  RefreshCw,
  Sparkles,
  ChevronRight,
  User,
} from 'lucide-react';

interface AdminChatExplorerProps {
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  sseUpdateTrigger?: number;
}

export function AdminChatExplorer({
  selectedSessionId,
  onSelectSession,
  sseUpdateTrigger = 0,
}: AdminChatExplorerProps) {
  const [sessions, setSessions] = useState<AdminChatSessionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeRole, setActiveRole] = useState<'ALL' | 'BUYER' | 'SELLER'>('ALL');
  const [timeFilter, setTimeFilter] = useState<'ALL' | 'TODAY' | '24H' | '7D'>('ALL');

  const loadChats = async () => {
    setIsLoading(true);
    try {
      let startDate: string | undefined;
      const now = new Date();
      if (timeFilter === 'TODAY') {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startDate = today.toISOString();
      } else if (timeFilter === '24H') {
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      } else if (timeFilter === '7D') {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      }

      const res = await fetchAdminChats({
        query: searchQuery.trim() || undefined,
        actorRole: activeRole !== 'ALL' ? activeRole : undefined,
        startDate,
        limit: 50,
      });

      setSessions(res.sessions || []);

      // Auto-select latest active session ONLY if no session is currently selected
      if (res.sessions && res.sessions.length > 0 && !selectedSessionId) {
        const firstId = res.sessions[0].businessAccountId || res.sessions[0].sessionId;
        onSelectSession(firstId);
      }
    } catch (err) {
      console.error('Failed to load admin chats:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadChats();
  }, [searchQuery, activeRole, timeFilter, sseUpdateTrigger]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0d1520] rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
      {/* Header & Search Bar */}
      <div className="p-3.5 bg-[#131d2b] border-b border-slate-800 space-y-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-sm text-slate-100">Live Chat Sessions</h3>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              {sessions.length} recorded
            </span>
          </div>

          <button
            type="button"
            onClick={loadChats}
            disabled={isLoading}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Refresh Chats"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by text, actor ID, or session..."
            className="w-full bg-[#090e16] rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 border border-slate-700 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Filters: Role & Time */}
        <div className="flex items-center justify-between gap-1 text-[11px]">
          {/* Role Filter */}
          <div className="flex items-center gap-1 bg-[#090e16] p-0.5 rounded-lg border border-slate-800">
            {(['ALL', 'BUYER', 'SELLER'] as const).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setActiveRole(role)}
                className={`px-2 py-0.5 rounded font-semibold transition-all ${
                  activeRole === role
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {role}
              </button>
            ))}
          </div>

          {/* Time Filter */}
          <div className="flex items-center gap-1 bg-[#090e16] p-0.5 rounded-lg border border-slate-800">
            {(['ALL', 'TODAY', '24H', '7D'] as const).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeFilter(tf)}
                className={`px-2 py-0.5 rounded font-semibold transition-all ${
                  timeFilter === tf
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-slate-800/60 p-2 space-y-1">
        {sessions.map((sess) => {
          const targetId = sess.sessionId || sess.businessAccountId || sess.actorId;
          const isSelected = selectedSessionId === targetId || selectedSessionId === sess.sessionId || selectedSessionId === sess.businessAccountId;
          const hasBoth = (sess as any).hasBuyerActivity && (sess as any).hasSellerActivity;
          const isSeller = (sess as any).hasSellerActivity || sess.actorRole === 'SELLER' || sess.chatMode === 'VENDOR';
          const displayBizName = sess.uniqueBusinessName || (sess.metadata as any)?.uniqueBusinessName || (sess.metadata as any)?.businessName || sess.actorId;

          return (
            <div
              key={targetId}
              onClick={() => onSelectSession(targetId)}
              className={`p-3 rounded-xl cursor-pointer transition-all border ${
                isSelected
                  ? 'bg-indigo-950/80 border-indigo-500/70 shadow-lg shadow-indigo-500/20'
                  : 'bg-[#121b27]/60 hover:bg-[#162232] border-transparent hover:border-slate-800'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 truncate min-w-0 flex-1">
                  <div
                    className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      hasBoth
                        ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                        : isSeller
                        ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30'
                        : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    }`}
                  >
                    {hasBoth ? <Sparkles className="w-3 h-3 text-purple-400" /> : isSeller ? <Store className="w-3 h-3" /> : <ShoppingBag className="w-3 h-3" />}
                  </div>
                  <span className="font-bold text-xs text-slate-200 truncate min-w-0" title={displayBizName}>
                    {displayBizName}
                  </span>
                </div>

                <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                  {new Date(sess.latestMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed break-words overflow-hidden min-w-0">
                {sess.latestMessage}
              </p>

              <div className="flex items-center justify-between mt-2 pt-1 border-t border-slate-800/50 text-[10px] text-slate-400">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono bg-slate-800/80 px-1.5 py-0.5 rounded text-slate-300">
                    {sess.messageCount} msg{sess.messageCount > 1 ? 's' : ''}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded font-mono font-bold text-[9px] ${
                      hasBoth
                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                        : isSeller
                        ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                        : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    }`}
                  >
                    {hasBoth ? '🛒 BUY & 🏪 SELL' : isSeller ? '🏪 VENDOR' : '🛒 BUYER'}
                  </span>
                </div>
                <span className="text-indigo-400 flex items-center gap-0.5 font-semibold">
                  <span>Inspect Trace</span>
                  <ChevronRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          );
        })}

        {sessions.length === 0 && !isLoading && (
          <div className="p-8 text-center text-slate-500">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 text-slate-700" />
            <p className="text-xs font-semibold text-slate-400">No Chat Records Found</p>
            <p className="text-[11px] text-slate-600 mt-1">Send a message from the mobile chat UI on / to generate live records.</p>
          </div>
        )}
      </div>
    </div>
  );
}
