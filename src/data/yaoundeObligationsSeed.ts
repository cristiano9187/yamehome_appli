/**
 * Seed / mapping Yaoundé — Loyer, eau, Starlink, Canal+, IPTV
 * (issu de calendrier_yamehome.xlsx · Loyer & abonements, clarifié avec la direction)
 */

export type YaoundeUnitSlug =
  | 'modena-haut-standing'
  | 'matera-studio-superior'
  | 'matera-deluxe'
  | 'matera-studio'
  | 'matera-chambre-a'
  | 'matera-chambre-b'
  | 'rieti-terracotta'
  | 'rieti-emeraude';

export const YAOUNDE_UNIT_LABELS: Record<YaoundeUnitSlug, string> = {
  'modena-haut-standing': 'Modena — Haut Standing (Brigade)',
  'matera-studio-superior': 'Matera — Studio Am. Superior (103)',
  'matera-deluxe': 'Matera — Deluxe (201)',
  'matera-studio': 'Matera — Studio Américain (203)',
  'matera-chambre-a': 'Matera — Chambre Std A (104 A)',
  'matera-chambre-b': 'Matera — Chambre Std B (104 B)',
  'rieti-terracotta': 'Rieti — Terracotta (F201)',
  'rieti-emeraude': 'Rieti — Emeraude (F202)',
};

/** Loyers bailleur — jour d’échéance par défaut (modifiable dans l’app). */
export const YAOUNDE_RENT_DUE_DAY: Record<YaoundeUnitSlug, number> = {
  'modena-haut-standing': 10,
  'matera-studio-superior': 1,
  'matera-deluxe': 1,
  'matera-studio': 1,
  'matera-chambre-a': 1,
  'matera-chambre-b': 1,
  'rieti-terracotta': 5,
  'rieti-emeraude': 5,
};

/** Eau — pas de ligne pour Modena (ND dans l’ancien Excel). */
export const YAOUNDE_WATER_DUE_DAY: Partial<Record<YaoundeUnitSlug, number>> = {
  'matera-studio-superior': 7,
  'matera-deluxe': 7,
  'matera-studio': 7,
  'matera-chambre-a': 7,
  'matera-chambre-b': 7,
  'rieti-terracotta': 5,
  'rieti-emeraude': 5,
};

/** Starlink : 2 abonnements (défaut le 20, modifiable). */
export const YAOUNDE_STARLINK_TEMPLATES = [
  {
    seedKey: 'yaounde-starlink-modena',
    title: 'Starlink — Modena (dédié)',
    dueDayOfMonth: 20,
    unitSlug: 'modena-haut-standing' as YaoundeUnitSlug,
    apartmentName: YAOUNDE_UNIT_LABELS['modena-haut-standing'],
    expectedAmount: null as number | null,
  },
  {
    seedKey: 'yaounde-starlink-rieti-matera',
    title: 'Starlink — Rieti + Matera (partagé)',
    dueDayOfMonth: 20,
    unitSlug: null as string | null,
    apartmentName: 'Rieti + Matera (partagé)',
    expectedAmount: null as number | null,
  },
] as const;

export type MediaSubscriptionKind = 'CANAL_PLUS' | 'IPTV';

/** Valeurs initiales Canal+ / IPTV (dates issues de l’Excel ; bouquet à compléter). */
export const YAOUNDE_MEDIA_SEED: Array<{
  seedKey: string;
  kind: MediaSubscriptionKind;
  unitSlug: YaoundeUnitSlug;
  bouquet: string | null;
  boxNumber: string | null;
  expiresOn: string | null;
}> = [
  // Canal+
  {
    seedKey: 'canal:modena-haut-standing',
    kind: 'CANAL_PLUS',
    unitSlug: 'modena-haut-standing',
    bouquet: null,
    boxNumber: '24100102758494',
    expiresOn: '2026-01-23',
  },
  {
    seedKey: 'canal:matera-studio-superior',
    kind: 'CANAL_PLUS',
    unitSlug: 'matera-studio-superior',
    bouquet: null,
    boxNumber: '24210138070828',
    expiresOn: '2026-03-04',
  },
  {
    seedKey: 'canal:matera-deluxe',
    kind: 'CANAL_PLUS',
    unitSlug: 'matera-deluxe',
    bouquet: null,
    boxNumber: '24100126668897',
    expiresOn: '2026-03-04',
  },
  {
    seedKey: 'canal:matera-studio',
    kind: 'CANAL_PLUS',
    unitSlug: 'matera-studio',
    bouquet: null,
    boxNumber: '24110005920117',
    expiresOn: '2026-03-04',
  },
  {
    seedKey: 'canal:matera-chambre-a',
    kind: 'CANAL_PLUS',
    unitSlug: 'matera-chambre-a',
    bouquet: null,
    boxNumber: '24510021693450',
    expiresOn: '2026-03-16',
  },
  {
    seedKey: 'canal:matera-chambre-b',
    kind: 'CANAL_PLUS',
    unitSlug: 'matera-chambre-b',
    bouquet: null,
    boxNumber: '24510021720019',
    expiresOn: '2026-03-16',
  },
  {
    seedKey: 'canal:rieti-terracotta',
    kind: 'CANAL_PLUS',
    unitSlug: 'rieti-terracotta',
    bouquet: null,
    boxNumber: '24210175271832',
    expiresOn: '2025-12-17',
  },
  {
    seedKey: 'canal:rieti-emeraude',
    kind: 'CANAL_PLUS',
    unitSlug: 'rieti-emeraude',
    bouquet: null,
    boxNumber: '24210177291322',
    expiresOn: '2026-03-07',
  },
  // IPTV
  {
    seedKey: 'iptv:modena-haut-standing',
    kind: 'IPTV',
    unitSlug: 'modena-haut-standing',
    bouquet: null,
    boxNumber: null,
    expiresOn: '2025-04-10',
  },
  {
    seedKey: 'iptv:matera-studio-superior',
    kind: 'IPTV',
    unitSlug: 'matera-studio-superior',
    bouquet: null,
    boxNumber: null,
    expiresOn: '2025-06-11',
  },
  {
    seedKey: 'iptv:matera-deluxe',
    kind: 'IPTV',
    unitSlug: 'matera-deluxe',
    bouquet: null,
    boxNumber: null,
    expiresOn: '2025-06-11',
  },
  {
    seedKey: 'iptv:matera-studio',
    kind: 'IPTV',
    unitSlug: 'matera-studio',
    bouquet: null,
    boxNumber: null,
    expiresOn: '2025-06-11',
  },
  {
    seedKey: 'iptv:rieti-terracotta',
    kind: 'IPTV',
    unitSlug: 'rieti-terracotta',
    bouquet: null,
    boxNumber: null,
    expiresOn: '2025-08-25',
  },
  {
    seedKey: 'iptv:rieti-emeraude',
    kind: 'IPTV',
    unitSlug: 'rieti-emeraude',
    bouquet: null,
    boxNumber: null,
    expiresOn: '2025-08-25',
  },
];

/** Alerte jaune avant expiration — Canal+ court, IPTV plus long (recherche marché). */
export const MEDIA_WARN_DAYS_BEFORE: Record<'CANAL_PLUS' | 'IPTV', number> = {
  CANAL_PLUS: 5,
  IPTV: 30,
};
