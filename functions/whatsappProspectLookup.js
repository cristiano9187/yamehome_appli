'use strict';

/**
 * Recherche lecture seule dans `prospects` pour l’assistant WhatsApp (n8n).
 * Par défaut : recherche « comme au téléphone » (nom + dates déclarés par le client),
 * pas le numéro WhatsApp de l’expéditeur. Le match téléphone est optionnel (usePhone=true).
 *
 * Auth : header X-Yamehome-Key = secret WHATSAPP_PROSPECT_LOOKUP_KEY.
 */

const crypto = require('crypto');
const { logger } = require('firebase-functions');

const MAX_IN_QUERY = 10;
const MAX_RESULTS = 25;

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** @param {string} s */
function normalizeWaPhoneQuery(s) {
  let d = digitsOnly(s);
  if (d.length <= 15) return d;
  const cm = d.match(/(237\d{9})/);
  if (cm) return cm[1];
  const last9 = d.slice(-9);
  if (last9.length === 9) return `237${last9}`;
  return d.slice(0, 15);
}

/**
 * @param {string} waDigits
 */
function phoneCandidates(waDigits) {
  const d = digitsOnly(waDigits);
  const set = new Set();
  if (d) set.add(d);
  if (d.length > 9) set.add(d.slice(-9));
  if (d.length > 8) set.add(d.slice(-8));
  if (d.startsWith('237') && d.length > 3) set.add(d.slice(3));
  if (!d.startsWith('237') && d.length >= 8 && d.length <= 12) set.add(`237${d}`);
  if (d.startsWith('0') && d.length > 1) set.add(d.slice(1));
  return [...set].filter(Boolean).slice(0, MAX_IN_QUERY);
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {{ phone?: string, startDate?: string, endDate?: string, lastName?: string, firstName?: string, source?: string, usePhone?: boolean|string }} q
 */
async function lookupProspects(db, q) {
  const usePhone =
    q.usePhone === true ||
    q.usePhone === 'true' ||
    String(q.usePhone || '').toLowerCase() === '1';

  const phoneDigits =
    usePhone && q.phone ? normalizeWaPhoneQuery(String(q.phone)) : '';

  const startDate = String(q.startDate || '').trim();
  const endDate = String(q.endDate || '').trim();
  const lastNameQ = String(q.lastName || '').trim();
  const firstNameQ = String(q.firstName || '').trim();

  const lastNameNorm = norm(lastNameQ);
  const firstNameNorm = norm(firstNameQ);

  const sourceQ = String(q.source || '')
    .trim()
    .toUpperCase();
  const allowedSource = new Set([
    'FACEBOOK',
    'AIRBNB',
    'BOOKING',
    'TELEPHONE',
    'WHATSAPP',
    'AUTRE',
    'SITE_WEB',
  ]);

  /** @type {Map<string, import('firebase-admin/firestore').DocumentData & { id: string }>} */
  const byId = new Map();

  function mergeSnap(snap) {
    snap.docs.forEach((doc) => {
      byId.set(doc.id, { id: doc.id, ...doc.data() });
    });
  }

  /* --- 1) Conversation : dates / nom (priorité) --- */
  if (startDate) {
    const snap = await db
      .collection('prospects')
      .where('startDate', '==', startDate)
      .limit(80)
      .get();
    mergeSnap(snap);
  }

  if (lastNameQ.length >= 2) {
    const variants = new Set([lastNameQ]);
    variants.add(
      lastNameQ.charAt(0).toUpperCase() + lastNameQ.slice(1).toLowerCase(),
    );
    for (const v of variants) {
      const snap = await db.collection('prospects').where('lastName', '==', v).limit(40).get();
      mergeSnap(snap);
    }
  }

  if (byId.size === 0 && endDate) {
    const snap = await db
      .collection('prospects')
      .where('endDate', '==', endDate)
      .limit(80)
      .get();
    mergeSnap(snap);
  }

  /* --- 2) Optionnel : téléphone déclaré ou expéditeur (si usePhone) --- */
  if (usePhone && phoneDigits) {
    const chunk = phoneCandidates(phoneDigits).slice(0, MAX_IN_QUERY);
    if (chunk.length) {
      const snap = await db.collection('prospects').where('phone', 'in', chunk).get();
      mergeSnap(snap);
    }
  }

  let rows = [...byId.values()];

  if (firstNameNorm) {
    rows = rows.filter((r) => {
      const fn = norm(r.firstName || '');
      return fn.includes(firstNameNorm) || firstNameNorm.includes(fn);
    });
  }

  if (lastNameNorm) {
    rows = rows.filter((r) => {
      const ln = norm(r.lastName || '');
      return ln.includes(lastNameNorm) || lastNameNorm.includes(ln);
    });
  }

  if (startDate) {
    rows = rows.filter((r) => String(r.startDate || '') === startDate);
  }
  if (endDate) {
    rows = rows.filter((r) => String(r.endDate || '') === endDate);
  }

  if (sourceQ && allowedSource.has(sourceQ)) {
    rows = rows.filter((r) => String(r.source || '').toUpperCase() === sourceQ);
  }

  rows.sort((a, b) =>
    String(b.updatedAt || b.createdAt || '').localeCompare(
      String(a.updatedAt || a.createdAt || ''),
    ),
  );

  rows = rows.slice(0, MAX_RESULTS);

  return rows.map(sanitizeProspectRow);
}

function sanitizeProspectRow(row) {
  const n = (x) => (x === undefined || x === null ? '' : x);
  return {
    id: n(row.id),
    firstName: n(row.firstName),
    lastName: n(row.lastName),
    phone: n(row.phone),
    startDate: n(row.startDate),
    endDate: n(row.endDate),
    apartmentName: n(row.apartmentName),
    calendarSlug: n(row.calendarSlug),
    source: n(row.source),
    totalStayPrice: row.totalStayPrice != null ? Number(row.totalStayPrice) : null,
    guestCount: row.guestCount != null ? Number(row.guestCount) : null,
    budget: row.budget != null ? Number(row.budget) : null,
  };
}

/**
 * @param {unknown} v
 * @param {boolean} defaultVal
 */
function parseBool(v, defaultVal) {
  if (v === undefined || v === null || v === '') return defaultVal;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return defaultVal;
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {import('firebase-functions').Request} req
 * @param {string} expectedKey
 */
async function handleWhatsAppProspectLookup(db, req, expectedKey) {
  const expected = String(expectedKey || '').trim();
  const headerKey = req.get('x-yamehome-key') || req.get('X-Yamehome-Key') || '';
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const qKey =
    (typeof req.query?.key === 'string' && req.query.key) ||
    (typeof body.key === 'string' ? body.key : '') ||
    headerKey;

  if (!expected || !qKey || expected.length !== String(qKey).trim().length) {
    logger.warn('[whatsappProspectLookup] clé invalide ou absente');
    return { status: 401, body: { ok: false, error: 'unauthorized' } };
  }
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(qKey).trim(), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    logger.warn('[whatsappProspectLookup] clé invalide ou absente');
    return { status: 401, body: { ok: false, error: 'unauthorized' } };
  }

  const phone =
    (typeof req.query?.phone === 'string' && req.query.phone) ||
    (typeof body.phone === 'string' ? body.phone : '') ||
    '';

  const startDate =
    (typeof req.query?.startDate === 'string' && req.query.startDate) ||
    (typeof body.startDate === 'string' ? body.startDate : '') ||
    '';

  const endDate =
    (typeof req.query?.endDate === 'string' && req.query.endDate) ||
    (typeof body.endDate === 'string' ? body.endDate : '') ||
    '';

  const lastName =
    (typeof req.query?.lastName === 'string' && req.query.lastName) ||
    (typeof body.lastName === 'string' ? body.lastName : '') ||
    '';

  const firstName =
    (typeof req.query?.firstName === 'string' && req.query.firstName) ||
    (typeof body.firstName === 'string' ? body.firstName : '') ||
    '';

  const source =
    (typeof req.query?.source === 'string' && req.query.source) ||
    (typeof body.source === 'string' ? body.source : '') ||
    '';

  const usePhone = parseBool(req.query?.usePhone ?? body.usePhone, false);

  const phoneDigitsNormalized = phone ? normalizeWaPhoneQuery(phone) : '';

  try {
    const prospects = await lookupProspects(db, {
      phone: phoneDigitsNormalized,
      startDate,
      endDate,
      lastName,
      firstName,
      source,
      usePhone,
    });
    return {
      status: 200,
      body: {
        ok: true,
        query: {
          usePhone,
          phoneDigits: digitsOnly(phoneDigitsNormalized) || null,
          startDate: startDate || null,
          endDate: endDate || null,
          lastName: lastName || null,
          firstName: firstName || null,
          source: source ? String(source).trim().toUpperCase() : null,
        },
        matchCount: prospects.length,
        prospects,
      },
    };
  } catch (e) {
    logger.error('[whatsappProspectLookup]', e.message || e);
    return { status: 500, body: { ok: false, error: 'lookup_failed' } };
  }
}

module.exports = {
  handleWhatsAppProspectLookup,
  phoneCandidates,
  digitsOnly,
  norm,
};
