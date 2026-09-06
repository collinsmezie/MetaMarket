'use client';

import React, { useState } from 'react';
import { getApiBase } from '@/lib/api';
import {
  ShieldAlert,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Database,
  Network,
  ShieldCheck,
  Lock,
} from 'lucide-react';

export function AdminSystemResetView() {
  const [activeTab, setActiveTab] = useState<'standard' | 'danger'>('standard');
  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Danger Zone Double Confirmation Modal State
  const [showDangerModal, setShowDangerModal] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');

  const handleResetChatsAndLogs = async () => {
    setIsLoading('chats');
    setStatusMessage(null);
    try {
      const res = await fetch(`${getApiBase()}/amke/admin/reset/chats-logs`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setStatusMessage({
          type: 'success',
          text: `✅ ${json.message} (${json.recordsCleared || 0} database records cleared)`,
        });
      } else {
        throw new Error(json.message || 'Failed to clear chats and logs');
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `❌ Reset failed: ${err.message}` });
    } finally {
      setIsLoading(null);
    }
  };

  const handleResetMarketGraph = async () => {
    setIsLoading('graph');
    setStatusMessage(null);
    try {
      const res = await fetch(`${getApiBase()}/amke/admin/reset/market-graph`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setStatusMessage({
          type: 'success',
          text: `✅ ${json.message} (Neo4j: ${json.neo4j?.deletedNodes || 0} nodes deleted. GS1 GPC Taxonomy preserved!)`,
        });
      } else {
        throw new Error(json.message || 'Failed to reset market graph');
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `❌ Reset failed: ${err.message}` });
    } finally {
      setIsLoading(null);
    }
  };

  const handleSeedGpcTaxonomy = async () => {
    setIsLoading('seed');
    setStatusMessage(null);
    try {
      const res = await fetch(`${getApiBase()}/amke/admin/seed-gpc?force=true`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setStatusMessage({
          type: 'success',
          text: `🌱 ${json.message}`,
        });
      } else {
        throw new Error(json.message || 'Failed to seed GPC taxonomy');
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `❌ Seeding failed: ${err.message}` });
    } finally {
      setIsLoading(null);
    }
  };

  const handleExecuteDangerEmbeddingsReset = async () => {
    if (confirmInput.trim() !== 'DELETE EMBEDDINGS') return;

    setIsLoading('embeddings');
    setStatusMessage(null);
    setShowDangerModal(false);
    setConfirmInput('');

    try {
      const res = await fetch(`${getApiBase()}/amke/admin/reset/embeddings`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setStatusMessage({
          type: 'success',
          text: `🔥 DANGER ZONE EXECUTION COMPLETE: ${json.message} (Neo4j: ${json.neo4j?.deletedNodes || 0} learned nodes cleared. GS1 GPC Taxonomy vectors strictly preserved!)`,
        });
      } else {
        throw new Error(json.message || 'Failed to clear learned embeddings');
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `❌ Embeddings reset failed: ${err.message}` });
    } finally {
      setIsLoading(null);
    }
  };

  return (
    <div className="h-full w-full bg-[#090e16] rounded-2xl border border-slate-800 p-6 flex flex-col space-y-6 overflow-y-auto font-sans">
      {/* Admin System Reset Title Header */}
      <div className="flex items-start justify-between pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <ShieldAlert className="w-6 h-6 text-amber-400" />
            <h2 className="text-xl font-extrabold text-white tracking-tight">System Reset & Clean Slate Administration</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Restore the AMKE system to a clean slate locally or on cloud. Clear user conversation logs, telemetry streams, and non-taxonomy graph nodes.
          </p>
        </div>

        {/* Permanent Taxonomy Shield Status Indicator */}
        <div className="px-3.5 py-2 rounded-xl bg-emerald-950/60 border border-emerald-500/40 flex items-center space-x-2 text-xs font-mono">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <div className="flex flex-col">
            <span className="font-bold text-emerald-300">GS1 GPC TAXONOMY SHIELD ACTIVE</span>
            <span className="text-[10px] text-slate-400">GpcClass, GpcFamily, GpcSegment nodes & vectors CANNOT be deleted</span>
          </div>
        </div>
      </div>

      {/* Navigation Subtabs: Standard Reset vs Stage 2 Danger Zone */}
      <div className="flex items-center space-x-2 bg-[#05080c] p-1 rounded-xl border border-slate-800 w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('standard')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-bold text-xs transition-all ${
            activeTab === 'standard'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Standard Clean Slate</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('danger')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-bold text-xs transition-all ${
            activeTab === 'danger'
              ? 'bg-red-600 text-white shadow-md animate-pulse'
              : 'text-red-400 hover:text-red-300 hover:bg-red-950/40'
          }`}
        >
          <Flame className="w-4 h-4 text-red-400" />
          <span>Stage 2: Danger Zone (Clear Embeddings)</span>
        </button>
      </div>

      {/* Alert Status Feedback Notification */}
      {statusMessage && (
        <div
          className={`p-4 rounded-xl border text-xs font-mono font-medium flex items-center space-x-2 animate-in fade-in ${
            statusMessage.type === 'success'
              ? 'bg-emerald-950/80 text-emerald-200 border-emerald-500/40'
              : 'bg-red-950/80 text-red-200 border-red-500/40'
          }`}
        >
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* SUBTAB 1: Standard Clean Slate Actions */}
      {activeTab === 'standard' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1: Clear User Chat History & Telemetry Logs */}
          <div className="p-5 rounded-2xl bg-[#0d1520] border border-slate-800 flex flex-col justify-between space-y-4 hover:border-slate-700 transition">
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Trash2 className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-sm text-white">Clear Chat Histories & Telemetry</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Clears all recorded user conversation messages (`raw_message_log` in PostgreSQL) and flushes the in-memory telemetry log buffers.
              </p>
            </div>

            <button
              type="button"
              onClick={handleResetChatsAndLogs}
              disabled={isLoading === 'chats'}
              className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs transition flex items-center justify-center space-x-2 shadow-md cursor-pointer"
            >
              {isLoading === 'chats' ? (
                <RefreshCw className="w-4 h-4 animate-spin text-white" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              <span>Clear Chat History & Telemetry Logs</span>
            </button>
          </div>

          {/* Card 2: Reset Non-Taxonomy Market Graph */}
          <div className="p-5 rounded-2xl bg-[#0d1520] border border-slate-800 flex flex-col justify-between space-y-4 hover:border-slate-700 transition">
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Network className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-sm text-white">Reset Non-Taxonomy Market Graph</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Resets vendor accounts, stock listings, phrases, and concepts in Neo4j and PostgreSQL back to initial state.
              </p>
              <div className="text-[11px] text-emerald-400 font-mono flex items-center space-x-1">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>GpcClass, GpcFamily, and GpcSegment nodes remain 100% untouched.</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleResetMarketGraph}
              disabled={isLoading === 'graph'}
              className="w-full py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold text-xs transition flex items-center justify-center space-x-2 shadow-md cursor-pointer"
            >
              {isLoading === 'graph' ? (
                <RefreshCw className="w-4 h-4 animate-spin text-white" />
              ) : (
                <Network className="w-4 h-4" />
              )}
              <span>Reset Market Graph (Clean Slate)</span>
            </button>
          </div>

          {/* Card 3: Re-Seed & Refresh GS1 GPC Taxonomy */}
          <div className="p-5 rounded-2xl bg-[#0d1520] border border-slate-800 flex flex-col justify-between space-y-4 hover:border-slate-700 transition">
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Database className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-sm text-white">Re-Seed GS1 GPC Taxonomy</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Re-seeds all 1,000+ pre-computed GS1 GPC Segments, Families, Classes, and 1536-dim vector embeddings from the intact local dataset.
              </p>
              <div className="text-[11px] text-emerald-400 font-mono flex items-center space-x-1">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>55.1MB canonical_gpc_embedded.json dataset intact!</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSeedGpcTaxonomy}
              disabled={isLoading === 'seed'}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs transition flex items-center justify-center space-x-2 shadow-md cursor-pointer"
            >
              {isLoading === 'seed' ? (
                <RefreshCw className="w-4 h-4 animate-spin text-white" />
              ) : (
                <Database className="w-4 h-4" />
              )}
              <span>Re-Seed GPC Taxonomy & Vectors</span>
            </button>
          </div>
        </div>
      )}

      {/* SUBTAB 2: Stage 2 Danger Zone (Clear Learned Embeddings) */}
      {activeTab === 'danger' && (
        <div className="p-6 rounded-2xl bg-red-950/20 border border-red-500/40 space-y-5">
          <div className="flex items-start space-x-3">
            <Flame className="w-8 h-8 text-red-500 shrink-0 mt-1" />
            <div>
              <h3 className="text-base font-extrabold text-red-400">
                Stage 2 Danger Zone: Clear Learned Market Embeddings
              </h3>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                This sensitive operation clears non-taxonomy custom learned phrase-to-GPC cluster embeddings stored in PostgreSQL (`phrase_gpc_clusters`, `phrases`) and Neo4j (`Phrase`, `Concept` nodes).
              </p>
              <div className="mt-3 p-3 rounded-xl bg-black/40 border border-red-500/30 text-xs font-mono text-emerald-300 flex items-center space-x-2">
                <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  CRITICAL GUARANTEE: Primary GS1 GPC Taxonomy vectors (`gpc_classes` in PGVector & `GpcClass`/`GpcFamily`/`GpcSegment` nodes in Neo4j) ARE PERMANENT AND CANNOT BE DELETED.
                </span>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-red-500/30 flex justify-end">
            <button
              type="button"
              onClick={() => setShowDangerModal(true)}
              className="py-3 px-6 rounded-xl bg-red-600 hover:bg-red-500 text-white font-extrabold text-xs transition flex items-center space-x-2 shadow-lg shadow-red-600/30 cursor-pointer"
            >
              <Flame className="w-4 h-4" />
              <span>Clear Indexed / Learned Market Embeddings...</span>
            </button>
          </div>
        </div>
      )}

      {/* Double Confirmation Modal for Danger Zone Reset */}
      {showDangerModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-[#0f172a] border border-red-500/50 max-w-md w-full rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3 text-red-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="font-extrabold text-base text-white">
                Confirm Danger Zone Action
              </h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to clear indexed/learned market embeddings? This will wipe all custom phrase-to-GPC cluster vectors.
            </p>

            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs">
              <span className="text-slate-400 font-bold block mb-1">
                Type <span className="text-red-400 font-mono">DELETE EMBEDDINGS</span> to confirm:
              </span>
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="DELETE EMBEDDINGS"
                className="w-full bg-[#05080c] px-3 py-2 rounded-lg border border-slate-700 text-slate-100 text-xs font-mono focus:outline-none focus:border-red-500"
              />
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowDangerModal(false);
                  setConfirmInput('');
                }}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleExecuteDangerEmbeddingsReset}
                disabled={confirmInput.trim() !== 'DELETE EMBEDDINGS' || isLoading === 'embeddings'}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-xs font-extrabold transition flex items-center space-x-1.5 shadow-md cursor-pointer"
              >
                {isLoading === 'embeddings' ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Flame className="w-4 h-4" />
                )}
                <span>Confirm & Delete Embeddings</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
