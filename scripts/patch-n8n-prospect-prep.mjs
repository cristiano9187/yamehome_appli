import fs from 'fs';

const p = 'c:/Users/chris/OneDrive/Documents/AgentReservationYamehome/whatsapp.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const codeId = 'b6c7d8e9-f0a1-2345-b678-9012345678ab';

const jsCode = `const agg = $input.first().json;
const root = $('Robot_WhatSapp_Webhook').item.json;
const p = root.body?.payload ?? root.payload ?? {};
const text = String(
  p.body ??
    p._data?.body ??
    p._data?.message?.conversation ??
    p._data?.message?.extendedTextMessage?.text ??
  ''
).trim();

const sourceHint = (() => {
  const tl = text.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
  if (/\\bbooking(\\.com)?\\b/.test(tl)) return 'BOOKING';
  if (/\\bairbnb\\b/.test(tl)) return 'AIRBNB';
  if (/\\bfacebook\\b|(^|[\\s,])fb([\\s,]|$)/.test(tl)) return 'FACEBOOK';
  if (/\\byamehome\\b|site\\s+web|sur\\s+(le\\s+)?internet|via\\s+le\\s+site|formulaire\\s+internet|sur\\s+yamehome/.test(tl)) return 'SITE_WEB';
  if (/\\bwhatsapp\\b|what\\'?s?\\s*app/.test(tl)) return 'WHATSAPP';
  if (/telephone|\\bappel\\b|appelez|appel\\s+telephonique/.test(tl)) return 'TELEPHONE';
  if (/\\bsource\\s*:?\\s*autre\\b|^autre\\s+source\\b/.test(tl)) return 'AUTRE';
  return '';
})();

let startDate = '';
let endDate = '';
const iso = text.match(/20\\d{2}-\\d{2}-\\d{2}/g);
if (iso && iso.length) {
  startDate = iso[0];
  if (iso[1]) endDate = iso[1];
}

const mois = { janvier:'01', février:'02', fevrier:'02', mars:'03', avril:'04', mai:'05', juin:'06', juillet:'07', 'août':'08', aout:'08', septembre:'09', octobre:'10', novembre:'11', décembre:'12', decembre:'12' };
const y = new Date().getFullYear();

function frMonthToNum(word) {
  const w = word.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
  return mois[w] || '';
}

const frDates = [];
const frRe = /(\\d{1,2})\\s+([a-zA-ZàâäéèëêïîôùûçÀ-Ÿ]+)(?:\\s+(20\\d{2}))?/g;
let fm;
while ((fm = frRe.exec(text)) !== null) {
  const mm = frMonthToNum(fm[2]);
  if (!mm) continue;
  const day = String(fm[1]).padStart(2, '0');
  const yr = fm[3] || String(y);
  frDates.push(\`\${yr}-\${mm}-\${day}\`);
}
if (!startDate && frDates.length > 0) {
  startDate = frDates[0];
  if (frDates.length > 1) endDate = frDates[1];
}

let firstName = '';
let lastName = '';
const STOP = new Set([
  'reservation', 'réservation', 'booking', 'chambre', 'chambres', 'matera', 'gallaghers',
  'yaounde', 'yaoundé', 'bangante', 'banganté', 'bonsoir', 'bonjour', 'merci', 'crois',
  'pourrais', 'trouver', 'maintenant', 'directement', 'standard', 'deluxe', 'studio',
  'appartement', 'logement', 'nuit', 'nuits', 'client', 'sejour', 'séjour', 'disponible',
  'verifier', 'vérifier', 'nouveau', 'nouvelle', 'pour', 'avec', 'dans', 'chez', 'vers',
]);
function normw(w) {
  return w.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
}
let textForNames = text
  .replace(/\\b(?:la|une|ma)\\s+r[ée]servation\\b/gi, ' ')
  .replace(/\\br[ée]servation\\b/gi, ' ')
  .replace(/\\breservation\\b/gi, ' ')
  .replace(/\\bbooking\\.com\\b/gi, ' ');
const pairRe = /([\\p{L}][\\p{L}'-]{1,})\\s+([\\p{L}][\\p{L}'-]{2,})/gu;
let best = { score: 0, fn: '', ln: '' };
let pm;
while ((pm = pairRe.exec(textForNames)) !== null) {
  const fn = pm[1];
  const ln = pm[2];
  const nfn = normw(fn);
  const nln = normw(ln);
  if (STOP.has(nfn) || STOP.has(nln)) continue;
  if (/^mai$|^juin$|^juillet$|^aout$|^août$/.test(nfn) || /^mai$/.test(nln)) continue;
  if (/^\\d/.test(fn) || /^\\d/.test(ln)) continue;
  let score = nfn.length + nln.length;
  if (nln.length >= 4) score += 4;
  if (nfn.length >= 3) score += 2;
  if (score > best.score) best = { score, fn, ln };
}
firstName = best.fn;
lastName = best.ln;

const base = 'https://europe-west1-gen-lang-client-0764402913.cloudfunctions.net/whatsappProspectLookup';
const q = ['usePhone=false'];
if (startDate) q.push('startDate=' + encodeURIComponent(startDate));
if (endDate) q.push('endDate=' + encodeURIComponent(endDate));
if (lastName) q.push('lastName=' + encodeURIComponent(lastName));
if (firstName) q.push('firstName=' + encodeURIComponent(firstName));
if (sourceHint) q.push('source=' + encodeURIComponent(sourceHint));
const prospectLookupUrl = base + '?' + q.join('&');

return [{ json: { aggregateCalendar: agg, prospectLookupUrl, prospectSearchDebug: { startDate, endDate, firstName, lastName, source: sourceHint } } }];`;

const prep = {
  parameters: { jsCode },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [2310, 1536],
  id: codeId,
  name: 'Prospect search prep',
};

const idx = j.nodes.findIndex((n) => n.name === 'WhatsApp Prospect Lookup');
if (idx === -1) throw new Error('WhatsApp Prospect Lookup not found');
const prepIdx = j.nodes.findIndex((n) => n.id === codeId);
if (prepIdx === -1) {
  j.nodes.splice(idx, 0, prep);
} else {
  j.nodes[prepIdx].parameters.jsCode = jsCode;
}

const http = j.nodes.find((n) => n.name === 'WhatsApp Prospect Lookup');
http.parameters.url = '={{ $json.prospectLookupUrl }}';

const merge = j.nodes.find((n) => n.name === 'Merge Gemini Context');
merge.parameters.jsCode = `const calendarForGemini = $('Prospect search prep').first().json.aggregateCalendar;
const prospectLookup = $input.first().json;
return [{ json: { calendarForGemini, prospectLookup } }];`;

j.connections.Aggregate = {
  main: [[{ node: 'Prospect search prep', type: 'main', index: 0 }]],
};
j.connections['Prospect search prep'] = {
  main: [[{ node: 'WhatsApp Prospect Lookup', type: 'main', index: 0 }]],
};

fs.writeFileSync(p, JSON.stringify(j, null, 2));
console.log('patched n8n workflow');
