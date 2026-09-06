'use client';

import React, { useState, useEffect } from 'react';
import { ActorRole, TelemetryEvent, AdminWorkflowExecution } from '@/lib/types';
import { fetchAdminSession, getApiBase } from '@/lib/api';
import { AdminChatExplorer } from '@/components/admin/AdminChatExplorer';
import { AdminSideBySideInspector } from '@/components/admin/AdminSideBySideInspector';
import { PipelineDagVisualizer } from '@/components/admin/visualizers/PipelineDagVisualizer';
import { AdminPromptEditor } from '@/components/admin/AdminPromptEditor';
import { MarketGraphView } from '@/components/graph/MarketGraphView';
import { AdminSystemResetView } from '@/components/admin/AdminSystemResetView';
import {
  Layers,
  MessageSquare,
  Network,
  Sparkles,
  Radio,
  Store,
  ShoppingBag,
  Sliders,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { getTelemetrySocket } from '@/lib/socket';

export default function AdminDashboardPage() {
  const [activeTab, setActiveTab] = useState<'chats' | 'pipeline' | 'prompts' | 'graph' | 'reset'>('chats');
  const [mirroredRole, setMirroredRole] = useState<ActorRole>('BUYER');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [sseUpdateTrigger, setSseUpdateTrigger] = useState(0);
  const [lastTelemetryEvent, setLastTelemetryEvent] = useState<TelemetryEvent | null>(null);
  const [activeWorkflow, setActiveWorkflow] = useState<AdminWorkflowExecution | null>(null);

  // Synchronously fetch session details & workflow trace when selectedSessionId changes or SSE/WS trigger fires
  useEffect(() => {
    if (selectedSessionId) {
      fetchAdminSession(selectedSessionId)
        .then((details) => {
          if (details?.workflows && details.workflows.length > 0) {
            setActiveWorkflow(details.workflows[details.workflows.length - 1]);
          }
        })
        .catch(() => {});
    }
  }, [selectedSessionId, sseUpdateTrigger]);

  // Dual Real-Time Listener (WebSocket + Server-Sent Events) for Instant All-Panel Mirroring
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimeout: any = null;

    // 1. WebSocket Gateway Listener
    const socket = getTelemetrySocket();
    socket.on('connect', () => {
      setIsConnected(true);
    });
    socket.on('telemetry:event', (evt: TelemetryEvent) => {
      if (evt && evt.stageLabel !== 'HEARTBEAT_PING') {
        setLastTelemetryEvent(evt);
        setSseUpdateTrigger((prev) => prev + 1);
      }
    });
    socket.on('graph:updated', () => {
      setSseUpdateTrigger((prev) => prev + 1);
    });

    // 2. Continuous SSE Stream Listener
    const connectSSE = () => {
      try {
        eventSource = new EventSource(`${getApiBase()}/telemetry/stream`);

        eventSource.onopen = () => {
          setIsConnected(true);
        };

        eventSource.onmessage = (event) => {
          try {
            const data: TelemetryEvent = JSON.parse(event.data);
            if (data && data.stageLabel !== 'HEARTBEAT_PING') {
              setLastTelemetryEvent(data);
              // Trigger instant re-render across all Admin SPA panels
              setSseUpdateTrigger((prev) => prev + 1);
            }
          } catch (e) {
            // Ignore non-json heartbeats
          }
        };

        eventSource.onerror = () => {
          eventSource?.close();
          reconnectTimeout = setTimeout(connectSSE, 3000);
        };
      } catch (err) {
        reconnectTimeout = setTimeout(connectSSE, 3000);
      }
    };

    connectSSE();

    return () => {
      eventSource?.close();
      clearTimeout(reconnectTimeout);
      socket.off('telemetry:event');
      socket.off('graph:updated');
    };
  }, []);

  return (
    <main className="h-screen max-h-screen overflow-hidden bg-[#070c12] text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Universal Admin Header */}
      <header className="shrink-0 z-40 w-full border-b border-slate-800 bg-[#0d1520]/90 backdrop-blur-md px-4 py-2 shadow-lg">
        <div className="max-w-[1700px] mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Brand & System Badges */}
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="font-extrabold text-base text-white tracking-tight">AMKE Admin Suite</h1>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold">
                  Observability & Control SPA
                </span>
              </div>
              <p className="text-xs text-slate-400">Autonomous Market Knowledge Engine &bull; PostgreSQL & Neo4j</p>
            </div>
          </div>

          {/* Center Navigation Tabs */}
          <div className="flex items-center space-x-1 p-1 rounded-xl bg-[#090e16] border border-slate-800 text-xs">
            <button
              onClick={() => setActiveTab('chats')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg font-bold transition-all ${
                activeTab === 'chats'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chat Explorer & Playback</span>
            </button>

            <button
              onClick={() => setActiveTab('pipeline')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg font-bold transition-all ${
                activeTab === 'pipeline'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Pipeline DAG Flowchart</span>
            </button>

            <button
              onClick={() => setActiveTab('prompts')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg font-bold transition-all ${
                activeTab === 'prompts'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Active Prompts Editor</span>
            </button>

            <button
              onClick={() => setActiveTab('graph')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg font-bold transition-all ${
                activeTab === 'graph'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>Entity-Synonym Graph</span>
            </button>

            <button
              onClick={() => setActiveTab('reset')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg font-bold transition-all ${
                activeTab === 'reset'
                  ? 'bg-red-600 text-white shadow-sm font-bold'
                  : 'text-red-400 hover:text-red-300 hover:bg-red-950/30'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
              <span>System Reset & Clean Slate</span>
            </button>
          </div>

          {/* Right Controls: Mode Mirroring & Real-Time Sync Indicator */}
          <div className="flex items-center space-x-3">
            {/* Mode Mirroring Switcher */}
            <div className="flex items-center p-1 rounded-xl bg-[#090e16] border border-slate-800 text-xs">
              <span className="text-[10px] uppercase font-bold text-slate-500 px-2">Mirror Mode:</span>
              <button
                onClick={() => setMirroredRole('BUYER')}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg font-medium transition-all ${
                  mirroredRole === 'BUYER'
                    ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ShoppingBag className="w-3 h-3" />
                <span>Buyer View</span>
              </button>

              <button
                onClick={() => setMirroredRole('SELLER')}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg font-medium transition-all ${
                  mirroredRole === 'SELLER'
                    ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Store className="w-3 h-3" />
                <span>Vendor View</span>
              </button>
            </div>

            {/* Live SSE Real-Time Sync Indicator */}
            <div
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl border text-xs font-mono font-bold transition-all ${
                isConnected
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300 shadow-lg shadow-emerald-500/10'
                  : 'bg-amber-950/60 border-amber-500/40 text-amber-300'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${isConnected ? 'text-emerald-400 animate-pulse' : 'text-amber-400'}`} />
              <span>{isConnected ? 'Real-Time Sync Active' : 'Connecting SSE...'}</span>
              <span
                className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Dynamic Viewport */}
      <div className="flex-1 w-full max-w-[1700px] mx-auto p-3 overflow-hidden min-h-0 flex flex-col">
        {/* Tab 1: Chat Explorer & Side-by-Side Playback */}
        {activeTab === 'chats' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 h-full min-h-0 flex-1 overflow-hidden">
            {/* Left: Chat Explorer Sidebar (4 cols on lg) */}
            <div className="lg:col-span-4 h-full min-h-0 flex flex-col overflow-hidden">
              <AdminChatExplorer
                selectedSessionId={selectedSessionId}
                onSelectSession={(id) => setSelectedSessionId(id)}
                sseUpdateTrigger={sseUpdateTrigger}
              />
            </div>

            {/* Right: Side-by-Side Playback & Data Flow (8 cols on lg) */}
            <div className="lg:col-span-8 h-full min-h-0 flex flex-col overflow-hidden">
              <AdminSideBySideInspector
                sessionId={selectedSessionId}
                sseUpdateTrigger={sseUpdateTrigger}
              />
            </div>
          </div>
        )}

        {/* Tab 2: Fullscreen Pipeline DAG Flowchart */}
        {activeTab === 'pipeline' && (
          <div className="h-full min-h-0 flex-1 flex flex-col overflow-hidden">
            <PipelineDagVisualizer workflow={activeWorkflow} />
          </div>
        )}

        {/* Tab 3: Active Prompts Catalog & Live Editor */}
        {activeTab === 'prompts' && (
          <div className="h-full min-h-0 flex-1 flex flex-col overflow-hidden">
            <AdminPromptEditor />
          </div>
        )}

        {/* Tab 4: Interactive Force-Directed Entity Graph */}
        {activeTab === 'graph' && (
          <div className="h-full min-h-0 flex-1 flex flex-col overflow-hidden bg-[#0d1520] rounded-2xl border border-slate-800 shadow-2xl p-2">
            <MarketGraphView
              isActive={activeTab === 'graph'}
              selectedActorId={activeWorkflow?.actorId || selectedSessionId || undefined}
            />
          </div>
        )}

        {/* Tab 5: System Reset & Clean Slate Administration */}
        {activeTab === 'reset' && (
          <div className="h-full min-h-0 flex-1 flex flex-col overflow-hidden">
            <AdminSystemResetView />
          </div>
        )}
      </div>
    </main>
  );
}
