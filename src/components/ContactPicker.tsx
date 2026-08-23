import React, { useMemo } from 'react';
import { Search } from 'lucide-react';
import { ClientProfileSeed, Prospect } from '../types';
import {
  filterMergedContacts,
  findOpenProspects,
  MergedClient,
} from '../utils/contactDirectory';
import ContactInterestLine from './ContactInterestLine';

export type ContactQuickAction = 'select' | 'receipt' | 'prospect' | 'proforma' | 'reopen';

interface ContactPickerProps {
  label?: string;
  placeholder?: string;
  search: string;
  onSearchChange: (value: string) => void;
  contacts: MergedClient[];
  onSelect: (contact: MergedClient) => void;
  onOpenProfile?: (seed: ClientProfileSeed) => void;
  onQuickAction?: (action: ContactQuickAction, contact: MergedClient) => void;
  prospects?: Prospect[];
  showQuickActions?: boolean;
  maxResults?: number;
  showProfileLink?: boolean;
}

function ContactBadge({ contact }: { contact: MergedClient }) {
  if (contact._isProspectOnly) {
    return (
      <span className="shrink-0 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">
        P
      </span>
    );
  }
  if (contact._clientDocIds.length > 0 || !contact._isProspectOnly) {
    return (
      <span className="shrink-0 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
        Client
      </span>
    );
  }
  return null;
}

function QuickActionChip({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: 'blue' | 'violet' | 'amber' | 'slate';
  onClick: (e: React.MouseEvent) => void;
}) {
  const tones = {
    blue: 'bg-blue-50 text-blue-700 hover:bg-blue-100',
    violet: 'bg-violet-50 text-violet-700 hover:bg-violet-100',
    amber: 'bg-amber-50 text-amber-800 hover:bg-amber-100',
    slate: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest transition-all ${tones[tone]}`}
    >
      {label}
    </button>
  );
}

export default function ContactPicker({
  label = 'Contact intelligent',
  placeholder = 'Nom, téléphone ou email…',
  search,
  onSearchChange,
  contacts,
  onSelect,
  onOpenProfile,
  onQuickAction,
  prospects = [],
  showQuickActions = false,
  maxResults = 8,
  showProfileLink = true,
}: ContactPickerProps) {
  const filtered = useMemo(
    () => filterMergedContacts(contacts, search, maxResults),
    [contacts, search, maxResults]
  );

  const handlePickFirst = () => {
    if (filtered.length > 0) onSelect(filtered[0]);
  };

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</label>
      <div className="flex gap-2 relative">
        <input
          type="text"
          placeholder={placeholder}
          className="flex-1 bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handlePickFirst();
            }
          }}
        />
        <button
          type="button"
          onClick={handlePickFirst}
          className="bg-[#141414] text-white p-3 rounded-xl hover:bg-gray-800 transition-all"
          aria-label="Sélectionner le premier résultat"
        >
          <Search size={16} />
        </button>
      </div>
      {filtered.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-2 space-y-1 max-h-64 overflow-y-auto">
          {filtered.map((contact) => {
            const openProspects = showQuickActions ? findOpenProspects(contact, prospects) : [];
            const hasOpen = openProspects.length > 0;
            return (
              <div
                key={contact._key}
                className="rounded-lg hover:bg-blue-50/80 transition-all px-3 py-2"
              >
                <button
                  type="button"
                  onClick={() => onSelect(contact)}
                  className="w-full text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <div className="text-[11px] font-black text-gray-800 uppercase truncate">
                          {contact.firstName} {contact.lastName}
                        </div>
                        <ContactBadge contact={contact} />
                        {hasOpen && (
                          <span className="shrink-0 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                            Ouvert
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-500 truncate">
                        {contact.phone || '-'} | {contact.email || '-'}
                      </div>
                      <ContactInterestLine
                        apartment={contact._lastProspectApartment}
                        startDate={contact._lastProspectStartDate}
                        endDate={contact._lastProspectEndDate}
                        compact
                      />
                    </div>
                    {showProfileLink && onOpenProfile && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenProfile({
                            firstName: contact.firstName || '',
                            lastName: contact.lastName || '',
                            phone: contact.phone || '',
                            email: contact.email || '',
                          });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            e.preventDefault();
                            onOpenProfile({
                              firstName: contact.firstName || '',
                              lastName: contact.lastName || '',
                              phone: contact.phone || '',
                              email: contact.email || '',
                            });
                          }
                        }}
                        className="shrink-0 text-[9px] font-black uppercase tracking-widest text-blue-600 hover:text-blue-800 px-1 pt-0.5"
                        title="Voir la fiche complète"
                      >
                        Fiche →
                      </span>
                    )}
                  </div>
                </button>
                {showQuickActions && onQuickAction && (
                  <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-100">
                    <QuickActionChip
                      label="Reçu"
                      tone="blue"
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickAction('receipt', contact);
                      }}
                    />
                    <QuickActionChip
                      label="Prospect"
                      tone="violet"
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickAction('prospect', contact);
                      }}
                    />
                    <QuickActionChip
                      label="Proforma"
                      tone="amber"
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickAction('proforma', contact);
                      }}
                    />
                    {hasOpen && (
                      <QuickActionChip
                        label="Rouvrir"
                        tone="slate"
                        onClick={(e) => {
                          e.stopPropagation();
                          onQuickAction('reopen', contact);
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
