import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { CashMovement, ReceiptData } from '../types';
import { getLocationForApartment, paymentMethodToCaisseId } from '../constants';
import { getReceiptSegments } from './receiptSegments';

function receiptPaymentMovementId(receiptId: string, paymentId: string): string {
  const safe = `${receiptId}__${paymentId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return `rcp_${safe}`;
}

/** Caisse auto : reçus dont tous les segments sont à Yaoundé (pas Bangangté / Régine). */
function isYaoundeReceipt(receipt: ReceiptData): boolean {
  const segments = getReceiptSegments(receipt);
  if (segments.length === 0) {
    return getLocationForApartment(receipt.apartmentName) === 'Yaoundé';
  }
  return segments.every((s) => getLocationForApartment(s.apartmentName) === 'Yaoundé');
}

/**
 * Alimente / met à jour / annule les mouvements auto liés aux versements d'un reçu Yaoundé.
 * Idempotent : doc id stable par (receiptId, paymentId).
 */
export async function syncReceiptCashMovements(
  receipt: ReceiptData,
  authorUid: string,
  authorName?: string | null
): Promise<void> {
  const receiptId = receipt.receiptId;
  if (!receiptId || !authorUid) return;

  const yaoundeOnly = isYaoundeReceipt(receipt);
  const isCancelled = receipt.status === 'ANNULE' || !yaoundeOnly;
  const now = new Date().toISOString();
  const payments = receipt.payments || [];
  const activePaymentIds = new Set(payments.map((p) => p.id));

  const existingSnap = await getDocs(
    query(collection(db, 'cash_movements'), where('receiptId', '==', receiptId))
  );

  const batch = writeBatch(db);

  for (const d of existingSnap.docs) {
    const m = d.data() as CashMovement;
    const shouldVoid =
      isCancelled || (m.paymentId != null && !activePaymentIds.has(m.paymentId));
    if (shouldVoid && !m.voided) {
      batch.update(d.ref, { voided: true, voidedAt: now, updatedAt: now });
    }
  }

  if (!isCancelled && yaoundeOnly) {
    for (const p of payments) {
      const amount = Number(p.amount) || 0;
      const caisseId = paymentMethodToCaisseId(p.method);
      const id = receiptPaymentMovementId(receiptId, p.id);

      if (amount <= 0 || !caisseId) {
        const existing = existingSnap.docs.find((x) => x.id === id);
        if (existing && !existing.data().voided) {
          batch.update(existing.ref, { voided: true, voidedAt: now, updatedAt: now });
        }
        continue;
      }

      const clientName = `${receipt.firstName || ''} ${receipt.lastName || ''}`.trim();
      const motif = `Reçu ${receiptId}${clientName ? ` — ${clientName}` : ''}`;

      const existing = existingSnap.docs.find((x) => x.id === id);
      const createdAt = (existing?.data()?.createdAt as string) || now;

      const movement: CashMovement = {
        caisseId,
        kind: 'deposit',
        amount,
        motif,
        date: p.date || now.slice(0, 10),
        source: 'receipt',
        receiptId,
        paymentId: p.id,
        paymentMethod: p.method,
        authorUid,
        authorName: authorName || undefined,
        createdAt,
        updatedAt: now,
        voided: false,
      };

      batch.set(doc(db, 'cash_movements', id), movement, { merge: true });
    }
  }

  await batch.commit();
}
