'use client';

import React, { useState } from 'react';
import { AdminWorkflowExecution, AdminWorkflowStage } from '@/lib/types';
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileCode,
  Sparkles,
  Zap,
} from 'lucide-react';

interface PipelineStepperVisualizerProps {
  workflow?: AdminWorkflowExecution | null;
}

export function PipelineStepperVisualizer({ workflow }: PipelineStepperVisualizerProps) {
  const [expandedStageId, setExpandedStageId] = useState<string | null>(null);

  const stages = workflow?.stages || [];

  if (!workflow || stages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-[#0d1520] rounded-2xl border border-slate-800 text-center">
        <Clock className="w-10 h-10 text-slate-600 mb-2" />
        <p className="text-slate-400 font-semibold text-sm">No Workflow Execution Selected</p>
        <p className="text-xs text-slate-600 mt-1">Select a chat interaction from the chat list to view its sequential timeline.</p>
      </div>
    );
  }

  return (
    <div className="bg-[#0d1520] rounded-2xl border border-slate-800 overflow-hidden shadow-2xl p-4 sm:p-6 space-y-4">
      {/* Workflow Summary Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-[#131d2b] border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase font-bold text-slate-400 tracking-wider">Workflow Type:</span>
            <span className="text-sm font-bold text-indigo-300 font-mono">{workflow.workflowType}</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold uppercase">
              {workflow.status}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Actor: <strong className="text-slate-200">{workflow.actorId}</strong> &bull; Role: <strong className="text-slate-200">{workflow.actorRole}</strong>
          </p>
        </div>

        <div className="text-right">
          <div className="text-lg font-bold text-emerald-400 font-mono">{workflow.totalLatencyMs}ms</div>
          <span className="text-[10px] uppercase font-bold text-slate-500">Total Execution Time</span>
        </div>
      </div>

      {/* Sequential Stepper Timeline */}
      <div className="relative pl-6 space-y-4 border-l-2 border-slate-800 ml-3">
        {stages.map((stage, idx) => {
          const isExpanded = expandedStageId === stage.id || (idx === 0 && expandedStageId === null);
          const isSuccess = stage.status === 'SUCCESS';

          return (
            <div key={stage.id} className="relative group">
              {/* Timeline Dot */}
              <div
                className={`absolute -left-[31px] top-1.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shadow ${
                  isSuccess
                    ? 'bg-emerald-500 text-black shadow-emerald-500/30 ring-4 ring-[#0d1520]'
                    : 'bg-amber-500 text-black shadow-amber-500/30 ring-4 ring-[#0d1520]'
                }`}
              >
                {stage.stageOrder || idx + 1}
              </div>

              {/* Stage Card */}
              <div className="rounded-xl bg-[#131d2b] border border-slate-800 hover:border-slate-700 transition-all overflow-hidden">
                <div
                  onClick={() => setExpandedStageId(isExpanded ? '' : stage.id)}
                  className="p-3.5 flex items-center justify-between cursor-pointer select-none"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-slate-100">{stage.stageName}</h4>
                        {stage.promptKey && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                            {stage.promptKey}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">Order #{stage.stageOrder} &bull; Latency: {stage.latencyMs}ms</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                      isSuccess
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    }`}>
                      {stage.status}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                </div>

                {/* Expandable JSON Detail */}
                {isExpanded && (
                  <div className="p-3.5 border-t border-slate-800/80 bg-[#090e16] space-y-3 text-xs font-mono">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-sans block mb-1">
                        Input Data:
                      </span>
                      <pre className="p-2.5 rounded-lg bg-[#0d1520] border border-slate-800 text-indigo-300 overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(stage.inputData, null, 2)}
                      </pre>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-sans block mb-1">
                        Output Data:
                      </span>
                      <pre className="p-2.5 rounded-lg bg-[#0d1520] border border-slate-800 text-emerald-300 overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(stage.outputData, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
