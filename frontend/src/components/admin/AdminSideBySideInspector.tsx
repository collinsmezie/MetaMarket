'use client';

import React, { useState, useEffect } from 'react';
import { AdminSessionDetails, AdminWorkflowExecution } from '@/lib/types';
import { fetchAdminSession } from '@/lib/api';
import { PipelineDagVisualizer } from './visualizers/PipelineDagVisualizer';
import { PipelineStepperVisualizer } from './visualizers/PipelineStepperVisualizer';
import { MarketGraphView } from '../graph/MarketGraphView';
import { AdminTerminalLogViewer } from './AdminTerminalLogViewer';
import {
  MessageSquare,
  Network,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  Sparkles,
  Layers,
  ListOrdered,
  Radio,
  User,
  Bot,
  Terminal,
} from 'lucide-react';

interface AdminSideBySideInspectorProps {
  sessionId: string | null;
  sseUpdateTrigger?: number;
}

export function AdminSideBySideInspector({
  sessionId,
  sseUpdateTrigger = 0,
}: AdminSideBySideInspectorProps) {
  const [details, setDetails] = useState<AdminSessionDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<AdminWorkflowExecution | null>(null);
  const [activeVisualizerTab, setActiveVisualizerTab] = useState<'terminal' | 'dag' | 'stepper' | 'graph'>('terminal');
  const chatPlaybackEndRef = React.useRef<HTMLDivElement>(null);

  const loadSession = async () => {
    if (!sessionId) return;
    setIsLoading(true);
    try {
      const res = await fetchAdminSession(sessionId);
      setDetails(res);
      if (res.workflows && res.workflows.length > 0) {
        setSelectedWorkflow(res.workflows[res.workflows.length - 1]);
      }
    } catch (err) {
      console.error('Failed to load admin session details:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSession();
  }, [sessionId, sseUpdateTrigger]);

  useEffect(() => {
    if (details?.messages && details.messages.length > 0) {
      chatPlaybackEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [details?.messages]);

  if (!sessionId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 bg-[#0d1520] rounded-2xl border border-slate-800 text-center">
        <MessageSquare className="w-12 h-12 text-slate-700 mb-3" />
        <h4 className="text-slate-300 font-bold text-base">Select a Chat Session to Inspect</h4>
        <p className="text-xs text-slate-500 max-w-sm mt-1">
          Pick any historical or real-time conversation from the list on the left to view side-by-side chat replay and pipeline data flow.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-4 h-full min-h-0 overflow-hidden">
      {/* LEFT COLUMN: WhatsApp Chat Playback (5 cols on xl) */}
      <div className="xl:col-span-5 flex flex-col bg-[#0d1520] rounded-2xl border border-slate-800 overflow-hidden shadow-2xl h-full min-h-0">
        {/* Chat Playback Header */}
        <div className="p-3.5 bg-[#131d2b] border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-bold text-xs">
              💬
            </div>
            <div>
              <h4 className="font-bold text-xs text-slate-100 flex items-center gap-1.5">
                <span>Chat Playback Replay</span>
              </h4>
              <p className="text-[11px] font-mono text-slate-400 truncate max-w-[200px]">{sessionId}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={loadSession}
            disabled={isLoading}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Reload Session"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        </div>

        {/* Chat Message Stream */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-[#0a1017] min-h-0">
          {details?.messages.map((msg, idx) => {
            const isUser = (msg.actorRole === 'BUYER' || msg.actorRole === 'SELLER') && msg.actorId !== 'amke_assistant';
            return (
              <div
                key={msg.id || idx}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                    isUser
                      ? 'bg-[#005c4b] text-slate-100 rounded-tr-none shadow'
                      : 'bg-[#182332] text-slate-200 rounded-tl-none border border-slate-700 shadow'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 mb-1 text-[10px] opacity-80">
                    <span className="font-bold flex items-center gap-1">
                      {isUser ? `${msg.actorId} (${msg.actorRole})` : '🤖 AMKE Assistant'}
                    </span>
                    <span className="font-mono">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <p className="whitespace-pre-wrap break-words">{msg.rawText}</p>

                  {/* Extraction Summary Badges if any */}
                  {msg.extractions && msg.extractions.length > 0 && (
                    <div className="mt-2 pt-1.5 border-t border-white/10 space-y-1">
                      <span className="text-[9px] uppercase font-bold text-teal-300 block">Extracted Entities:</span>
                      <div className="flex flex-wrap gap-1">
                        {msg.extractions.map((ext: any, i: number) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-black/30 text-teal-200">
                            {ext.model} &bull; {ext.latencyMs}ms
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {(!details?.messages || details.messages.length === 0) && !isLoading && (
            <div className="p-8 text-center text-slate-500 text-xs">
              No recorded messages for this session ID.
            </div>
          )}
          <div ref={chatPlaybackEndRef} />
        </div>
      </div>

      {/* RIGHT COLUMN: 3-Way Interactive Visualizer (7 cols on xl) */}
      <div className="xl:col-span-7 flex flex-col bg-[#0d1520] rounded-2xl border border-slate-800 overflow-hidden shadow-2xl h-full min-h-0">
        {/* Workflow Execution Run Selector (if user has multiple pipeline executions) */}
        {details?.workflows && details.workflows.length > 0 && (
          <div className="px-3 py-2 bg-[#0a1017] border-b border-slate-800/80 flex items-center justify-between gap-2 overflow-x-auto shrink-0">
            <div className="flex items-center gap-1.5 shrink-0 text-xs font-bold text-slate-400">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Pipeline Runs ({details.workflows.length}):</span>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto text-[11px] custom-scrollbar py-0.5">
              {details.workflows.map((wf, idx) => {
                const isSelected = selectedWorkflow?.id === wf.id;
                const isBuyer = wf.workflowType === 'BUYER_SEARCH' || wf.chatMode === 'BUYER';
                return (
                  <button
                    key={wf.id || idx}
                    type="button"
                    onClick={() => setSelectedWorkflow(wf)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-mono transition-all shrink-0 ${
                      isSelected
                        ? 'bg-indigo-600/30 text-indigo-200 border-indigo-500 font-bold shadow-sm'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                    <span>
                      #{idx + 1} {isBuyer ? 'BUY' : 'SELL'}: &quot;{wf.rawInput.slice(0, 20)}...&quot;
                    </span>
                    <span className="text-[10px] text-slate-400">({wf.totalLatencyMs}ms)</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Visualizer Mode Switcher Tabs */}
        <div className="p-3 bg-[#131d2b] border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5">
            <Radio className="w-4 h-4 text-indigo-400" />
            <span className="font-bold text-xs text-slate-200">Execution Data Flow & Observability</span>
          </div>

          {/* 4-Way Visualizer Toggle */}
          <div className="flex items-center gap-1 bg-[#090e16] p-0.5 rounded-xl border border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => setActiveVisualizerTab('terminal')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold transition-all ${
                activeVisualizerTab === 'terminal'
                  ? 'bg-emerald-600 text-white shadow-sm font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Terminal Log Shell</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveVisualizerTab('dag')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold transition-all ${
                activeVisualizerTab === 'dag'
                  ? 'bg-indigo-600 text-white shadow-sm font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>DAG Flowchart</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveVisualizerTab('stepper')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold transition-all ${
                activeVisualizerTab === 'stepper'
                  ? 'bg-indigo-600 text-white shadow-sm font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ListOrdered className="w-3.5 h-3.5" />
              <span>Stage Stepper</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveVisualizerTab('graph')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold transition-all ${
                activeVisualizerTab === 'graph'
                  ? 'bg-indigo-600 text-white shadow-sm font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>Entity Graph</span>
            </button>
          </div>
        </div>

        {/* Dynamic Visualizer Viewport */}
        <div className="flex-1 overflow-hidden p-2 min-h-0 flex flex-col">
          {activeVisualizerTab === 'terminal' && (
            <AdminTerminalLogViewer sessionId={sessionId} sseUpdateTrigger={sseUpdateTrigger} />
          )}

          {activeVisualizerTab === 'dag' && (
            <PipelineDagVisualizer workflow={selectedWorkflow} />
          )}

          {activeVisualizerTab === 'stepper' && (
            <div className="h-full overflow-y-auto">
              <PipelineStepperVisualizer workflow={selectedWorkflow} />
            </div>
          )}

          {activeVisualizerTab === 'graph' && (
            <div className="h-full rounded-xl overflow-hidden border border-slate-800">
              <MarketGraphView isActive={activeVisualizerTab === 'graph'} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
