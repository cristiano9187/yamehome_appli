/**
 * public_calendar — collection Firestore en lecture publique.
 *
 * Sert de vue "propre" des réservations et dates bloquées pour :
 *   - yamehome.com (site public)
 *   - L'agent IA WhatsApp (n8n via REST Firestore)
 *
 * Structure d'un document :
 *   id       : calendarSlug (ex. "matera-deluxe")
 *   start    : YYYY-MM-DD
 *   end      : YYYY-MM-DD
 *   client   : "Prénom Nom" | "Fermé"
 *   ref_id   : receiptId | "block_<docId>"
 *   type     : "reservation" | "blocked"
 *   updatedAt: ISO datetime
 */

import { db } from '../firebase';
import { setDoc, deleteDoc, doc } from 'firebase/firestore';

export interface PublicCalendarEvent {
  id: string;
  start: string;
  end: string;
  client: string;
  ref_id: string;
  type: 'reservation' | 'blocked';
  updatedAt: string;
}

export async function upsertPublicCalendar(event: PublicCalendarEvent): Promise<void> {
  try {
    await setDoc(doc(db, 'public_calendar', event.ref_id), event);
    console.info('[public_calendar] upsert ok:', event.ref_id);
  } catch (e: any) {
    console.error('[public_calendar] upsert FAILED:', e?.code, e?.message, event);
  }
}

export async function deletePublicCalendar(refId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'public_calendar', refId));
    console.info('[public_calendar] delete ok:', refId);
  } catch (e: any) {
    console.error('[public_calendar] delete FAILED:', e?.code, e?.message, refId);
  }
}
