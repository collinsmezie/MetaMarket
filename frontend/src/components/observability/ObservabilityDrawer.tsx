'use client';

import React, { useState, useEffect } from 'react';
import { TelemetryEvent, PipelineStage } from '@/lib/types';
import { StageStepper } from './StageStepper';
import { JsonPayloadViewer } from './JsonPayloadViewer';
import { getApiBase } from '@/lib/api';
import { getTelemetrySocket } from '@/lib/socket';
import { X, Activity, Cpu, Clock, Terminal, Sparkles } from 'lucide-react';

interface ObservabilityDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectionChange?: (connected: boolean) => void;
}

export const ObservabilityDrawer: React.FC<ObservabilityDrawerProps> = ({
  isOpen,
  onClose,
  onConnectionChange,
}) => {
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [latestEvent, setLatestEvent] = useState<TelemetryEvent | null>(null);
  const [currentStage, setCurrentStage] = useState<PipelineStage | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // 1. Connect WebSocket for live telemetry events
    const socket = getTelemetrySocket();

    socket.on('connect', () => {
      setIsConnected(true);
      onConnectionChange?.(true);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      onConnectionChange?.(false);
    });

    socket.on('telemetry:event', (event: TelemetryEvent) => {
      setLatestEvent(event);
      setCurrentStage(event.stage);
      setEvents((prev) => [event, ...prev.slice(0, 49)]);
    });

    // 2. Also open SSE EventSource as backup
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(`${getApiBase()}/telemetry/stream/all`);
      eventSource.onmessage = (e) => {
        try {
          const parsed: TelemetryEvent = JSON.parse(e.data);
          setLatestEvent(parsed);
          setCurrentStage(parsed.stage);
          setEvents((prev) => [parsed, ...prev.slice(0, 49)]);
        } catch {}
      };
    } catch {}

    return () => {
      socket.off('telemetry:event');
      eventSource?.close();
    };
  }, [onConnectionChange]);

  if (!isOpen) return null;

  return (
    <aside className="fixed top-0 right-0 z-50 h-full w-full max-w-lg bg-surface/95 border-l border-surface-border backdrop-blur-xl shadow-2xl flex flex-col transition-all duration-300 animate-in slide-in-from-right">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-surface-border bg-surface-light/50">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-400">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-white">AMKE Live Execution Inspector</h3>
            <p className="text-[11px] text-slate-400 font-mono">
              Dual-Channel Stream &middot; {isConnected ? '⚡ Active' : 'Connecting...'}
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-surface-border transition-all"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Drawer Scroll Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Active Provider & Metrics Badge */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-3 rounded-2xl border bg-purple-950/40 border-purple-500/50 text-purple-200 flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-black/40">
              <Cpu className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold tracking-wider opacity-75">
                AI Engine
              </span>
              <p className="font-bold text-xs">
                {latestEvent?.provider || 'AMKE Cognitive Priming'}
              </p>
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-surface border border-surface-border flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                Execution Latency
              </span>
              <p className="font-bold text-xs text-white font-mono">
                {latestEvent?.data?.totalDurationMs || latestEvent?.durationMs || 180} ms
              </p>
            </div>
          </div>
        </div>

        {/* 5-Stage Stepper Progress */}
        <StageStepper currentStage={currentStage} status={latestEvent?.status || 'SUCCESS'} />

        {/* Dynamic Concept Vector Resolution */}
        {latestEvent?.data?.resolvedConcepts && latestEvent.data.resolvedConcepts.length > 0 && (
          <div className="p-3 rounded-2xl bg-surface border border-surface-border space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-purple-300">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Vector Concept Graph Resolutions
              </span>
              <span className="text-[10px] font-mono text-slate-400">&gt; 0.82 Cosine</span>
            </div>
            <div className="space-y-1.5">
              {latestEvent.data.resolvedConcepts.map((rc, idx) => (
                <div
                  key={idx}
                  className="p-2 rounded-xl bg-slate-900 border border-purple-500/30 flex items-center justify-between text-xs font-mono"
                >
                  <span className="font-bold text-white capitalize">&quot;{rc.concept}&quot;</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      rc.sprouted
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    }`}
                  >
                    {rc.sprouted ? '✨ SPROUTED' : `🎯 ${(rc.score * 100).toFixed(0)}% MATCH`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Structured Cognitive Extraction Payload */}
        <div className="space-y-2">
          <JsonPayloadViewer
            title="Nigerian Market Structured Output (Zod)"
            data={latestEvent?.data?.extractedPayload || { status: 'Awaiting cognitive stream...' }}
          />
        </div>

        {/* Recent Server Log Feed */}
        <div className="space-y-2">
          <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-300">
            <Terminal className="w-3.5 h-3.5 text-slate-400" />
            <span>Real-Time Pipeline Telemetry Log</span>
          </div>

          <div className="p-3 rounded-2xl bg-black/60 border border-surface-border text-[11px] font-mono space-y-1.5 max-h-48 overflow-y-auto">
            {events.length === 0 ? (
              <p className="text-slate-600">// Listening for AMKE pipeline events...</p>
            ) : (
              events.map((evt, idx) => (
                <div key={idx} className="flex items-start space-x-2 text-slate-300">
                  <span className="text-slate-500 shrink-0">
                    [{evt.timestamp.slice(11, 19)}]
                  </span>
                  <span
                    className={`font-bold shrink-0 ${
                      evt.status === 'ERROR'
                        ? 'text-rose-400'
                        : evt.status === 'WARNING'
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {evt.stageLabel}:
                  </span>
                  <span className="truncate text-slate-400">
                    {evt.data?.rawInput || 'Execution OK'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};
