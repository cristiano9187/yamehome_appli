/**
 * archiveManager — fonctions d'archivage et de population initiale
 *
 * archivePastReservations()  : copie vers 'archives' les réservations VALIDE passées
 *                              et les retire de 'public_calendar'
 * populatePublicCalendar()   : alimente 'public_calendar' avec les réservations
 *                              actuelles/futures et les dates bloquées actuelles
 */

import { db } from '../firebase';
import { deleteAllReservationEventsForReceipt } from './publicCalendar';
import type { ReceiptData } from '../types';
import { getReceiptSegments } from './receiptSegments';
import {
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  doc,
  deleteDoc,
} from 'firebase/firestore';

export interface ArchiveResult {
  archived: number;
  cleaned: number;
  errors: string[];
}

export interface SyncResult {
  synced: number;
  errors: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Archiver les réservations passées (endDate < aujourd'hui, status=VALIDE)
// Les copie dans 'archives' et les retire de 'public_calendar'
// ─────────────────────────────────────────────────────────────────────────────
export async function archivePastReservations(): Promise<ArchiveResult> {
  const today = new Date().toISOString().split('T')[0];
  const result: ArchiveResult = { archived: 0, cleaned: 0, errors: [] };

  try {
    const snapshot = await getDocs(
      query(
        collection(db, 'receipts'),
        where('status', '==', 'VALIDE'),
        where('endDate', '<', today)
      )
    );

    if (snapshot.empty) return result;

    // Traitement par lots de 400 ops (limite Firestore = 500 par batch)
    const BATCH_SIZE = 400;
    let batch = writeBatch(db);
    let ops = 0;

    const archivedReceiptIds: string[] = [];

    for (const snap of snapshot.docs) {
      const data = snap.data();

      batch.set(doc(db, 'archives', snap.id), {
        ...data,
        archivedAt: new Date().toISOString(),
      });
      ops++;

      result.archived++;
      const rid = data.receiptId as string | undefined;
      if (rid) archivedReceiptIds.push(rid);

      if (ops >= BATCH_SIZE) {
        await batch.commit();
        batch = writeBatch(db);
        ops = 0;
      }
    }

    if (ops > 0) await batch.commit();

    for (const rid of archivedReceiptIds) {
      await deleteAllReservationEventsForReceipt(rid);
      result.cleaned++;
    }
  } catch (e: any) {
    result.errors.push(e?.message || String(e));
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Peupler public_calendar avec toutes les données connues
// (réservations actuelles/futures + dates bloquées actuelles/futures)
// ─────────────────────────────────────────────────────────────────────────────
export async function populatePublicCalendar(): Promise<SyncResult> {
  const today = new Date().toISOString().split('T')[0];
  const result: SyncResult = { synced: 0, errors: [] };

  try {
    // Réservations VALIDE dont la fin est >= aujourd'hui
    const receiptsSnap = await getDocs(
      query(
        collection(db, 'receipts'),
        where('status', '==', 'VALIDE'),
        where('endDate', '>=', today)
      )
    );

    // Dates bloquées actuelles et futures
    const blockedSnap = await getDocs(
      query(
        collection(db, 'blocked_dates'),
        where('date', '>=', today)
      )
    );

    const items: Array<{ id: string; data: object }> = [];

    for (const snap of receiptsSnap.docs) {
      const d = { id: snap.id, ...snap.data() } as ReceiptData;
      const segments = getReceiptSegments(d);
      const refId = d.receiptId || snap.id;
      const client = `${d.firstName || ''} ${d.lastName || ''}`.trim();
      const updatedAt = new Date().toISOString();

      if (segments.length === 1) {
        const s = segments[0];
        items.push({
          id: refId,
          data: {
            id: s.calendarSlug,
            start: s.startDate,
            end: s.endDate,
            client,
            ref_id: refId,
            type: 'reservation',
            updatedAt,
          },
        });
      } else {
        for (const s of segments) {
          items.push({
            id: `${refId}__${s.id}`,
            data: {
              id: s.calendarSlug,
              start: s.startDate,
              end: s.endDate,
              client,
              ref_id: refId,
              type: 'reservation',
              updatedAt,
            },
          });
        }
      }
    }

    for (const snap of blockedSnap.docs) {
      const d = snap.data();
      items.push({
        id: `block_${snap.id}`,
        data: {
          id: d.calendarSlug || '',
          start: d.date || '',
          end: d.date || '',
          client: d.reason || 'Fermé',
          ref_id: `block_${snap.id}`,
          type: 'blocked',
          updatedAt: new Date().toISOString(),
        },
      });
    }

    // Écriture par lots
    const BATCH_SIZE = 400;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      const chunk = items.slice(i, i + BATCH_SIZE);
      for (const item of chunk) {
        batch.set(doc(db, 'public_calendar', item.id), item.data);
        result.synced++;
      }
      await batch.commit();
    }
  } catch (e: any) {
    result.errors.push(e?.message || String(e));
  }

  return result;
}
