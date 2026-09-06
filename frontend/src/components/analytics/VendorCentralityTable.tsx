'use client';

import React from 'react';
import { Sparkles, Layers, CheckCircle2 } from 'lucide-react';
import { ConceptCatalogItem } from '@/lib/types';

interface ConceptCatalogTableProps {
  data: ConceptCatalogItem[];
}

export const VendorCentralityTable: React.FC<ConceptCatalogTableProps> = ({ data }) => {
  return (
    <div className="p-4 bg-surface rounded-2xl border border-surface-border space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          <h4 className="text-sm font-bold text-white">Autonomous Sprouted Concepts</h4>
        </div>
        <span className="text-[10px] text-slate-400 font-mono">1536-dim Vector Anchors</span>
      </div>

      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {data.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-500 font-sans">
            No sprouted concepts discovered yet.
          </div>
        ) : (
          data.map((c, idx) => (
            <div
              key={c.conceptName}
              className="p-3 rounded-xl bg-surface-light border border-surface-border flex items-center justify-between text-xs hover:border-slate-600 transition-all"
            >
              <div className="flex items-center space-x-3">
                <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-300 font-bold flex items-center justify-center text-[10px]">
                  #{idx + 1}
                </span>
                <div>
                  <span className="font-bold text-slate-100 capitalize">{c.conceptName}</span>
                  {c.samplePhrases && c.samplePhrases.length > 0 && (
                    <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono">
                      <span>Phrases: [{c.samplePhrases.join(', ')}]</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-3 text-right">
                <div>
                  <span className="font-mono text-emerald-300 font-bold block text-xs">
                    {c.supplierCount} {c.supplierCount === 1 ? 'Seller' : 'Sellers'}
                  </span>
                  <span className="text-[10px] text-slate-400 font-sans">
                    {c.phraseCount} dialect phrases
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
