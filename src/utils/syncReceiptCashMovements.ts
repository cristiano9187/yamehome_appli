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

function normalizeMovementDate(raw: string | undefined, fallbackIso: string): string {
  if (raw && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(raw)) return raw;
  return fallbackIso.slice(0, 10);
}

/** Caisse auto : reçus dont tous les segments sont à Yaoundé (pas Bangangté / Régine). */
function isYaoundeReceipt(receipt: ReceiptData): boolean {
  const segments = getReceiptSegments(receipt);
  if (segments.length === 0) {
    return getLocationForApartment(receipt.apartmentName) === 'Yaoundé';
  }
  return segments.every((s) => getLocationForApartment(s.apartmentName) === 'Yaoundé');
}

export type SyncReceiptCashResult = {
  ok: boolean;
  /** Versements ignorés (moyen de paiement non mappé ou montant nul). */
  skippedPayments: { paymentId: string; method: string; amount: number; reason: string }[];
  /** Mouvements créés ou mis à jour. */
  syncedCount: number;
  error?: string;
};

/**
 * Alimente / met à jour / annule les mouvements auto liés aux versements d'un reçu Yaoundé.
 * Idempotent : doc id stable par (receiptId, paymentId).
 */
export async function syncReceiptCashMovements(
  receipt: ReceiptData,
  authorUid: string,
  authorName?: string | null
): Promise<SyncReceiptCashResult> {
  const skippedPayments: SyncReceiptCashResult['skippedPayments'] = [];
  const receiptId = receipt.receiptId;
  if (!receiptId || !authorUid) {
    return { ok: true, skippedPayments, syncedCount: 0 };
  }

  const yaoundeOnly = isYaoundeReceipt(receipt);
  if (!yaoundeOnly) {
    return { ok: true, skippedPayments, syncedCount: 0 };
  }

  const isCancelled = receipt.status === 'ANNULE';
  const now = new Date().toISOString();
  const payments = receipt.payments || [];
  const activePaymentIds = new Set(payments.map((p) => p.id));

  let existingSnap;
  try {
    existingSnap = await getDocs(
      query(
        collection(db, 'cash_movements'),
        where('receiptId', '==', receiptId),
        where('source', '==', 'receipt')
      )
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('Sync caisse reçu — lecture mouvements:', e);
    return {
      ok: false,
      skippedPayments,
      syncedCount: 0,
      error: message,
    };
  }

  const batch = writeBatch(db);
  let syncedCount = 0;

  for (const d of existingSnap.docs) {
    const m = d.data() as CashMovement;
    const shouldVoid =
      isCancelled || (m.paymentId != null && !activePaymentIds.has(m.paymentId));
    if (shouldVoid && !m.voided) {
      batch.update(d.ref, { voided: true, voidedAt: now, updatedAt: now });
    }
  }

  if (!isCancelled) {
    for (const p of payments) {
      const amount = Number(p.amount) || 0;
      const caisseId = paymentMethodToCaisseId(p.method);
      const id = receiptPaymentMovementId(receiptId, p.id);

      if (amount <= 0) {
        skippedPayments.push({
          paymentId: p.id,
          method: p.method || '',
          amount,
          reason: 'montant nul',
        });
        const existing = existingSnap.docs.find((x) => x.id === id);
        if (existing && !existing.data().voided) {
          batch.update(existing.ref, { voided: true, voidedAt: now, updatedAt: now });
        }
        continue;
      }

      if (!caisseId) {
        skippedPayments.push({
          paymentId: p.id,
          method: p.method || '',
          amount,
          reason: 'moyen de paiement non reconnu pour la caisse',
        });
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
        date: normalizeMovementDate(p.date, now),
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
      syncedCount += 1;
    }
  }

  try {
    await batch.commit();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('Sync caisse reçu — écriture mouvements:', e);
    return {
      ok: false,
      skippedPayments,
      syncedCount: 0,
      error: message,
    };
  }

  return { ok: true, skippedPayments, syncedCount };
}
