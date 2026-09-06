'use client';

import React, { useState, useEffect, useRef } from 'react';
import { TelemetryEvent } from '@/lib/types';
import { getTelemetrySocket } from '@/lib/socket';
import { getApiBase } from '@/lib/api';
import {
  Terminal,
  Play,
  Pause,
  Trash2,
  Download,
  Filter,
  ChevronRight,
  ChevronDown,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Layers,
} from 'lucide-react';

interface AdminTerminalLogViewerProps {
  sessionId?: string | null;
  sseUpdateTrigger?: number;
}

export function AdminTerminalLogViewer({
  sessionId,
  sseUpdateTrigger = 0,
}: AdminTerminalLogViewerProps) {
  const [logs, setLogs] = useState<TelemetryEvent[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [stageFilter, setStageFilter] = useState<string>('ALL');
  const [expandedPayloads, setExpandedPayloads] = useState<Record<number, boolean>>({});
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Fetch initial telemetry log history for the selected session
  const fetchInitialLogs = async () => {
    try {
      const url = `${getApiBase()}/telemetry/logs?sessionId=${sessionId || 'all'}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        if (json.logs && Array.isArray(json.logs)) {
          setLogs(json.logs);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch initial telemetry logs:', err);
    }
  };

  useEffect(() => {
    fetchInitialLogs();
  }, [sessionId, sseUpdateTrigger]);

  // Real-time EventSource (SSE) & WebSocket stream subscription
  useEffect(() => {
    let eventSource: EventSource | null = null;
    const socket = getTelemetrySocket();

    const handleEvent = (evt: TelemetryEvent) => {
      if (!evt || evt.stageLabel === 'HEARTBEAT_PING') return;
      if (sessionId && sessionId !== 'all' && evt.sessionId !== sessionId && evt.sessionId !== 'all') {
        return;
      }
      setLogs((prev) => {
        const updated = [...prev, evt];
        return updated.slice(-600); // keep last 600 events in memory
      });
    };

    socket.on('telemetry:event', handleEvent);

    try {
      const streamUrl = `${getApiBase()}/telemetry/stream${sessionId ? `/${sessionId}` : ''}`;
      eventSource = new EventSource(streamUrl);
      eventSource.onmessage = (e) => {
        try {
          const evt: TelemetryEvent = JSON.parse(e.data);
          handleEvent(evt);
        } catch {}
      };
    } catch {}

    return () => {
      eventSource?.close();
      socket.off('telemetry:event', handleEvent);
    };
  }, [sessionId]);

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    if (autoScroll) {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const togglePayload = (index: number) => {
    setExpandedPayloads((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const clearTerminal = () => {
    setLogs([]);
    setExpandedPayloads({});
  };

  const exportLogs = () => {
    const text = logs
      .map(
        (l) =>
          `[${l.timestamp}] [${l.stage}] [Session: ${l.sessionId}] [Status: ${l.status}]\n` +
          `Data: ${JSON.stringify(l.data, null, 2)}\n----------------------------------------`
      )
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `amke_pipeline_${sessionId || 'all'}_${Date.now()}.log`;
    a.click();
  };

  // Filter logs by selected stage
  const filteredLogs = logs.filter((log) => {
    if (stageFilter === 'ALL') return true;
    if (stageFilter === 'ERRORS') return log.status === 'ERROR';
    return log.stage === stageFilter;
  });

  const getStageBadgeColor = (stage: string) => {
    switch (stage) {
      case 'STAGE_1_INPUT_RECEIVED':
        return 'bg-emerald-950 text-emerald-300 border-emerald-500/40';
      case 'STAGE_2_PREFILTER_LOOKUP':
        return 'bg-amber-950 text-amber-300 border-amber-500/40';
      case 'STAGE_4_AI_EXTRACTION':
        return 'bg-indigo-950 text-indigo-300 border-indigo-500/40';
      case 'STAGE_5_PGVECTOR_SEARCH':
      case 'STAGE_5_GRAPH_TRANSACTION':
        return 'bg-cyan-950 text-cyan-300 border-cyan-500/40';
      case 'STAGE_COMPLETE':
        return 'bg-purple-950 text-purple-300 border-purple-500/40';
      case 'STAGE_ERROR':
        return 'bg-red-950 text-red-300 border-red-500/40';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#05080c] rounded-2xl border border-slate-800 overflow-hidden font-mono text-xs shadow-2xl">
      {/* Retro Terminal Header Bar */}
      <div className="bg-[#0b1017] px-4 py-2.5 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center space-x-2">
          {/* Terminal Window Controls */}
          <div className="flex items-center space-x-1.5 mr-2">
            <span className="w-3 h-3 rounded-full bg-red-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
          </div>

          <Terminal className="w-4 h-4 text-emerald-400" />
          <span className="font-bold text-slate-200 tracking-tight">
            AMKE Pipeline Execution Shell
          </span>
          <span className="text-[10px] text-slate-400 font-mono bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
            {sessionId ? `session: ${sessionId}` : 'session: ALL'}
          </span>
        </div>

        {/* Terminal Controls */}
        <div className="flex items-center space-x-2">
          {/* Stage Filter Dropdown */}
          <div className="flex items-center space-x-1 bg-[#05080c] px-2 py-1 rounded-lg border border-slate-800 text-[11px]">
            <Filter className="w-3 h-3 text-slate-400" />
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="bg-transparent text-slate-300 focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Stages ({logs.length})</option>
              <option value="STAGE_1_INPUT_RECEIVED">Stage 1: Input Intake</option>
              <option value="STAGE_2_PREFILTER_LOOKUP">Stage 2: Intent Hydration</option>
              <option value="STAGE_4_AI_EXTRACTION">Stage 4: LLM Extraction</option>
              <option value="STAGE_5_GRAPH_TRANSACTION">Stage 5: Vector & Graph</option>
              <option value="ERRORS">Errors Only</option>
            </select>
          </div>

          {/* Auto-Scroll Toggle */}
          <button
            type="button"
            onClick={() => setAutoScroll((prev) => !prev)}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg border font-bold text-[11px] transition ${
              autoScroll
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
          >
            {autoScroll ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            <span>{autoScroll ? 'AUTO-SCROLL ON' : 'PAUSED'}</span>
          </button>

          {/* Clear Buffer */}
          <button
            type="button"
            onClick={clearTerminal}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition"
            title="Clear Terminal Output"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          {/* Export Log File */}
          <button
            type="button"
            onClick={exportLogs}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition"
            title="Export Logs (.log)"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal Command Prompt Header */}
      <div className="bg-[#070d14] px-4 py-1.5 border-b border-slate-900 text-[11px] text-slate-400 flex items-center gap-2 font-mono">
        <span className="text-emerald-400 font-bold">algorithmz@amke-engine:~$</span>
        <span>./observe-pipeline.sh --session={sessionId || 'ALL'} --mode=REALTIME_STREAM</span>
      </div>

      {/* Terminal Log Output Window */}
      <div className="flex-1 p-3 overflow-y-auto space-y-2 font-mono text-[11px] leading-relaxed custom-scrollbar bg-[#05080c]">
        {filteredLogs.map((log, index) => {
          const isExpanded = !!expandedPayloads[index];
          const time = new Date(log.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3,
          });

          return (
            <div
              key={index}
              className="p-2 rounded-lg bg-[#090f17] border border-slate-800/80 hover:border-slate-700/80 transition-colors"
            >
              {/* Primary Log Header Line */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center space-x-2 truncate min-w-0">
                  {/* Timestamp */}
                  <span className="text-slate-400 font-bold">{time}</span>

                  {/* Session Badge */}
                  <span className="text-purple-400 font-bold truncate max-w-[140px]">
                    [{log.sessionId}]
                  </span>

                  {/* Stage Badge */}
                  <span
                    className={`px-2 py-0.5 rounded border text-[10px] font-bold ${getStageBadgeColor(
                      log.stage
                    )}`}
                  >
                    {log.stageLabel || log.stage}
                  </span>

                  {/* Provider / Model Badge */}
                  {log.provider && (
                    <span className="text-[10px] text-indigo-300 bg-indigo-950/60 px-1.5 py-0.2 rounded border border-indigo-500/30">
                      {log.provider}
                    </span>
                  )}
                </div>

                {/* Status Indicator & Latency */}
                <div className="flex items-center space-x-2 shrink-0">
                  {log.durationMs !== undefined && (
                    <span className="text-slate-400 font-bold">{log.durationMs}ms</span>
                  )}

                  {log.status === 'SUCCESS' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                  {log.status === 'WARNING' && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                  {log.status === 'ERROR' && <XCircle className="w-3.5 h-3.5 text-red-400" />}

                  {/* Expand JSON Button */}
                  <button
                    type="button"
                    onClick={() => togglePayload(index)}
                    className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold transition"
                  >
                    {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    <span>JSON</span>
                  </button>
                </div>
              </div>

              {/* Log Message Summary Text */}
              <div className="mt-1 text-slate-200">
                {log.data?.rawInput && (
                  <span className="text-slate-300">
                    📥 Raw Speech/Query: <span className="text-emerald-300 font-bold">&quot;{log.data.rawInput}&quot;</span>
                  </span>
                )}
                {log.data?.hydrationQuestion && (
                  <div className="text-amber-300">
                    🧠 Hydration Probing Question: &quot;{log.data.hydrationQuestion}&quot;
                  </div>
                )}
                {log.data?.extractedPayload && (
                  <div className="text-indigo-300 text-[10.5px]">
                    📦 Items Extracted: {JSON.stringify(log.data.extractedPayload.extractedItems || [])}
                  </div>
                )}
                {log.data?.cypherQuery && (
                  <div className="text-cyan-300 text-[10.5px] truncate">
                    🕸️ Cypher: {log.data.cypherQuery}
                  </div>
                )}
              </div>

              {/* Collapsible Formatted JSON Payload Inspector */}
              {isExpanded && (
                <div className="mt-2 p-2.5 rounded bg-[#03060a] border border-slate-800 text-[10.5px] text-slate-300 font-mono overflow-x-auto">
                  <div className="text-slate-400 font-bold mb-1">// Complete Telemetry Event Payload:</div>
                  <pre className="text-emerald-400 font-mono whitespace-pre-wrap">
                    {JSON.stringify(log, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          );
        })}

        {filteredLogs.length === 0 && (
          <div className="p-12 text-center text-slate-500 font-mono text-xs">
            No pipeline execution telemetry logs recorded for this session yet.
            <div className="text-[11px] text-slate-600 mt-1">
              Send a chat request from the seller or buyer interface to watch execution stream live!
            </div>
          </div>
        )}

        <div ref={terminalEndRef} />
      </div>
    </div>
  );
}
