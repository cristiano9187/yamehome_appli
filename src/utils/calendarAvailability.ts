import type { BlockedDate, ReceiptData, ReceiptStaySegment } from '../types';
import { getReceiptSegments } from './receiptSegments';

/**
 * Séjour half-open [startDate, endDate) : la nuit `date` (YYYY-MM-DD) est occupée
 * si startDate <= date < endDate.
 */
export function stayOccupiesDate(startDate: string, endDate: string, date: string): boolean {
  return !!startDate && !!endDate && !!date && date >= startDate && date < endDate;
}

/** Première date bloquée qui coupe le séjour sur ce calendarSlug. */
export function findBlockedDateInStay(
  blockedDates: BlockedDate[],
  calendarSlug: string,
  startDate: string,
  endDate: string
): BlockedDate | undefined {
  return blockedDates.find(
    (bd) =>
      bd.calendarSlug === calendarSlug &&
      stayOccupiesDate(startDate, endDate, bd.date)
  );
}

/** Toutes les dates bloquées qui chevauchent le séjour. */
export function listBlockedDatesInStay(
  blockedDates: BlockedDate[],
  calendarSlug: string,
  startDate: string,
  endDate: string
): BlockedDate[] {
  return blockedDates.filter(
    (bd) =>
      bd.calendarSlug === calendarSlug &&
      stayOccupiesDate(startDate, endDate, bd.date)
  );
}

/**
 * Réservation VALIDE qui occupe déjà cette nuit (même unité).
 * excludeReceiptId / excludeDocId : ignorer le reçu en cours d'édition.
 */
export function findActiveBookingOccupyingDate(
  receipts: ReceiptData[],
  calendarSlug: string,
  date: string,
  opts?: { excludeDocId?: string; excludeReceiptId?: string }
): ReceiptData | null {
  for (const booking of receipts) {
    if (booking.status === 'ANNULE') continue;
    if (opts?.excludeDocId && booking.id === opts.excludeDocId) continue;
    if (opts?.excludeReceiptId && booking.receiptId === opts.excludeReceiptId) continue;
    for (const seg of getReceiptSegments(booking)) {
      if (seg.calendarSlug !== calendarSlug) continue;
      if (stayOccupiesDate(seg.startDate, seg.endDate, date)) {
        return booking;
      }
    }
  }
  return null;
}

export function findBlockedDateInSegments(
  blockedDates: BlockedDate[],
  segments: ReceiptStaySegment[]
): { blocked: BlockedDate; segment: ReceiptStaySegment } | null {
  for (const s of segments) {
    const blocked = findBlockedDateInStay(
      blockedDates,
      s.calendarSlug,
      s.startDate,
      s.endDate
    );
    if (blocked) return { blocked, segment: s };
  }
  return null;
}
