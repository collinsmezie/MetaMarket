'use client';

import React from 'react';
import {
  Sparkles,
  Store,
  ShoppingBag,
  Split,
  Trash2,
  VolumeX,
  BookOpen,
  PenTool,
  Palette,
} from 'lucide-react';
import { ActorRole } from '@/lib/types';

interface DemoScenariosProps {
  onSelectScenario: (text: string, role: ActorRole) => void;
}

export const DemoScenarios: React.FC<DemoScenariosProps> = ({ onSelectScenario }) => {
  const scenarios = [
    {
      id: 'test1_seller',
      title: '1. Seller Intake (Sprout)',
      role: 'SELLER' as ActorRole,
      icon: Store,
      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20',
      text: 'I sell Peak milk and Dano in my shop at Surulere',
    },
    {
      id: 'test2_buyer',
      title: '2. Buyer Match (> 0.82)',
      role: 'BUYER' as ActorRole,
      icon: ShoppingBag,
      color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30 hover:bg-cyan-500/20',
      text: 'Who has milk powder for tea?',
    },
    {
      id: 'test3_cluster',
      title: '3. Cluster Trace (Art)',
      role: 'BUYER' as ActorRole,
      icon: Palette,
      color: 'text-amber-400 bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20',
      text: 'I need a charcoal pencil',
    },
    {
      id: 'test4_mixer',
      title: '4. Multi-Sector Splitter',
      role: 'SELLER' as ActorRole,
      icon: Split,
      color: 'text-purple-400 bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20',
      text: 'I have Dangote cement and Honeywell flour in stock',
    },
    {
      id: 'test5_sever',
      title: '5. Out of Stock (Sever)',
      role: 'SELLER' as ActorRole,
      icon: Trash2,
      color: 'text-rose-400 bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20',
      text: "Don't call me for milk, Peak is finished, I only have Milo left",
    },
    {
      id: 'test_bibles',
      title: '6. Bibles & Diaries',
      role: 'BUYER' as ActorRole,
      icon: BookOpen,
      color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30 hover:bg-indigo-500/20',
      text: 'I need bibles and diaries for church conference in Warri',
    },
    {
      id: 'test_pencups',
      title: '7. Pen Cups (Mobinco)',
      role: 'BUYER' as ActorRole,
      icon: PenTool,
      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20',
      text: 'I need pen cups for office in Warri',
    },
    {
      id: 'test_hydration_nylon',
      title: 'FR-1: Buyer Hydration ("nylon")',
      role: 'BUYER' as ActorRole,
      icon: Sparkles,
      color: 'text-amber-400 bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20',
      text: 'I need nylon',
    },
    {
      id: 'test_hydration_glue',
      title: 'FR-1: Seller Hydration ("glue")',
      role: 'SELLER' as ActorRole,
      icon: Store,
      color: 'text-amber-400 bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20',
      text: 'I sell glue in my shop',
    },
    {
      id: 'test8_noise',
      title: '8. Noise Isolation',
      role: 'BUYER' as ActorRole,
      icon: VolumeX,
      color: 'text-slate-400 bg-slate-800/40 border-slate-700 hover:bg-slate-800',
      text: 'Oya bring change for 10k sharp-sharp when you are coming abeg',
    },
  ];

  return (
    <div className="p-3 bg-surface/60 border border-surface-border rounded-2xl">
      <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-400 mb-2">
        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
        <span>Benchmark Scenarios (1-Click Real-Time Test):</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {scenarios.map((sc) => {
          const Icon = sc.icon;
          return (
            <button
              key={sc.id}
              onClick={() => onSelectScenario(sc.text, sc.role)}
              className={`flex flex-col text-left p-2.5 rounded-xl border text-xs transition-all hover:scale-[1.02] active:scale-95 ${sc.color}`}
            >
              <div className="flex items-center space-x-1.5 font-bold mb-1">
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{sc.title}</span>
              </div>
              <span className="text-[10px] text-slate-300 opacity-90 line-clamp-2">
                &quot;{sc.text}&quot;
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
