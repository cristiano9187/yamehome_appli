import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileText, Plus, UserRound } from 'lucide-react';

interface NewCreateMenuProps {
  onNewReceipt: () => void;
  onNewProspect: () => void;
  activeView: 'form' | 'prospects' | string;
}

export default function NewCreateMenu({ onNewReceipt, onNewProspect, activeView }: NewCreateMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDocClick);
    return () => document.removeEventListener('pointerdown', onDocClick);
  }, []);

  const isReceiptActive = activeView === 'form';
  const isProspectActive = activeView === 'prospects';

  return (
    <div ref={rootRef} className="relative">
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
            isReceiptActive || isProspectActive
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
              : 'bg-slate-900 text-white shadow-lg shadow-slate-900/20 hover:bg-black'
          }`}
        >
          <Plus size={16} />
          Nouveau
          <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          <button
            type="button"
            onClick={() => {
              onNewReceipt();
              setOpen(false);
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-gray-700 hover:bg-blue-50 transition-all"
          >
            <FileText size={15} className="text-blue-600 shrink-0" />
            Reçu
          </button>
          <button
            type="button"
            onClick={() => {
              onNewProspect();
              setOpen(false);
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-gray-700 hover:bg-violet-50 border-t border-gray-100 transition-all"
          >
            <UserRound size={15} className="text-violet-600 shrink-0" />
            Prospect
          </button>
        </div>
      )}
    </div>
  );
}
