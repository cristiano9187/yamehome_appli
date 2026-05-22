'use strict';

/**
 * JSON lecture seule de la collection `prospects` pour injection dans le prompt WhatsApp (n8n).
 * Même auth que whatsappProspectLookup (X-Yamehome-Key).
 */

const crypto = require('crypto');
const { logger } = require('firebase-functions');

const MAX_DOCS = 300;

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {import('firebase-functions').Request} req
 * @param {string} expectedKey
 */
async function handleWhatsAppProspectFeed(db, req, expectedKey) {
  const expected = String(expectedKey || '').trim();
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

  try {
    const snap = await db.collection('prospects').limit(500).get();
    let prospects = snap.docs.map((doc) => {
      const d = doc.data() || {};
      return {
        id: doc.id,
        firstName: d.firstName != null ? String(d.firstName) : '',
        lastName: d.lastName != null ? String(d.lastName) : '',
        phone: d.phone != null ? String(d.phone) : '',
        email: d.email != null ? String(d.email) : '',
        apartmentName: d.apartmentName != null ? String(d.apartmentName) : '',
        calendarSlug: d.calendarSlug != null ? String(d.calendarSlug) : '',
        source: d.source != null ? String(d.source) : '',
        startDate: d.startDate != null ? String(d.startDate) : '',
        endDate: d.endDate != null ? String(d.endDate) : '',
        totalStayPrice:
          d.totalStayPrice != null && d.totalStayPrice !== '' ? Number(d.totalStayPrice) : null,
        guestCount:
          d.guestCount != null && d.guestCount !== '' ? Number(d.guestCount) : null,
        budget: d.budget != null && d.budget !== '' ? Number(d.budget) : null,
        createdAt: d.createdAt != null ? String(d.createdAt) : '',
        updatedAt: d.updatedAt != null ? String(d.updatedAt) : '',
      };
    });
    prospects.sort((a, b) =>
      String(b.updatedAt || b.createdAt || '').localeCompare(
        String(a.updatedAt || a.createdAt || ''),
      ),
    );
    prospects = prospects.slice(0, MAX_DOCS);

    return {
      status: 200,
      body: {
        ok: true,
        kind: 'prospects_feed',
        count: prospects.length,
        generatedAt: new Date().toISOString(),
        prospects,
      },
    };
  } catch (e) {
    logger.error('[whatsappProspectFeed]', e.message || e, e.code || '');
    return {
      status: 500,
      body: { ok: false, error: 'feed_failed', detail: String(e.message || e) },
    };
  }
}

module.exports = { handleWhatsAppProspectFeed };
