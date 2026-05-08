/**
 * public_calendar — collection Firestore en lecture publique.
 *
 * Sert de vue "propre" des réservations et dates bloquées pour :
 *   - yamehome.com (site public)
 *   - l’agent IA WhatsApp (n8n via REST Firestore)
 *
 * Structure d’un document :
 *   id       : calendarSlug (ex. "matera-deluxe")
 *   start    : YYYY-MM-DD
 *   end      : YYYY-MM-DD
 *   client   : "Prénom Nom" | "Fermé"
 *   ref_id   : receiptId | "block_<docId>"
 *   type     : "reservation" | "blocked"
 *   updatedAt: ISO datetime
 *
 * Réservations mono-segment (historique) : document ID == ref_id (= receiptId).
 * Réservations multi-segments : un document par segment, ID == `{ref_id}__{segmentId}`.
 */

import type { ReceiptData } from '../types';
import { db } from '../firebase';
import {
  doc,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { getReceiptSegments } from './receiptSegments';

export interface PublicCalendarEvent {
  id: string;
  start: string;
  end: string;
  client: string;
  ref_id: string;
  type: 'reservation' | 'blocked';
  updatedAt: string;
}

/** Blocages / ancien comportement ponctuel : l’ID du doc = ref_id passé à la fonction. */
export async function upsertPublicCalendar(event: PublicCalendarEvent): Promise<void> {
  try {
    await setDoc(doc(db, 'public_calendar', event.ref_id), event);
    console.info('[public_calendar] upsert ok:', event.ref_id);
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    console.error('[public_calendar] upsert FAILED:', err?.code, err?.message, event);
  }
}

/** Supprime un document précis par son ID (`receiptId` mono, ou `block_…`). */
export async function deletePublicCalendar(documentId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'public_calendar', documentId));
    console.info('[public_calendar] delete ok:', documentId);
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    console.error('[public_calendar] delete FAILED:', err?.code, err?.message, documentId);
  }
}

/** Retire du calendrier public toutes les entrées réservation liées à un `receiptId`. */
export async function deleteAllReservationEventsForReceipt(receiptId: string): Promise<void> {
  try {
    const qRef = query(
      collection(db, 'public_calendar'),
      where('ref_id', '==', receiptId),
      where('type', '==', 'reservation')
    );
    const snap = await getDocs(qRef);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    // Doc mono historique même si absent du résultat requête (données corrompues)
    await deleteDoc(doc(db, 'public_calendar', receiptId)).catch(() => undefined);
    console.info('[public_calendar] deleted reservation event(s):', receiptId, snap.size);
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    console.error('[public_calendar] bulk delete FAILED:', err?.code, err?.message, receiptId);
  }
}

/**
 * Réécrit `public_calendar` pour une réservation : multi-doc si plusieurs segments,
 * sinon un seul doc dont l’ID reste `receiptId`.
 */
export async function syncReservationPublicCalendar(receipt: ReceiptData): Promise<void> {
  await deleteAllReservationEventsForReceipt(receipt.receiptId);
  if (receipt.status !== 'VALIDE') return;

  const segments = getReceiptSegments(receipt);
  const client = `${receipt.firstName ?? ''} ${receipt.lastName ?? ''}`.trim() || 'Réservation';
  const updatedAt = new Date().toISOString();

  if (segments.length === 1) {
    const s = segments[0];
    const ev: PublicCalendarEvent = {
      id: s.calendarSlug,
      start: s.startDate,
      end: s.endDate,
      client,
      ref_id: receipt.receiptId,
      type: 'reservation',
      updatedAt,
    };
    await setDoc(doc(db, 'public_calendar', receipt.receiptId), ev);
    console.info('[public_calendar] sync mono ok:', receipt.receiptId);
    return;
  }

  await Promise.all(
    segments.map((s) =>
      setDoc(doc(db, 'public_calendar', `${receipt.receiptId}__${s.id}`), {
        id: s.calendarSlug,
        start: s.startDate,
        end: s.endDate,
        client,
        ref_id: receipt.receiptId,
        type: 'reservation',
        updatedAt,
      } as PublicCalendarEvent)
    )
  );
  console.info('[public_calendar] sync multi ok:', receipt.receiptId, segments.length);
}
