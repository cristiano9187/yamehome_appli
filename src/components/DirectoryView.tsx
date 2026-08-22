import React, { useState } from 'react';
import { Menu, BookUser, Wrench, Shield } from 'lucide-react';
import { UserProfile } from '../types';
import TechnicianContactsView from './TechnicianContactsView';
import SiteContactsView from './SiteContactsView';

interface DirectoryViewProps {
  userProfile: UserProfile | null;
  onMenuClick?: () => void;
  onAlert: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type DirectoryTab = 'technicians' | 'site';

export default function DirectoryView({
  userProfile,
  onMenuClick,
  onAlert,
}: DirectoryViewProps) {
  const [tab, setTab] = useState<DirectoryTab>('technicians');

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 pb-24">
      <div className="mb-6 flex items-center gap-3">
        {onMenuClick && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMenuClick();
            }}
            className="md:hidden p-2 hover:bg-gray-100 rounded-xl transition-all"
          >
            <Menu size={20} />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-slate-800">
            <BookUser size={20} className="text-orange-600 shrink-0" />
            <h1 className="text-lg font-black uppercase tracking-tight truncate">Annuaire</h1>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Techniciens urgences & contacts sur site
          </p>
        </div>
      </div>

      <div className="flex gap-2 mb-6 p-1 bg-gray-100 rounded-xl">
        <button
          type="button"
          onClick={() => setTab('technicians')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
            tab === 'technicians'
              ? 'bg-white text-orange-700 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Wrench size={14} />
          Techniciens
        </button>
        <button
          type="button"
          onClick={() => setTab('site')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
            tab === 'site'
              ? 'bg-white text-emerald-700 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Shield size={14} />
          Sur site
        </button>
      </div>

      {tab === 'technicians' ? (
        <TechnicianContactsView
          userProfile={userProfile}
          onAlert={onAlert}
          embedded
        />
      ) : (
        <SiteContactsView
          userProfile={userProfile}
          onAlert={onAlert}
          embedded
        />
      )}
    </div>
  );
}
