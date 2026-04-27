/**
 * YameHome — Cloud Function d'archivage automatique
 *
 * Tourne chaque nuit à 02h00 (heure Yaoundé, Africa/Douala = UTC+1).
 * Copie dans 'archives' les réservations VALIDE dont la date de fin est passée,
 * et les retire de 'public_calendar'.
 */

'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { logger } = require('firebase-functions');

initializeApp();

const DB_ID = 'ai-studio-469b45b3-ddc0-4c8a-9d44-563700ba9c68';
const REGION = 'europe-west1';

exports.archivePastReservations = onSchedule(
  {
    schedule: '0 2 * * *',   // chaque nuit à 02:00
    timeZone: 'Africa/Douala',
    region: REGION,
  },
  async () => {
    const db = getFirestore(DB_ID);
    const today = new Date().toISOString().split('T')[0];

    logger.info(`[archive] Démarrage — date de référence : ${today}`);

    const snapshot = await db
      .collection('receipts')
      .where('status', '==', 'VALIDE')
      .where('endDate', '<', today)
      .get();

    if (snapshot.empty) {
      logger.info('[archive] Aucune réservation à archiver.');
      return;
    }

    const BATCH_SIZE = 400;
    let batch = db.batch();
    let ops = 0;
    let archived = 0;

    for (const snap of snapshot.docs) {
      const data = snap.data();

      // Écriture dans archives (upsert)
      batch.set(db.collection('archives').doc(snap.id), {
        ...data,
        archivedAt: new Date().toISOString(),
      });
      ops++;

      // Retrait de public_calendar
      if (data.receiptId) {
        batch.delete(db.collection('public_calendar').doc(data.receiptId));
        ops++;
      }

      archived++;

      if (ops >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }

    if (ops > 0) await batch.commit();

    logger.info(`[archive] Terminé — ${archived} réservation(s) archivée(s).`);
  }
);
