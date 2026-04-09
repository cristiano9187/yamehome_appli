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
  agent: string;
  status: 'EFFECTUÉ' | 'ANOMALIE' | 'REPORTÉ' | 'PRÉVU' | 'ANNULÉ';
  feedback: string;
  damages: string;
  maintenance: string;
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

export interface UserProfile {
  uid: string;
  email: string;
  role: 'admin' | 'agent';
  displayName: string;
  isApproved?: boolean;
  allowedSites?: string[];
}

export interface AuthorizedEmail {
  id?: string;
  email: string;
  role: 'admin' | 'agent';
  addedAt: string;
  allowedSites?: string[];
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
  checkInTime?: string; // HH:mm
  checkOutTime?: string; // HH:mm
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
