import { TARIFS } from '../constants';
import type { Prospect } from '../types';

/** Slug calendrier exploitable pour une ligne du planning (unité explicite ou implicite si une seule unité). */
export function resolveProspectUnitSlug(p: Prospect): string | null {
  const slug = (p.calendarSlug || '').trim();
  if (slug) return slug;
  const apt = p.apartmentName || '';
  const units = apt ? TARIFS[apt]?.units || [] : [];
  if (units.length === 1) return units[0]!;
  return null;
}

/** Convention identique aux réservations : nuit `dateStr` incluse si start <= d < end. */
export function prospectNightCoversDate(p: Prospect, dateStr: string): boolean {
  const start = (p.startDate || '').trim();
  const end = (p.endDate || '').trim();
  if (!start || !end) return false;
  return dateStr >= start && dateStr < end;
}

export function prospectTouchesMonth(p: Prospect, monthFirstYmd: string, monthLastYmd: string): boolean {
  const start = (p.startDate || '').trim();
  const end = (p.endDate || '').trim();
  if (!start || !end) return false;
  return start <= monthLastYmd && end > monthFirstYmd;
}

/** Première clé TARIFS dont `units` contient ce slug. */
export function apartmentNameForUnitSlug(unitSlug: string): string {
  for (const name of Object.keys(TARIFS)) {
    const units = TARIFS[name]?.units || [];
    if (units.includes(unitSlug)) return name;
  }
  return '';
}

export function buildProspectsByCell(
  prospects: Prospect[],
  unitSlugs: string[],
  daysYmd: string[]
): Map<string, Prospect[]> {
  const map = new Map<string, Prospect[]>();
  const slugSet = new Set(unitSlugs);

  for (const p of prospects) {
    const slug = resolveProspectUnitSlug(p);
    if (!slug || !slugSet.has(slug)) continue;
    for (const dateStr of daysYmd) {
      if (!prospectNightCoversDate(p, dateStr)) continue;
      const key = `${slug}|${dateStr}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
  }

  for (const arr of map.values()) {
    arr.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  return map;
}

export function ymdAddDays(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
