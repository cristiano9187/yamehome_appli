/**
 * Données d’amorçage (seed) pour la vue « Codes keybox » — premier déploiement.
 *
 * Catalogue des logements (Yaoundé) : réutilise `YAOUNDE_UNIT_LABELS` (nom officiel calendrier)
 * complété par les 2 unités hors calendrier (Magasin Matera, Ext. Fécafoot).
 *
 * Boîtiers + codes : relevés depuis la feuille « codes_boxs » au 20/07/2026, avec l’accord
 * explicite de l’utilisateur pour un premier import ("7 oui tu peu prendre ces donnees pour
 * le premier deploiement").
 */
import { KeyboxDwelling, KeyboxSite, KeyboxUnit } from '../types';
import { YAOUNDE_UNIT_LABELS } from './yaoundeObligationsSeed';

export interface KeyboxDwellingSeed {
  id: string;
  shortLabel: string;
  officialLabel: string;
  site: KeyboxSite;
  unitSlug: string | null;
}

export const KEYBOX_DWELLINGS_SEED: KeyboxDwellingSeed[] = [
  { id: 'modena-haut-standing', shortLabel: 'Brigade', officialLabel: YAOUNDE_UNIT_LABELS['modena-haut-standing'], site: 'MODENA YAMEHOME', unitSlug: 'modena-haut-standing' },
  { id: 'matera-studio-superior', shortLabel: 'B10 103', officialLabel: YAOUNDE_UNIT_LABELS['matera-studio-superior'], site: 'MATERA YAMEHOME', unitSlug: 'matera-studio-superior' },
  { id: 'matera-deluxe', shortLabel: 'B10 201', officialLabel: YAOUNDE_UNIT_LABELS['matera-deluxe'], site: 'MATERA YAMEHOME', unitSlug: 'matera-deluxe' },
  { id: 'matera-studio', shortLabel: 'B10 203', officialLabel: YAOUNDE_UNIT_LABELS['matera-studio'], site: 'MATERA YAMEHOME', unitSlug: 'matera-studio' },
  { id: 'matera-chambre-a', shortLabel: 'B10 104A', officialLabel: YAOUNDE_UNIT_LABELS['matera-chambre-a'], site: 'MATERA YAMEHOME', unitSlug: 'matera-chambre-a' },
  { id: 'matera-chambre-b', shortLabel: 'B10 104B', officialLabel: YAOUNDE_UNIT_LABELS['matera-chambre-b'], site: 'MATERA YAMEHOME', unitSlug: 'matera-chambre-b' },
  { id: 'rieti-terracotta', shortLabel: 'F201', officialLabel: YAOUNDE_UNIT_LABELS['rieti-terracotta'], site: 'RIETI YAMEHOME', unitSlug: 'rieti-terracotta' },
  { id: 'rieti-emeraude', shortLabel: 'F202', officialLabel: YAOUNDE_UNIT_LABELS['rieti-emeraude'], site: 'RIETI YAMEHOME', unitSlug: 'rieti-emeraude' },
  { id: 'ext-fecafoot', shortLabel: 'Ext. Fécafoot', officialLabel: 'Extérieur Fécafoot', site: 'RIETI YAMEHOME', unitSlug: null },
  { id: 'magasin-matera', shortLabel: 'Magasin Matera', officialLabel: 'Magasin Matera', site: 'MATERA YAMEHOME', unitSlug: null },
];

export interface KeyboxUnitSeed {
  letter: string;
  site: KeyboxSite;
  code: string;
  /** IDs des logements (voir `KEYBOX_DWELLINGS_SEED`) dont les clés sont dans ce boîtier au 20/07/2026 */
  dwellingIds: string[];
}

export const KEYBOX_UNITS_SEED: KeyboxUnitSeed[] = [
  { letter: 'A', site: 'MODENA YAMEHOME', code: '1987', dwellingIds: ['modena-haut-standing'] },
  { letter: 'B', site: 'MATERA YAMEHOME', code: '1987', dwellingIds: ['matera-studio-superior'] },
  { letter: 'D', site: 'MATERA YAMEHOME', code: '2105', dwellingIds: ['matera-deluxe'] },
  { letter: 'E', site: 'MATERA YAMEHOME', code: '2015', dwellingIds: ['matera-studio'] },
  { letter: 'F', site: 'RIETI YAMEHOME', code: '2015', dwellingIds: ['rieti-terracotta'] },
  { letter: 'G', site: 'RIETI YAMEHOME', code: '2015', dwellingIds: ['rieti-emeraude'] },
  { letter: 'H', site: 'MATERA YAMEHOME', code: '1964', dwellingIds: ['matera-chambre-a', 'matera-chambre-b'] },
  { letter: 'J', site: 'RIETI YAMEHOME', code: '2105', dwellingIds: ['ext-fecafoot'] },
];

export type { KeyboxDwelling, KeyboxUnit };
