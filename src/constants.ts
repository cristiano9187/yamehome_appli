import { TarifMap } from './types';

/**
 * LOGO_BASE64: Paste your logo's base64 string here.
 * You can convert your image to base64 using online tools like 'base64-image.de'
 */
export const LOGO_BASE64 = "data:image/png;base64,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";

export const PAYMENT_METHODS = ["Espèces", "Paiement mobile", "Virement bancaire", "PayPal", "Autre"];

export const HOSTS = [
  { id: "paola",     label: "Paola (+237 691 47 24 82)",    sites: ['Yaoundé'] },
  { id: "edwige",    label: "Edwige (+237 656 75 13 10)",   sites: ['Yaoundé'] },
  { id: "idriss",    label: "Idriss (+237 651 16 37 50)",   sites: ['Yaoundé'] },
  { id: "madeleine", label: "Madeleine (+237 693 00 96 26)",sites: ['Yaoundé'] },
  { id: "pierre",    label: "Pierre (+237 670 87 11 39)",   sites: ['Bangangté'] },
  { id: "regine",    label: "Regine (+237 692 79 22 26)",   sites: ['Bangangté'] },
];

/** Retourne les hôtes disponibles pour un logement donné.
 *  Si aucun logement n'est sélectionné, retourne tous les hôtes. */
export function getHostsForApartment(apartmentName: string) {
  if (!apartmentName || !TARIFS[apartmentName]) return HOSTS;
  const address = TARIFS[apartmentName].address as string || '';
  const location = address.includes('Bangangté') ? 'Bangangté' : 'Yaoundé';
  return HOSTS.filter(h => h.sites.includes(location));
}

export const SITES = [
  "MODENA YAMEHOME",
  "MATERA YAMEHOME",
  "RIETI YAMEHOME",
  "GALLAGHERS CITY"
];

/**
 * Slugs d’unités (chambres) sans installation onduleur / backup — formulaire ménage : bloc grisé, pas de saisie.
 * Matera : chambres A/B. Gallaghers : toutes les chambres (standard simple + cuisine).
 */
export const UNITS_SANS_ONDULEUR: readonly string[] = [
  'matera-chambre-a',
  'matera-chambre-b',
  'bgt-standard-a',
  'bgt-standard-b',
  'bgt-standard-c',
  'bgt-cuisine'
];

export function isOnduleurNonConcerne(calendarSlug: string): boolean {
  if (!calendarSlug || typeof calendarSlug !== 'string') return false;
  return (UNITS_SANS_ONDULEUR as readonly string[]).includes(calendarSlug);
}

export const SITE_MAPPING: Record<string, string[]> = {
  "MODENA YAMEHOME": [
    'MODENA YAMEHOME - APPARTEMENT HAUT STANDING mode STUDIO',
    'MODENA YAMEHOME - APPARTEMENT HAUT STANDING'
  ],
  "MATERA YAMEHOME": [
    'MATERA YAMEHOME - APPARTEMENT DELUXE mode STUDIO',
    'MATERA YAMEHOME - APPARTEMENT DELUXE',
    'MATERA YAMEHOME - STUDIO AMERICAIN',
    'MATERA YAMEHOME - CHAMBRE STANDARD'
  ],
  "RIETI YAMEHOME": [
    'RIETI YAMEHOME - APPARTEMENT TERRACOTTA mode STUDIO',
    'RIETI YAMEHOME - APPARTEMENT TERRACOTTA',
    'RIETI YAMEHOME - APPARTEMENT EMERAUDE mode STUDIO',
    'RIETI YAMEHOME - APPARTEMENT EMERAUDE'
  ],
  "GALLAGHERS CITY": [
    'GALLAGHERS CITY - CHAMBRE STANDARD SIMPLE',
    'GALLAGHERS CITY - CHAMBRE STANDARD + CUISINE'
  ]
};

export const TARIFS: TarifMap = {
  'RIETI YAMEHOME - APPARTEMENT TERRACOTTA mode STUDIO': { 
      address: 'Odza entrée Fécafoot Yaoundé, Porte 201',
      units: ['rieti-terracotta'],
      '1-6': { prix: 25000, caution: 10000 }, '7+': { prix: 23000, caution: 15000 }
  },
  'RIETI YAMEHOME - APPARTEMENT TERRACOTTA': { 
      address: 'Odza entrée Fécafoot Yaoundé, Porte 201',
      units: ['rieti-terracotta'],
      '1-6': { prix: 32000, caution: 10000 }, '7-29': { prix: 30000, caution: 15000 }, '30+': { prix: 26000, caution: 30000 }
  },
  'RIETI YAMEHOME - APPARTEMENT EMERAUDE mode STUDIO': { 
      address: 'Odza entrée Fécafoot Yaoundé, Porte 202',
      units: ['rieti-emeraude'],
      '1-6': { prix: 25000, caution: 10000 }, '7+': { prix: 23000, caution: 15000 }
  },
  'RIETI YAMEHOME - APPARTEMENT EMERAUDE': { 
      address: 'Odza entrée Fécafoot Yaoundé, Porte 202',
      units: ['rieti-emeraude'],
      '1-6': { prix: 32000, caution: 10000 }, '7-29': { prix: 30000, caution: 15000 }, '30+': { prix: 26000, caution: 30000 }
  },
  'MODENA YAMEHOME - APPARTEMENT HAUT STANDING mode STUDIO': { 
      address: 'Odza Brigade, Yaoundé',
      units: ['modena-haut-standing'],
      '1-6': { prix: 27000, caution: 10000 }, '7+': { prix: 24000, caution: 15000 }
  },
  'MODENA YAMEHOME - APPARTEMENT HAUT STANDING': { 
      address: 'Odza Brigade, Yaoundé',
      units: ['modena-haut-standing'],
      '1-6': { prix: 35000, caution: 10000 }, '7-29': { prix: 30000, caution: 15000 }, '30+': { prix: 27000, caution: 30000 }
  },
  'MATERA YAMEHOME - APPARTEMENT DELUXE mode STUDIO': { 
      address: 'Odza borne 10, Porte 201',
      units: ['matera-deluxe'],
      '1-6': { prix: 30000, caution: 10000 }, '7+': { prix: 25000, caution: 15000 }
  },
  'MATERA YAMEHOME - APPARTEMENT DELUXE': { 
      address: 'Odza borne 10, Porte 201',
      units: ['matera-deluxe'],
      '1-6': { prix: 40000, caution: 10000 }, '7-29': { prix: 34000, caution: 15000 }, '30+': { prix: 30000, caution: 30000 }
  },
  'MATERA YAMEHOME - STUDIO AMERICAIN': {
      address: 'Odza borne 10, Porte 103|203',
      units: ['matera-studio', 'matera-studio-superior'], 
      '1-6': { prix: 25000, caution: 5000 }, '7-29': { prix: 22500, caution: 10000 }, '30+': { prix: 20000, caution: 15000 }
  },
  'MATERA YAMEHOME - CHAMBRE STANDARD': {
      address: 'Odza borne 10, Porte 104 A|B',
      units: ['matera-chambre-a', 'matera-chambre-b'],
      '1-2': { prix: 15000, caution: 5000 }, '3+': { prix: 13000, caution: 10000 }
  },
  'GALLAGHERS CITY - CHAMBRE STANDARD SIMPLE': { 
      address: 'Lieu-dit Troisième Mi-temps. Bangangté',
      units: ['bgt-standard-a', 'bgt-standard-b', 'bgt-standard-c'],
      '1-6': { prix: 12000, caution: 5000 }, '7+': { prix: 10000, caution: 15000 }
  },
  'GALLAGHERS CITY - CHAMBRE STANDARD + CUISINE': { 
    address: 'Lieu-dit Troisième Mi-temps. Bangangté',
    units: ['bgt-cuisine'],
    '1-6': { prix: 15000, caution: 5000 }, '7+': { prix: 12000, caution: 15000 }
  }
};

export const getRateForApartment = (apartmentName: string, nights: number): { prix: number; caution: number; address: string } => {
  const apartmentRules = TARIFS[apartmentName];
  if (!apartmentRules) return { prix: 0, caution: 0, address: 'Non trouvé' };
  const rateKeys = Object.keys(apartmentRules).filter(k => k !== 'address' && k !== 'units');
  let bestMatchKey: string | undefined;
  for (const key of rateKeys) {
    if (key.includes('+')) {
      const minNights = parseInt(key.replace('+', ''), 10);
      if (nights >= minNights) bestMatchKey = key;
    } else if (key.includes('-')) {
      const [min, max] = key.split('-').map(n => parseInt(n, 10));
      if (nights >= min && nights <= max) { bestMatchKey = key; break; }
    }
  }
  if (bestMatchKey) {
    const rate = apartmentRules[bestMatchKey];
    if (typeof rate === 'object' && rate !== null && 'prix' in rate) {
      return { prix: (rate as any).prix, caution: (rate as any).caution, address: apartmentRules.address };
    }
  }
  return { prix: 0, caution: 0, address: apartmentRules.address };
};

export const formatCurrency = (amount: number) => {
  return amount.toLocaleString('fr-FR', { style: 'currency', currency: 'XAF', minimumFractionDigits: 0, maximumFractionDigits: 0 });
};
