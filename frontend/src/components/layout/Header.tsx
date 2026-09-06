'use client';

import React from 'react';
import { ActorRole } from '@/lib/types';
import { Store, ShoppingBag, Sparkles, Network, BarChart3, Radio } from 'lucide-react';

interface HeaderProps {
  activeRole: ActorRole;
  setActiveRole: (role: ActorRole) => void;
  activeTab: 'chat' | 'graph' | 'analytics';
  setActiveTab: (tab: 'chat' | 'graph' | 'analytics') => void;
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;
  isConnected: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeRole,
  setActiveRole,
  activeTab,
  setActiveTab,
  isDrawerOpen,
  setIsDrawerOpen,
  isConnected,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-surface-border bg-surface/90 backdrop-blur-md px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand & Logo */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <span className="font-extrabold text-white tracking-tight text-lg">A</span>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="font-bold text-lg text-white tracking-tight">AMKE</h1>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">
                Vector Concept Graph
              </span>
            </div>
            <p className="text-xs text-slate-400">Autonomous Market Knowledge Engine &bull; Neo4j 1536-dim Vector Search</p>
          </div>
        </div>

        {/* Center Tabs: Chat / Graph / Analytics */}
        <div className="hidden md:flex items-center space-x-1 p-1 rounded-xl bg-background border border-surface-border">
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'chat'
                ? 'bg-surface-light text-white shadow-sm border border-slate-700'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>Market Stream & Search</span>
          </button>

          <button
            onClick={() => setActiveTab('graph')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'graph'
                ? 'bg-surface-light text-white shadow-sm border border-slate-700'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Network className="w-3.5 h-3.5 text-cyan-400" />
            <span>Entity-Synonym Graph</span>
          </button>

          <button
            onClick={() => setActiveTab('analytics')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'analytics'
                ? 'bg-surface-light text-white shadow-sm border border-slate-700'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Concept Catalog & Gaps</span>
          </button>
        </div>

        {/* Right Controls: Role Toggle & Observability Drawer Trigger */}
        <div className="flex items-center space-x-3">
          {/* Persona Role Toggle */}
          <div className="flex items-center p-1 rounded-xl bg-background border border-surface-border">
            <button
              onClick={() => setActiveRole('SELLER')}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                activeRole === 'SELLER'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              <span>Seller Intake</span>
            </button>

            <button
              onClick={() => setActiveRole('BUYER')}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                activeRole === 'BUYER'
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40 shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>Buyer Search</span>
            </button>
          </div>

          {/* Observability Live Drawer Button */}
          <button
            onClick={() => setIsDrawerOpen(!isDrawerOpen)}
            className={`relative flex items-center space-x-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all ${
              isDrawerOpen
                ? 'bg-purple-600 text-white border-purple-400 font-bold shadow-lg shadow-purple-500/30'
                : 'bg-surface-light text-slate-300 border-surface-border hover:border-slate-600'
            }`}
          >
            <Radio className={`w-3.5 h-3.5 ${isConnected ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`} />
            <span>Telemetry</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          </button>
        </div>
      </div>
    </header>
  );
};
