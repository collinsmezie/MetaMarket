'use client';

import React from 'react';
import { AlertCircle, CheckCircle2, TrendingUp, Sparkles } from 'lucide-react';

interface GapItem {
  conceptName: string;
  supplierCount: number;
  demandCount: number;
  gapStatus: 'UNDERSERVED_GAP' | 'STABLE';
}

interface SupplyDemandGapChartProps {
  data: GapItem[];
}

export const SupplyDemandGapChart: React.FC<SupplyDemandGapChartProps> = ({ data }) => {
  return (
    <div className="p-4 bg-surface rounded-2xl border border-surface-border space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <TrendingUp className="w-4 h-4 text-purple-400" />
          <h4 className="text-sm font-bold text-white">AMKE Concept Supply & Demand Gaps</h4>
        </div>
        <span className="text-[10px] text-slate-400 font-mono">Live Neo4j Graph Traversal</span>
      </div>

      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {data.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-500 font-sans">
            No supply/demand gaps recorded yet.
          </div>
        ) : (
          data.map((item) => (
            <div
              key={item.conceptName}
              className="p-2.5 rounded-xl bg-surface-light border border-surface-border flex items-center justify-between text-xs"
            >
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-purple-300 capitalize">{item.conceptName}</span>
                </div>
                <span className="text-[11px] text-slate-400 font-sans">
                  {item.demandCount} buyer requests
                </span>
              </div>

              <div className="flex items-center space-x-2">
                <span className="font-mono text-slate-300 font-bold">
                  {item.supplierCount} {item.supplierCount === 1 ? 'Supplier' : 'Suppliers'}
                </span>

                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-mono ${
                    item.supplierCount === 0
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  }`}
                >
                  {item.supplierCount === 0 ? 'UNDERSERVED GAP' : 'STABLE SUPPLY'}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
