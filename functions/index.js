/**
 * YameHome — Cloud Function d'archivage automatique
 *
 * Tourne chaque nuit à 02h00 (heure Yaoundé, Africa/Douala = UTC+1).
 * Copie dans 'archives' les réservations VALIDE dont la date de fin est passée,
 * et les retire de 'public_calendar'.
 */

'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { logger } = require('firebase-functions');
const {
  ALLOWED_CALENDAR_SLUGS,
  resolveApartmentName,
  getRateForApartment,
  countNights,
  tomorrowYmdDouala,
} = require('./pricing');

const DB_ID = 'ai-studio-469b45b3-ddc0-4c8a-9d44-563700ba9c68';
const REGION = 'europe-west1';

const app = initializeApp();
/** Base Firestore nommée (même ID que le client web). */
const db = getFirestore(app, DB_ID);

/** Même chaîne pour tous les prospects créés depuis le site (pas un UID Firebase réel). */
const WEBSITE_PROSPECT_AUTHOR_UID = 'yamehome-site-public';

function todayYmdDouala() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Douala',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function clampStr(s, max) {
  if (typeof s !== 'string') return '';
  const t = s.trim();
  return t.length > max ? t.slice(0, max) : t;
}

/**
 * Pré-réservation depuis yamehome.com — écriture admin dans `prospects`.
 * Payload attendu : firstName, lastName, phone, calendarSlug, startDate, endDate,
 * isStudioMode?, guestCount?, email?, notes?, campaignSource?
 */
exports.submitWebsiteProspect = onCall(
  {
    region: REGION,
    cors: [
      'https://yamehome.com',
      'https://www.yamehome.com',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ],
  },
  async (request) => {
    const data = request.data || {};

    const firstName = clampStr(String(data.firstName ?? ''), 80);
    const lastName = clampStr(String(data.lastName ?? ''), 80);
    const phone = clampStr(String(data.phone ?? ''), 32);
    const email = clampStr(String(data.email ?? ''), 120);
    const calendarSlug = clampStr(String(data.calendarSlug ?? ''), 80);
    const startDate = clampStr(String(data.startDate ?? ''), 12);
    const endDate = clampStr(String(data.endDate ?? ''), 12);
    const notesExtra = clampStr(String(data.notes ?? ''), 2000);
    const campaignSource = clampStr(String(data.campaignSource ?? ''), 120);

    const isStudioMode = Boolean(data.isStudioMode);
    const guestCountRaw = data.guestCount;
    let guestCount = 1;
    if (guestCountRaw !== undefined && guestCountRaw !== null && guestCountRaw !== '') {
      const n=Number(guestCountRaw);
      if (!Number.isFinite(n) || n < 1 || n > 20) {
        throw new HttpsError('invalid-argument', 'guestCount invalide');
      }
      guestCount = Math.floor(n);
    }

    if (!lastName) throw new HttpsError('invalid-argument', 'Le nom est obligatoire');
    if (!phone || phone.replace(/\s/g, '').length < 8) {
      throw new HttpsError('invalid-argument', 'Numéro de téléphone invalide');
    }
    if (!calendarSlug || !ALLOWED_CALENDAR_SLUGS.has(calendarSlug)) {
      throw new HttpsError('invalid-argument', 'Logement non reconnu');
    }
    if (!startDate || !endDate) {
      throw new HttpsError('invalid-argument', 'Les dates de séjour sont obligatoires');
    }

    const today = todayYmdDouala();
    if (startDate < today) {
      throw new HttpsError('invalid-argument', 'La date d’arrivée ne peut pas être dans le passé');
    }

    const nights = countNights(startDate, endDate);
    if (nights <= 0) {
      throw new HttpsError('invalid-argument', 'La date de départ doit être après l’arrivée');
    }

    let apartmentName;
    try {
      apartmentName = resolveApartmentName(calendarSlug, isStudioMode);
    } catch (e) {
      logger.warn(e);
      throw new HttpsError('invalid-argument', 'Combinaison logement / mode studio invalide');
    }

    const rate = getRateForApartment(apartmentName, nights);
    if (!rate.prix || rate.prix <= 0) {
      throw new HttpsError('failed-precondition', 'Impossible de calculer le tarif');
    }

    const totalStayPrice = nights * rate.prix + rate.caution;

    const nowIso = new Date().toISOString();
    const nextFollowUpDate = tomorrowYmdDouala();

    const notesParts = [
      notesExtra || null,
      campaignSource ? `Source campagne (site): ${campaignSource}` : null,
      `Mode tarifaire: ${isStudioMode ? 'Studio' : 'Standard'}`,
      `Serveur — nuits: ${nights}, prix/nuit: ${rate.prix}, caution: ${rate.caution}`,
    ].filter(Boolean);

    const payload = {
      source: 'SITE_WEB',
      status: 'NOUVEAU',
      firstName,
      lastName,
      phone,
      email,
      apartmentName,
      calendarSlug,
      startDate,
      endDate,
      totalStayPrice,
      guestCount,
      budget: 0,
      assignedTo: '',
      nextFollowUpDate,
      notes: notesParts.join('\n'),
      createdAt: nowIso,
      updatedAt: nowIso,
      authorUid: WEBSITE_PROSPECT_AUTHOR_UID,
    };

    const ref = await db.collection('prospects').add(payload);
    logger.info(`[submitWebsiteProspect] créé ${ref.id} — ${calendarSlug} — ${startDate}→${endDate}`);

    return { ok: true, prospectId: ref.id };
  }
);

exports.archivePastReservations = onSchedule(
  {
    schedule: '0 2 * * *',   // chaque nuit à 02:00
    timeZone: 'Africa/Douala',
    region: REGION,
  },
  async () => {
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
