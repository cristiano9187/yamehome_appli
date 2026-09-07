'use strict';

/**
 * NOTE admin WhatsApp → journal par numéro (tout contact WhatsApp, sans fiche CRM obligatoire).
 * Si une fiche prospect existe, ses notes CRM sont aussi enrichies (bonus).
 * Auth : X-Yamehome-Key (= WHATSAPP_PROSPECT_LOOKUP_KEY).
 */

const crypto = require('crypto');
const { logger } = require('firebase-functions');
const {
  normalizeWaPhoneQuery,
  allPhoneKeysFromPayload,
  findProspectsByWaPhone,
  findProspectsByNameHint,
  nameHintFromNote,
  appendNoteToProspects,
  writeTeamContextLines,
  doualaTimestamp,
} = require('./whatsappPhoneUtils');

function verifyKey(req, expectedKey) {
  const expected = String(expectedKey || '').trim();
  const headerKey = req.get('x-yamehome-key') || req.get('X-Yamehome-Key') || '';
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const qKey =
    (typeof req.query?.key === 'string' && req.query.key) ||
    (typeof body.key === 'string' ? body.key : '') ||
    headerKey;
  if (!expected || !qKey || expected.length !== String(qKey).trim().length) {
    return false;
  }
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(qKey).trim(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function buildAckMessage({ phone, prospectsUpdated }) {
  let msg = `OK — note enregistrée pour ${phone}. L’assistant s’en souviendra à la prochaine conversation WhatsApp.`;
  if (prospectsUpdated > 0) {
    msg += ` (${prospectsUpdated} fiche(s) CRM aussi mises à jour)`;
  }
  return msg;
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {import('firebase-functions').Request} req
 * @param {string} expectedKey
 */
async function handleWhatsAppAdminNote(db, req, expectedKey) {
  if (!verifyKey(req, expectedKey)) {
    return { status: 401, body: { ok: false, error: 'unauthorized' } };
  }

  if (req.method !== 'POST') {
    return { status: 405, body: { ok: false, error: 'method_not_allowed' } };
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const phone = normalizeWaPhoneQuery(String(body.phone || req.query?.phone || ''));
  const noteText = String(body.note || body.text || '').trim().slice(0, 2000);

  if (!phone || phone.length < 8) {
    return { status: 400, body: { ok: false, error: 'invalid_phone' } };
  }
  if (!noteText) {
    return { status: 400, body: { ok: false, error: 'empty_note' } };
  }

  const stamp = doualaTimestamp();
  const line = `[${stamp} équipe WhatsApp] ${noteText}`;
  try {
    const contextPhones = new Set([phone]);
    const waPayload = body.waPayload && typeof body.waPayload === 'object' ? body.waPayload : null;
    if (waPayload) {
      for (const p of allPhoneKeysFromPayload(waPayload)) contextPhones.add(p);
    }

    let prospects = await findProspectsByWaPhone(db, phone);
    if (!prospects.length) {
      const hint = nameHintFromNote(noteText);
      if (hint) prospects = await findProspectsByNameHint(db, hint);
    }
    for (const row of prospects) {
      const p = normalizeWaPhoneQuery(row.phone);
      if (p && p.length >= 8) contextPhones.add(p);
    }

    const contextDocIds = await writeTeamContextLines(db, [...contextPhones], noteText, stamp);
    const updatedIds = await appendNoteToProspects(db, prospects, line);

    const ackMessage = buildAckMessage({
      phone,
      prospectsUpdated: updatedIds.length,
    });

    logger.info('[whatsappAdminNote]', phone, 'prospects=', updatedIds.length, 'ctx=', contextDocIds.length);

    return {
      status: 200,
      body: {
        ok: true,
        phone,
        prospectIds: updatedIds,
        prospectsUpdated: updatedIds.length,
        contextPhones: [...contextPhones],
        contextDocIds,
        ackMessage,
        linePreview: line.slice(0, 200),
      },
    };
  } catch (e) {
    logger.error('[whatsappAdminNote]', e.message || e);
    return { status: 500, body: { ok: false, error: 'write_failed' } };
  }
}

module.exports = { handleWhatsAppAdminNote };
