export interface Payment {
  id: string;
  date: string;
  amount: number;
  method: string;
}

/**
 * Une plage réservée dans un même reçu (multi-logements et/ou séjour split).
 * `lodgingAllocated` : part indicative hébergement (XAF) pour PDF / analyse — les paiements restent au niveau du reçu.
 */
export interface ReceiptStaySegment {
  /** Stable (sync public_calendar multi-docs : `{receiptId}__${id}`) */
  id: string;
  calendarSlug: string;
  apartmentName: string;
  startDate: string;
  endDate: string;
  lodgingAllocated?: number | null;
}

export interface ReceiptData {
  id?: string;
  receiptId: string;
  calendarSlug: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  apartmentName: string;
  startDate: string;
  endDate: string;
  /** Si défini et non vide : plusieurs plages/unités pour le même reçu ; sinon segment unique dérivé des champs ci-dessus. */
  staySegments?: ReceiptStaySegment[] | null;
  isCustomRate: boolean;
  customLodgingTotal: number;
  isNegotiatedRate: boolean;
  negotiatedPricePerNight: number;
  payments: Payment[];
  signature: string;
  hosts: string[];
  electricityCharge: boolean;
  packEco: boolean;
  packConfort: boolean;
  observations: string;
  internalNotes?: string;
  status: 'VALIDE' | 'ANNULE';
  grandTotal: number;
  totalPaid: number;
  remaining: number;
  agentName?: string;
  commissionAmount?: number;
  isCommissionPaid?: boolean;
  cautionAmount?: number;
  isCautionRefunded?: boolean;
  cautionRefundDate?: string;
  cautionRefundMethod?: string;
  createdAt: string;
  authorUid: string;
}

export interface CleaningReport {
  id?: string;
  menageId: string;
  calendarSlug: string;
  dateIntervention: string;
  /** Contrôle en 2 temps (comme les fiches papier) — obligatoires sur le rapport final */
  agentEtape1: string;
  agentEtape2: string;
  status: 'EFFECTUÉ' | 'ANOMALIE' | 'REPORTÉ' | 'PRÉVU' | 'ANNULÉ';
  feedback: string;
  damages: string;
  /** kWh restants (compteur prépayé) — obligatoire pour EFFECTUÉ / ANOMALIE */
  kwhCompteurPrepaye: number | null;
  /** Présence / disponibilité de l'eau */
  eau: '' | 'OUI' | 'NON';
  courant: '' | 'OUI' | 'NON';
  /** Connexion Internet opérationnelle */
  internet: '' | 'OUI' | 'NON';
  /** L’onduleur / backup de secours pris en charge (affiche, bip, autonomie) */
  backupOnduleurFonctionne: '' | 'OUI' | 'NON';
  /**
   * Niveau batterie (barres visibles sur l’onduleur) : 1 = presque vide, 2 = moyen, 3 = plein.
   * Obligatoire si `backupOnduleurFonctionne` = OUI.
   */
  backupBatterieBarres: 1 | 2 | 3 | null;
  nombreServiettes: number | null;
  serviettesPropresRangees: boolean;
  checkEntreeSalon: boolean;
  checkCuisine: boolean;
  checkChambres: boolean;
  checkSdb: boolean;
  createdAt: string;
}

export interface Apartment {
  id?: string;
  name: string;
  location: 'Yaoundé' | 'Bangangté';
  units: string[];
  basePrice: number;
  caution: number;
}

/** Jeton prépayé d’électricité — rattaché à un logement (slug calendrier = un seul compteur). */
export interface PrepaidElectricityToken {
  id?: string;
  unitSlug: string;
  apartmentName: string;
  /** Code de recharge (texte, ~50 caractères) */
  tokenCode: string;
  purchasePrice: number;
  expectedKwh: number;
  used: boolean;
  /** Date-heure ISO à l’enregistrement de l’utilisation */
  usedAt: string | null;
  usedByUid: string | null;
  usedByDisplayName: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUid: string;
}

/** N° de compteur affiché pour un logement (un doc par `unitSlug`). */
export interface UnitElectricitySettings {
  unitSlug: string;
  apartmentName: string;
  meterNumber: string;
  updatedAt: string;
  updatedByUid: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  role: 'admin' | 'agent';
  displayName: string;
  isApproved?: boolean;
  allowedSites?: string[];
  /** Profil employé (présence) — renseigné via Gestion des accès, synchronisé depuis authorized_emails */
  linkedEmployeeId?: string | null;
  /** Vue Coûts / marges — accordé via Gestion des accès (whitelist) ou champ users */
  financeAccess?: boolean;
}

export interface AuthorizedEmail {
  id?: string;
  email: string;
  role: 'admin' | 'agent';
  addedAt: string;
  allowedSites?: string[];
  /** ID document `employees/{id}` — l’agent ne peut cocher la présence que pour cet employé */
  linkedEmployeeId?: string | null;
  /** Accès à la vue Coûts / marges (sans être admin complet) */
  financeAccess?: boolean;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  active: boolean;
  createdAt: string;
}

export interface AttendanceRecord {
  id?: string;
  employeeId: string;
  date: string; // YYYY-MM-DD
  status: 'PRÉSENT' | 'ABSENT' | 'REPOS' | 'PRÉVU_REPOS';
  /** HH:mm — heure locale du Cameroun (Africa/Douala), pas le fuseau du navigateur */
  checkInTime?: string;
  /** HH:mm — heure locale du Cameroun (Africa/Douala) */
  checkOutTime?: string;
  checkInSite?: string;
  checkOutSite?: string;
  notes?: string;
  updatedAt: string;
}

export interface TarifDetails {
  prix: number;
  caution: number;
}

export interface ApartmentTarif {
  address: string;
  units: string[];
  [key: string]: string[] | string | TarifDetails;
}

export interface TarifMap {
  [key: string]: ApartmentTarif;
}

export interface BlockedDate {
  id?: string;
  date: string; // YYYY-MM-DD
  calendarSlug: string;
  reason?: string;
  createdAt: string;
  authorUid: string;
}

export type ProspectStatus = 'NOUVEAU' | 'A_RELANCER' | 'EN_NEGOCIATION' | 'CONVERTI' | 'PERDU' | 'ANNULE';

export type ProspectSource = 'FACEBOOK' | 'AIRBNB' | 'BOOKING' | 'TELEPHONE' | 'WHATSAPP' | 'AUTRE' | 'SITE_WEB';

export interface Prospect {
  id?: string;
  source: ProspectSource;
  status: ProspectStatus;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  apartmentName?: string;
  calendarSlug?: string;
  startDate?: string;
  endDate?: string;
  totalStayPrice?: number;
  guestCount?: number;
  budget?: number;
  assignedTo?: string;
  nextFollowUpDate?: string;
  notes?: string;
  convertedReceiptId?: string;
  createdAt: string;
  updatedAt: string;
  authorUid: string;
}

export interface ClientProfile {
  id?: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  createdAt: string;
  updatedAt: string;
  authorUid: string;
}

export interface AgentProfile {
  id?: string;
  name: string;
  preferredPaymentMethod: string;
  paymentReference: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  authorUid: string;
}

/**
 * Facture destinée aux structures employeuses — document séparé du reçu interne {@link ReceiptData}.
 * `amountFromReceipt` trace le total du reçu ; `amountInvoice` ce qui figure sur la facture (écart léger possible).
 */
export interface ProInvoice {
  id?: string;
  /** ID document Firestore `receipts/{id}` lié au reçu source */
  sourceReceiptFirestoreId: string;
  /** Numéro métier affiché côté reçus (ReceiptData.receiptId) */
  receiptBusinessId: string;

  apartmentName: string;
  calendarSlug: string;
  guestFirstName: string;
  guestLastName: string;
  startDate: string;
  endDate: string;

  /** Total enregistré sur le reçu interne (référence honnête) */
  amountFromReceipt: number;
  /** Total affiché sur la facture « entreprise » */
  amountInvoice: number;

  /** Motif léger si écart (optionnel, court) */
  adjustmentNote?: string | null;

  /** Tampon « Payé » sur le PDF (optionnel) */
  paidStamp?: 'none' | 'paid' | 'paid_cash';

  invoiceNumber: string;
  invoiceDate: string;
  issuePlace: string;
  billedToDisplayName: string;

  sectionTitle: string;
  lineLabel: string;
  roomsCount: number;
  nightsCount: number;
  unitPriceDisplay: number;

  currency: 'XAF';

  createdAt: string;
  updatedAt: string;
  authorUid: string;
}

/** Ligne saisie manuelle dans la vue Coûts (Firestore `finance_entries`) */
export type FinanceEntryKind = 'REVENUE' | 'EXPENSE';

export type FinanceExpenseCategory =
  | 'SALARY'
  | 'RENT'
  | 'BILL'
  | 'REPAIR'
  | 'PURCHASE'
  | 'OTHER_EXPENSE';

export type FinanceRevenueCategory = 'MISC_SALE' | 'OTHER_REVENUE';

export type FinanceCategory = FinanceExpenseCategory | FinanceRevenueCategory;

export interface FinanceEntry {
  id?: string;
  kind: FinanceEntryKind;
  category: FinanceCategory;
  /** Toujours > 0 ; le sens est donné par `kind` */
  amount: number;
  currency: 'XAF';
  /** Date comptable (jour concerné) */
  date: string;
  title: string;
  notes?: string;
  /** Obligatoire pour catégorie SALARY si renseigné */
  employeeId?: string | null;
  /** Unité du parc (slug calendrier), optionnel — avec apartmentName pour l’affichage */
  unitSlug?: string | null;
  /** Nom du bâtiment TARIFS — renseigné avec unitSlug pour affichage / filtres */
  apartmentName?: string | null;
  createdAt: string;
  updatedAt: string;
  authorUid: string;
}
