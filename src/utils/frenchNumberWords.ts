/** Entier ≥ 0 → libellé français — pour mention « somme en toutes lettres » sur factures. */

const U = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
const T = ['dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];

/** 0–99 */
function lt100(n: number): string {
  if (n < 10) return U[n];
  if (n < 20) return T[n - 10];

  if (n < 70) {
    const d = Math.floor(n / 10);
    const unit = n % 10;
    const dec = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'][d]!;
    if (unit === 0) return dec;
    if (d === 2 && unit === 1) return 'vingt et un';
    return `${dec}-${U[unit]}`;
  }

  if (n < 80) {
    if (n === 71) return 'soixante et onze';
    return `soixante-${lt100(n - 60)}`;
  }

  if (n === 80) return 'quatre-vingts';
  if (n < 100) {
    if (n === 90) return 'quatre-vingt-dix';
    return `quatre-vingt-${lt100(n - 80)}`;
  }

  return String(n);
}

function lt1000(n: number): string {
  if (n < 100) return lt100(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  const head = h === 1 ? 'cent' : `${U[h]} cent`;
  if (r === 0) return h === 1 ? 'cent' : `${head}s`;
  return `${head} ${lt100(r)}`;
}

export function integerToFrenchWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999) {
    return String(n);
  }
  if (n === 0) return 'zéro';

  const mil = Math.floor(n / 1_000_000);
  const k = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;

  const parts: string[] = [];
  if (mil > 0) parts.push(mil === 1 ? 'un million' : `${lt1000(mil)} millions`);
  if (k > 0) parts.push(k === 1 ? 'mille' : `${lt1000(k)} mille`);
  if (rest > 0 || parts.length === 0) parts.push(lt1000(rest));

  return parts.join(' ').trim();
}

/** Arrêter la présente facture — forme utilisée pour XAF sur documents. */
export function amountFcfaToFrenchWords(amount: number): string {
  const rounded = Math.round(amount);
  if (rounded <= 0) return 'Zéro Franc CFA';
  const low = integerToFrenchWords(rounded);
  const cap = `${low.charAt(0).toUpperCase()}${low.slice(1)}`;
  const tail = rounded > 1 ? 'Francs CFA' : 'Franc CFA';
  return `${cap} ${tail}`;
}
