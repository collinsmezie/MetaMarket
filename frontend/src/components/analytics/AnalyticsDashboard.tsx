'use client';

import React, { useState, useEffect } from 'react';
import { SupplyDemandGapChart } from './SupplyDemandGapChart';
import { VendorCentralityTable } from './VendorCentralityTable';
import { getSupplyDemandGaps, getConceptsCatalog, getTrainingPairs } from '@/lib/api';
import { Download, RefreshCw, Database, Sparkles, BrainCircuit, Activity } from 'lucide-react';

export const AnalyticsDashboard: React.FC = () => {
  const [gaps, setGaps] = useState<any[]>([]);
  const [concepts, setConcepts] = useState<any[]>([]);
  const [trainingCount, setTrainingCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [gapsData, conceptsData, pairsData] = await Promise.all([
        getSupplyDemandGaps(),
        getConceptsCatalog(),
        getTrainingPairs(50),
      ]);
      setGaps(gapsData);
      setConcepts(conceptsData);
      setTrainingCount(pairsData.totalCount || pairsData.pairs?.length || 0);
    } catch (err) {
      console.error('Failed to load AMKE analytics data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleExportTrainingData = async () => {
    try {
      const data = await getTrainingPairs(500);
      const list = data.pairs || [];
      const jsonl = list.map((p: any) => JSON.stringify(p)).join('\n');
      const blob = new Blob([jsonl], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `amke_training_pairs_${Date.now()}.jsonl`;
      a.click();
    } catch (err) {
      alert('Failed to export dataset: ' + err);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-5 h-[calc(100vh-80px)] overflow-y-auto">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 rounded-3xl bg-surface border border-surface-border flex items-center space-x-3 shadow-lg">
          <div className="p-3 rounded-2xl bg-purple-500/20 text-purple-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] text-slate-400 font-medium">Sprouted Concepts</span>
            <p className="text-xl font-extrabold text-white">{concepts.length} Vector Anchors</p>
          </div>
        </div>

        <div className="p-4 rounded-3xl bg-surface border border-surface-border flex items-center space-x-3 shadow-lg">
          <div className="p-3 rounded-2xl bg-cyan-500/20 text-cyan-400">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] text-slate-400 font-medium">PostgreSQL Cold Ledger</span>
            <p className="text-xl font-extrabold text-white">Immutable Logs</p>
          </div>
        </div>

        <div className="p-4 rounded-3xl bg-surface border border-surface-border flex items-center space-x-3 shadow-lg">
          <div className="p-3 rounded-2xl bg-emerald-500/20 text-emerald-400">
            <BrainCircuit className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] text-slate-400 font-medium">AI Training Flywheel</span>
            <p className="text-xl font-extrabold text-white">{trainingCount} Labeled Pairs</p>
          </div>
        </div>
      </div>

      {/* Flywheel Export Banner */}
      <div className="p-4 rounded-3xl bg-gradient-to-r from-purple-950/40 via-surface to-surface-light border border-purple-500/40 flex flex-wrap items-center justify-between gap-3 shadow-xl">
        <div className="space-y-0.5">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <h3 className="font-bold text-sm text-white">
              Autonomous Market Knowledge Engine Dataset Export
            </h3>
          </div>
          <p className="text-xs text-slate-300">
            Export paired raw informal market speech and resolved concept graph embeddings for fine-tuning local reasoning models.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={loadData}
            className="p-2 rounded-xl bg-surface-border text-slate-300 hover:text-white transition-all"
            title="Refresh Analytics"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleExportTrainingData}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition-all shadow-lg shadow-purple-600/30 active:scale-95"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export JSONL Dataset</span>
          </button>
        </div>
      </div>

      {/* Analytics Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <VendorCentralityTable data={concepts} />
        <SupplyDemandGapChart data={gaps} />
      </div>
    </div>
  );
};
