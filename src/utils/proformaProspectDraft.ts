/**
 * Brouillon proforma mémorisé sur la fiche prospect.
 * Stocké dans `notes` derrière un marqueur (compatible règles Firestore actuelles)
 * et, si présent, aussi dans le champ dédié `proformaDraft`.
 */

export const PROFORMA_DRAFT_MARKER = '[[YAMEHOME_PROFORMA_DRAFT]]';

export interface ProformaProspectDraft {
  isCustomRate?: boolean;
  customLodgingTotal?: number;
  isNegotiatedRate?: boolean;
  negotiatedPricePerNight?: number;
  electricityCharge?: boolean;
  packEco?: boolean;
  packConfort?: boolean;
  hosts?: string[];
  /** Signature du gérant qui émet le reçu (ex. CHRISTIAN, PAOLA). */
  signature?: string;
  observations?: string;
  agentName?: string;
  receiptId?: string;
}

export function stripProformaDraftFromNotes(notes: string | undefined | null): {
  cleanNotes: string;
  draft: ProformaProspectDraft | null;
} {
  const raw = String(notes || '');
  const idx = raw.indexOf(PROFORMA_DRAFT_MARKER);
  if (idx === -1) {
    return { cleanNotes: raw, draft: null };
  }
  const cleanNotes = raw.slice(0, idx).replace(/\s+$/, '');
  const jsonPart = raw.slice(idx + PROFORMA_DRAFT_MARKER.length).trim();
  try {
    const parsed = JSON.parse(jsonPart) as ProformaProspectDraft;
    return { cleanNotes, draft: parsed && typeof parsed === 'object' ? parsed : null };
  } catch {
    return { cleanNotes, draft: null };
  }
}

export function embedProformaDraftInNotes(
  cleanNotes: string,
  draft: ProformaProspectDraft
): string {
  const base = String(cleanNotes || '').replace(/\s+$/, '');
  const payload = `${PROFORMA_DRAFT_MARKER}\n${JSON.stringify(draft)}`;
  return base ? `${base}\n\n${payload}` : payload;
}

export function parseProformaDraftJson(
  value: string | ProformaProspectDraft | undefined | null
): ProformaProspectDraft | null {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value) as ProformaProspectDraft;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
