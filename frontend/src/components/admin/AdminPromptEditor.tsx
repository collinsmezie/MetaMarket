'use client';

import React, { useState, useEffect } from 'react';
import { PromptTemplateItem } from '@/lib/types';
import { fetchPromptTemplates, updatePromptTemplate } from '@/lib/api';
import {
  Code2,
  Sparkles,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Sliders,
  Cpu,
  Layers,
  ChevronRight,
  Info,
} from 'lucide-react';

export function AdminPromptEditor() {
  const [prompts, setPrompts] = useState<PromptTemplateItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('INTENT_EXTRACTION');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Form State for active prompt
  const [currentPrompt, setCurrentPrompt] = useState<PromptTemplateItem | null>(null);

  const loadPrompts = async () => {
    setIsLoading(true);
    try {
      const list = await fetchPromptTemplates();
      setPrompts(list);
      const active = list.find((p) => p.promptKey === selectedKey) || list[0];
      if (active) {
        setSelectedKey(active.promptKey);
        setCurrentPrompt({ ...active });
      }
    } catch (err) {
      console.error('Failed to load prompts:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPrompts();
  }, []);

  const handleSelectPrompt = (key: string) => {
    setSelectedKey(key);
    const found = prompts.find((p) => p.promptKey === key);
    if (found) {
      setCurrentPrompt({ ...found });
      setSaveSuccess(false);
    }
  };

  const handleSave = async () => {
    if (!currentPrompt) return;
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const updated = await updatePromptTemplate(currentPrompt.promptKey, {
        name: currentPrompt.name,
        description: currentPrompt.description,
        systemPrompt: currentPrompt.systemPrompt,
        userTemplate: currentPrompt.userTemplate,
        modelProvider: currentPrompt.modelProvider,
        modelName: currentPrompt.modelName,
        temperature: currentPrompt.temperature,
      });

      setSaveSuccess(true);
      // Update local array
      setPrompts((prev) =>
        prev.map((p) => (p.promptKey === updated.promptKey ? updated : p))
      );
      setCurrentPrompt({ ...updated });
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      alert(`Failed to save prompt: ${err}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row h-full bg-[#0d1520] rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
      {/* Left Prompts Sidebar */}
      <div className="w-full lg:w-80 bg-[#131d2b] border-b lg:border-b-0 lg:border-r border-slate-800 flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <h3 className="font-bold text-sm text-slate-100">AMKE Active Prompts</h3>
          </div>
          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold">
            {prompts.length} Active
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {prompts.map((p) => {
            const isSelected = selectedKey === p.promptKey;
            return (
              <div
                key={p.promptKey}
                onClick={() => handleSelectPrompt(p.promptKey)}
                className={`p-3 rounded-xl cursor-pointer transition-all border ${
                  isSelected
                    ? 'bg-purple-950/70 border-purple-500/60 shadow-lg shadow-purple-500/10'
                    : 'bg-[#101824] hover:bg-[#162232] border-transparent hover:border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs font-bold text-purple-300">
                    {p.promptKey}
                  </span>
                  <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                    v{p.version}
                  </span>
                </div>
                <h5 className="font-bold text-xs text-slate-200">{p.name}</h5>
                <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5 leading-snug">
                  {p.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Prompt Editor */}
      <div className="flex-1 flex flex-col bg-[#0d1520] overflow-hidden">
        {currentPrompt ? (
          <div className="flex-1 flex flex-col overflow-y-auto p-4 sm:p-6 space-y-4">
            {/* Header & Meta Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-[#131d2b] border border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-base font-bold text-white">{currentPrompt.name}</h4>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    {currentPrompt.promptKey}
                  </span>
                  <span className="text-xs font-mono text-slate-400">Version {currentPrompt.version}</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">{currentPrompt.description}</p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                {saveSuccess && (
                  <span className="flex items-center gap-1 text-xs font-bold text-emerald-400 animate-in fade-in">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Saved to Database!</span>
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-lg shadow-purple-500/20 active:scale-95 transition-all disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </div>

            {/* Model Configuration Controls */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 rounded-xl bg-[#101824] border border-slate-800 text-xs">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1 flex items-center gap-1">
                  <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Provider</span>
                </label>
                <select
                  value={currentPrompt.modelProvider}
                  onChange={(e) =>
                    setCurrentPrompt({ ...currentPrompt, modelProvider: e.target.value })
                  }
                  className="w-full bg-[#090e16] text-slate-200 p-2 rounded-lg border border-slate-700 focus:outline-none focus:border-purple-500"
                >
                  <option value="OPENAI">OpenAI</option>
                  <option value="ANTHROPIC">Anthropic Claude</option>
                  <option value="LOCAL">Local Cognitive Engine</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1 flex items-center gap-1">
                  <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Model Name</span>
                </label>
                <input
                  type="text"
                  value={currentPrompt.modelName}
                  onChange={(e) =>
                    setCurrentPrompt({ ...currentPrompt, modelName: e.target.value })
                  }
                  className="w-full bg-[#090e16] text-slate-200 p-2 rounded-lg border border-slate-700 focus:outline-none focus:border-purple-500 font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1 flex items-center justify-between">
                  <span>Temperature: {currentPrompt.temperature}</span>
                  <span className="text-[10px] text-slate-500">Precise &rarr; Creative</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={currentPrompt.temperature}
                  onChange={(e) =>
                    setCurrentPrompt({
                      ...currentPrompt,
                      temperature: parseFloat(e.target.value),
                    })
                  }
                  className="w-full mt-2 accent-purple-500"
                />
              </div>
            </div>

            {/* System Prompt Textarea */}
            <div className="space-y-1.5 flex-1 flex flex-col">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Code2 className="w-4 h-4 text-purple-400" />
                  <span>System Prompt Instructions</span>
                </label>
                <span className="text-[10px] text-slate-500">Live prompt template executed on pipeline runs</span>
              </div>
              <textarea
                value={currentPrompt.systemPrompt}
                onChange={(e) =>
                  setCurrentPrompt({ ...currentPrompt, systemPrompt: e.target.value })
                }
                rows={12}
                className="w-full flex-1 p-3.5 rounded-xl bg-[#090e16] border border-slate-700 text-slate-100 font-mono text-xs focus:outline-none focus:border-purple-500 leading-relaxed shadow-inner"
              />
            </div>

            {/* User Template Textarea */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>User Message Template (with variables)</span>
              </label>
              <textarea
                value={currentPrompt.userTemplate}
                onChange={(e) =>
                  setCurrentPrompt({ ...currentPrompt, userTemplate: e.target.value })
                }
                rows={3}
                className="w-full p-3 rounded-xl bg-[#090e16] border border-slate-700 text-purple-200 font-mono text-xs focus:outline-none focus:border-purple-500 leading-relaxed"
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">
            Select a prompt template from the left sidebar to edit.
          </div>
        )}
      </div>
    </div>
  );
}
