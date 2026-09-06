'use client';

import React, { useState } from 'react';
import { Copy, Check, Code2 } from 'lucide-react';

interface JsonPayloadViewerProps {
  title: string;
  data: any;
}

export const JsonPayloadViewer: React.FC<JsonPayloadViewerProps> = ({ title, data }) => {
  const [copied, setCopied] = useState(false);

  const jsonString = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-2xl bg-surface border border-surface-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-surface-light border-b border-surface-border text-xs">
        <div className="flex items-center space-x-1.5 font-bold text-slate-300">
          <Code2 className="w-3.5 h-3.5 text-primary-400" />
          <span>{title}</span>
        </div>

        <button
          onClick={handleCopy}
          className="flex items-center space-x-1 px-2 py-1 rounded bg-surface border border-slate-700 text-[10px] text-slate-400 hover:text-white transition-all"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      <pre className="p-3 text-[11px] font-mono text-emerald-300 bg-black/40 overflow-x-auto max-h-56">
        <code>{jsonString || '// No payload data'}</code>
      </pre>
    </div>
  );
};
