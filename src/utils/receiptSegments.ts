import { getRateForApartment } from '../constants';
import type { ReceiptData, ReceiptStaySegment } from '../types';

/** Identifiant réservé au segment implicite lorsqu’aucun `staySegments` n’est stocké. */
export const LEGACY_SINGLE_SEGMENT_ID = 'default';

export function newStaySegmentId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `seg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Nombre de nuitées (exclusive du jour de départ, comme l’historique formulaire). */
export function countNightsBetweenExclusiveEnd(startStr: string, endStr: string): number {
  if (!startStr || !endStr || startStr >= endStr) return 0;
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (Number.isNaN(+start) || Number.isNaN(+end)) return 0;
  const diffMs = end.getTime() - start.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 3600 * 24)));
}

/**
 * Liste des plages unité/dates pour ce reçu — toujours au moins une entrée.
 * Reçus sans `staySegments` : un seul segment aligné sur les champs legacy.
 */
export function getReceiptSegments(receipt: ReceiptData): ReceiptStaySegment[] {
  const list = receipt.staySegments?.filter(
    (s) => s?.calendarSlug?.trim() && s.startDate && s.endDate && s.apartmentName?.trim()
  );
  if (list && list.length > 0) {
    return list.map((s) => ({
      ...s,
      id: s.id?.trim() ? s.id.trim() : `${LEGACY_SINGLE_SEGMENT_ID}-${s.calendarSlug}`,
    }));
  }
  return [
    {
      id: LEGACY_SINGLE_SEGMENT_ID,
      calendarSlug: receipt.calendarSlug,
      apartmentName: receipt.apartmentName,
      startDate: receipt.startDate,
      endDate: receipt.endDate,
      lodgingAllocated: receipt.isCustomRate && receipt.customLodgingTotal > 0 ? receipt.customLodgingTotal : null,
    },
  ];
}

/** Nuits cumulées de tous les segments (reçu multi ou simple). */
export function totalNightsAcrossReceipt(receipt: ReceiptData): number {
  return getReceiptSegments(receipt).reduce(
    (sum, s) => sum + countNightsBetweenExclusiveEnd(s.startDate, s.endDate),
    0
  );
}

export function aggregateDateSpanFromSegments(segments: ReceiptStaySegment[]): {
  startDate: string;
  endDate: string;
} {
  if (!segments.length) return { startDate: '', endDate: '' };
  let minS = segments[0].startDate;
  let maxE = segments[0].endDate;
  for (const s of segments) {
    if (s.startDate < minS) minS = s.startDate;
    if (s.endDate > maxE) maxE = s.endDate;
  }
  return { startDate: minS, endDate: maxE };
}

/** Segment le plus hâtif (pour tarif barème réf., hôtes, etc.). */
export function primarySegmentChronologically(segments: ReceiptStaySegment[]): ReceiptStaySegment {
  return [...segments].sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
}

/**
 * Champ « récap » aligné sur Firebase / index (archive, filtres): plage globale + 1re unité comme référence.
 */
export function synthesizePersistedReceiptSummary(formData: ReceiptData): Partial<ReceiptData> {
  if (!formData.staySegments?.length) {
    return {
      apartmentName: formData.apartmentName,
      calendarSlug: formData.calendarSlug,
      startDate: formData.startDate,
      endDate: formData.endDate,
    };
  }
  const segs = getReceiptSegments({ ...formData, staySegments: formData.staySegments });
  const span = aggregateDateSpanFromSegments(segs);
  const primary = primarySegmentChronologically(segs);
  return {
    apartmentName: primary.apartmentName,
    calendarSlug: primary.calendarSlug,
    startDate: span.startDate,
    endDate: span.endDate,
  };
}

/** Caution indicative = somme des cautions barémiques par segment (modifiable via totaux ensuite si besoin). */
export function sumCautionsForSegments(formData: ReceiptData): number {
  return getReceiptSegments(formData).reduce((acc, seg) => {
    const nights = countNightsBetweenExclusiveEnd(seg.startDate, seg.endDate);
    if (!seg.apartmentName || nights <= 0) return acc;
    return acc + getRateForApartment(seg.apartmentName, nights).caution;
  }, 0);
}

/**
 * Détecte une réservation VALIDE incompatible (même `calendarSlug`, chevauchement de dates),
 * même si l’autre reçu est multi-segments.
 */
export function findBookingConflictAcrossSegments(
  currentDocFirestoreId: string,
  currentReceiptId: string,
  candidateSegments: ReceiptStaySegment[],
  allReceipts: ReceiptData[]
): ReceiptData | null {
  for (const booking of allReceipts) {
    if (booking.status === 'ANNULE') continue;
    if (booking.id === currentDocFirestoreId || booking.receiptId === currentReceiptId) continue;
    const theirs = getReceiptSegments(booking);
    for (const a of candidateSegments) {
      for (const b of theirs) {
        if (a.calendarSlug !== b.calendarSlug) continue;
        if (!a.startDate || !a.endDate || !b.startDate || !b.endDate) continue;
        if (a.startDate < b.endDate && a.endDate > b.startDate) {
          return booking;
        }
      }
    }
  }
  return null;
}

/** Vrai si `public_calendar`/Firestore représente plusieurs plages réservées. */
export function receiptHasMultipleSegments(receipt: ReceiptData): boolean {
  return !!(receipt.staySegments && receipt.staySegments.length > 1);
}
