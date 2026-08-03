import { ReceiptData, ReceiptStaySegment } from '../types';
import { getRateForApartment } from '../constants';
import { getReceiptSegments, receiptHasMultipleSegments, totalNightsAcrossReceipt } from './receiptSegments';

/**
 * Sur le reçu / PDF, les libellés « … APPARTEMENT … STUDIO » sont souvent coupés avant « mode studio ».
 * Si le nom contient STUDIO, on remplace « Appartement » / « Appartements » par « APT » pour l'affichage uniquement.
 */
export function formatApartmentNameForPdfDisplay(name: string): string {
  if (!name.trim()) return name;
  if (!name.toUpperCase().includes('STUDIO')) return name;
  return name.replace(/\bappartements?\b/gi, 'APT');
}

export interface ReceiptCalculations {
  segments: ReceiptStaySegment[];
  multiStay: boolean;
  nights: number;
  rateInfo: { prix: number; caution: number; address: string };
  pricePerNight: number;
  lodgingTotal: number;
  cautionDisplay: number;
  latePenalty: number;
  basePrice: number;
  discountPercent: number;
  priceLabel: string;
  isAppartement: boolean;
  isStudio: boolean;
  logementDisplay: string;
  kwPerNightEco: number;
  totalKwEco: number;
  kwPerNightConfort: number;
  towelsCount: number;
  totalKwConfort: number;
  totalPaid: number;
  remaining: number;
}

/**
 * Calculs financiers / logement partagés entre l'aperçu écran (ReceiptPreview) et
 * la génération PDF (ReceiptPdfDocument) — une seule source de vérité pour ne jamais
 * afficher des chiffres différents entre les deux.
 */
export function computeReceiptCalculations(data: ReceiptData): ReceiptCalculations {
  const segments = getReceiptSegments(data);
  const multiStay = receiptHasMultipleSegments(data);
  const nights = multiStay
    ? totalNightsAcrossReceipt(data)
    : Math.max(0, Math.ceil((new Date(data.endDate).getTime() - new Date(data.startDate).getTime()) / (1000 * 3600 * 24)));

  const rateInfo = getRateForApartment(data.apartmentName, nights);

  const totalPaid = data.payments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = data.grandTotal - totalPaid;

  const pricePerNight = data.isCustomRate
    ? (nights > 0 ? Math.round(data.customLodgingTotal / nights) : 0)
    : (data.isNegotiatedRate ? data.negotiatedPricePerNight : rateInfo.prix);

  const lodgingTotal = data.isCustomRate ? data.customLodgingTotal : (pricePerNight * nights);

  /** Caution : total enregistré sur le reçu (somme segments en multi-barème dans l'app). */
  const cautionDisplay = multiStay ? (data.cautionAmount ?? 0) : rateInfo.caution;

  const latePenalty = Math.round(pricePerNight / 2);

  const basePrice = rateInfo.prix;
  const discountPercent = (data.isNegotiatedRate || data.isCustomRate) && basePrice > 0 && pricePerNight < basePrice
    ? Math.round(((basePrice - pricePerNight) / basePrice) * 100)
    : 0;

  const priceLabel = data.isCustomRate
    ? '(Ajusté Plateforme)'
    : (data.isNegotiatedRate ? '(Tarif Négocié)' : '');

  const isAppartement = data.apartmentName.toUpperCase().includes('APPARTEMENT') && !data.apartmentName.toUpperCase().includes('STUDIO');
  const isStudio = data.apartmentName.toUpperCase().includes('STUDIO');

  const logementDisplay = formatApartmentNameForPdfDisplay(data.apartmentName);

  const kwPerNightEco = isAppartement ? 8 : 6;
  const totalKwEco = kwPerNightEco * nights;

  let kwPerNightConfort = 8; // Défaut pour Chambre
  let towelsCount = 2;
  if (isAppartement) {
    kwPerNightConfort = 15;
    towelsCount = 4;
  } else if (isStudio) {
    kwPerNightConfort = 10;
    towelsCount = 2;
  }
  const totalKwConfort = kwPerNightConfort * nights;

  return {
    segments,
    multiStay,
    nights,
    rateInfo,
    pricePerNight,
    lodgingTotal,
    cautionDisplay,
    latePenalty,
    basePrice,
    discountPercent,
    priceLabel,
    isAppartement,
    isStudio,
    logementDisplay,
    kwPerNightEco,
    totalKwEco,
    kwPerNightConfort,
    towelsCount,
    totalKwConfort,
    totalPaid,
    remaining,
  };
}

/**
 * Normalise un numéro de téléphone pour les protocoles tel: et wa.me/
 * Gère les formats camerounais : 6XXXXXXXX, +2376XXXXXXXX, 002376XXXXXXXX
 */
export function normalizePhone(raw: string): { tel: string; wa: string } {
  const digits = raw.replace(/[\s\-.()]/g, '');
  let international = digits;
  if (digits.startsWith('00')) international = '+' + digits.slice(2);
  else if (digits.startsWith('237')) international = '+' + digits;
  else if (!digits.startsWith('+')) international = '+237' + digits;
  const waDigits = international.replace(/[^\d]/g, '');
  return { tel: international, wa: waDigits };
}

/**
 * Validité d'un proforma (en heures) :
 * - 48h si l'arrivée (check-in) est à plus de 14 jours de la date d'émission
 * - 24h sinon
 */
export function computeProformaValidityHours(
  issuedAt: string | Date,
  checkInDate: string | undefined | null
): 24 | 48 {
  if (!checkInDate) return 24;
  const issued = new Date(issuedAt || Date.now());
  if (Number.isNaN(issued.getTime())) return 24;
  const checkIn = new Date(`${String(checkInDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(checkIn.getTime())) return 24;
  const issuedDay = new Date(issued.getFullYear(), issued.getMonth(), issued.getDate());
  const checkInDay = new Date(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate());
  const daysUntil = Math.round((checkInDay.getTime() - issuedDay.getTime()) / (1000 * 3600 * 24));
  return daysUntil > 14 ? 48 : 24;
}

/** Texte court pour le bandeau / mentions légales du proforma. */
export function buildProformaValidityNotice(
  issuedAt: string | Date,
  checkInDate: string | undefined | null
): { hours: 24 | 48; notice: string } {
  const hours = computeProformaValidityHours(issuedAt, checkInDate);
  return {
    hours,
    notice:
      `Proforma valable ${hours}h. Les dates ne sont pas bloquées. ` +
      `La réservation n'est définitive qu'après réception d'un acompte d'au moins 1/3 du total.`,
  };
}

/** Nom de fichier (sans extension) utilisé pour le PDF exporté et le titre d'onglet. */
export function buildReceiptFileName(data: ReceiptData, options?: { proforma?: boolean }): string {
  const createdAt = new Date(data.createdAt || Date.now());
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${createdAt.getFullYear()}-${pad2(createdAt.getMonth() + 1)}-${pad2(createdAt.getDate())}`;
  const timeStr = `${pad2(createdAt.getHours())}h${pad2(createdAt.getMinutes())}`;

  const cleanString = (str: string) =>
    str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '');

  const clientName = cleanString(`${data.firstName} ${data.lastName}`);
  const apartmentShort = cleanString((data.apartmentName || '').substring(0, 10));
  const prefix = options?.proforma ? 'proforma' : 'reçu';

  return `${prefix}_${clientName}_${apartmentShort}_${dateStr}_${timeStr}`;
}
