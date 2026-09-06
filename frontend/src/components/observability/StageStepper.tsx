'use client';

import React from 'react';
import { PipelineStage } from '@/lib/types';
import { Check, Circle, Loader2, AlertCircle } from 'lucide-react';

interface StageStepperProps {
  currentStage: PipelineStage | null;
  status: 'PENDING' | 'SUCCESS' | 'WARNING' | 'ERROR';
}

export const StageStepper: React.FC<StageStepperProps> = ({ currentStage, status }) => {
  const stages: Array<{ id: PipelineStage; label: string; number: number }> = [
    { id: 'STAGE_1_INPUT_RECEIVED', label: '1. Ingest & Log', number: 1 },
    { id: 'STAGE_2_PREFILTER_LOOKUP', label: '2. Lucene Pre-Filter', number: 2 },
    { id: 'STAGE_3_CONTEXT_ASSEMBLY', label: '3. Context Assembly', number: 3 },
    { id: 'STAGE_4_AI_EXTRACTION', label: '4. AI Extraction', number: 4 },
    { id: 'STAGE_5_GRAPH_TRANSACTION', label: '5. Cypher Write', number: 5 },
  ];

  const getStageIndex = (stage: PipelineStage | null) => {
    if (!stage) return -1;
    if (stage === 'STAGE_COMPLETE') return 5;
    return stages.findIndex((s) => s.id === stage);
  };

  const activeIndex = getStageIndex(currentStage);

  return (
    <div className="p-3.5 bg-surface-light rounded-2xl border border-surface-border">
      <div className="flex items-center justify-between text-xs font-bold text-slate-300 mb-3">
        <span>5-Stage Ingestion Pipeline</span>
        <span className="font-mono text-[10px] text-primary-400 bg-primary-500/10 px-2 py-0.5 rounded border border-primary-500/20">
          {currentStage === 'STAGE_COMPLETE' ? 'COMPLETED (200 OK)' : currentStage || 'IDLE'}
        </span>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {stages.map((st, idx) => {
          const isPassed = activeIndex > idx || currentStage === 'STAGE_COMPLETE';
          const isCurrent = activeIndex === idx && currentStage !== 'STAGE_COMPLETE';
          const isError = isCurrent && status === 'ERROR';

          return (
            <div
              key={st.id}
              className={`flex flex-col items-center p-2 rounded-xl border text-center transition-all ${
                isPassed
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                  : isError
                  ? 'bg-rose-500/10 border-rose-500/40 text-rose-300'
                  : isCurrent
                  ? 'bg-primary-500/20 border-primary-500 text-primary-300 animate-pulse'
                  : 'bg-surface border-surface-border text-slate-500'
              }`}
            >
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mb-1">
                {isPassed ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : isCurrent ? (
                  <Loader2 className="w-3.5 h-3.5 text-primary-400 animate-spin" />
                ) : isError ? (
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                ) : (
                  <Circle className="w-3.5 h-3.5 text-slate-600" />
                )}
              </div>
              <span className="text-[10px] font-medium truncate w-full leading-tight">
                {st.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
