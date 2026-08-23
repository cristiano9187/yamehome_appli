import { ClientProfile, ClientProfileSeed, Prospect, ReceiptData } from '../types';
import { parseApartment } from './aptDisplay';

export type ContactLike = { firstName?: string; lastName?: string; phone?: string; email?: string };

/** Fiche fusionnée : clients + reçus + prospects désignant la même personne. */
export interface MergedClient extends ClientProfile {
  _key: string;
  _variants: ClientProfileSeed[];
  _clientDocIds: string[];
  /** Jamais réservé — connu seulement via prospect(s). */
  _isProspectOnly: boolean;
  /** Dernier intérêt prospect (affiché sur fiche P uniquement). */
  _interestedApartment: string | null;
  _interestedStartDate: string | null;
  _interestedEndDate: string | null;
  /** Dernier prospect connu — utile pour pré-remplir un nouveau dossier. */
  _lastProspectApartment: string | null;
  _lastProspectStartDate: string | null;
  _lastProspectEndDate: string | null;
}

export const normalizeContactString = (value: string) =>
  (value || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Compare sur les 9 derniers chiffres : tolère +237 / 00237 / espaces. */
export function normalizePhoneDigits(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length < 8) return '';
  return digits.slice(-9);
}

export function normalizeFullName(firstName?: string, lastName?: string): string {
  return normalizeContactString(`${firstName || ''} ${lastName || ''}`);
}

/** Deux identités = même personne si email, téléphone ou nom complet coïncident. */
export function sameContact(a: ContactLike, b: ContactLike): boolean {
  const emailA = normalizeContactString(a.email || '');
  const emailB = normalizeContactString(b.email || '');
  if (emailA && emailA.includes('@') && emailA === emailB) return true;
  const phoneA = normalizePhoneDigits(a.phone || '');
  const phoneB = normalizePhoneDigits(b.phone || '');
  if (phoneA && phoneA === phoneB) return true;
  const nameA = normalizeFullName(a.firstName, a.lastName);
  const nameB = normalizeFullName(b.firstName, b.lastName);
  if (nameA && nameA.includes(' ') && nameA === nameB) return true;
  return false;
}

export function identityKeyOf(c: ContactLike): string {
  return normalizeContactString(`${c.firstName || ''}|${c.lastName || ''}|${c.phone || ''}|${c.email || ''}`);
}

export function formatDateFr(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return iso;
  return d.toLocaleDateString('fr-FR');
}

/** Libellé court « RIETI — Emeraude studio » à partir du nom TARIFS. */
export function formatInterestedByLabel(apartmentName: string): string {
  let cleaned = (apartmentName || '')
    .replace(/\bYAMEHOME\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  cleaned = cleaned
    .replace(/[\s\-–—]*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}([\s\-–—]+\d{1,2}[./-]\d{1,2}[./-]\d{2,4})?\s*$/g, '')
    .trim();
  const apt = parseApartment(cleaned || apartmentName);
  let unit = (apt.unit || '')
    .replace(/\bAPPARTEMENT\b/gi, '')
    .replace(/\bMODE\b/gi, '')
    .replace(/\s*[-–—]\s*/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
  if (unit) {
    unit = unit.toLowerCase().replace(/(^|[ ·])(\S)/g, (_, sep, ch) => sep + ch.toUpperCase());
  }
  if (unit && unit !== apt.site) return `${apt.site} — ${unit}`;
  return apt.site || cleaned || apartmentName;
}

export function formatInterestedDatesCompact(
  startDate?: string | null,
  endDate?: string | null
): string | null {
  if (!startDate && !endDate) return null;
  if (!startDate || !endDate) return formatDateFr(startDate || endDate || '');
  const [ys, ms, ds] = startDate.split('-').map(Number);
  const [ye, me, de] = endDate.split('-').map(Number);
  if (ys && ms && ds && ye && me && de && ys === ye && ms === me) {
    return `${String(ds).padStart(2, '0')}–${String(de).padStart(2, '0')}/${String(ms).padStart(2, '0')}/${ys}`;
  }
  return `${formatDateFr(startDate)} → ${formatDateFr(endDate)}`;
}

/**
 * Regroupe fiches `clients` + reçus + tous les prospects par personne réelle.
 */
export function buildMergedDirectory(
  clients: ClientProfile[],
  receipts: ReceiptData[],
  prospects: Prospect[]
): MergedClient[] {
  type Candidate = ContactLike & {
    createdAt: string;
    updatedAt: string;
    authorUid: string;
    preferences?: string;
    notes?: string;
    docId?: string;
    fromRealStay?: boolean;
    fromProspect?: boolean;
    apartmentName?: string;
    startDate?: string;
    endDate?: string;
  };

  const candidates: Candidate[] = [];
  clients.forEach((c) => {
    candidates.push({
      firstName: c.firstName || '',
      lastName: c.lastName || '',
      phone: c.phone || '',
      email: c.email || '',
      createdAt: c.createdAt || new Date().toISOString(),
      updatedAt: c.updatedAt || c.createdAt || new Date().toISOString(),
      authorUid: c.authorUid || '',
      preferences: c.preferences,
      notes: c.notes,
      docId: c.id,
    });
  });
  receipts.forEach((r) => {
    if (!r.lastName?.trim()) return;
    candidates.push({
      firstName: r.firstName || '',
      lastName: r.lastName || '',
      phone: r.phone || '',
      email: r.email || '',
      createdAt: r.createdAt || new Date().toISOString(),
      updatedAt: r.createdAt || new Date().toISOString(),
      authorUid: r.authorUid || '',
      fromRealStay: true,
    });
  });
  prospects.forEach((p) => {
    if (!p.lastName?.trim()) return;
    candidates.push({
      firstName: p.firstName || '',
      lastName: p.lastName || '',
      phone: p.phone || '',
      email: p.email || '',
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
      authorUid: p.authorUid || '',
      notes: p.notes,
      fromProspect: true,
      apartmentName: (p.apartmentName || '').trim() || undefined,
      startDate: (p.startDate || '').trim() || undefined,
      endDate: (p.endDate || '').trim() || undefined,
    });
  });

  const parent = candidates.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (i: number, j: number) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  };

  const phoneBuckets = new Map<string, number[]>();
  const emailBuckets = new Map<string, number[]>();
  const nameBuckets = new Map<string, number[]>();
  candidates.forEach((c, i) => {
    const p = normalizePhoneDigits(c.phone || '');
    if (p) {
      if (!phoneBuckets.has(p)) phoneBuckets.set(p, []);
      phoneBuckets.get(p)!.push(i);
    }
    const e = normalizeContactString(c.email || '');
    if (e && e.includes('@')) {
      if (!emailBuckets.has(e)) emailBuckets.set(e, []);
      emailBuckets.get(e)!.push(i);
    }
    const n = normalizeFullName(c.firstName, c.lastName);
    if (n && n.includes(' ')) {
      if (!nameBuckets.has(n)) nameBuckets.set(n, []);
      nameBuckets.get(n)!.push(i);
    }
  });
  [phoneBuckets, emailBuckets, nameBuckets].forEach((buckets) => {
    buckets.forEach((idxs) => {
      for (let k = 1; k < idxs.length; k++) union(idxs[0], idxs[k]);
    });
  });

  const clusters = new Map<number, Candidate[]>();
  candidates.forEach((c, i) => {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(c);
  });

  const merged: MergedClient[] = [];
  clusters.forEach((group) => {
    const registered = group
      .filter((g) => g.docId)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const byRecency = group.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const base =
      registered[0] ||
      byRecency.find((g) => g.fromRealStay) ||
      byRecency.find((g) => !g.fromProspect) ||
      byRecency[0];
    const phone = base.phone || group.find((g) => g.phone)?.phone || '';
    const email = base.email || group.find((g) => g.email)?.email || '';
    const preferences = registered.find((g) => g.preferences?.trim())?.preferences;
    const notes =
      registered.find((g) => g.notes?.trim())?.notes || group.find((g) => g.notes?.trim())?.notes;
    const createdAt = group.reduce(
      (min, g) => (g.createdAt && g.createdAt < min ? g.createdAt : min),
      base.createdAt
    );
    const hasRealStay = group.some((g) => g.fromRealStay);
    const hasProspect = group.some((g) => g.fromProspect);
    const isProspectOnly = hasProspect && !hasRealStay;
    const latestProspectContext = group
      .filter((g) => g.fromProspect && (g.apartmentName || g.startDate || g.endDate))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
    const lastApartment = latestProspectContext?.apartmentName || null;
    const lastStart = latestProspectContext?.startDate || null;
    const lastEnd = latestProspectContext?.endDate || null;
    const variants: ClientProfileSeed[] = group.map((g) => ({
      firstName: g.firstName || '',
      lastName: g.lastName || '',
      phone: g.phone || '',
      email: g.email || '',
    }));
    merged.push({
      id: base.docId,
      firstName: base.firstName || '',
      lastName: base.lastName || '',
      phone,
      email,
      preferences,
      notes,
      createdAt,
      updatedAt: base.updatedAt,
      authorUid: base.authorUid || '',
      _key: identityKeyOf(base),
      _variants: variants,
      _clientDocIds: registered.map((g) => g.docId!).filter(Boolean),
      _isProspectOnly: isProspectOnly,
      _interestedApartment: isProspectOnly ? lastApartment : null,
      _interestedStartDate: isProspectOnly ? lastStart : null,
      _interestedEndDate: isProspectOnly ? lastEnd : null,
      _lastProspectApartment: lastApartment,
      _lastProspectStartDate: lastStart,
      _lastProspectEndDate: lastEnd,
    });
  });

  return merged.sort((a, b) =>
    `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'fr')
  );
}

export function filterMergedContacts(contacts: MergedClient[], search: string, max = 8): MergedClient[] {
  const term = normalizeContactString(search);
  if (term.length < 2) return [];
  return contacts
    .filter((c) => {
      const fullName = normalizeFullName(c.firstName, c.lastName);
      return (
        fullName.includes(term) ||
        normalizeContactString(c.phone || '').includes(term) ||
        normalizeContactString(c.email || '').includes(term)
      );
    })
    .slice(0, max);
}
