'use strict';

const { FieldValue } = require('firebase-admin/firestore');

const MAX_IN_QUERY = 10;

/** Numéros admin WhatsApp (commandes NOTE / IA STOP). Peuvent aussi être clients (ex. tests). */
const ADMIN_WA_PHONES = new Set([
  '393270223168',
  '23791472482',
  '23756751310',
  '237650168239', // Solange
]);

/**
 * Numéro « réel » du client : priorité @s.whatsapp.net, ignore les @lid internes.
 * @param {object} payload
 */
function extractWaPhoneDigits(payload) {
  const jids = [
    payload?._data?.key?.remoteJidAlt,
    payload?.from,
    payload?._data?.key?.remoteJid,
    payload?._data?.id?.remote,
  ]
    .filter(Boolean)
    .map(String);

  const net = jids.find((j) => /@s\.whatsapp\.net$/i.test(j));
  if (net) {
    const d = digitsOnly(net.split('@')[0]);
    if (d.length >= 8 && d.length <= 15) return d;
  }

  for (const j of jids) {
    if (/@lid$/i.test(j)) continue;
    const d = digitsOnly(j.split('@')[0]);
    if (d.length >= 8 && d.length <= 15) return d;
  }
  return '';
}

/** Toutes les clés utiles (numéro + éventuel @lid) pour journaliser une NOTE. */
function allPhoneKeysFromPayload(payload) {
  const set = new Set();
  const primary = extractWaPhoneDigits(payload);
  if (primary) set.add(primary);
  for (const j of [
    payload?._data?.key?.remoteJidAlt,
    payload?.from,
    payload?._data?.key?.remoteJid,
    payload?._data?.id?.remote,
  ]) {
    if (!j) continue;
    const d = digitsOnly(String(j).split('@')[0]);
    if (d.length >= 8) set.add(d);
  }
  return [...set];
}

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
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

/** @param {string} waDigits */
function phoneDocId(waDigits) {
  let d = normalizeWaPhoneQuery(waDigits);
  if (d.length === 9) d = `237${d}`;
  if (d.startsWith('0') && d.length > 1) d = `237${d.slice(1)}`;
  return d || 'unknown';
}

/** @param {string} waDigits */
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
 * @param {string} waPhone
 */
async function findProspectsByWaPhone(db, waPhone) {
  const phoneDigits = normalizeWaPhoneQuery(waPhone);
  if (!phoneDigits) return [];

  const byId = new Map();
  const chunk = phoneCandidates(phoneDigits).slice(0, MAX_IN_QUERY);
  if (chunk.length) {
    const snap = await db.collection('prospects').where('phone', 'in', chunk).get();
    snap.docs.forEach((doc) => {
      byId.set(doc.id, { id: doc.id, ...doc.data() });
    });
  }

  const rows = [...byId.values()];
  rows.sort((a, b) =>
    String(b.updatedAt || b.createdAt || '').localeCompare(
      String(a.updatedAt || a.createdAt || ''),
    ),
  );
  return rows;
}

function normName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Premier mot « prénom » dans le texte de la note (ex. « Christian a déjà payé… »). */
function nameHintFromNote(noteText) {
  const m = String(noteText || '').match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]{2,})/);
  return m ? m[1] : '';
}

/**
 * Recherche prospects par prénom / nom (si le numéro NOTE ne matche pas le CRM).
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} hint
 */
async function findProspectsByNameHint(db, hint) {
  const h = normName(hint);
  if (h.length < 2) return [];

  const byId = new Map();
  try {
    const exact = await db.collection('prospects').where('firstName', '==', hint).limit(8).get();
    exact.docs.forEach((doc) => byId.set(doc.id, { id: doc.id, ...doc.data() }));
  } catch (_) {
    /* index ou champ absent */
  }

  if (byId.size < 8) {
    const snap = await db.collection('prospects').orderBy('updatedAt', 'desc').limit(60).get();
    snap.docs.forEach((doc) => {
      if (byId.size >= 8) return;
      const d = doc.data();
      const fn = normName(d.firstName);
      const ln = normName(d.lastName);
      const full = `${fn} ${ln}`.trim();
      if (fn === h || ln === h || full.includes(h)) {
        byId.set(doc.id, { id: doc.id, ...d });
      }
    });
  }

  const rows = [...byId.values()];
  rows.sort((a, b) =>
    String(b.updatedAt || b.createdAt || '').localeCompare(
      String(a.updatedAt || a.createdAt || ''),
    ),
  );
  return rows.slice(0, 5);
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} noteText
 * @param {string} line
 */
async function appendNoteToProspects(db, prospects, line) {
  const updatedIds = [];
  for (const row of prospects) {
    const ref = db.collection('prospects').doc(row.id);
    const prev = String(row.notes || '').trim();
    const next = prev ? `${prev}\n${line}` : line;
    await ref.update({
      notes: next.slice(0, 8000),
      updatedAt: new Date().toISOString(),
    });
    updatedIds.push(row.id);
  }
  return updatedIds;
}

/**
 * Journal whatsapp_team_context — une ou plusieurs clés téléphone (client + variante saisie).
 * @param {import('firebase-admin/firestore').Firestore} db
 */
async function writeTeamContextLines(db, phones, noteText, stamp) {
  const ids = new Set();
  for (const raw of phones) {
    const id = phoneDocId(raw);
    if (id && id !== 'unknown') ids.add(id);
  }
  const line = { at: new Date().toISOString(), text: noteText, stamp };
  for (const docId of ids) {
    const ctxRef = db.collection('whatsapp_team_context').doc(docId);
    await ctxRef.set(
      {
        phone: normalizeWaPhoneQuery(docId),
        lines: FieldValue.arrayUnion(line),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }
  return [...ids];
}

function doualaTimestamp() {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Africa/Douala',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const pick = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${pick('day')}/${pick('month')}/${pick('year')} ${pick('hour')}:${pick('minute')}`;
}

module.exports = {
  ADMIN_WA_PHONES,
  extractWaPhoneDigits,
  allPhoneKeysFromPayload,
  digitsOnly,
  normalizeWaPhoneQuery,
  phoneDocId,
  phoneCandidates,
  findProspectsByWaPhone,
  findProspectsByNameHint,
  nameHintFromNote,
  appendNoteToProspects,
  writeTeamContextLines,
  doualaTimestamp,
};
