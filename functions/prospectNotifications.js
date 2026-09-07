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

/**
 * Email de confirmation bilingue (FR/EN) envoyé au prospect après sa pré-réservation.
 *
 * @param {object} params
 * @param {string} params.prospectId  ID Firestore du prospect
 * @param {Record<string, unknown>} params.data  Données du prospect
 * @param {{ user: string; pass: string }} params.smtp
 */
async function sendProspectConfirmationEmail({ prospectId, data, smtp }) {
  const authUser = String(smtp.user || '').trim().toLowerCase();
  const authPass = String(smtp.pass || '').trim().replace(/\s/g, '');

  const prospectEmail = String(data.email || '').trim();
  if (!prospectEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prospectEmail)) {
    logger.info(`[prospectConfirmEmail] pas d'email valide pour ${prospectId} — confirmation non envoyée`);
    return;
  }

  const firstName = String(data.firstName || '').trim();
  const lastName = String(data.lastName || '').trim();
  const client = [firstName, lastName].filter(Boolean).join(' ') || 'Client';
  const apartment = String(data.apartmentName || data.calendarSlug || '').trim() || '—';
  const startDate = String(data.startDate || '').trim() || '—';
  const endDate = String(data.endDate || '').trim() || '—';
  const guests = data.guestCount != null ? String(data.guestCount) : '1';
  const price = formatMoneyXaf(data.totalStayPrice);
  const shortRef = prospectId.slice(0, 8).toUpperCase();

  const subject = `[YameHome] Confirmation de pré-réservation / Booking confirmation — Réf. ${shortRef}`;
  const preheader = `${apartment} · ${startDate} → ${endDate} · Réf. ${shortRef}`;

  /* -------- HTML bilingue -------- */
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f0ece8;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.5;">
  <!-- preheader -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f0ece8;opacity:0;">${escapeHtml(preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0ece8;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:16px;border-collapse:separate;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

        <!-- ===== HEADER ===== -->
        <tr>
          <td style="background:linear-gradient(135deg,#134e4a 0%,#0f766e 100%);padding:0;">
            <!-- Logo + Titre -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:28px 28px 12px;">
                  <!-- Logo text (image fallback) -->
                  <table role="presentation" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="background:#ffffff18;border-radius:8px;padding:7px 14px;">
                        <span style="font-size:18px;font-weight:800;letter-spacing:0.06em;color:#ffffff;text-transform:uppercase;font-family:Georgia,serif;">Yame<span style="color:#fcd34d;">Home</span></span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 28px 28px;">
                  <h1 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#ffffff;line-height:1.25;">
                    Pré-réservation reçue ✓
                  </h1>
                  <p style="margin:0;font-size:14px;color:#a7f3d0;font-style:italic;">Booking request received</p>
                </td>
              </tr>
            </table>

            <!-- Bannière ref -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#0d3d3a;padding:12px 28px;">
                  <p style="margin:0;font-size:12px;color:#6ee7b7;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">Référence / Reference</p>
                  <p style="margin:2px 0 0;font-size:20px;font-weight:800;color:#ffffff;font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:0.12em;">${escapeHtml(shortRef)}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ===== INTRO ===== -->
        <tr>
          <td style="padding:28px 28px 8px;">
            <p style="margin:0 0 6px;font-size:16px;font-weight:600;color:#134e4a;">Bonjour ${escapeHtml(firstName || client)},</p>
            <p style="margin:0 0 14px;color:#374151;font-size:14px;">
              Nous avons bien reçu votre demande de pré-réservation. Notre équipe vous contactera dans les plus brefs délais pour confirmer les disponibilités et les modalités de paiement.
            </p>
            <p style="margin:0 0 0;color:#6b7280;font-size:13px;font-style:italic;">
              We have received your booking request. Our team will contact you shortly to confirm availability and payment details.
            </p>
          </td>
        </tr>

        <!-- ===== RÉCAP SÉJOUR ===== -->
        <tr>
          <td style="padding:20px 28px 8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #134e4a;border-radius:12px;border-collapse:separate;overflow:hidden;">
              <!-- Header table -->
              <tr>
                <td colspan="2" style="background:#134e4a;padding:12px 18px;">
                  <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#a7f3d0;">Résumé du séjour / Stay summary</p>
                </td>
              </tr>
              <!-- Ligne logement -->
              <tr style="border-bottom:1px solid #e5e7eb;">
                <td style="padding:12px 18px 12px 18px;width:40%;color:#6b7280;font-size:13px;vertical-align:top;border-bottom:1px solid #f3f4f6;">
                  🏠 Logement<br/><span style="font-style:italic;font-size:11px;color:#9ca3af;">Property</span>
                </td>
                <td style="padding:12px 18px;font-size:14px;font-weight:700;color:#134e4a;vertical-align:top;border-bottom:1px solid #f3f4f6;">
                  ${escapeHtml(apartment)}
                </td>
              </tr>
              <!-- Arrivée -->
              <tr>
                <td style="padding:12px 18px;color:#6b7280;font-size:13px;vertical-align:top;border-bottom:1px solid #f3f4f6;">
                  📅 Arrivée<br/><span style="font-style:italic;font-size:11px;color:#9ca3af;">Check-in</span>
                </td>
                <td style="padding:12px 18px;font-size:14px;font-weight:600;color:#1f2937;vertical-align:top;border-bottom:1px solid #f3f4f6;">
                  ${escapeHtml(startDate)}
                </td>
              </tr>
              <!-- Départ -->
              <tr>
                <td style="padding:12px 18px;color:#6b7280;font-size:13px;vertical-align:top;border-bottom:1px solid #f3f4f6;">
                  📅 Départ<br/><span style="font-style:italic;font-size:11px;color:#9ca3af;">Check-out</span>
                </td>
                <td style="padding:12px 18px;font-size:14px;font-weight:600;color:#1f2937;vertical-align:top;border-bottom:1px solid #f3f4f6;">
                  ${escapeHtml(endDate)}
                </td>
              </tr>
              <!-- Voyageurs -->
              <tr>
                <td style="padding:12px 18px;color:#6b7280;font-size:13px;vertical-align:top;border-bottom:1px solid #f3f4f6;">
                  👥 Voyageurs<br/><span style="font-style:italic;font-size:11px;color:#9ca3af;">Guests</span>
                </td>
                <td style="padding:12px 18px;font-size:14px;color:#1f2937;vertical-align:top;border-bottom:1px solid #f3f4f6;">
                  ${escapeHtml(guests)}
                </td>
              </tr>
              <!-- Total -->
              ${price && price !== '—' ? `<tr>
                <td style="padding:12px 18px;color:#6b7280;font-size:13px;vertical-align:top;background:#f9fafb;">
                  💰 Total estimé<br/><span style="font-style:italic;font-size:11px;color:#9ca3af;">Estimated total</span>
                </td>
                <td style="padding:12px 18px;vertical-align:top;background:#f9fafb;">
                  <span style="font-size:18px;font-weight:800;color:#134e4a;">${escapeHtml(price)}</span>
                  <br/><span style="font-size:10px;color:#9ca3af;">(caution incluse / deposit included)</span>
                </td>
              </tr>` : ''}
            </table>
          </td>
        </tr>

        <!-- ===== ÉTAPES SUIVANTES ===== -->
        <tr>
          <td style="padding:20px 28px 8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;">
              <tr>
                <td style="padding:16px 18px;">
                  <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.06em;">Prochaines étapes / Next steps</p>
                  <p style="margin:0 0 6px;font-size:13px;color:#166534;">
                    1. Notre équipe examine votre demande (réponse sous 24h).<br/>
                    <span style="color:#4ade80;font-style:italic;">Our team reviews your request (reply within 24h).</span>
                  </p>
                  <p style="margin:0 0 6px;font-size:13px;color:#166534;">
                    2. Nous vous confirmions la disponibilité et les conditions de paiement.<br/>
                    <span style="color:#4ade80;font-style:italic;">We confirm availability and payment terms.</span>
                  </p>
                  <p style="margin:0;font-size:13px;color:#166534;">
                    3. La réservation est <strong>définitive après paiement de l'acompte</strong> (1/3 du total hors caution).<br/>
                    <span style="color:#4ade80;font-style:italic;">Booking is <strong style="color:#86efac;">confirmed upon deposit payment</strong> (1/3 of total, excluding security deposit).</span>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ===== CONTACT ===== -->
        <tr>
          <td style="padding:20px 28px 8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;">
              <tr>
                <td style="padding:16px 18px;">
                  <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:0.06em;">Nous contacter / Contact us</p>
                  <p style="margin:0 0 4px;font-size:13px;color:#9a3412;">
                    📧 <a href="mailto:yamehome.yaounde@gmail.com" style="color:#c2410c;font-weight:600;">yamehome.yaounde@gmail.com</a>
                  </p>
                  <p style="margin:0;font-size:13px;color:#9a3412;">
                    💬 WhatsApp : <a href="https://wa.me/237657507671" style="color:#c2410c;font-weight:600;">+237 657 507 671</a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ===== FOOTER ===== -->
        <tr>
          <td style="padding:24px 28px;border-top:1px solid #e5e7eb;margin-top:12px;">
            <p style="margin:0 0 6px;font-size:12px;color:#9ca3af;line-height:1.5;">
              Cet email confirme la réception de votre demande. Il ne constitue pas une confirmation définitive de réservation.<br/>
              <em>This email confirms receipt of your request. It does not constitute a definitive booking confirmation.</em>
            </p>
            <p style="margin:8px 0 0;font-size:11px;color:#d1d5db;">
              © YameHome · Yaoundé, Cameroun · <a href="https://yamehome.com" style="color:#9ca3af;text-decoration:none;">yamehome.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Bonjour ${client},`,
    '',
    'Votre pré-réservation a bien été reçue. / Your booking request has been received.',
    '',
    `Référence / Reference : ${shortRef}`,
    `Logement / Property   : ${apartment}`,
    `Arrivée / Check-in    : ${startDate}`,
    `Départ / Check-out    : ${endDate}`,
    `Voyageurs / Guests    : ${guests}`,
    price && price !== '—' ? `Total estimé / Total  : ${price}` : '',
    '',
    'Notre équipe vous contactera sous 24h pour confirmer la disponibilité et les modalités de paiement.',
    'La réservation est définitive après paiement de l\'acompte (1/3 du total hors caution).',
    'Your booking is confirmed upon deposit payment (1/3 of total, excl. security deposit).',
    'Our team will contact you within 24h to confirm availability and payment details.',
    '',
    'Contact : yamehome.yaounde@gmail.com',
    'WhatsApp : +237 657 507 671',
    '',
    '© YameHome · Yaoundé, Cameroun',
  ].filter(s => s !== null).join('\n');

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: authUser, pass: authPass },
  });

  await transporter.sendMail({
    from: `"YameHome" <${authUser}>`,
    to: prospectEmail,
    subject,
    text,
    html,
  });

  logger.info(`[prospectConfirmEmail] confirmation envoyée à ${prospectEmail} pour ${prospectId}`);
}

module.exports = {
  sendProspectCreatedEmail,
  sendProspectConfirmationEmail,
  WEBSITE_PROSPECT_AUTHOR_UID,
};
