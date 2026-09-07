'use strict';

/**
 * Analyse d’une pièce jointe WhatsApp (image / capture / PDF) pour extraire
 * un résumé factuel utile au prompt principal (preuve de paiement, etc.).
 *
 * Auth identique à whatsappProspectFeed : header X-Yamehome-Key ou ?key= (secret WHATSAPP_PROSPECT_LOOKUP_KEY).
 *
 * POST JSON :
 * {
 *   "mimeType": "image/jpeg" | "image/png" | "application/pdf" | ...,
 *   "base64": "< données base64 brutes, sans préfixe data: >",
 *   "downloadUrl": "<optionnel — URL WAHA /api/files/... si base64 vide dans n8n>",
 *   "caption": "<optionnel>",
 *   "filename": "<optionnel, ex. pour PDF>"
 * }
 */

const crypto = require('crypto');
const { logger } = require('firebase-functions');

const MAX_BASE64_CHARS = Math.floor((8 * 1024 * 1024 * 4) / 3); // ~8 Mo binaire en base64
/** Même famille que le nœud n8n « Message a model » (gemini-2.5-flash). */
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

const ALLOWED_MIME_PREFIX = ['image/', 'application/pdf'];

const EXTRACTION_PROMPT = `Tu es un assistant OCR / lecture de captures d'écran mobiles (Orange Money, MTN MoMo, virements, SMS, emails) et de documents PDF (relevés, reçus banque).
Réponds UNIQUEMENT avec un objet JSON valide (pas de markdown, pas de texte hors JSON).

Champs obligatoires :
- "readable" (boolean) : est-ce que le média semble contenir une preuve de paiement ou un accusé SMS/banque lisible ?
- "summary_fr" (string) : résumé en 2 à 6 phrases en français du contenu pertinent (montants, bénéficiaire, références visibles).
- "amounts_seen" (array de strings ou nombres) : montants chiffrés repérés, ou [] si aucun ou illisible.
- "beneficiary_hints" (array de strings) : noms / marques visibles qui ressemblent à un bénéficiaire marchand ou personne ("YAMEHOME", marchand OM, banque…), ou [].
- "transaction_refs_seen" (array de strings) : IDs / références visiblement liées au paiement, ou [].
- "confidence_0_to_100" (number) : niveau de certitude lecture (0 si flou vide ou hors-sujet).
- "looks_like_placeholder_or_empty" (boolean) : capture noire/flou/incompréhensible ou document vide pertinent.

Si tu vois plusieurs langues ou textes superposés : priorise lignes financières.
N'invente pas de montant : si invisible, liste vide pour amounts_seen et baisse la confiance.

Contexte carte optionnel fourni après le fichier (caption client) si présent.`;

const ALLOWED_DOWNLOAD_HOSTS = new Set(['82.165.116.138', 'localhost', '127.0.0.1']);

function normalizeBase64ForGemini(raw) {
  const cleaned = String(raw || '')
    .replace(/^data:[^;]+;base64,/, '')
    .replace(/\s/g, '');
  if (!cleaned) return { b64: '', buffer: Buffer.alloc(0) };
  let buffer;
  try {
    buffer = Buffer.from(cleaned, 'base64');
  } catch {
    return { b64: '', buffer: Buffer.alloc(0) };
  }
  if (!buffer.length) return { b64: '', buffer: Buffer.alloc(0) };
  return { b64: buffer.toString('base64'), buffer };
}

function looksLikeValidMedia(buffer, mime) {
  if (!buffer?.length) return false;
  if (mime.startsWith('image/')) {
    return buffer[0] === 0xff && buffer[1] === 0xd8;
  }
  if (mime === 'application/pdf') {
    return buffer.slice(0, 4).toString() === '%PDF';
  }
  return true;
}

async function callGeminiVision(apiKey, effectiveMime, b64, userTextParts) {
  const parts = [
    {
      inline_data: {
        mime_type: effectiveMime,
        data: b64,
      },
    },
    { text: EXTRACTION_PROMPT },
  ];
  if (userTextParts.length) {
    parts.push({ text: userTextParts.join('\n') });
  }

  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
        },
      }),
    });
    const raw = await res.text();
    if (res.ok) {
      return { ok: true, model, raw };
    }
    lastErr = { model, status: res.status, raw: raw.slice(0, 800) };
    logger.warn('[whatsappMediaProofExtract] gemini_try', model, res.status, raw.slice(0, 400));
    if (res.status !== 400 && res.status !== 404) {
      break;
    }
  }
  return { ok: false, lastErr };
}

/**
 * @param {string} downloadUrl
 * @param {string} wahaApiKey
 * @returns {Promise<{ b64: string, mimeFromResponse?: string } | { error: string, status?: number }>}
 */
async function fetchWahaMediaAsBase64(downloadUrl, wahaApiKey) {
  let parsed;
  try {
    parsed = new URL(downloadUrl);
  } catch {
    return { error: 'invalid_download_url' };
  }
  if (!ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname)) {
    return { error: 'download_url_not_allowed' };
  }
  const key = String(wahaApiKey || '').trim();
  if (!key) {
    return { error: 'waha_key_not_configured' };
  }
  const res = await fetch(downloadUrl, {
    headers: { 'X-Api-Key': key },
  });
  if (!res.ok) {
    return { error: 'waha_download_failed', status: res.status };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > 9 * 1024 * 1024) {
    return { error: 'payload_too_large' };
  }
  const mimeFromResponse = String(res.headers.get('content-type') || '').split(';')[0].trim();
  return { b64: buf.toString('base64'), mimeFromResponse };
}

/**
 * @param {import('firebase-functions').Request} req
 * @param {string} expectedLookupKey — WHATSAPP_PROSPECT_LOOKUP_KEY
 * @param {string} geminiApiKey — GOOGLE_AI_STUDIO compatible key
 * @param {string} [wahaApiKey] — clé WAHA pour télécharger downloadUrl si base64 absent
 */
async function handleWhatsAppMediaProofExtract(req, expectedLookupKey, geminiApiKey, wahaApiKey) {
  const expected = String(expectedLookupKey || '').trim();
  const headerKey = req.get('x-yamehome-key') || req.get('X-Yamehome-Key') || '';
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const qKey =
    (typeof req.query?.key === 'string' && req.query.key) ||
    (typeof body.key === 'string' ? body.key : '') ||
    headerKey;

  if (!expected || !qKey || expected.length !== String(qKey).trim().length) {
    return { status: 401, body: { ok: false, error: 'unauthorized' } };
  }
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(qKey).trim(), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { status: 401, body: { ok: false, error: 'unauthorized' } };
  }

  const apiKey = String(geminiApiKey || '').trim();
  if (!apiKey) {
    return { status: 503, body: { ok: false, error: 'gemini_key_not_configured' } };
  }

  if (req.method !== 'POST') {
    return { status: 405, body: { ok: false, error: 'method_not_allowed' } };
  }

  const mimeType = String(body.mimeType || '').trim().toLowerCase();
  let b64 = String(body.base64 || '').replace(/\s/g, '');
  const downloadUrl = typeof body.downloadUrl === 'string' ? body.downloadUrl.trim() : '';
  const caption = typeof body.caption === 'string' ? body.caption.trim() : '';
  const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
  const fnLower = filename.toLowerCase();

  let effectiveMime = mimeType;
  if ((!b64 || b64.length < 80) && downloadUrl) {
    const fetched = await fetchWahaMediaAsBase64(downloadUrl, wahaApiKey);
    if (fetched.error) {
      return { status: 502, body: { ok: false, error: fetched.error, status: fetched.status } };
    }
    b64 = fetched.b64;
    if (!effectiveMime && fetched.mimeFromResponse) {
      effectiveMime = fetched.mimeFromResponse.toLowerCase();
    }
  }

  if (
    (!effectiveMime || effectiveMime === 'application/octet-stream') &&
    fnLower.endsWith('.pdf')
  ) {
    effectiveMime = 'application/pdf';
  }

  if (!effectiveMime || !ALLOWED_MIME_PREFIX.some((p) => effectiveMime.startsWith(p))) {
    return {
      status: 400,
      body: { ok: false, error: 'unsupported_mime', allowed: ALLOWED_MIME_PREFIX },
    };
  }
  let normalized = normalizeBase64ForGemini(b64);
  if (
    (!normalized.b64 || normalized.b64.length < 80 || !looksLikeValidMedia(normalized.buffer, effectiveMime)) &&
    downloadUrl
  ) {
    const fetched = await fetchWahaMediaAsBase64(downloadUrl, wahaApiKey);
    if (!fetched.error) {
      normalized = normalizeBase64ForGemini(fetched.b64);
      if (!effectiveMime && fetched.mimeFromResponse) {
        effectiveMime = fetched.mimeFromResponse.toLowerCase();
      }
    }
  }

  if (!normalized.b64 || normalized.b64.length > MAX_BASE64_CHARS) {
    return { status: 400, body: { ok: false, error: 'invalid_base64_size' } };
  }

  const buffer = normalized.buffer;
  if (!buffer.length || buffer.length > 9 * 1024 * 1024) {
    return { status: 400, body: { ok: false, error: 'payload_too_large' } };
  }
  if (!looksLikeValidMedia(buffer, effectiveMime)) {
    return {
      status: 400,
      body: { ok: false, error: 'invalid_media_bytes', mimeType: effectiveMime },
    };
  }

  b64 = normalized.b64;

  const userTextParts = [];
  if (caption) userTextParts.push(`Légende WhatsApp du client : ${caption}`);
  if (filename) userTextParts.push(`Nom de fichier : ${filename}`);

  try {
    const gemini = await callGeminiVision(apiKey, effectiveMime, b64, userTextParts);
    if (!gemini.ok) {
      const le = gemini.lastErr || {};
      return {
        status: 502,
        body: {
          ok: false,
          error: 'gemini_request_failed',
          status: le.status,
          model: le.model,
          gemini_detail: le.raw,
        },
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(gemini.raw);
    } catch {
      return { status: 502, body: { ok: false, error: 'gemini_invalid_json' } };
    }

    const text =
      parsed?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    let structured;
    try {
      structured = JSON.parse(text);
    } catch (e) {
      logger.warn('[whatsappMediaProofExtract] parse_model_json', e.message);
      structured = {
        readable: false,
        summary_fr: text.slice(0, 2000),
        amounts_seen: [],
        beneficiary_hints: [],
        transaction_refs_seen: [],
        confidence_0_to_100: 0,
        looks_like_placeholder_or_empty: true,
        _raw_model_text: text.slice(0, 4000),
      };
    }

    return {
      status: 200,
      body: {
        ok: true,
        kind: 'media_proof_extract',
        mimeType: effectiveMime,
        generatedAt: new Date().toISOString(),
        model: gemini.model,
        extraction: structured,
      },
    };
  } catch (e) {
    logger.error('[whatsappMediaProofExtract]', e.message || e);
    return {
      status: 500,
      body: { ok: false, error: 'extract_failed', detail: String(e.message || e) },
    };
  }
}

module.exports = { handleWhatsAppMediaProofExtract };
