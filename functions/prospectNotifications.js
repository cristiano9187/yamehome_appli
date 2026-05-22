'use strict';

/**
 * Notifications email à la création d’un prospect.
 * SMTP Gmail : définir le secret PROSPECT_SMTP_APP_PASSWORD (mot de passe d’application Google).
 *
 * Le secret PROSPECT_SMTP_APP_PASSWORD = mot de passe d’application Google de yamehome.yaounde@gmail.com.
 * Destinataire et expéditeur sont fixés dans functions/index.js.
 */

const nodemailer = require('nodemailer');
const { getAuth } = require('firebase-admin/auth');
const { logger } = require('firebase-functions');

/** Doit rester aligné avec submitWebsiteProspect (index.js). */
const WEBSITE_PROSPECT_AUTHOR_UID = 'yamehome-site-public';

const SOURCE_LABELS = {
  FACEBOOK: 'Facebook',
  AIRBNB: 'Airbnb',
  BOOKING: 'Booking',
  TELEPHONE: 'Téléphone',
  WHATSAPP: 'WhatsApp',
  AUTRE: 'Autre',
  SITE_WEB: 'Site web',
};

const STATUS_LABELS = {
  NOUVEAU: 'Nouveau',
  A_RELANCER: 'À relancer',
  EN_NEGOCIATION: 'En négociation',
  CONVERTI: 'Converti',
  PERDU: 'Perdu',
  ANNULE: 'Annulé',
};

function escapeHtml(s) {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2brEsc(s) {
  return escapeHtml(s).replace(/\n/g, '<br/>');
}

/** Lien tel: — garde le libellé affiché, href simplifié pour les clients mail. */
function phoneLinkHtml(displayPhone) {
  if (!displayPhone || displayPhone === '—') return escapeHtml(displayPhone || '—');
  const raw = String(displayPhone);
  const href = raw.replace(/[^\d+]/g, '') || raw;
  return `<a href="tel:${escapeHtml(href)}" style="color:#0f766e;text-decoration:none;font-weight:600;">${escapeHtml(raw)}</a>`;
}

function emailLinkHtml(displayEmail) {
  if (!displayEmail || displayEmail === '—') return escapeHtml(displayEmail || '—');
  const e = String(displayEmail).trim();
  return `<a href="mailto:${escapeHtml(e)}" style="color:#0f766e;text-decoration:none;">${escapeHtml(e)}</a>`;
}

/**
 * @param {string} title
 * @param {string} rowsHtml lignes <tr>…</tr> (valeurs déjà safe HTML)
 */
function emailSection(title, rowsHtml) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border:1px solid #e7e5e4;border-radius:10px;border-collapse:separate;">
    <tr>
      <td style="background:#f8fafc;padding:10px 16px;border-bottom:1px solid #e7e5e4;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#475569;">
        ${escapeHtml(title)}
      </td>
    </tr>
    <tr>
      <td style="padding:8px 16px 14px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          ${rowsHtml}
        </table>
      </td>
    </tr>
  </table>`;
}

/** @param {string} valueHtml */
function kvRow(label, valueHtml) {
  return `<tr>
    <td style="padding:8px 14px 8px 0;width:36%;max-width:160px;color:#64748b;font-size:13px;vertical-align:top;line-height:1.4;">${escapeHtml(label)}</td>
    <td style="padding:8px 0;font-size:14px;color:#0f172a;vertical-align:top;line-height:1.45;">${valueHtml}</td>
  </tr>`;
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {import('firebase-admin/app').App} adminApp
 * @param {string} authorUid
 */
async function resolveCreatorLabel(db, adminApp, authorUid) {
  if (!authorUid || authorUid === WEBSITE_PROSPECT_AUTHOR_UID) {
    return 'Formulaire public (yamehome.com) — pas d’employé connecté';
  }
  try {
    const doc = await db.collection('users').doc(authorUid).get();
    if (doc.exists) {
      const d = doc.data() || {};
      const name = String(d.displayName || '').trim();
      const email = String(d.email || '').trim();
      if (name && email) return `${name} (${email})`;
      if (name) return name;
      if (email) return email;
    }
  } catch (e) {
    logger.warn('[prospectEmail] lecture users/', authorUid, e.message);
  }
  try {
    const rec = await getAuth(adminApp).getUser(authorUid);
    const bits = [rec.displayName, rec.email].filter(Boolean);
    if (bits.length) return bits.join(' — ');
  } catch (e) {
    logger.warn('[prospectEmail] getUser', authorUid, e.message);
  }
  return `Compte Firebase (UID court: ${authorUid.slice(0, 8)}…)`;
}

function formatMoneyXaf(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
  try {
    return `${Number(n).toLocaleString('fr-FR')} FCFA`;
  } catch {
    return String(n);
  }
}

/**
 * @param {object} params
 * @param {import('firebase-admin/firestore').Firestore} params.db
 * @param {import('firebase-admin/app').App} params.adminApp
 * @param {string} params.prospectId
 * @param {Record<string, unknown>} params.data
 * @param {{ user: string; pass: string }} params.smtp
 * @param {string} params.to
 */
async function sendProspectCreatedEmail({ db, adminApp, prospectId, data, smtp, to }) {
  const creator = await resolveCreatorLabel(db, adminApp, String(data.authorUid || ''));

  /** Gmail affiche le mot de passe d’app par groupes (`xxxx xxxx …`) : tout espace casserait l’auth 535. */
  const authUser = String(smtp.user || '').trim().toLowerCase();
  const authPass = String(smtp.pass || '').trim().replace(/\s/g, '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authUser)) {
    logger.error(
      `[prospectEmail] SMTP user invalide : "${authUser.slice(0, 40)}…" — doit être une adresse Gmail (ex. yamehome.yaounde@gmail.com), pas le mot de passe d'application.`
    );
    throw new Error(
      'SMTP : utilisez l’adresse Gmail comme identifiant et le mot de passe d’application dans le secret PROSPECT_SMTP_APP_PASSWORD uniquement.'
    );
  }

  const sourceKey = String(data.source || '');
  const statusKey = String(data.status || '');
  const source = SOURCE_LABELS[sourceKey] || sourceKey || '—';
  const status = STATUS_LABELS[statusKey] || statusKey || '—';

  const client = `${String(data.firstName || '').trim()} ${String(data.lastName || '').trim()}`.trim() || '—';
  const phone = String(data.phone || '').trim() || '—';
  const emailClient = String(data.email || '').trim() || '—';
  const apartment = String(data.apartmentName || '').trim() || '—';
  const unit = String(data.calendarSlug || '').trim() || '—';
  const startDate = String(data.startDate || '').trim() || '—';
  const endDate = String(data.endDate || '').trim() || '—';
  const guests = data.guestCount != null ? String(data.guestCount) : '—';
  const price = formatMoneyXaf(data.totalStayPrice);
  const budget = data.budget != null && data.budget !== '' ? formatMoneyXaf(data.budget) : '—';
  const assignedTo = String(data.assignedTo || '').trim() || '—';
  const nextFollowUp = String(data.nextFollowUpDate || '').trim() || '—';
  const notes = String(data.notes || '').trim() || '—';
  const createdAt = String(data.createdAt || '').trim() || '—';

  const subject = `[YameHome] Nouveau prospect — ${client} (${source})`;
  const preheader = `${client} · ${startDate} → ${endDate} · ${source}`.replace(/—/g, '-');

  const text = [
    'Un nouveau prospect a été enregistré.',
    '',
    `ID Firestore : ${prospectId}`,
    `Créé le : ${createdAt}`,
    `Créé par : ${creator}`,
    '',
    '--- Client ---',
    `Nom : ${client}`,
    `Téléphone : ${phone}`,
    `Email : ${emailClient}`,
    '',
    '--- Séjour ---',
    `Source : ${source}`,
    `Statut : ${status}`,
    `Logement : ${apartment}`,
    `Unité (slug) : ${unit}`,
    `Arrivée : ${startDate}`,
    `Départ : ${endDate}`,
    `Personnes : ${guests}`,
    `Budget indicatif : ${budget}`,
    `Prix séjour (si renseigné) : ${price}`,
    `Assigné à : ${assignedTo}`,
    `Prochaine relance : ${nextFollowUp}`,
    '',
    '--- Notes ---',
    notes,
  ].join('\n');

  const metaRows =
    kvRow('ID Firestore', `<code style="font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px;">${escapeHtml(prospectId)}</code>`) +
    kvRow('Créé le', escapeHtml(createdAt)) +
    kvRow('Créé par', nl2brEsc(creator));

  const clientRows =
    kvRow('Nom', `<strong style="font-size:15px;">${escapeHtml(client)}</strong>`) +
    kvRow('Téléphone', phoneLinkHtml(phone)) +
    kvRow('Email', emailLinkHtml(emailClient));

  const stayRows =
    kvRow('Source', `<strong>${escapeHtml(source)}</strong>`) +
    kvRow('Statut', escapeHtml(status)) +
    kvRow('Logement', escapeHtml(apartment)) +
    kvRow('Unité', `<span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;">${escapeHtml(unit)}</span>`) +
    kvRow('Dates', `<strong>${escapeHtml(startDate)}</strong> → <strong>${escapeHtml(endDate)}</strong>`) +
    kvRow('Personnes', escapeHtml(guests)) +
    kvRow('Budget indicatif', escapeHtml(budget)) +
    kvRow('Prix séjour', `<strong>${escapeHtml(price)}</strong>`) +
    kvRow('Assigné à', escapeHtml(assignedTo)) +
    kvRow('Prochaine relance', escapeHtml(nextFollowUp));

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#e8e6e3;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.45;">
  <!-- Pré-en-tête (aperçu boîte mail) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;opacity:0;">
    ${escapeHtml(preheader)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8e6e3;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border-collapse:separate;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.06);">
          <tr>
            <td style="background:#134e4a;padding:22px 24px;color:#ecfdf5;">
              <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;opacity:0.9;">YameHome</p>
              <h1 style="margin:0;font-size:20px;font-weight:700;line-height:1.25;">Nouveau prospect</h1>
              <p style="margin:10px 0 0;font-size:15px;font-weight:600;opacity:0.95;">${escapeHtml(client)}</p>
              <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">${escapeHtml(startDate)} → ${escapeHtml(endDate)} · ${escapeHtml(source)}</p>
              <p style="margin:12px 0 0;font-size:13px;opacity:0.85;">${phoneLinkHtml(phone)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 24px 8px;">
              <p style="margin:0 0 18px;color:#475569;font-size:13px;">Création enregistrée dans l’app. Détail ci-dessous.</p>
              ${emailSection('Enregistrement', metaRows)}
              ${emailSection('Client', clientRows)}
              ${emailSection('Séjour', stayRows)}
              <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#475569;">Notes</p>
              <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:14px 16px;border-radius:10px;font-size:14px;color:#334155;">${nl2brEsc(notes)}</div>
              <p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #e7e5e4;font-size:11px;color:#94a3b8;line-height:1.5;">
                Email automatique — ne pas répondre directement à cette adresse technique.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: authUser,
      pass: authPass,
    },
  });

  /** Indépendant du compte Firebase dans le navigateur (ex. christian.yamepi@gmail.com). */
  logger.info(`[prospectEmail] SMTP auth user (compte Gmail expéditeur) = ${authUser}`);

  const toList = String(to)
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  await transporter.sendMail({
    from: `"YameHome Prospects" <${authUser}>`,
    to: toList.length <= 1 ? (toList[0] || to) : toList,
    subject,
    text,
    html,
  });

  logger.info(`[prospectEmail] envoyé pour ${prospectId} → ${toList.join(', ')}`);
}

module.exports = {
  sendProspectCreatedEmail,
  WEBSITE_PROSPECT_AUTHOR_UID,
};
