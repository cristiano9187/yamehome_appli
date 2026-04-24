import React from 'react';
import { Phone, MessageCircle } from 'lucide-react';

// ── Apartment badge helpers ─────────────────────────────────────────────────

export const APT_SITE_CONFIG: Record<string, { bg: string; text: string; ring: string }> = {
  MODENA:     { bg: 'bg-violet-100', text: 'text-violet-800', ring: 'ring-violet-200' },
  MATERA:     { bg: 'bg-sky-100',    text: 'text-sky-800',    ring: 'ring-sky-200' },
  RIETI:      { bg: 'bg-teal-100',   text: 'text-teal-800',   ring: 'ring-teal-200' },
  GALLAGHERS: { bg: 'bg-amber-100',  text: 'text-amber-800',  ring: 'ring-amber-200' },
};

export function parseApartment(name: string) {
  const siteKey = Object.keys(APT_SITE_CONFIG).find((k) =>
    (name || '').toUpperCase().startsWith(k)
  );
  const cfg = siteKey
    ? APT_SITE_CONFIG[siteKey]
    : { bg: 'bg-gray-100', text: 'text-gray-700', ring: 'ring-gray-200' };
  const site = siteKey ?? (name || '').split(' ')[0];
  const dashIdx = (name || '').indexOf(' - ');
  let unit = dashIdx >= 0 ? name.slice(dashIdx + 3) : name || '';
  unit = unit.replace(/^APPARTEMENT\s+/i, '').replace(/\s+mode\s+/i, ' · ');
  return { site, unit, ...cfg };
}

export function AptBadge({ name }: { name: string }) {
  const apt = parseApartment(name);
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest ring-1 w-fit ${apt.bg} ${apt.text} ${apt.ring}`}
      >
        {apt.site}
      </span>
      <span className="text-[10px] font-bold text-gray-700 leading-tight">{apt.unit}</span>
    </div>
  );
}

// ── Phone helpers ───────────────────────────────────────────────────────────

export function normalizePhone(raw: string): { tel: string; wa: string } {
  if (!raw) return { tel: '', wa: '' };
  const digits = raw.replace(/[\s\-\.\(\)]/g, '');
  let international = digits;
  if (digits.startsWith('00')) international = '+' + digits.slice(2);
  else if (digits.startsWith('237') && !digits.startsWith('+')) international = '+' + digits;
  else if (!digits.startsWith('+')) international = '+237' + digits;
  const waDigits = international.replace(/[^\d]/g, '');
  return { tel: international, wa: waDigits };
}

export function PhoneLinks({ phone, size = 'sm' }: { phone: string; size?: 'xs' | 'sm' }) {
  const { tel, wa } = normalizePhone(phone);
  const textSize = size === 'xs' ? 'text-[9px]' : 'text-[10px]';
  const iconSize = size === 'xs' ? 9 : 10;
  return (
    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
      <a
        href={`tel:${tel}`}
        className={`inline-flex items-center gap-0.5 ${textSize} font-bold text-slate-700 hover:text-slate-900 transition-colors`}
      >
        <Phone size={iconSize} />
        {phone}
      </a>
      <a
        href={`https://wa.me/${wa}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-green-50 text-green-700 hover:bg-green-100 rounded text-[9px] font-black transition-colors"
      >
        <MessageCircle size={iconSize - 1} />
        WA
      </a>
    </div>
  );
}
