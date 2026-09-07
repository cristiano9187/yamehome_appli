'use strict';

/**
 * Contexte CRM + notes équipe pour le client WhatsApp en cours (par téléphone).
 * GET ?phone=698557489 — auth X-Yamehome-Key.
 */

const crypto = require('crypto');
const { logger } = require('firebase-functions');
const {
  normalizeWaPhoneQuery,
  phoneDocId,
  findProspectsByWaPhone,
  allPhoneKeysFromPayload,
} = require('./whatsappPhoneUtils');

function verifyKey(req, expectedKey) {
  const expected = String(expectedKey || '').trim();
  const headerKey = req.get('x-yamehome-key') || req.get('X-Yamehome-Key') || '';
  const qKey =
    (typeof req.query?.key === 'string' && req.query.key) ||
    headerKey;
  if (!expected || !qKey || expected.length !== String(qKey).trim().length) {
    return false;
  }
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(qKey).trim(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sanitize(row) {
  return {
    id: row.id,
    firstName: String(row.firstName || ''),
    lastName: String(row.lastName || ''),
    phone: String(row.phone || ''),
    email: String(row.email || ''),
    apartmentName: String(row.apartmentName || ''),
    calendarSlug: String(row.calendarSlug || ''),
    source: String(row.source || ''),
    status: String(row.status || ''),
    startDate: String(row.startDate || ''),
    endDate: String(row.endDate || ''),
    totalStayPrice:
      row.totalStayPrice != null && row.totalStayPrice !== ''
        ? Number(row.totalStayPrice)
        : null,
    notes: String(row.notes || '').slice(0, 4000),
    convertedReceiptId: String(row.convertedReceiptId || ''),
    updatedAt: String(row.updatedAt || ''),
  };
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string[]} phones
 */
async function loadTeamLines(db, phones) {
  const seen = new Set();
  const merged = [];

  for (const raw of phones) {
    const docId = phoneDocId(raw);
    if (!docId || seen.has(docId)) continue;
    seen.add(docId);
    const ctxSnap = await db.collection('whatsapp_team_context').doc(docId).get();
    if (!ctxSnap.exists) continue;
    const data = ctxSnap.data() || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    for (const ln of lines) {
      merged.push({ ...ln, _ctxPhone: docId });
    }
  }

  merged.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  return merged.slice(-20);
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {import('firebase-functions').Request} req
 * @param {string} expectedKey
 */
async function handleWhatsAppProspectContext(db, req, expectedKey) {
  if (!verifyKey(req, expectedKey)) {
    return { status: 401, body: { ok: false, error: 'unauthorized' } };
  }

  const phone = normalizeWaPhoneQuery(String(req.query?.phone || ''));
  if (!phone || phone.length < 8) {
    return { status: 400, body: { ok: false, error: 'invalid_phone' } };
  }

  try {
    const raw = await findProspectsByWaPhone(db, phone);
    const prospects = raw.slice(0, 5).map(sanitize);

    const phonesForCtx = new Set([phone]);
    for (const row of prospects) {
      const p = normalizeWaPhoneQuery(row.phone);
      if (p && p.length >= 8) phonesForCtx.add(p);
    }
    let waPayload = null;
    if (typeof req.query?.waPayload === 'string' && req.query.waPayload) {
      try {
        waPayload = JSON.parse(req.query.waPayload);
      } catch (_) {
        waPayload = null;
      }
    }
    if (waPayload) {
      for (const p of allPhoneKeysFromPayload(waPayload)) phonesForCtx.add(p);
    }

    const teamLines = await loadTeamLines(db, [...phonesForCtx]);

    return {
      status: 200,
      body: {
        ok: true,
        kind: 'client_context',
        phone,
        matchCount: prospects.length,
        prospects,
        teamLines,
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (e) {
    logger.error('[whatsappProspectContext]', e.message || e);
    return { status: 500, body: { ok: false, error: 'read_failed' } };
  }
}

module.exports = { handleWhatsAppProspectContext };
