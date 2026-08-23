import React, { useMemo } from 'react';
import { Search } from 'lucide-react';
import { ClientProfileSeed } from '../types';
import { filterMergedContacts, MergedClient } from '../utils/contactDirectory';
import ContactInterestLine from './ContactInterestLine';

interface ContactPickerProps {
  label?: string;
  placeholder?: string;
  search: string;
  onSearchChange: (value: string) => void;
  contacts: MergedClient[];
  onSelect: (contact: MergedClient) => void;
  onOpenProfile?: (seed: ClientProfileSeed) => void;
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

export default function ContactPicker({
  label = 'Contact intelligent',
  placeholder = 'Nom, téléphone ou email…',
  search,
  onSearchChange,
  contacts,
  onSelect,
  onOpenProfile,
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
        <div className="bg-white border border-gray-200 rounded-xl p-2 space-y-1 max-h-52 overflow-y-auto">
          {filtered.map((contact) => (
            <button
              key={contact._key}
              type="button"
              onClick={() => onSelect(contact)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-blue-50 transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <div className="text-[11px] font-black text-gray-800 uppercase truncate">
                      {contact.firstName} {contact.lastName}
                    </div>
                    <ContactBadge contact={contact} />
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
          ))}
        </div>
      )}
    </div>
  );
}
