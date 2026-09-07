/**
 * Alerte e-mail interne quand un check-in client est validé sur un reçu (planning).
 * Destinataires : cyamepi@gmail.com + yamehome.yaounde@gmail.com
 * SMTP : même secret PROSPECT_SMTP_APP_PASSWORD (compte yamehome.yaounde@gmail.com).
 */
'use strict';

const nodemailer = require('nodemailer');
const { logger } = require('firebase-functions');

const CHECK_IN_NOTIFY_TO = 'cyamepi@gmail.com, yamehome.yaounde@gmail.com';

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Compare checkInsBySegmentId avant/après ; retourne les nouveaux segments validés.
 * @param {Record<string, unknown>|null|undefined} before
 * @param {Record<string, unknown>|null|undefined} after
 * @returns {Array<{ segmentId: string, record: Record<string, unknown> }>}
 */
function detectNewCheckIns(before, after) {
  const prev = before && typeof before === 'object' ? before : {};
  const next = after && typeof after === 'object' ? after : {};
  const added = [];
  for (const segmentId of Object.keys(next)) {
    if (!next[segmentId] || typeof next[segmentId] !== 'object') continue;
    if (prev[segmentId]) continue;
    added.push({ segmentId, record: next[segmentId] });
  }
  return added;
}

/**
 * @param {object} params
 * @param {{ user: string; pass: string }} params.smtp
 * @param {string} params.receiptDocId
 * @param {Record<string, unknown>} params.receipt
 * @param {string} params.segmentId
 * @param {Record<string, unknown>} params.checkIn
 */
async function sendCheckInValidatedEmail({ smtp, receiptDocId, receipt, segmentId, checkIn }) {
  const authUser = String(smtp.user || '').trim().toLowerCase();
  const authPass = String(smtp.pass || '').trim().replace(/\s/g, '');
  if (!authUser || !authPass) {
    throw new Error('SMTP credentials manquantes pour alerte check-in');
  }

  const client =
    `${String(receipt.firstName || '').trim()} ${String(receipt.lastName || '').trim()}`.trim() || '—';
  const phone = String(receipt.phone || '').trim() || '—';
  const apartment = String(receipt.apartmentName || '').trim() || '—';
  const unit = String(receipt.calendarSlug || '').trim() || '—';
  const startDate = String(receipt.startDate || '').trim() || '—';
  const endDate = String(receipt.endDate || '').trim() || '—';
  const receiptId = String(receipt.receiptId || receiptDocId || '').trim() || '—';
  const agent =
    String(checkIn.authorDisplayName || '').trim() ||
    String(checkIn.authorUid || '').trim() ||
    '—';
  const validatedAt = String(checkIn.validatedAt || '').trim() || '—';
  const idPiece = String(checkIn.idPieceControlee || '').trim() || '—';
  const kwh =
    checkIn.kwhCompteurPrepaye != null && checkIn.kwhCompteurPrepaye !== ''
      ? String(checkIn.kwhCompteurPrepaye)
      : '—';
  const comment = String(checkIn.commentaire || '').trim() || '—';

  const subject = `[YameHome] Check-in validé — ${client} · ${apartment}`;
  const text = [
    'Un check-in client a été validé dans le planning.',
    '',
    `Reçu : ${receiptId}`,
    `Doc Firestore : ${receiptDocId}`,
    `Segment : ${segmentId}`,
    `Validé le : ${validatedAt}`,
    `Par : ${agent}`,
    '',
    `Client : ${client}`,
    `Téléphone : ${phone}`,
    `Logement : ${apartment} (${unit})`,
    `Séjour : ${startDate} → ${endDate}`,
    `Pièce contrôlée : ${idPiece}`,
    `kWh compteur : ${kwh}`,
    `Commentaire : ${comment}`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#e8e6e3;font-family:Segoe UI,Roboto,Arial,sans-serif;font-size:14px;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
    <tr><td style="background:#134e4a;padding:20px 24px;color:#ecfdf5;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;opacity:0.9;">YameHome</p>
      <h1 style="margin:0;font-size:20px;">Check-in validé</h1>
      <p style="margin:10px 0 0;font-weight:600;">${escapeHtml(client)}</p>
      <p style="margin:6px 0 0;opacity:0.9;">${escapeHtml(apartment)} · ${escapeHtml(startDate)} → ${escapeHtml(endDate)}</p>
    </td></tr>
    <tr><td style="padding:22px 24px;">
      <p style="margin:0 0 12px;color:#475569;font-size:13px;">Validation enregistrée dans l’app (planning).</p>
      <p style="margin:0 0 6px;"><strong>Reçu</strong> : ${escapeHtml(receiptId)}</p>
      <p style="margin:0 0 6px;"><strong>Téléphone</strong> : ${escapeHtml(phone)}</p>
      <p style="margin:0 0 6px;"><strong>Unité</strong> : ${escapeHtml(unit)}</p>
      <p style="margin:0 0 6px;"><strong>Agent</strong> : ${escapeHtml(agent)}</p>
      <p style="margin:0 0 6px;"><strong>Validé le</strong> : ${escapeHtml(validatedAt)}</p>
      <p style="margin:0 0 6px;"><strong>Pièce contrôlée</strong> : ${escapeHtml(idPiece)}</p>
      <p style="margin:0 0 6px;"><strong>kWh</strong> : ${escapeHtml(kwh)}</p>
      <p style="margin:12px 0 0;"><strong>Commentaire</strong><br>${escapeHtml(comment)}</p>
      <p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #e7e5e4;font-size:11px;color:#94a3b8;">Email automatique — ne pas répondre.</p>
    </td></tr>
  </table>
</body></html>`;

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: authUser, pass: authPass },
  });

  await transporter.sendMail({
    from: `"YameHome" <${authUser}>`,
    to: CHECK_IN_NOTIFY_TO,
    subject,
    text,
    html,
  });

  logger.info(`[checkInEmail] alerte envoyée pour receipts/${receiptDocId} segment=${segmentId}`);
}

module.exports = {
  detectNewCheckIns,
  sendCheckInValidatedEmail,
  CHECK_IN_NOTIFY_TO,
};
