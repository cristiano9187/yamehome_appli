/**
 * Barèmes alignés sur `src/constants.ts` (YameHome_Appli_V3) et les slugs du site yamehome.com.
 * À maintenir en synchro si les prix ou les clés TARIFS changent.
 */

'use strict';

/** @type {Record<string, { address: string, units: string[], [key: string]: unknown }>} */
const TARIFS = {
  'RIETI YAMEHOME - APPARTEMENT TERRACOTTA mode STUDIO': {
    address: 'Odza entrée Fécafoot Yaoundé, Porte 201',
    units: ['rieti-terracotta'],
    '1-6': { prix: 25000, caution: 10000 },
    '7+': { prix: 23000, caution: 15000 },
  },
  'RIETI YAMEHOME - APPARTEMENT TERRACOTTA': {
    address: 'Odza entrée Fécafoot Yaoundé, Porte 201',
    units: ['rieti-terracotta'],
    '1-6': { prix: 32000, caution: 10000 },
    '7-29': { prix: 30000, caution: 15000 },
    '30+': { prix: 26000, caution: 30000 },
  },
  'RIETI YAMEHOME - APPARTEMENT EMERAUDE mode STUDIO': {
    address: 'Odza entrée Fécafoot Yaoundé, Porte 202',
    units: ['rieti-emeraude'],
    '1-6': { prix: 25000, caution: 10000 },
    '7+': { prix: 23000, caution: 15000 },
  },
  'RIETI YAMEHOME - APPARTEMENT EMERAUDE': {
    address: 'Odza entrée Fécafoot Yaoundé, Porte 202',
    units: ['rieti-emeraude'],
    '1-6': { prix: 32000, caution: 10000 },
    '7-29': { prix: 30000, caution: 15000 },
    '30+': { prix: 26000, caution: 30000 },
  },
  'MODENA YAMEHOME - APPARTEMENT HAUT STANDING mode STUDIO': {
    address: 'Odza Brigade, Yaoundé',
    units: ['modena-haut-standing'],
    '1-6': { prix: 27000, caution: 10000 },
    '7+': { prix: 24000, caution: 15000 },
  },
  'MODENA YAMEHOME - APPARTEMENT HAUT STANDING': {
    address: 'Odza Brigade, Yaoundé',
    units: ['modena-haut-standing'],
    '1-6': { prix: 35000, caution: 10000 },
    '7-29': { prix: 30000, caution: 15000 },
    '30+': { prix: 27000, caution: 30000 },
  },
  'MATERA YAMEHOME - APPARTEMENT DELUXE mode STUDIO': {
    address: 'Odza borne 10, Entrée Ministre, Porte 201',
    units: ['matera-deluxe'],
    '1-6': { prix: 30000, caution: 10000 },
    '7+': { prix: 25000, caution: 15000 },
  },
  'MATERA YAMEHOME - APPARTEMENT DELUXE': {
    address: 'Odza borne 10, Entrée Ministre, Porte 201',
    units: ['matera-deluxe'],
    '1-6': { prix: 40000, caution: 10000 },
    '7-29': { prix: 34000, caution: 15000 },
    '30+': { prix: 30000, caution: 30000 },
  },
  'MATERA YAMEHOME - STUDIO AMERICAIN': {
    address: 'Odza borne 10, Entrée Ministre, Porte 103|203',
    units: ['matera-studio', 'matera-studio-superior'],
    '1-6': { prix: 25000, caution: 5000 },
    '7-29': { prix: 22500, caution: 10000 },
    '30+': { prix: 20000, caution: 15000 },
  },
  'MATERA YAMEHOME - CHAMBRE STANDARD': {
    address: 'Odza borne 10, Entrée Ministre, Porte 104 A|B',
    units: ['matera-chambre-a', 'matera-chambre-b'],
    '1-2': { prix: 15000, caution: 5000 },
    '3+': { prix: 13000, caution: 10000 },
  },
  'GALLAGHERS CITY - CHAMBRE STANDARD SIMPLE': {
    address: 'Lieu-dit Troisième Mi-temps. Bangangté',
    units: ['bgt-standard-a', 'bgt-standard-b', 'bgt-standard-c'],
    '1-6': { prix: 12000, caution: 5000 },
    '7+': { prix: 10000, caution: 15000 },
  },
  'GALLAGHERS CITY - CHAMBRE STANDARD + CUISINE': {
    address: 'Lieu-dit Troisième Mi-temps. Bangangté',
    units: ['bgt-cuisine'],
    '1-6': { prix: 15000, caution: 5000 },
    '7+': { prix: 12000, caution: 15000 },
  },
};

/** Slugs autorisés (site web) */
const ALLOWED_CALENDAR_SLUGS = new Set(
  Object.values(TARIFS).flatMap((t) => t.units || [])
);

/**
 * @param {string} calendarSlug
 * @param {boolean} isStudioMode
 * @returns {string}
 */
function resolveApartmentName(calendarSlug, isStudioMode) {
  const studioCapable = new Set([
    'rieti-terracotta',
    'rieti-emeraude',
    'modena-haut-standing',
    'matera-deluxe',
  ]);

  if (calendarSlug === 'matera-studio' || calendarSlug === 'matera-studio-superior') {
    return 'MATERA YAMEHOME - STUDIO AMERICAIN';
  }
  if (calendarSlug === 'matera-chambre-a' || calendarSlug === 'matera-chambre-b') {
    return 'MATERA YAMEHOME - CHAMBRE STANDARD';
  }
  if (calendarSlug === 'bgt-cuisine') {
    return 'GALLAGHERS CITY - CHAMBRE STANDARD + CUISINE';
  }
  if (['bgt-standard-a', 'bgt-standard-b', 'bgt-standard-c'].includes(calendarSlug)) {
    return 'GALLAGHERS CITY - CHAMBRE STANDARD SIMPLE';
  }

  if (studioCapable.has(calendarSlug)) {
    if (isStudioMode) {
      if (calendarSlug === 'rieti-terracotta') return 'RIETI YAMEHOME - APPARTEMENT TERRACOTTA mode STUDIO';
      if (calendarSlug === 'rieti-emeraude') return 'RIETI YAMEHOME - APPARTEMENT EMERAUDE mode STUDIO';
      if (calendarSlug === 'modena-haut-standing') return 'MODENA YAMEHOME - APPARTEMENT HAUT STANDING mode STUDIO';
      if (calendarSlug === 'matera-deluxe') return 'MATERA YAMEHOME - APPARTEMENT DELUXE mode STUDIO';
    }
    if (calendarSlug === 'rieti-terracotta') return 'RIETI YAMEHOME - APPARTEMENT TERRACOTTA';
    if (calendarSlug === 'rieti-emeraude') return 'RIETI YAMEHOME - APPARTEMENT EMERAUDE';
    if (calendarSlug === 'modena-haut-standing') return 'MODENA YAMEHOME - APPARTEMENT HAUT STANDING';
    if (calendarSlug === 'matera-deluxe') return 'MATERA YAMEHOME - APPARTEMENT DELUXE';
  }

  throw new Error(`calendarSlug inconnu: ${calendarSlug}`);
}

/**
 * @param {string} apartmentName
 * @param {number} nights
 * @returns {{ prix: number, caution: number, address: string }}
 */
function getRateForApartment(apartmentName, nights) {
  const apartmentRules = TARIFS[apartmentName];
  if (!apartmentRules) return { prix: 0, caution: 0, address: 'Non trouvé' };
  const rateKeys = Object.keys(apartmentRules).filter((k) => k !== 'address' && k !== 'units');
  let bestMatchKey;
  for (const key of rateKeys) {
    if (key.includes('+')) {
      const minNights = parseInt(key.replace('+', ''), 10);
      if (nights >= minNights) bestMatchKey = key;
    } else if (key.includes('-')) {
      const [min, max] = key.split('-').map((n) => parseInt(n, 10));
      if (nights >= min && nights <= max) {
        bestMatchKey = key;
        break;
      }
    }
  }
  if (bestMatchKey) {
    const rate = apartmentRules[bestMatchKey];
    if (typeof rate === 'object' && rate !== null && 'prix' in rate) {
      return { prix: rate.prix, caution: rate.caution, address: apartmentRules.address };
    }
  }
  return { prix: 0, caution: 0, address: apartmentRules.address };
}

/**
 * @param {string} ymd
 * @returns {number}
 */
function parseYmd(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return NaN;
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return NaN;
  return dt.getTime();
}

/**
 * Nuits entre start et end (exclusive end), aligné sur le site (checkout exclus).
 * @param {string} startDate
 * @param {string} endDate
 */
function countNights(startDate, endDate) {
  const a = parseYmd(startDate);
  const b = parseYmd(endDate);
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return 0;
  return Math.ceil((b - a) / (1000 * 60 * 60 * 24));
}

function tomorrowYmdDouala() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Douala',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(Date.now() + 86400000));
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

module.exports = {
  TARIFS,
  ALLOWED_CALENDAR_SLUGS,
  resolveApartmentName,
  getRateForApartment,
  countNights,
  tomorrowYmdDouala,
};
