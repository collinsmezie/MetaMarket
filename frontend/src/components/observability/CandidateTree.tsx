'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Hash, Layers } from 'lucide-react';

interface CandidateTreeProps {
  candidates?: Array<{
    code: string;
    name: string;
    score?: number;
    segmentName?: string;
    definition?: string;
  }>;
}

export const CandidateTree: React.FC<CandidateTreeProps> = ({ candidates = [] }) => {
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

  if (!candidates || candidates.length === 0) {
    return (
      <div className="p-4 bg-surface rounded-xl border border-surface-border text-center text-xs text-slate-500">
        No candidate nodes discovered yet. Trigger a message to run Lucene lookup.
      </div>
    );
  }

  return (
    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
      {candidates.map((cand) => {
        const isExpanded = expandedCode === cand.code;
        return (
          <div
            key={cand.code}
            className="p-2 rounded-xl bg-surface border border-surface-border hover:border-slate-600 transition-all text-xs"
          >
            <div
              onClick={() => setExpandedCode(isExpanded ? null : cand.code)}
              className="flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center space-x-2">
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                )}
                <span className="font-mono font-bold text-primary-400 bg-primary-500/10 px-1.5 py-0.5 rounded border border-primary-500/20">
                  {cand.code}
                </span>
                <span className="font-semibold text-slate-200 truncate max-w-[180px]">
                  {cand.name}
                </span>
              </div>

              {cand.score !== undefined && (
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                  Score: {cand.score.toFixed(2)}
                </span>
              )}
            </div>

            {isExpanded && (
              <div className="mt-2 pt-2 border-t border-surface-border/50 pl-5 text-[11px] space-y-1 text-slate-400">
                {cand.segmentName && (
                  <div className="flex items-center gap-1">
                    <Layers className="w-3 h-3 text-amber-400" />
                    <span>Segment: {cand.segmentName}</span>
                  </div>
                )}
                {cand.definition && (
                  <p className="text-slate-300 leading-relaxed italic">
                    "{cand.definition}"
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
