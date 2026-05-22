import { Timestamp } from 'firebase/firestore';
import type { CleaningReport } from './types';
import { isOnduleurNonConcerne } from './constants';

/** Événement window : fusion immédiate d’un rapport ménage dans le calendrier après setDoc / annulation */
export const CLEANING_REPORT_SYNC_EVENT = 'yamehome:cleaning-report-sync';

/** États dérivés par créneau `slug|YYYY-MM-DD` pour le calendrier ménage. */
export interface CleaningSlotCalendarState {
  /** Le dernier enregistrement (createdAt) sur ce créneau est ANNULÉ — case vide jusqu’à un nouveau PRÉVU plus récent. */
  suppressed: boolean;
  /** Rapport à afficher (couleurs, icônes) parmi les fiches non annulées du créneau. */
  displayReport: CleaningReport | null;
}

/**
 * Créneau unique dans le calendar (unité + jour d’intervention).
 */
export function cleaningSlotKey(calendarSlug: string, dateInterventionIso: unknown): string {
  const slug = String(calendarSlug ?? '').trim();
  const di = normalizeCleaningDateIso(dateInterventionIso);
  if (!slug || !di) return '';
  return `${slug}|${di}`;
}

export function cleaningSlotKeyFromReport(r: Pick<CleaningReport, 'calendarSlug' | 'dateIntervention'>): string {
  return cleaningSlotKey(r.calendarSlug, r.dateIntervention);
}

/** ANNULÉ avec ou sans accents (anciennes données / saisie). */
export function isCleaningStatusAnnulé(status: unknown): boolean {
  const s = String(status ?? '')
    .normalize('NFC')
    .trim()
    .toUpperCase();
  return s === 'ANNULÉ' || s === 'ANNULE' || s === 'ANNULEE';
}

/** Priorité d’affichage si plusieurs fiches non annulées sur le même créneau (rare mais possible). Plus petit = prioritaire. */
export function cleaningStatusDisplayRank(status: string): number {
  const s = String(status ?? '')
    .normalize('NFC')
    .trim()
    .toUpperCase();
  const order: Record<string, number> = {
    EFFECTUÉ: 0,
    EFFECTUE: 0,
    ANOMALIE: 1,
    REPORTÉ: 2,
    REPORTE: 2,
    PRÉVU: 3,
    PREVU: 3,
    ANNULÉ: 100,
    ANNULE: 100,
    ANNULEE: 100,
  };
  return order[s] ?? 50;
}

/**
 * Agrège plusieurs documents `cleaning_reports` sur une même unité+jour.
 * Si plusieurs docs existent, le plus récent (createdAt) décide si le créneau est effacé ou actif — un nouveau PRÉVU après un ANNULÉ redevient visible.
 */
export function buildCleaningSlotsMap(reports: CleaningReport[]): Map<string, CleaningSlotCalendarState> {
  const buckets = new Map<string, CleaningReport[]>();

  for (const r of reports) {
    const k = cleaningSlotKeyFromReport(r);
    if (!k) continue;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(r);
  }

  const out = new Map<string, CleaningSlotCalendarState>();

  for (const [slotKey, list] of buckets) {
    const sortedNewestFirst = [...list].sort((a, b) =>
      String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
    );
    const latest = sortedNewestFirst[0];

    if (latest && isCleaningStatusAnnulé(latest.status)) {
      out.set(slotKey, { suppressed: true, displayReport: null });
      continue;
    }

    const active = list.filter((r) => !isCleaningStatusAnnulé(r.status));
    if (!active.length) {
      out.set(slotKey, { suppressed: false, displayReport: null });
      continue;
    }
    const sorted = [...active].sort((a, b) => {
      const ra = cleaningStatusDisplayRank(a.status || '');
      const rb = cleaningStatusDisplayRank(b.status || '');
      if (ra !== rb) return ra - rb;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    out.set(slotKey, { suppressed: false, displayReport: sorted[0]! });
  }

  return out;
}

/** Assure slug + date stables avant écriture Firestore */
export function canonicalizeCleaningReportFields(r: CleaningReport): CleaningReport {
  const di = normalizeCleaningDateIso(r.dateIntervention) || String(r.dateIntervention ?? '').trim();
  return {
    ...r,
    calendarSlug: String(r.calendarSlug ?? '').trim(),
    dateIntervention: di,
  };
}

/**
 * Formats date issus du planning (Firestore Timestamp, ISO avec heure, etc.) en YYYY-MM-DD
 * pour correspondre aux cellules du calendrier (`getLocalDateString`).
 */
export function normalizeCleaningDateIso(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
    return m?.[1] ?? trimmed;
  }
  try {
    if (value instanceof Timestamp) {
      return ymdFromDate(value.toDate());
    }
    const v = value as { toDate?: () => Date };
    if (v && typeof v.toDate === 'function') {
      const d = v.toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return ymdFromDate(d);
    }
  } catch {
    /* ignore */
  }
  return '';
}

function ymdFromDate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

export const defaultCleaningChecklist: Pick<
  CleaningReport,
  | 'kwhCompteurPrepaye'
  | 'eau'
  | 'courant'
  | 'internet'
  | 'backupOnduleurFonctionne'
  | 'backupBatterieBarres'
  | 'nombreServiettes'
  | 'serviettesPropresRangees'
  | 'checkEntreeSalon'
  | 'checkCuisine'
  | 'checkChambres'
  | 'checkSdb'
> = {
  kwhCompteurPrepaye: null,
  eau: '',
  courant: '',
  internet: '',
  backupOnduleurFonctionne: '',
  backupBatterieBarres: null,
  nombreServiettes: null,
  serviettesPropresRangees: false,
  checkEntreeSalon: false,
  checkCuisine: false,
  checkChambres: false,
  checkSdb: false
};

function asBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
}

/** Repère un « RAS » minimal ou un mot fourre-tout. */
function isTrivialFeedback(fb: string): boolean {
  const t = fb
    .trim()
    .toLowerCase()
    .replace(/[.']/g, '')
    .replace(/\s+/g, ' ');
  if (t.length < 4) return true;
  const oneWord = t.split(' ').length === 1;
  if (oneWord) {
    return ['ras', 'ok', 'bon', 'nickel', 'niquel', 'bien', 'n/a', 'na', 'none', 'rasras'].includes(t);
  }
  return ['rien a signaler', 'rien à signaler', 'tout est bon', 'tout est ok', 'tout va bien'].includes(t);
}

/**
 * Unifie un document Firestore (anciens champs, types souples) vers CleaningReport.
 */
export function normalizeCleaningReport(raw: Record<string, unknown>): CleaningReport {
  const { maintenance: _m, ...rest } = raw as Record<string, unknown> & { maintenance?: string };
  const k = rest.kwhCompteurPrepaye;
  const n = rest.nombreServiettes;
  const dateInterventionNorm = normalizeCleaningDateIso(rest.dateIntervention);
  return {
    id: typeof rest.id === 'string' ? rest.id : undefined,
    menageId: String(rest.menageId ?? ''),
    calendarSlug: String(rest.calendarSlug ?? '').trim(),
    dateIntervention: dateInterventionNorm || String(rest.dateIntervention ?? '').trim(),
    agentEtape1: String(rest.agentEtape1 ?? rest.agent ?? ''),
    agentEtape2: String(rest.agentEtape2 ?? ''),
    status: (rest.status as CleaningReport['status']) || 'PRÉVU',
    feedback: String(rest.feedback ?? ''),
    damages: String(rest.damages ?? ''),
    kwhCompteurPrepaye: (() => {
      if (k === '' || k == null) return null;
      if (typeof k === 'number' && !Number.isNaN(k)) return k;
      const num = Number(k);
      return Number.isNaN(num) ? null : num;
    })(),
    eau: rest.eau === 'OUI' || rest.eau === 'NON' ? rest.eau : '',
    courant: rest.courant === 'OUI' || rest.courant === 'NON' ? rest.courant : '',
    internet: rest.internet === 'OUI' || rest.internet === 'NON' ? rest.internet : '',
    backupOnduleurFonctionne:
      rest.backupOnduleurFonctionne === 'OUI' || rest.backupOnduleurFonctionne === 'NON'
        ? rest.backupOnduleurFonctionne
        : '',
    backupBatterieBarres: (() => {
      const b = rest.backupBatterieBarres;
      if (b === '' || b == null) return null;
      const n = typeof b === 'number' ? b : parseInt(String(b), 10);
      return n === 1 || n === 2 || n === 3 ? n : null;
    })(),
    nombreServiettes: (() => {
      if (n === '' || n == null) return null;
      if (typeof n === 'number' && !Number.isNaN(n)) return Math.max(0, Math.floor(n));
      const num = Math.floor(Number(n));
      return Number.isNaN(num) ? null : Math.max(0, num);
    })(),
    serviettesPropresRangees: asBool(rest.serviettesPropresRangees),
    checkEntreeSalon: asBool(rest.checkEntreeSalon),
    checkCuisine: asBool(rest.checkCuisine),
    checkChambres: asBool(rest.checkChambres),
    checkSdb: asBool(rest.checkSdb),
    createdAt: String(rest.createdAt ?? new Date().toISOString())
  };
}

export function validateCleaningReportForSubmit(r: CleaningReport): string | null {
  if (r.status === 'PRÉVU' || r.status === 'ANNULÉ') return null;

  if (!r.agentEtape1?.trim() || !r.agentEtape2?.trim()) {
    return "Les noms des deux agents (étape 1 et étape 2) sont requis pour ce type de rapport.";
  }

  if (r.status === 'REPORTÉ') {
    if (r.feedback.trim().length < 20) {
      return 'Indiquez la raison et la nouvelle date ou le contexte du report (20 caractères minimum).';
    }
    return null;
  }

  if (r.status === 'EFFECTUÉ' || r.status === 'ANOMALIE') {
    if (r.kwhCompteurPrepaye == null || Number.isNaN(r.kwhCompteurPrepaye) || r.kwhCompteurPrepaye < 0) {
      return 'Indiquez les kWh restants affichés sur le compteur prépayé (nombre ≥ 0).';
    }
    if (r.eau !== 'OUI' && r.eau !== 'NON') {
      return "Indiquez si l'eau est disponible (Oui / Non).";
    }
    if (r.courant !== 'OUI' && r.courant !== 'NON') {
      return 'Indiquez si le courant est disponible (Oui / Non).';
    }
    if (r.internet !== 'OUI' && r.internet !== 'NON') {
      return "Indiquez si l'Internet fonctionne (Oui / Non).";
    }
    if (!isOnduleurNonConcerne(r.calendarSlug)) {
      if (r.backupOnduleurFonctionne !== 'OUI' && r.backupOnduleurFonctionne !== 'NON') {
        return "Indiquez si l'onduleur / backup de courant est fonctionnel (Oui / Non).";
      }
      if (r.backupOnduleurFonctionne === 'OUI') {
        if (r.backupBatterieBarres !== 1 && r.backupBatterieBarres !== 2 && r.backupBatterieBarres !== 3) {
          return "Indiquez le niveau de batterie (1, 2 ou 3 barres) affiché sur l'onduleur.";
        }
      }
    }
    if (r.nombreServiettes == null || Number.isNaN(r.nombreServiettes) || r.nombreServiettes < 0) {
      return 'Indiquez le nombre de serviettes propres mises en place (entier ≥ 0).';
    }
    if (!r.checkEntreeSalon || !r.checkCuisine || !r.checkChambres || !r.checkSdb) {
      return 'Cochez toutes les zones vérifiées (entrée/salon, cuisine, chambres, salle de bain).';
    }
    if (r.feedback.trim().length < 30) {
      return "Le compte-rendu doit faire au moins 30 caractères (décrivez l'état réel du logement).";
    }
    if (isTrivialFeedback(r.feedback)) {
      return 'Rédigez un compte-rendu utile : évitez seulement « RAS », « OK » ou un mot sans détail.';
    }
  }

  return null;
}

/**
 * « Effectué » + au moins un indicateur négatif (mesures) ou compte-rendu à risque
 * → le calendrier en orange, pas le vert.
 */
export function effectuéMériteAffichageAlerte(r: CleaningReport): boolean {
  if (r.status !== 'EFFECTUÉ') return false;
  if (effectuéSignaleUnSouciTextuel(r)) return true;
  if (r.eau === 'NON' || r.courant === 'NON' || r.internet === 'NON') return true;
  if (!isOnduleurNonConcerne(r.calendarSlug) && r.backupOnduleurFonctionne === 'NON') return true;
  if (!r.serviettesPropresRangees) return true;
  if (!isOnduleurNonConcerne(r.calendarSlug) && r.backupBatterieBarres === 1) return true;
  return false;
}

/**
 * Statut enregistré « Effectué » mais le compte-rendu ou la casse décrivent un souci
 * → le calendrier affiche l’alerte orange (comme « Anomalie »), pas le vert.
 */
export function effectuéSignaleUnSouciTextuel(r: CleaningReport): boolean {
  if (r.status !== 'EFFECTUÉ') return false;
  if ((r.damages || '').trim().length >= 2) return true;
  let t = (r.feedback || '').trim();
  if (t.length < 4) return false;
  t = t
    .replace(/\b(pas|aucun|aucune|rien)\s+d['’]?anomalie\b/gi, ' ')
    .replace(/\b(pas|aucun|aucune|sans)\s+problème\b/gi, ' ')
    .replace(/\baucun(e)?\s+souci\b/gi, ' ')
    .replace(/\brien\s+d['’]?anormal\b/gi, ' ')
    .replace(/\bsans\s+anomalie\b/gi, ' ')
    .replace(/\bne\s+manque\s+rien\b/gi, ' ')
    .replace(/\br\.?\s*a\.?\s*s\.?/gi, ' ');
  return (
    /\b(anomal(ie|ies)|problèm|défauts?|défaut|panne|cass(é|ée|es|e)\b|dégâts?|dégat|fuite|défectu|dysfonctionn|déconne|ne\s+marche\s+pas|ne\s+fonctionne\s+pas|h\.?\s*s\.?|hors\s+service|insalubr|moisiss|déchir|fissur|rayur|déboît|bouch|obstru|urgence|dangereu|douteux|plombier|électricien|té?chnic|technici|répar|remplac|doute|salete?s?|insatisf|décev|manque|absence|égratign|ébréch|fêle|odeur|traces?|désagréa|onduleur|batterie|backup|inverter|bip|alarme|autonomie|recharg)\b/gi.test(
      t
    ) ||
    /\b(il|elle)\s+manque|manquent\b/gi.test(t)
  );
}
