export interface Payment {
  id: string;
  date: string;
  amount: number;
  method: string;
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
}

export interface AuthorizedEmail {
  id?: string;
  email: string;
  role: 'admin' | 'agent';
  addedAt: string;
  allowedSites?: string[];
  /** ID document `employees/{id}` — l’agent ne peut cocher la présence que pour cet employé */
  linkedEmployeeId?: string | null;
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

export type ProspectSource = 'FACEBOOK' | 'AIRBNB' | 'BOOKING' | 'TELEPHONE' | 'WHATSAPP' | 'AUTRE';

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
