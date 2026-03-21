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
  observations: string;
  status: 'VALIDE' | 'ANNULE';
  grandTotal: number;
  totalPaid: number;
  remaining: number;
  agentName?: string;
  commissionAmount?: number;
  isCommissionPaid?: boolean;
  createdAt: string;
  authorUid: string;
}

export interface CleaningReport {
  id?: string;
  menageId: string;
  calendarSlug: string;
  dateIntervention: string;
  agent: string;
  status: 'EFFECTUÉ' | 'ANOMALIE' | 'REPORTÉ' | 'PRÉVU';
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
}

export interface AuthorizedEmail {
  id?: string;
  email: string;
  role: 'admin' | 'agent';
  addedAt: string;
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
