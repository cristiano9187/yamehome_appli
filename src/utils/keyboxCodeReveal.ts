import type { ClientProfile, ReceiptData, ReceiptStaySegment } from '../types';
import { normalizePhoneDigits } from './contactDirectory';
import { getReceiptSegments } from './receiptSegments';
import { todayYmdCameroon } from './cameroonTime';

export type KeyboxRevealStayOption = {
  key: string;
  receiptDocId: string;
  receiptId: string;
  segment: ReceiptStaySegment;
  clientName: string;
  clientPhone: string;
  apartmentName: string;
  startDate: string;
  endDate: string;
};

/** Séjour actif aujourd’hui (arrivée ≤ today ≤ départ) — y compris arrivées du jour. */
export function segmentCoversToday(seg: ReceiptStaySegment, todayYmd: string = todayYmdCameroon()): boolean {
  if (!seg.startDate || !seg.endDate) return false;
  return seg.startDate <= todayYmd && seg.endDate >= todayYmd;
}

export function listRevealStaysForUnitSlug(
  receipts: ReceiptData[],
  unitSlug: string,
  todayYmd: string = todayYmdCameroon()
): KeyboxRevealStayOption[] {
  const slug = (unitSlug || '').trim();
  if (!slug) return [];
  const out: KeyboxRevealStayOption[] = [];
  for (const r of receipts) {
    if (r.status === 'ANNULE' || !r.id) continue;
    for (const seg of getReceiptSegments(r)) {
      if (seg.calendarSlug !== slug) continue;
      if (!segmentCoversToday(seg, todayYmd)) continue;
      const clientName = `${(r.firstName || '').trim()} ${(r.lastName || '').trim()}`.trim() || '—';
      out.push({
        key: `${r.id}|${seg.id}`,
        receiptDocId: r.id,
        receiptId: r.receiptId || r.id,
        segment: seg,
        clientName,
        clientPhone: (r.phone || '').trim(),
        apartmentName: seg.apartmentName || r.apartmentName || slug,
        startDate: seg.startDate,
        endDate: seg.endDate,
      });
    }
  }
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.clientName.localeCompare(b.clientName, 'fr'));
}

export function findClientWithIdDoc(
  clients: ClientProfile[],
  phone: string,
  firstName?: string,
  lastName?: string
): ClientProfile | null {
  const digits = normalizePhoneDigits(phone || '');
  const fn = (firstName || '').trim().toLowerCase();
  const ln = (lastName || '').trim().toLowerCase();
  const matches = clients.filter((c) => {
    if (digits && normalizePhoneDigits(c.phone || '') === digits) return true;
    if (fn && ln) {
      return (c.firstName || '').trim().toLowerCase() === fn && (c.lastName || '').trim().toLowerCase() === ln;
    }
    return false;
  });
  const withDoc = matches.find((c) => Boolean(c.idDocument?.downloadUrl));
  return withDoc || matches[0] || null;
}
