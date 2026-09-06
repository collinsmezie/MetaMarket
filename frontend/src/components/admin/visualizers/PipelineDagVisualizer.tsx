'use client';

import React, { useState, useEffect } from 'react';
import { AdminWorkflowExecution, AdminWorkflowStage } from '@/lib/types';
import {
  Layers,
  Sparkles,
  Zap,
  Network,
  CheckCircle2,
  AlertTriangle,
  Code2,
  FileJson,
  Bot,
  Database,
  Activity,
} from 'lucide-react';

interface PipelineDagVisualizerProps {
  workflow?: AdminWorkflowExecution | null;
}

const STAGE_TEMPLATES = [
  {
    order: 1,
    name: 'INPUT_INGESTION',
    title: '1. Ingestion & Audit',
    icon: Database,
    color: 'from-blue-500/20 to-cyan-500/20 border-blue-500/40 text-blue-400',
    desc: 'Raw market speech logged to PostgreSQL audit ledger',
  },
  {
    order: 2,
    name: 'HYDRATION_CHECK',
    title: '2. Intent Hydration',
    icon: Zap,
    color: 'from-amber-500/20 to-yellow-500/20 border-amber-500/40 text-amber-400',
    desc: 'Brevity check & localized probing evaluation',
  },
  {
    order: 3,
    name: 'CONTEXT_ASSEMBLY',
    title: '3. Open Context',
    icon: Layers,
    color: 'from-purple-500/20 to-indigo-500/20 border-purple-500/40 text-purple-400',
    desc: 'Reads active MacroFamilies into prompt frame',
  },
  {
    order: 4,
    name: 'AI_EXTRACTION',
    title: '4. AI Extraction',
    icon: Bot,
    color: 'from-pink-500/20 to-rose-500/20 border-pink-500/40 text-pink-400',
    desc: 'OpenAI o3-mini semantic decomposition & parsing',
  },
  {
    order: 5,
    name: 'NEO4J_GRAPH_RESOLUTION',
    title: '5. Graph Resolution',
    icon: Network,
    color: 'from-emerald-500/20 to-teal-500/20 border-emerald-500/40 text-emerald-400',
    desc: 'Vector gate lookup (≥0.88), concept sprouting & edges',
  },
  {
    order: 6,
    name: 'FULFILLMENT_RANKING',
    title: '6. Supplier Resolution',
    icon: Sparkles,
    color: 'from-cyan-500/20 to-blue-500/20 border-cyan-500/40 text-cyan-400',
    desc: '3-tier supplier resolution (Direct, Vector, Macro)',
  },
];

export function PipelineDagVisualizer({ workflow }: PipelineDagVisualizerProps) {
  const [selectedStageOrder, setSelectedStageOrder] = useState<number>(1);
  const [selectedStage, setSelectedStage] = useState<AdminWorkflowStage | null>(null);
  const [selectedStageTitle, setSelectedStageTitle] = useState<string>('Stage 1');
  const [activeTab, setActiveTab] = useState<'output' | 'input'>('output');

  const stages = workflow?.stages || [];

  // Helper function to match template stage to executed stage in workflow
  const findExecutedStage = (tmplName: string) => {
    return stages.find((s) => {
      const sName = s.stageName.toUpperCase();
      if (tmplName === 'INPUT_INGESTION') return sName.includes('INPUT') || sName.includes('INGESTION');
      if (tmplName === 'HYDRATION_CHECK') return sName.includes('HYDRATION');
      if (tmplName === 'CONTEXT_ASSEMBLY') return sName.includes('CONTEXT');
      if (tmplName === 'AI_EXTRACTION') return sName.includes('EXTRACTION') || sName.includes('AI') || sName.includes('GATE');
      if (tmplName === 'NEO4J_GRAPH_RESOLUTION') return sName.includes('GRAPH') || sName.includes('NEO4J');
      if (tmplName === 'FULFILLMENT_RANKING') return sName.includes('FULFILLMENT') || sName.includes('RANKING') || sName.includes('SEARCH') || sName.includes('TRAVERSAL');
      return false;
    });
  };

  // Auto-sync when active workflow changes (e.g. user clicked another chat session)
  useEffect(() => {
    if (workflow?.stages && workflow.stages.length > 0) {
      const firstStage = workflow.stages[0];
      setSelectedStage(firstStage);

      const matchedTmpl = STAGE_TEMPLATES.find((tmpl) => findExecutedStage(tmpl.name)?.id === firstStage.id);
      if (matchedTmpl) {
        setSelectedStageOrder(matchedTmpl.order);
        setSelectedStageTitle(matchedTmpl.title);
      } else {
        setSelectedStageOrder(1);
        setSelectedStageTitle('1. Ingestion & Audit');
      }
    } else {
      setSelectedStage(null);
      setSelectedStageOrder(1);
    }
  }, [workflow]);

  return (
    <div className="flex flex-col h-full bg-[#090e15] rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
      {/* Header Bar */}
      <div className="bg-[#111923] px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-md">
            <Activity className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-extrabold text-sm text-white tracking-tight">AMKE Execution Pipeline (DAG)</h3>
              {workflow && (
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                  {workflow.workflowType} &bull; {workflow.totalLatencyMs}ms total
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400">
              {workflow
                ? `Session Actor: ${workflow.actorId} (${workflow.actorRole}) • Click any stage card below to inspect inputs & outputs`
                : 'Select a chat session to inspect live execution DAG flow'}
            </p>
          </div>
        </div>

        {workflow && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">Pipeline Status:</span>
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-mono font-bold uppercase tracking-wider ${
                workflow.status === 'SUCCESS'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
                  : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
              }`}
            >
              ✓ {workflow.status}
            </span>
          </div>
        )}
      </div>

      {!workflow ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-slate-500 min-h-0">
          <Layers className="w-12 h-12 text-slate-700 mb-3 animate-bounce" />
          <h4 className="font-bold text-slate-300 text-sm">No Active Workflow Selected</h4>
          <p className="text-xs text-slate-500 max-w-sm mt-1">
            Click any session in the Chat Explorer to view its full 6-stage execution DAG.
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Top Stage Pipeline Steps - Legible & Spacious Cards */}
          <div className="p-3 bg-[#0d1420] border-b border-slate-800/80 overflow-x-auto shrink-0">
            <div className="flex items-stretch gap-3 min-w-max pb-1">
              {STAGE_TEMPLATES.map((tmpl) => {
                const executedStage = findExecutedStage(tmpl.name);
                const isExecuted = !!executedStage;
                const isSelected = selectedStageOrder === tmpl.order;
                const IconComponent = tmpl.icon;

                return (
                  <div
                    key={tmpl.order}
                    onClick={() => {
                      setSelectedStageOrder(tmpl.order);
                      setSelectedStageTitle(tmpl.title);
                      setSelectedStage(executedStage || null);
                    }}
                    className={`w-[210px] p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between select-none shadow-md shrink-0 ${
                      isSelected
                        ? 'bg-indigo-950/90 border-indigo-400 shadow-indigo-500/20 ring-2 ring-indigo-500/60 scale-[1.01]'
                        : isExecuted
                        ? 'bg-[#121c2b] hover:bg-[#18263a] border-slate-700/80 hover:border-slate-500'
                        : 'bg-[#0d1420]/70 border-slate-800/60 opacity-60'
                    }`}
                  >
                    <div>
                      {/* Step Header & Latency */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${tmpl.color} flex items-center justify-center shrink-0`}>
                          <IconComponent className="w-4 h-4" />
                        </div>
                        {executedStage && (
                          <span className="text-xs font-mono font-bold text-emerald-400">
                            {executedStage.latencyMs}ms
                          </span>
                        )}
                      </div>

                      {/* Title & Description */}
                      <h4 className="font-extrabold text-xs text-white tracking-tight">
                        {tmpl.title}
                      </h4>
                      <p className="text-[11px] text-slate-300 mt-1 leading-snug">
                        {tmpl.desc}
                      </p>
                    </div>

                    {/* Step Footer Badge */}
                    <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between gap-1 text-xs">
                      {isExecuted ? (
                        <span className="text-emerald-400 flex items-center gap-1 font-semibold text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span>Executed</span>
                        </span>
                      ) : (
                        <span className="text-slate-500 text-xs">Skipped</span>
                      )}

                      {executedStage?.promptKey && (
                        <span
                          className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 truncate max-w-[85px]"
                          title={executedStage.promptKey}
                        >
                          {executedStage.promptKey}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom Interactive JSON Payload Inspector Drawer */}
          <div className="flex-1 p-3.5 bg-[#090e15] overflow-y-auto min-h-0 flex flex-col">
            {selectedStage ? (
              <div className="flex-1 flex flex-col bg-[#111923] rounded-xl border border-slate-800 overflow-hidden shadow-xl min-h-0">
                {/* Inspector Header */}
                <div className="bg-[#15212e] px-4 py-2.5 border-b border-slate-800 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <Code2 className="w-4 h-4 text-indigo-400" />
                    <h4 className="font-bold text-xs text-white">
                      Stage Inspector:{' '}
                      <span className="text-indigo-300 font-mono">
                        {selectedStageTitle} ({selectedStage.stageName})
                      </span>
                    </h4>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">
                      {selectedStage.latencyMs}ms
                    </span>
                  </div>

                  {/* Toggle Input vs Output Tabs */}
                  <div className="flex items-center gap-1 bg-[#090e16] p-1 rounded-lg border border-slate-800 text-xs">
                    <button
                      type="button"
                      onClick={() => setActiveTab('output')}
                      className={`px-3 py-1 rounded font-bold transition-all text-xs ${
                        activeTab === 'output' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Output Data
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('input')}
                      className={`px-3 py-1 rounded font-bold transition-all text-xs ${
                        activeTab === 'input' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Input Data
                    </button>
                  </div>
                </div>

                {/* JSON Data Viewer */}
                <div className="flex-1 p-4 overflow-auto font-mono text-xs text-emerald-300 bg-[#0a1017] min-h-0">
                  <pre className="whitespace-pre-wrap break-all max-w-full leading-relaxed font-mono text-xs text-emerald-300">
                    {JSON.stringify(
                      activeTab === 'output' ? selectedStage.outputData : selectedStage.inputData,
                      null,
                      2
                    )}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500 p-8 border border-dashed border-slate-800 rounded-xl">
                <FileJson className="w-8 h-8 text-slate-600 mb-2" />
                <p className="text-xs text-slate-400 font-medium">
                  Stage "{selectedStageTitle}" was not executed in this {workflow.workflowType} run.
                </p>
                <p className="text-[11px] text-slate-600 mt-1">
                  Click another stage card above with an "Executed" badge to inspect its payload.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
