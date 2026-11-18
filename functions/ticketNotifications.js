'use strict';

/**
 * Notification à la création d’un ticket interne.
 * 1) Email → assigneeEmail (toujours)
 * 2) WhatsApp WAHA → notifyPhone sur authorized_emails si présent
 */

const nodemailer = require('nodemailer');
const { logger } = require('firebase-functions');

const SMTP_FROM = 'yamehome.yaounde@gmail.com';

function escapeHtml(s) {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function digitsOnly(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/** chatId WAHA style `2376…@c.us` (Cameroun 237 par défaut si 9 chiffres). */
function phoneToWahaChatId(phone) {
  let d = digitsOnly(phone);
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9 && d.startsWith('6')) d = `237${d}`;
  if (d.length < 10) return null;
  return `${d}@c.us`;
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} email
 */
async function resolveNotifyPhone(db, email) {
  const id = String(email || '').toLowerCase().trim();
  if (!id) return null;
  try {
    const snap = await db.collection('authorized_emails').doc(id).get();
    if (!snap.exists) return null;
    const phone = String(snap.data()?.notifyPhone || '').trim();
    return phone || null;
  } catch (e) {
    logger.warn('[ticketNotify] lecture notifyPhone', id, e.message);
    return null;
  }
}

/**
 * @param {{ title: string, acceptance?: string, description?: string, createdByName?: string, createdByEmail?: string, dueDate?: string|null, site?: string|null, ticketId: string }} ticket
 * @param {{ user: string, pass: string }} smtp
 * @param {string} toEmail
 */
async function sendTicketAssignedEmail(ticket, smtp, toEmail) {
  const authUser = String(smtp.user).trim().toLowerCase();
  const authPass = String(smtp.pass).trim().replace(/\s/g, '');
  const to = String(toEmail).trim().toLowerCase();
  if (!to || !authPass) throw new Error('smtp_or_to_missing');

  const title = ticket.title || 'Ticket YameHome';
  const subject = `[YameHome] Nouveau ticket : ${title}`;
  const creator = ticket.createdByName || ticket.createdByEmail || '—';
  const acceptance = ticket.acceptance || '—';
  const description = ticket.description || '—';
  const due = ticket.dueDate || '—';
  const site = ticket.site || '—';

  const text = [
    'Nouveau ticket YameHome assigné à toi.',
    '',
    `Titre : ${title}`,
    `Créé par : ${creator}`,
    `Échéance : ${due}`,
    `Site : ${site}`,
    '',
    'Description :',
    description,
    '',
    'Acceptance :',
    acceptance,
    '',
    'Ouvre l’app YameHome → menu Tickets → À faire.',
  ].join('\n');

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#f5f5f4;padding:24px;">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;border:1px solid #e7e5e4;">
    <tr><td style="padding:20px 24px;background:#4f46e5;color:#fff;border-radius:16px 16px 0 0;">
      <p style="margin:0;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">YameHome · Tickets</p>
      <h1 style="margin:8px 0 0;font-size:18px;">${escapeHtml(title)}</h1>
    </td></tr>
    <tr><td style="padding:20px 24px;font-size:14px;color:#0f172a;line-height:1.5;">
      <p style="margin:0 0 12px;">Un ticket t’a été assigné. Ouvre l’app → <strong>Tickets</strong> → <strong>À faire</strong>.</p>
      <p style="margin:0 0 6px;"><strong>Créé par</strong> : ${escapeHtml(creator)}</p>
      <p style="margin:0 0 6px;"><strong>Échéance</strong> : ${escapeHtml(due)}</p>
      <p style="margin:0 0 12px;"><strong>Site</strong> : ${escapeHtml(site)}</p>
      <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.06em;">Description</p>
      <p style="margin:0 0 14px;white-space:pre-wrap;">${escapeHtml(description)}</p>
      <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.06em;">Acceptance</p>
      <p style="margin:0;white-space:pre-wrap;">${escapeHtml(acceptance)}</p>
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
    from: `"YameHome Tickets" <${SMTP_FROM}>`,
    to,
    subject,
    text,
    html,
  });

  logger.info(`[ticketNotify] email envoyé → ${to} ticket=${ticket.ticketId}`);
}

/**
 * @param {string} wahaBaseUrl
 * @param {string} wahaApiKey
 * @param {string} phone
 * @param {string} text
 */
async function sendTicketWhatsApp(wahaBaseUrl, wahaApiKey, phone, text) {
  const base = String(wahaBaseUrl || '').replace(/\/$/, '');
  const key = String(wahaApiKey || '').trim();
  const chatId = phoneToWahaChatId(phone);
  if (!base || !key || !chatId) {
    return { ok: false, reason: 'waha_not_configured_or_bad_phone' };
  }

  const res = await fetch(`${base}/api/sendText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': key,
    },
    body: JSON.stringify({
      session: 'default',
      chatId,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.error('[ticketNotify] WAHA sendText failed', res.status, body.slice(0, 300));
    return { ok: false, reason: `waha_http_${res.status}` };
  }

  logger.info(`[ticketNotify] WhatsApp envoyé → ${chatId}`);
  return { ok: true };
}

/**
 * @param {object} opts
 * @param {import('firebase-admin/firestore').Firestore} opts.db
 * @param {string} opts.ticketId
 * @param {object} opts.data — document ticket
 * @param {{ user: string, pass: string }} opts.smtp
 * @param {string} [opts.wahaBaseUrl]
 * @param {string} [opts.wahaApiKey]
 */
async function notifyTicketAssignee(opts) {
  const { db, ticketId, data, smtp, wahaBaseUrl, wahaApiKey } = opts;
  const toEmail = String(data.assigneeEmail || '').toLowerCase().trim();
  if (!toEmail) {
    logger.warn('[ticketNotify] pas d’assigneeEmail', ticketId);
    return;
  }

  const ticket = {
    ticketId,
    title: String(data.title || ''),
    description: String(data.description || ''),
    acceptance: String(data.acceptance || ''),
    createdByName: String(data.createdByName || ''),
    createdByEmail: String(data.createdByEmail || ''),
    dueDate: data.dueDate || null,
    site: data.site || null,
  };

  try {
    await sendTicketAssignedEmail(ticket, smtp, toEmail);
  } catch (e) {
    logger.error('[ticketNotify] email échoué', e.message || e);
  }

  const phone = await resolveNotifyPhone(db, toEmail);
  if (!phone) {
    logger.info(`[ticketNotify] pas de notifyPhone pour ${toEmail} — email seul`);
    return;
  }

  const waText = [
    `🎫 *YameHome — nouveau ticket*`,
    ``,
    `*${ticket.title}*`,
    ticket.dueDate ? `Échéance : ${ticket.dueDate}` : null,
    ticket.site ? `Site : ${ticket.site}` : null,
    ``,
    ticket.acceptance ? `Acceptance :\n${ticket.acceptance}` : null,
    ``,
    `Ouvre l’app → Tickets → À faire.`,
  ]
    .filter((l) => l != null)
    .join('\n');

  try {
    await sendTicketWhatsApp(wahaBaseUrl, wahaApiKey, phone, waText);
  } catch (e) {
    logger.error('[ticketNotify] WhatsApp échoué', e.message || e);
  }
}

module.exports = {
  notifyTicketAssignee,
  sendTicketAssignedEmail,
  sendTicketWhatsApp,
  phoneToWahaChatId,
  resolveNotifyPhone,
};
