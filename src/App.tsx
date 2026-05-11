/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc,
  addDoc,
  getDoc, 
  getDocs, 
  query, 
  where, 
  onSnapshot,
  orderBy,
  limit,
  Timestamp,
  deleteDoc,
  waitForPendingWrites
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { TARIFS, PAYMENT_METHODS, HOSTS, getHostsForApartment, getRateForApartment, formatCurrency, SITES, SITE_MAPPING, isOnduleurNonConcerne, canSeeCostsMenu } from './constants';
import { ReceiptData, ReceiptStaySegment, CleaningReport, Payment, UserProfile, AuthorizedEmail, BlockedDate, Prospect, ClientProfile, AgentProfile } from './types';
import { defaultCleaningChecklist, normalizeCleaningReport, validateCleaningReportForSubmit } from './cleaningReportUtils';
import { syncReservationPublicCalendar, deleteAllReservationEventsForReceipt } from './utils/publicCalendar';
import {
  getReceiptSegments,
  newStaySegmentId,
  totalNightsAcrossReceipt,
  primarySegmentChronologically,
  synthesizePersistedReceiptSummary,
  sumCautionsForSegments,
  findBookingConflictAcrossSegments,
} from './utils/receiptSegments';
import { archivePastReservations, populatePublicCalendar } from './utils/archiveManager';
import ReceiptPreview from './components/ReceiptPreview';
import DateRangePicker from './components/DateRangePicker';
const HistoryView = lazy(() => import('./components/HistoryView'));
const CalendarView = lazy(() => import('./components/CalendarView'));
const UserManagement = lazy(() => import('./components/UserManagement'));
const ProspectsView = lazy(() => import('./components/ProspectsView'));
const PrepaidElectricityTokensView = lazy(() => import('./components/PrepaidElectricityTokensView'));
const CostsView = lazy(() => import('./components/CostsView'));
const ProInvoicesView = lazy(() => import('./components/ProInvoicesView'));
import { 
  LogOut, 
  Plus, 
  Edit,
  Save, 
  Printer, 
  Search, 
  Trash2, 
  CheckCircle2, 
  AlertCircle, 
  Clock,
  Check,
  User as UserIcon,
  Home,
  FileText,
  ClipboardCheck,
  ChevronRight,
  Menu,
  Shield,
  Users,
  Lock,
  X,
  History,
  Info,
  Eye,
  Calendar as CalendarIcon,
  Loader2,
  Zap,
  Wallet,
  ScrollText,
  ArrowLeft,
  CreditCard,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

function handleFirestoreError(error: unknown, operationType: string, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    }
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // Ne pas re-lancer : les catch des appelants doivent pouvoir afficher setAlertMessage à l’utilisateur.
}

/** Firestore rejette les champs `undefined` — on les retire avant setDoc. */
function stripUndefinedForFirestore<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

const getLocalDateString = (date: Date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const MAIN_ADMIN_EMAILS = new Set(['christian.yamepi@gmail.com', 'cyamepi@gmail.com']);
const isMainAdminEmail = (email?: string | null) => MAIN_ADMIN_EMAILS.has((email || '').toLowerCase());
const normalizeString = (value: string) => value.trim().toLowerCase();

/** Slug physique pour un segment (unité unique implicite sinon calendrier sélectionné). */
function resolveStaySegmentSlug(seg: ReceiptStaySegment): string {
  const ud = TARIFS[seg.apartmentName]?.units;
  if (ud && ud.length === 1) return ud[0]!;
  return (seg.calendarSlug || '').trim();
}

/** Un seul segment : enregistrement « classique » sans tableau `staySegments`. */
function flattenStaySegmentsIfSingleton(fd: ReceiptData): ReceiptData {
  if (!fd.staySegments?.length) return fd;
  if (fd.staySegments.length > 1) return fd;
  const s = fd.staySegments[0];
  return {
    ...fd,
    staySegments: undefined,
    apartmentName: s.apartmentName,
    calendarSlug: resolveStaySegmentSlug(s),
    startDate: s.startDate,
    endDate: s.endDate,
  };
}

/**
 * Remplit les `calendarSlug` implicites (logement à une seule unité physique) avant de chercher les
 * chevauchements dans Firestore. Sans cela `slugSet` peut rester vide : aucune requête → doublons possibles.
 */
function enrichReceiptSlugsForConflictQueries(r: ReceiptData): ReceiptData {
  if (r.staySegments?.length) {
    return {
      ...r,
      staySegments: r.staySegments.map((seg) => ({
        ...seg,
        calendarSlug: resolveStaySegmentSlug(seg),
      })),
    };
  }
  const ud = r.apartmentName ? TARIFS[r.apartmentName]?.units || [] : [];
  if (ud.length === 1 && !r.calendarSlug?.trim()) {
    return { ...r, calendarSlug: ud[0]! };
  }
  return r;
}

export default function App() {
  const generateNewId = () => `RC-${Math.floor(100000 + Math.random() * 900000)}`;

  const getInitialState = (): ReceiptData => ({
    receiptId: generateNewId(),
    calendarSlug: '',
    firstName: '', lastName: '', phone: '', email: '',
    apartmentName: '', startDate: '', endDate: '',
    isCustomRate: false, customLodgingTotal: 0,
    isNegotiatedRate: false, negotiatedPricePerNight: 0,
    payments: [{ id: Date.now().toString(), date: getLocalDateString(), amount: 0, method: 'Espèces' }],
    signature: '', hosts: [], electricityCharge: false, packEco: false, packConfort: false, observations: '', internalNotes: '',
    status: 'VALIDE', grandTotal: 0, totalPaid: 0, remaining: 0,
    agentName: '', commissionAmount: 0, isCommissionPaid: false,
    cautionAmount: 0, isCautionRefunded: false,
    createdAt: new Date().toISOString(),
    authorUid: auth.currentUser?.uid || ''
  });

  // --- STATES ---
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState<'form' | 'history' | 'calendar' | 'users' | 'prospects' | 'prepaidTokens' | 'costs' | 'proInvoices' | 'maintenance'>('calendar');
  /** Vue où revenir après « Fermer » depuis l’aperçu lecture seule (calendrier, historique…). */
  const [receiptReturnTarget, setReceiptReturnTarget] = useState<'calendar' | 'history' | 'prospects' | null>(null);
  const [maintenanceStatus, setMaintenanceStatus] = useState<Record<string, string>>({});
  const [calendarViewMode, setCalendarViewMode] = useState<'reservations' | 'cleaning' | 'presence'>('reservations');
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [formData, setFormData] = useState<ReceiptData>(getInitialState());
  
  // Custom Debounce for weak mobile devices
  const [debouncedFormData, setDebouncedFormData] = useState(formData);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    setIsSyncing(true);
    const timer = setTimeout(() => {
      setDebouncedFormData(formData);
      setIsSyncing(false);
    }, 500); // 500ms debounce is safe for very weak devices
    return () => clearTimeout(timer);
  }, [formData]);

  const [isSaving, setIsSaving] = useState(false);
  const [sourceProspectId, setSourceProspectId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [clientSearch, setClientSearch] = useState('');
  const [agentSearch, setAgentSearch] = useState('');
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [agentPaymentMethodInput, setAgentPaymentMethodInput] = useState('');
  const [agentPaymentReferenceInput, setAgentPaymentReferenceInput] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showMobileNav, setShowMobileNav] = useState(false);
  
  useEffect(() => {
    if (window.innerWidth < 768 && (urlParams.has('id') || urlParams.has('menageId'))) {
      setIsSidebarOpen(false);
    }
  }, []);

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [alertType, setAlertType] = useState<'info' | 'error' | 'success'>('info');
  const [cleaningSubmitHint, setCleaningSubmitHint] = useState<string | null>(null);
  
  const [isCleaningMode, setIsCleaningMode] = useState(urlParams.has('menageId'));
  const [isReadOnly, setIsReadOnly] = useState(urlParams.has('id'));
  /** Bloc Orange / MTN / RIB / espèces sur le PDF — activé par défaut (désactivable avant impression). */
  const [showReceiptPaymentMethods, setShowReceiptPaymentMethods] = useState(true);
  const [isCleaningReadOnly, setIsCleaningReadOnly] = useState(false);
  const [showCleaningConfirm, setShowCleaningConfirm] = useState(false);
  const [showDeleteCleaningConfirm, setShowDeleteCleaningConfirm] = useState(false);
  const [lastCalendarScroll, setLastCalendarScroll] = useState(0);
  const [pendingCleaningData, setPendingCleaningData] = useState<{
    menageId: string;
    slug: string;
    date: string;
    report?: CleaningReport;
  } | null>(null);

  const [cleaningReport, setCleaningReport] = useState<CleaningReport>({
    menageId: urlParams.get('menageId') || '',
    calendarSlug: urlParams.get('slug') || '',
    dateIntervention: urlParams.get('date') || getLocalDateString(),
    agentEtape1: '',
    agentEtape2: '',
    status: 'PRÉVU', 
    feedback: '', 
    damages: '', 
    ...defaultCleaningChecklist,
    createdAt: new Date().toISOString()
  });

  // Chambres sans onduleur / anti-délestage (Gallaghers) : ne pas conserver d’ancienne saisie backup
  useEffect(() => {
    if (!isCleaningMode || isCleaningReadOnly) return;
    if (!isOnduleurNonConcerne(cleaningReport.calendarSlug)) return;
    setCleaningReport((prev) => {
      if (!prev.backupOnduleurFonctionne && prev.backupBatterieBarres == null) return prev;
      return { ...prev, backupOnduleurFonctionne: '', backupBatterieBarres: null };
    });
  }, [isCleaningMode, isCleaningReadOnly, cleaningReport.calendarSlug]);

  // --- AUTH ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      console.log("Auth state changed:", u?.email);
      setUser(u);
      if (u) {
        try {
          const userEmail = u.email?.toLowerCase();
          const isMainAdmin = isMainAdminEmail(userEmail);
          console.log("Is main admin?", isMainAdmin, userEmail);
          
          const docRef = doc(db, 'users', u.uid);
          let snap;
          try {
            snap = await getDoc(docRef);
          } catch (e) {
            console.error("Error fetching user doc:", e);
            handleFirestoreError(e, OperationType.GET, `users/${u.uid}`);
            return;
          }
          
          let whiteData: AuthorizedEmail | null = null;
          if (userEmail) {
            try {
              const q = query(collection(db, 'authorized_emails'), where('email', '==', userEmail));
              const whiteSnap = await getDocs(q);
              whiteData = !whiteSnap.empty ? whiteSnap.docs[0]?.data() as AuthorizedEmail : null;
            } catch (e) {
              console.error("Error fetching whitelist:", e);
              // Don't block the whole app if whitelist fetch fails, just log it
              // handleFirestoreError(e, OperationType.GET, 'authorized_emails');
            }
          }

          if (snap && snap.exists()) {
            const profile = snap.data() as UserProfile;
            console.log("Existing profile found:", profile);
            
            const shouldBeApproved = profile.isApproved || isMainAdmin || !!whiteData;
            const finalRole = isMainAdmin ? 'admin' : (whiteData?.role || profile.role || 'agent');
            const finalSites = isMainAdmin ? SITES : (whiteData?.allowedSites || profile.allowedSites || []);
            /** Lien fiche employé (présence) : source of truth = authorized_emails, pas stocké sur users/ */
            const finalLinked: string | null | undefined =
              whiteData != null
                ? (whiteData.linkedEmployeeId ?? null)
                : (profile as UserProfile & { linkedEmployeeId?: string | null }).linkedEmployeeId ?? null;

            const financeFromWhitelist = whiteData?.financeAccess === true;
            const financeFromProfile = !!(profile as UserProfile & { financeAccess?: boolean }).financeAccess;
            const finalFinanceAccess = financeFromWhitelist || financeFromProfile;

            const { allowedApartments, ...restProfile } = profile as any;
            const updatedProfile: UserProfile = { 
              ...restProfile, 
              isApproved: shouldBeApproved,
              role: finalRole,
              allowedSites: finalSites
            };
            const forUi: UserProfile = {
              ...updatedProfile,
              linkedEmployeeId: finalLinked ?? undefined,
              ...(finalFinanceAccess ? { financeAccess: true } : {})
            };
            
            // Only update if something actually changed to avoid unnecessary permission checks
            const hasChanged = profile.role !== finalRole || 
                              profile.isApproved !== shouldBeApproved || 
                              JSON.stringify(profile.allowedSites) !== JSON.stringify(finalSites) ||
                              'allowedApartments' in profile;

            if (hasChanged) {
              console.log("Updating user profile in Firestore:", updatedProfile);
              try {
                await setDoc(docRef, updatedProfile);
              } catch (e) {
                console.warn("Could not update user profile in Firestore (likely permission denied for non-admin):", e);
              }
            }
            setUserProfile(forUi);
          } else {
            console.log("No profile found, creating new one");
            const isApproved = !!whiteData || isMainAdmin;
            
            const newProfile: UserProfile = {
              uid: u.uid,
              email: u.email || '',
              displayName: u.displayName || 'Utilisateur',
              role: isMainAdmin ? 'admin' : (whiteData?.role || 'agent'),
              isApproved: isApproved,
              allowedSites: isMainAdmin ? SITES : (whiteData?.allowedSites || [])
            };
            const newForUi: UserProfile = {
              ...newProfile,
              linkedEmployeeId: whiteData != null ? (whiteData.linkedEmployeeId ?? undefined) : undefined,
              ...(whiteData?.financeAccess ? { financeAccess: true } : {})
            };
            console.log("Setting user profile (new):", newProfile);
            try {
              await setDoc(docRef, newProfile);
            } catch (e) {
              console.error("Error creating user profile:", e);
              handleFirestoreError(e, OperationType.WRITE, `users/${u.uid}`);
            }
            setUserProfile(newForUi);
          }
        } catch (error) {
          console.error("Auth profile general error:", error);
        } finally {
          setIsAuthReady(true);
          console.log("Auth ready set to true in finally");
        }
      } else {
        setUserProfile(null);
        setIsAuthReady(true);
      }
    });
    return unsubscribe;
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login error:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  // --- DATA LOADING ---
  const loadData = useCallback(async () => {
    if (!isAuthReady || !user) return;
    
    const id = urlParams.get('id');
    const mId = urlParams.get('menageId');
    if (!id && !mId) return;

    setIsSaving(true);
    try {
      if (id) {
        const q = query(collection(db, 'receipts'), where('receiptId', '==', id), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const data = snap.docs[0].data() as ReceiptData;
          setFormData(flattenStaySegmentsIfSingleton({ ...data }));
          setIsReadOnly(true);
        }
      } else if (mId) {
        const date = urlParams.get('date');
        const slug = urlParams.get('slug');
        let q;
        if (date && slug) {
          q = query(
            collection(db, 'cleaning_reports'), 
            where('menageId', '==', mId), 
            where('dateIntervention', '==', date),
            where('calendarSlug', '==', slug),
            limit(1)
          );
        } else {
          q = query(collection(db, 'cleaning_reports'), where('menageId', '==', mId), limit(1));
        }
        const snap = await getDocs(q);
        if (!snap.empty) {
          const cr = snap.docs[0];
          const raw = cr.data() as Record<string, unknown>;
          setCleaningReport(normalizeCleaningReport({ id: cr.id, ...raw }));
          setIsCleaningReadOnly(true);
        }
      }
    } catch (e) { 
      handleFirestoreError(e, OperationType.GET, id ? 'receipts' : 'cleaning_reports');
    } finally { 
      setIsSaving(false); 
    }
  }, [isAuthReady, user]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!isAuthReady || !user) return;
    const loadDirectoryData = async () => {
      try {
        const [clientsSnap, agentsSnap, receiptsSnap] = await Promise.all([
          getDocs(query(collection(db, 'clients'), orderBy('lastName'))),
          getDocs(query(collection(db, 'agents'), orderBy('name'))),
          getDocs(query(collection(db, 'receipts'), orderBy('createdAt', 'desc'), limit(500)))
        ]);

        const directoryClients = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ClientProfile));
        const directoryAgents = agentsSnap.docs.map(d => ({ id: d.id, ...d.data() } as AgentProfile));
        const receipts = receiptsSnap.docs.map(d => d.data() as ReceiptData);

        const clientsMap = new Map<string, ClientProfile>();
        directoryClients.forEach(client => {
          const key = normalizeString(`${client.firstName}|${client.lastName}|${client.phone}|${client.email}`);
          clientsMap.set(key, client);
        });
        receipts.forEach(receipt => {
          if (!receipt.lastName) return;
          const syntheticClient: ClientProfile = {
            firstName: receipt.firstName || '',
            lastName: receipt.lastName || '',
            phone: receipt.phone || '',
            email: receipt.email || '',
            createdAt: receipt.createdAt || new Date().toISOString(),
            updatedAt: receipt.createdAt || new Date().toISOString(),
            authorUid: receipt.authorUid || user.uid
          };
          const key = normalizeString(`${syntheticClient.firstName}|${syntheticClient.lastName}|${syntheticClient.phone}|${syntheticClient.email}`);
          if (!clientsMap.has(key)) clientsMap.set(key, syntheticClient);
        });

        const agentsMap = new Map<string, AgentProfile>();
        directoryAgents.forEach(agent => {
          agentsMap.set(normalizeString(agent.name), agent);
        });
        receipts.forEach(receipt => {
          const agentName = (receipt.agentName || '').trim();
          if (!agentName) return;
          const key = normalizeString(agentName);
          if (!agentsMap.has(key)) {
            agentsMap.set(key, {
              name: agentName,
              preferredPaymentMethod: '',
              paymentReference: '',
              createdAt: receipt.createdAt || new Date().toISOString(),
              updatedAt: receipt.createdAt || new Date().toISOString(),
              authorUid: receipt.authorUid || user.uid
            });
          }
        });

        setClients(Array.from(clientsMap.values()));
        setAgents(Array.from(agentsMap.values()));
      } catch (error) {
        console.warn('Could not load clients/agents directory:', error);
      }
    };
    loadDirectoryData();
  }, [isAuthReady, user]);

  const upsertClientFromReceipt = useCallback(async (receipt: ReceiptData) => {
    if (!user?.uid || !receipt.lastName) return;
    const normalizedPhone = normalizeString(receipt.phone || '');
    const normalizedEmail = normalizeString(receipt.email || '');
    const existing = clients.find(c =>
      (normalizedEmail && normalizeString(c.email || '') === normalizedEmail) ||
      (normalizedPhone && normalizeString(c.phone || '') === normalizedPhone) ||
      normalizeString(`${c.firstName} ${c.lastName}`) === normalizeString(`${receipt.firstName} ${receipt.lastName}`)
    );

    const payload: Omit<ClientProfile, 'id'> = {
      firstName: receipt.firstName || '',
      lastName: receipt.lastName || '',
      phone: receipt.phone || '',
      email: receipt.email || '',
      updatedAt: new Date().toISOString(),
      createdAt: existing?.createdAt || new Date().toISOString(),
      authorUid: existing?.id ? (existing.authorUid || user.uid) : user.uid
    };

    if (existing?.id) {
      await setDoc(doc(db, 'clients', existing.id), payload, { merge: true });
    } else {
      await addDoc(collection(db, 'clients'), payload);
    }
  }, [clients, user?.uid]);

  const upsertAgentFromReceipt = useCallback(async (receipt: ReceiptData) => {
    if (!user?.uid || !receipt.agentName?.trim()) return;
    const existing = agents.find(a => normalizeString(a.name) === normalizeString(receipt.agentName || ''));
    const payload: Omit<AgentProfile, 'id'> = {
      name: receipt.agentName || '',
      preferredPaymentMethod: existing?.preferredPaymentMethod || '',
      paymentReference: existing?.paymentReference || '',
      notes: existing?.notes || '',
      updatedAt: new Date().toISOString(),
      createdAt: existing?.createdAt || new Date().toISOString(),
      authorUid: existing?.id ? (existing.authorUid || user.uid) : user.uid
    };

    if (existing?.id) {
      await setDoc(doc(db, 'agents', existing.id), payload, { merge: true });
    } else {
      await addDoc(collection(db, 'agents'), payload);
    }
  }, [agents, user?.uid]);

  // --- CALCULATIONS ---
  const totals = useMemo(() => {
    const zeroTotals = { nights: 0, grandTotal: 0, totalPaid: 0, remaining: 0, commissionAmount: 0, cautionAmount: 0 };
    const multi =
      !!formData.staySegments && Array.isArray(formData.staySegments) && formData.staySegments.length >= 2;

    if (!multi) {
      if (!formData.startDate || !formData.endDate || !formData.apartmentName) {
        return zeroTotals;
      }
      const start = new Date(formData.startDate);
      const end = new Date(formData.endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return zeroTotals;
      }
      const diffTime = end.getTime() - start.getTime();
      const nights = Math.max(0, Math.ceil(diffTime / (1000 * 3600 * 24)));
      const rates = getRateForApartment(formData.apartmentName, nights);
      const pricePerNight = formData.isNegotiatedRate ? (formData.negotiatedPricePerNight || 0) : rates.prix;
      const totalLodging = formData.isCustomRate ? formData.customLodgingTotal : (pricePerNight * nights);
      const cautionAmount = rates.caution;
      const grandTotal = totalLodging + cautionAmount;
      const totalPaid = (formData.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
      let commissionAmount = 0;
      if (formData.agentName && nights > 0) {
        if (nights <= 14) {
          commissionAmount = totalLodging * 0.10;
        } else if (nights <= 30) {
          commissionAmount = totalLodging * 0.08;
        } else {
          const avgPrice = totalLodging / nights;
          commissionAmount = (avgPrice * 30) * 0.08;
        }
      }
      return {
        nights,
        grandTotal,
        totalPaid,
        remaining: grandTotal - totalPaid,
        commissionAmount,
        cautionAmount
      };
    }

    const segList = formData.staySegments!;
    if (
      segList.some((s) => {
        if (!s.apartmentName?.trim() || !s.startDate || !s.endDate || s.startDate >= s.endDate) return true;
        const ud = TARIFS[s.apartmentName]?.units || [];
        if (ud.length > 1 && !s.calendarSlug?.trim()) return true;
        const sl = resolveStaySegmentSlug(s);
        return !sl;
      })
    ) {
      return zeroTotals;
    }
    const synth = { ...formData, staySegments: segList } as ReceiptData;
    const nights = totalNightsAcrossReceipt(synth);
    if (!nights) return zeroTotals;
    const prim = primarySegmentChronologically(segList);
    const rates = getRateForApartment(prim.apartmentName, nights);
    const pricePerNight = formData.isNegotiatedRate ? (formData.negotiatedPricePerNight || 0) : rates.prix;
    const totalLodging = formData.isCustomRate ? formData.customLodgingTotal : (pricePerNight * nights);
    const cautionAmount = sumCautionsForSegments(synth);
    const grandTotal = totalLodging + cautionAmount;
    const totalPaid = (formData.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
    let commissionAmount = 0;
    if (formData.agentName && nights > 0) {
      if (nights <= 14) {
        commissionAmount = totalLodging * 0.10;
      } else if (nights <= 30) {
        commissionAmount = totalLodging * 0.08;
      } else {
        const avgPrice = totalLodging / nights;
        commissionAmount = (avgPrice * 30) * 0.08;
      }
    }
    return {
      nights,
      grandTotal,
      totalPaid,
      remaining: grandTotal - totalPaid,
      commissionAmount,
      cautionAmount
    };
  }, [
    formData.staySegments,
    formData.startDate,
    formData.endDate,
    formData.apartmentName,
    formData.isNegotiatedRate,
    formData.negotiatedPricePerNight,
    formData.isCustomRate,
    formData.customLodgingTotal,
    formData.payments,
    formData.agentName
  ]);

  useEffect(() => {
    const hasChanged = 
      (formData.grandTotal !== totals.grandTotal && !(Number.isNaN(formData.grandTotal) && Number.isNaN(totals.grandTotal))) ||
      (formData.totalPaid !== totals.totalPaid && !(Number.isNaN(formData.totalPaid) && Number.isNaN(totals.totalPaid))) ||
      (formData.remaining !== totals.remaining && !(Number.isNaN(formData.remaining) && Number.isNaN(totals.remaining))) ||
      (formData.commissionAmount !== totals.commissionAmount && !(Number.isNaN(formData.commissionAmount) && Number.isNaN(totals.commissionAmount))) ||
      (formData.cautionAmount !== totals.cautionAmount && !(Number.isNaN(formData.cautionAmount) && Number.isNaN(totals.cautionAmount)));

    if (hasChanged) {
      setFormData(prev => ({
        ...prev,
        grandTotal: totals.grandTotal,
        totalPaid: totals.totalPaid,
        remaining: totals.remaining,
        commissionAmount: totals.commissionAmount,
        cautionAmount: totals.cautionAmount
      }));
    }
  }, [totals, formData.grandTotal, formData.totalPaid, formData.remaining, formData.commissionAmount, formData.cautionAmount]);

  // --- TITLE SYNC FOR PDF FILENAME ---
  useEffect(() => {
    if (view === 'form' && isReadOnly && formData.receiptId) {
      const createdAt = new Date(formData.createdAt || Date.now());
      const dateStr = getLocalDateString(createdAt);
      const hours = String(createdAt.getHours()).padStart(2, '0');
      const minutes = String(createdAt.getMinutes()).padStart(2, '0');
      const timeStr = `${hours}h${minutes}`;

      const cleanString = (str: string) => {
        return str
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "") // Remove accents
          .trim()
          .replace(/\s+/g, '_')
          .replace(/[^a-zA-Z0-9_]/g, ''); // Keep only alphanumeric and underscores
      };

      const clientName = cleanString(`${formData.firstName} ${formData.lastName}`);
      const apartmentShort = cleanString((formData.apartmentName || '').substring(0, 10));

      const fileName = `reçu_${clientName}_${apartmentShort}_${dateStr}_${timeStr}`;
      const originalTitle = document.title;
      document.title = fileName;

      // Extra safety for some mobile browsers
      const handleBeforePrint = () => { document.title = fileName; };
      window.addEventListener('beforeprint', handleBeforePrint);

      return () => {
        document.title = originalTitle;
        window.removeEventListener('beforeprint', handleBeforePrint);
      };
    }
  }, [view, isReadOnly, formData.receiptId, formData.createdAt, formData.firstName, formData.lastName, formData.apartmentName]);

  const handlePrint = useCallback(() => {
    if (!isReadOnly) {
      setAlertType('error');
      setAlertMessage("Veuillez d'abord SAUVEGARDER le reçu avant de l'exporter en PDF pour garantir que les données sont bien enregistrées dans la base de données.");
      return;
    }
    window.print();
  }, [isReadOnly]);

  // --- HANDLERS ---
  const handleChange = (e: any) => {
    if (isReadOnly) return;
    const { name, value, type, checked } = e.target;
    if (type === 'checkbox') {
      if (name === 'isCustomRate') setFormData(prev => ({ ...prev, isCustomRate: checked, isNegotiatedRate: checked ? false : prev.isNegotiatedRate }));
      else if (name === 'isNegotiatedRate') setFormData(prev => ({ ...prev, isNegotiatedRate: checked, isCustomRate: checked ? false : prev.isCustomRate }));
      else if (name === 'electricityCharge') setFormData(prev => ({ ...prev, electricityCharge: checked, packEco: checked ? false : prev.packEco, packConfort: checked ? false : prev.packConfort }));
      else if (name === 'packEco') setFormData(prev => ({ ...prev, packEco: checked, electricityCharge: checked ? false : prev.electricityCharge, packConfort: checked ? false : prev.packConfort }));
      else if (name === 'packConfort') setFormData(prev => ({ ...prev, packConfort: checked, electricityCharge: checked ? false : prev.electricityCharge, packEco: checked ? false : prev.packEco }));
      else setFormData(prev => ({ ...prev, [name]: checked }));
    } else if (name === 'hosts') {
      const options = e.target.options;
      const selected = [];
      for (let i = 0; i < options.length; i++) {
        if (options[i].selected) selected.push(options[i].value);
      }
      setFormData(prev => ({ ...prev, hosts: selected }));
    } else {
      setFormData(prev => ({ ...prev, [name]: type === 'number' ? (parseFloat(value) || 0) : value }));
    }
  };

  const handleCleaningChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const t = e.target;
    if ('type' in t && t.type === 'checkbox' && t instanceof HTMLInputElement) {
      const { name, checked } = t;
      setCleaningReport(prev => ({ ...prev, [name]: checked } as CleaningReport));
      return;
    }
    if ('type' in t && t.type === 'number' && t instanceof HTMLInputElement) {
      const { name, value } = t;
      if (name === 'kwhCompteurPrepaye' || name === 'nombreServiettes') {
        if (value === '') {
          setCleaningReport(prev => ({ ...prev, [name]: null } as CleaningReport));
        } else if (name === 'kwhCompteurPrepaye') {
          const n = parseFloat(value);
          setCleaningReport(prev => ({ ...prev, kwhCompteurPrepaye: Number.isNaN(n) ? null : n }));
        } else {
          const n = parseInt(value, 10);
          setCleaningReport(prev => ({ ...prev, nombreServiettes: Number.isNaN(n) ? null : Math.max(0, n) }));
        }
      }
      return;
    }
    const { name, value } = t;
    if (name === 'backupOnduleurFonctionne') {
      setCleaningReport(prev => ({
        ...prev,
        backupOnduleurFonctionne: value as '' | 'OUI' | 'NON',
        backupBatterieBarres: value === 'NON' ? null : prev.backupBatterieBarres
      } as CleaningReport));
      return;
    }
    if (name === 'backupBatterieBarres') {
      if (value === '') {
        setCleaningReport(prev => ({ ...prev, backupBatterieBarres: null } as CleaningReport));
        return;
      }
      const n = parseInt(value, 10);
      setCleaningReport(prev => ({
        ...prev,
        backupBatterieBarres: n === 1 || n === 2 || n === 3 ? n : null
      } as CleaningReport));
      return;
    }
    setCleaningReport(prev => ({ ...prev, [name]: value } as CleaningReport));
  };

  const submitCleaningReport = async () => {
    setCleaningSubmitHint(null);
    const allowedSites = userProfile?.allowedSites || [];
    const isMainAdmin = isMainAdminEmail(userProfile?.email);
    
    const allowedApartments = userProfile?.role === 'admin' || isMainAdmin 
      ? Object.keys(TARIFS) 
      : allowedSites.flatMap(site => SITE_MAPPING[site] || []);

    const isAllowed = allowedApartments.some(apt => TARIFS[apt]?.units?.includes(cleaningReport.calendarSlug));

    if (!isAllowed) {
      const msg = "Vous n'êtes pas autorisé à gérer le ménage pour ce logement.";
      setCleaningSubmitHint(msg);
      setAlertType('error');
      setAlertMessage(msg);
      return;
    }

    const validationError = validateCleaningReportForSubmit(cleaningReport);
    if (validationError) {
      setCleaningSubmitHint(validationError);
      setAlertType('error');
      setAlertMessage(validationError);
      return;
    }
    setIsSaving(true);
    try {
      // Create a unique deterministic ID if not already present
      const reportId = cleaningReport.id || `CR-${cleaningReport.menageId}-${cleaningReport.calendarSlug}-${cleaningReport.dateIntervention}`;
      const payload = stripUndefinedForFirestore({
        ...cleaningReport,
        id: reportId,
        createdAt: new Date().toISOString()
      } as Record<string, unknown>);
      await setDoc(doc(db, 'cleaning_reports', reportId), payload);

      // Close modals first
      setIsCleaningMode(false);
      setView('calendar');

      setCleaningSubmitHint(null);
      // Then show alert
      setTimeout(() => {
        setAlertType('success');
        setAlertMessage(cleaningReport.status === 'ANNULÉ' ? "Planning effacé !" : "Rapport enregistré !");
      }, 100);
    } catch (e) { 
      handleFirestoreError(e, OperationType.WRITE, 'cleaning_reports');
      const em = e && typeof e === 'object' && 'message' in e ? String((e as Error).message) : String(e);
      const isPerm =
        /permission|insufficient|missing or insufficient|denied|PERMISSION/i.test(em);
      const msg = isPerm
        ? "Enregistrement refusé : droits Firebase insuffisants. Vérifiez que vous êtes connecté et autorisé pour ce logement, ou demandez un correctif des règles Firestore."
        : "Erreur d'enregistrement (réseau, données invalides, etc.). Détails dans la console (F12).";
      setCleaningSubmitHint(msg);
      setAlertType('error');
      setAlertMessage(msg);
    } finally { 
      setIsSaving(false); 
    }
  };

  const deleteCleaningReport = async () => {
    const dataToUse = pendingCleaningData?.report || cleaningReport;
    const slug = dataToUse.calendarSlug || pendingCleaningData?.slug || '';
    
    const isMainAdmin = isMainAdminEmail(userProfile?.email);
    const isAdmin = userProfile?.role === 'admin' || isMainAdmin;
    
    const allowedSites = userProfile?.allowedSites || [];
    const allowedApartments = isAdmin ? Object.keys(TARIFS) : allowedSites.flatMap(site => SITE_MAPPING[site] || []);
    
    const isAllowed = allowedApartments.some(apt => TARIFS[apt]?.units?.includes(slug));

    if (!isAllowed) {
      setAlertType('error');
      setAlertMessage("Vous n'êtes pas autorisé à effacer ce planning.");
      return;
    }

    setIsSaving(true);
    try {
      // Use pending data if available to avoid stale state issues
      const dataToUse = pendingCleaningData?.report || cleaningReport;
      const reportId = dataToUse.id || `CR-${dataToUse.menageId || pendingCleaningData?.menageId || 'MANUAL'}-${dataToUse.calendarSlug || pendingCleaningData?.slug}-${dataToUse.dateIntervention || pendingCleaningData?.date}`;
      
      const finalData = {
        ...dataToUse,
        menageId: dataToUse.menageId || pendingCleaningData?.menageId || 'MANUAL',
        calendarSlug: dataToUse.calendarSlug || pendingCleaningData?.slug || '',
        dateIntervention: dataToUse.dateIntervention || pendingCleaningData?.date || '',
        id: reportId,
        status: 'ANNULÉ' as const,
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'cleaning_reports', reportId), finalData);

      // Close modals first
      setIsCleaningMode(false);
      setShowCleaningConfirm(false);
      setShowDeleteCleaningConfirm(false);
      setPendingCleaningData(null);
      setView('calendar');

      // Then show alert
      setTimeout(() => {
        setAlertType('success');
        setAlertMessage("Planning effacé avec succès !");
      }, 100);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'cleaning_reports');
      setAlertType('error');
      setAlertMessage("Erreur lors de la suppression");
    } finally {
      setIsSaving(false);
    }
  };

  const saveToFirestore = async () => {
    if (isReadOnly) return;

    let working = flattenStaySegmentsIfSingleton(formData);
    const isMultiPersist = !!(working.staySegments && working.staySegments.length >= 2);

    if (!working.lastName?.trim()) {
      setAlertType('error');
      setAlertMessage('Remplir au minimum le nom du client.');
      return;
    }

    if (!isMultiPersist) {
      if (!working.apartmentName || !working.startDate || !working.endDate) {
        setAlertType('error');
        setAlertMessage('Remplir Nom, Logement et dates.');
        return;
      }
      const apartmentDataMono = TARIFS[working.apartmentName];
      const unitsMono = apartmentDataMono?.units || [];
      const monoSlugCheck = unitsMono.length === 1 ? unitsMono[0] : working.calendarSlug;
      if (unitsMono.length > 1 && !working.calendarSlug) {
        setAlertType('error');
        setAlertMessage("Précisez l'unité");
        return;
      }
    } else {
      const segList = working.staySegments!;
      for (const s of segList) {
        if (!s.apartmentName?.trim() || !s.startDate || !s.endDate) {
          setAlertType('error');
          setAlertMessage('Chaque segment doit avoir un logement et des dates (début / fin).');
          return;
        }
        if (s.startDate >= s.endDate) {
          setAlertType('error');
          setAlertMessage(`Segment : la date de fin doit être après le début (${s.apartmentName}).`);
          return;
        }
        const ud = TARIFS[s.apartmentName]?.units || [];
        if (ud.length > 1 && !s.calendarSlug?.trim()) {
          setAlertType('error');
          setAlertMessage(`Précisez l'unité pour : ${s.apartmentName}`);
          return;
        }
      }
    }

    const isMainAdmin = isMainAdminEmail(userProfile?.email);
    const isAdmin = userProfile?.role === 'admin' || isMainAdmin;
    const allowedSites = userProfile?.allowedSites || [];
    const allowedApartments = isAdmin ? Object.keys(TARIFS) : allowedSites.flatMap((site) => SITE_MAPPING[site] || []);

    if (isMultiPersist) {
      for (const s of working.staySegments!) {
        if (!allowedApartments.includes(s.apartmentName)) {
          setAlertType('error');
          setAlertMessage(`Vous n'êtes pas autorisé à gérer le logement : ${s.apartmentName}`);
          return;
        }
      }
    } else if (!allowedApartments.includes(working.apartmentName!)) {
      setAlertType('error');
      setAlertMessage("Vous n'êtes pas autorisé à gérer cet appartement.");
      return;
    }

    setIsSaving(true);
    try {
      const docId = working.id || working.receiptId;

      const withTimeout = async (p: Promise<any>, ms: number = 10000) => {
        return Promise.race([
          p,
          new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), ms))
        ]);
      };

      /** Segments persistés avec `calendarSlug` résolu pour chaque ligne. */
      let persistSegments: ReceiptStaySegment[] | undefined = undefined;
      let overlapSegsInput: ReceiptData = working;
      if (isMultiPersist) {
        persistSegments = working.staySegments!.map((s) => ({
          ...s,
          id: s.id?.trim() ? s.id : newStaySegmentId(),
          calendarSlug: resolveStaySegmentSlug(s),
        }));
        working = { ...working, staySegments: persistSegments };
        overlapSegsInput = { ...working, staySegments: persistSegments };
      }

      overlapSegsInput = enrichReceiptSlugsForConflictQueries(overlapSegsInput);
      const overlapSegs = getReceiptSegments(overlapSegsInput);

      const slugSet = new Set(overlapSegs.map((s) => s.calendarSlug).filter(Boolean));
      if (slugSet.size === 0) {
        setIsSaving(false);
        setAlertType('error');
        setAlertMessage(
          "Impossible de vérifier les disponibilités : unité de logement non identifiée. Précisez l'unité (slug calendrier) ou le bon appartement."
        );
        return;
      }
      const docMap = new Map<string, ReceiptData>();

      for (const finalSlugLoop of slugSet) {
        const relatedApartments = Object.entries(TARIFS)
          .filter(([_, data]) => data.units?.includes(finalSlugLoop))
          .map(([name]) => name);

        const snapSlug = await withTimeout(
          getDocs(query(collection(db, 'receipts'), where('calendarSlug', '==', finalSlugLoop))) as Promise<any>
        );
        let allDocsRaw: any[] = [...snapSlug.docs];
        if (relatedApartments.length > 0) {
          for (let i = 0; i < relatedApartments.length; i += 30) {
            const chunk = relatedApartments.slice(i, i + 30);
            const qApt = query(collection(db, 'receipts'), where('apartmentName', 'in', chunk));
            const snapApt = await withTimeout(getDocs(qApt) as Promise<any>);
            allDocsRaw = allDocsRaw.concat(snapApt.docs);
          }
        }

        allDocsRaw.forEach((d: any) => docMap.set(d.id, { id: d.id, ...d.data() }));
      }

      const activeBookings = Array.from(docMap.values()).filter((b) => b.status !== 'ANNULE');
      const conflict = findBookingConflictAcrossSegments(
        docId,
        working.receiptId,
        overlapSegs,
        activeBookings
      );

      if (conflict) {
        setIsSaving(false);
        const conflictName = `${conflict.firstName} ${conflict.lastName}`.trim() || 'un autre client';
        const otherSegs = getReceiptSegments(conflict);
        const o = otherSegs[0];
        setAlertType('error');
        setAlertMessage(
          `CONFLIT DE RÉSERVATION : le logement est déjà réservé sur ces dates (chevauchement avec « ${conflictName} », reçu ${conflict.receiptId}, ${o?.calendarSlug ?? ''} ${o?.startDate}→${o?.endDate}). Ne créez pas un second reçu : ouvrez le reçu existant pour ajouter un versement ou modifier les dates / le logement.`
        );
        return;
      }

      for (const s of overlapSegs) {
        const qBlocked = query(collection(db, 'blocked_dates'), where('calendarSlug', '==', s.calendarSlug));
        const snapBlocked = await withTimeout(getDocs(qBlocked) as Promise<any>);
        const blockedDates = snapBlocked.docs.map((d: any) => d.data() as BlockedDate);
        const blocked = blockedDates.find((bd) => bd.date >= s.startDate && bd.date < s.endDate);
        if (blocked) {
          setIsSaving(false);
          setAlertType('error');
          setAlertMessage(
            `DATE BLOQUÉE : "${s.calendarSlug}" est bloqué le ${blocked.date} (coupe votre plage du ${s.startDate} au ${s.endDate}).`
          );
          return;
        }
      }

      const summary = synthesizePersistedReceiptSummary(overlapSegsInput);

      let finalTopSlug: string;
      if (!isMultiPersist) {
        const apartmentDataMono = TARIFS[working.apartmentName!];
        const unitsMono = apartmentDataMono?.units || [];
        finalTopSlug = unitsMono.length === 1 ? unitsMono[0]! : working.calendarSlug!;
      } else {
        finalTopSlug = summary.calendarSlug || persistSegments![0].calendarSlug;
      }

      const receiptPayload: ReceiptData = {
        ...working,
        ...summary,
        staySegments: isMultiPersist ? persistSegments : undefined,
        calendarSlug: finalTopSlug,
        id: docId,
        receiptId: working.receiptId,
        authorUid: user?.uid,
        createdAt: working.createdAt || new Date().toISOString(),
        status: working.status || 'VALIDE'
      };

      await withTimeout(
        setDoc(doc(db, 'receipts', docId), stripUndefinedForFirestore(receiptPayload as unknown as Record<string, unknown>))
      );

      await Promise.all([upsertClientFromReceipt(receiptPayload), upsertAgentFromReceipt(receiptPayload)]);

      // --- AUTOMATIC CLEANING GENERATION (un rapport par segment de séjour)
      if (receiptPayload.status !== 'ANNULE') {
        for (const seg of getReceiptSegments(receiptPayload)) {
          const cleaningReportId = `CR-${receiptPayload.receiptId}-${seg.calendarSlug}-${seg.endDate}`;
          await withTimeout(
            setDoc(
              doc(db, 'cleaning_reports', cleaningReportId),
              {
                menageId: receiptPayload.receiptId,
                calendarSlug: seg.calendarSlug,
                dateIntervention: seg.endDate,
                agentEtape1: '',
                agentEtape2: '',
                status: 'PRÉVU',
                feedback: '',
                damages: '',
                ...defaultCleaningChecklist,
                createdAt: new Date().toISOString()
              },
              { merge: true }
            )
          );
        }
      }

      if (sourceProspectId) {
        await withTimeout(
          updateDoc(doc(db, 'prospects', sourceProspectId), {
            status: 'CONVERTI',
            convertedReceiptId: receiptPayload.receiptId,
            updatedAt: new Date().toISOString()
          })
        );
      }

      await syncReservationPublicCalendar(receiptPayload);
      setFormData(receiptPayload);

      try {
        await withTimeout(waitForPendingWrites(db), 5000);
      } catch (e) {
        console.warn('Server sync timeout, data will sync in background');
      }

      setSaveStatus('success');
      setAlertType('success');
      setAlertMessage('Reçu enregistré avec succès !');
      setTimeout(() => setSaveStatus('idle'), 3000);
      setIsReadOnly(true);
      setSourceProspectId(null);
      setShowMobileNav(false);
    } catch (error: any) {
      if (error.message === 'TIMEOUT') {
        setAlertType('error');
        setAlertMessage(
          'DÉLAI DÉPASSÉ : La connexion est trop lente. Vos données sont peut-être enregistrées localement et seront synchronisées dès que possible.'
        );
      } else {
        handleFirestoreError(error, OperationType.WRITE, 'receipts');
        setSaveStatus('error');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleNewReceipt = () => {
    setFormData(getInitialState());
    setSourceProspectId(null);
    setIsReadOnly(false);
    setReceiptReturnTarget(null);
    setView('form');
    setShowMobileNav(false);
  };

  const handleCloseReceiptPreview = useCallback(() => {
    setView(receiptReturnTarget ?? 'calendar');
    setReceiptReturnTarget(null);
  }, [receiptReturnTarget]);

  const handleConvertProspect = (prospect: Prospect) => {
    const apartmentData = prospect.apartmentName ? TARIFS[prospect.apartmentName] : undefined;
    const finalSlug = prospect.calendarSlug || (apartmentData?.units?.length === 1 ? apartmentData.units[0] : '');
    const hasTotalStayPrice = !!prospect.totalStayPrice && prospect.totalStayPrice > 0;

    setFormData({
      ...getInitialState(),
      receiptId: generateNewId(),
      firstName: prospect.firstName || '',
      lastName: prospect.lastName || '',
      phone: prospect.phone || '',
      email: prospect.email || '',
      apartmentName: prospect.apartmentName || '',
      calendarSlug: finalSlug,
      startDate: prospect.startDate || '',
      endDate: prospect.endDate || '',
      isCustomRate: hasTotalStayPrice,
      customLodgingTotal: hasTotalStayPrice ? (prospect.totalStayPrice || 0) : 0,
      observations: prospect.notes || ''
    });
    setSourceProspectId(prospect.id || null);
    setIsReadOnly(false);
    setReceiptReturnTarget('prospects');
    setView('form');
    setShowMobileNav(false);
    if (window.innerWidth < 768) setIsSidebarOpen(true);
    setAlertType('info');
    setAlertMessage("Prospect charge. Completez puis sauvegardez pour creer le recu.");
  };

  const applyClientSuggestion = (matchedClient: ClientProfile) => {
    setFormData(prev => ({
      ...prev,
      firstName: matchedClient.firstName || '',
      lastName: matchedClient.lastName || '',
      phone: matchedClient.phone || '',
      email: matchedClient.email || ''
    }));
    setClientSearch(`${matchedClient.firstName} ${matchedClient.lastName}`.trim());
  };

  const selectableApartments = useMemo(() => {
    if (!userProfile) return [] as string[];
    if (userProfile.role === 'admin' || isMainAdminEmail(userProfile.email)) return Object.keys(TARIFS);
    return (userProfile.allowedSites || []).flatMap((site) => SITE_MAPPING[site] || []);
  }, [userProfile]);

  const stayMultiUi = !!(formData.staySegments?.length);

  const enableStayMultiMode = () => {
    if (isReadOnly) return;
    if (!formData.apartmentName || !formData.startDate || !formData.endDate) {
      setAlertType('info');
      setAlertMessage('Renseignez d’abord un logement et les dates dans le mode simple, puis réactivez le mode multi-plages.');
      return;
    }
    const ud = TARIFS[formData.apartmentName]?.units || [];
    const slugMono = ud.length === 1 ? ud[0]! : formData.calendarSlug || '';
    if (ud.length > 1 && !formData.calendarSlug) {
      setAlertType('error');
      setAlertMessage("Précisez l’unité avant d’ajouter plusieurs plages.");
      return;
    }
    const first: ReceiptStaySegment = {
      id: newStaySegmentId(),
      apartmentName: formData.apartmentName,
      calendarSlug: slugMono,
      startDate: formData.startDate,
      endDate: formData.endDate,
      lodgingAllocated: formData.isCustomRate ? formData.customLodgingTotal : null,
    };
    const second: ReceiptStaySegment = {
      id: newStaySegmentId(),
      apartmentName: '',
      calendarSlug: '',
      startDate: formData.endDate,
      endDate: formData.endDate,
      lodgingAllocated: null,
    };
    const nextSegs = [first, second];
    setFormData((prev) => ({
      ...prev,
      staySegments: nextSegs,
      ...synthesizePersistedReceiptSummary({ ...prev, staySegments: nextSegs }),
    }));
  };

  const disableStayMultiMode = () => {
    setFormData((prev) => {
      const segs = prev.staySegments;
      if (!segs?.length) return { ...prev, staySegments: undefined };
      return flattenStaySegmentsIfSingleton({ ...prev, staySegments: [segs[0]] });
    });
  };

  const updateStaySegmentRow = (index: number, patch: Partial<ReceiptStaySegment>) => {
    setFormData((prev) => {
      const arr = [...(prev.staySegments || [])];
      const merged = { ...arr[index], ...patch };
      arr[index] = merged;
      const ud = TARIFS[merged.apartmentName]?.units;
      if (ud && ud.length === 1) {
        arr[index].calendarSlug = ud[0]!;
      }
      const next = { ...prev, staySegments: arr };
      if (arr.length >= 2) {
        return { ...next, ...synthesizePersistedReceiptSummary(next as ReceiptData) };
      }
      return next;
    });
  };

  const addStaySegmentRow = () => {
    setFormData((prev) => {
      const arr = [...(prev.staySegments || [])];
      const last = arr[arr.length - 1];
      const anchorEnd = last?.endDate || prev.endDate || getLocalDateString();
      arr.push({
        id: newStaySegmentId(),
        apartmentName: last?.apartmentName || prev.apartmentName || '',
        calendarSlug: last?.calendarSlug || prev.calendarSlug || '',
        startDate: anchorEnd,
        endDate: anchorEnd,
        lodgingAllocated: null,
      });
      const next = { ...prev, staySegments: arr };
      return arr.length >= 2 ? { ...next, ...synthesizePersistedReceiptSummary(next as ReceiptData) } : next;
    });
  };

  const removeStaySegmentRow = (index: number) => {
    setFormData((prev) => {
      const arr = [...(prev.staySegments || [])];
      arr.splice(index, 1);
      if (arr.length === 0) {
        return { ...prev, staySegments: undefined };
      }
      const next = { ...prev, staySegments: arr };
      if (arr.length === 1) {
        const f = arr[0];
        return {
          ...next,
          staySegments: undefined,
          apartmentName: f.apartmentName,
          calendarSlug: resolveStaySegmentSlug(f),
          startDate: f.startDate,
          endDate: f.endDate,
        };
      }
      return { ...next, ...synthesizePersistedReceiptSummary(next as ReceiptData) };
    });
  };

  // Hôtes filtrés selon la ville du logement sélectionné
  const availableHosts = useMemo(
    () => getHostsForApartment(formData.apartmentName),
    [formData.apartmentName]
  );

  // Nettoyer les hôtes sélectionnés qui ne correspondent plus au logement choisi
  useEffect(() => {
    if (!formData.apartmentName || isReadOnly) return;
    const validIds = new Set(availableHosts.map(h => h.id));
    const cleanedHosts = (formData.hosts || []).filter(label =>
      HOSTS.some(h => h.label === label && validIds.has(h.id))
    );
    if (cleanedHosts.length !== (formData.hosts || []).length) {
      setFormData(prev => ({
        ...prev,
        hosts: cleanedHosts,
        signature: cleanedHosts.length > 0 ? prev.signature : '',
      }));
    }
  }, [formData.apartmentName]);

  const filteredClients = useMemo(() => {
    const term = normalizeString(clientSearch);
    if (term.length < 2) return [];
    return clients
      .filter(c => {
        const fullName = normalizeString(`${c.firstName} ${c.lastName}`);
        return fullName.includes(term) ||
          normalizeString(c.phone || '').includes(term) ||
          normalizeString(c.email || '').includes(term);
      })
      .slice(0, 8);
  }, [clientSearch, clients]);

  const filteredAgents = useMemo(() => {
    const term = normalizeString(agentSearch);
    if (term.length < 2) return [];
    return agents
      .filter(a => {
        const label = normalizeString(`${a.name} ${a.preferredPaymentMethod} ${a.paymentReference}`);
        return label.includes(term);
      })
      .slice(0, 8);
  }, [agentSearch, agents]);

  const getSelectedAgent = useMemo(
    () => agents.find(a => normalizeString(a.name) === normalizeString(formData.agentName || '')),
    [agents, formData.agentName]
  );

  const getSelectedClient = useMemo(
    () => clients.find(c =>
      normalizeString(c.firstName) === normalizeString(formData.firstName || '') &&
      normalizeString(c.lastName) === normalizeString(formData.lastName || '')
    ),
    [clients, formData.firstName, formData.lastName]
  );

  const hasClientDirectoryChanges = useMemo(() => {
    const firstName = (formData.firstName || '').trim();
    const lastName = (formData.lastName || '').trim();
    const phone = (formData.phone || '').trim();
    const email = (formData.email || '').trim();

    if (!lastName) return false;
    if (!getSelectedClient) return true;

    return firstName !== (getSelectedClient.firstName || '').trim() ||
      lastName !== (getSelectedClient.lastName || '').trim() ||
      phone !== (getSelectedClient.phone || '').trim() ||
      email !== (getSelectedClient.email || '').trim();
  }, [formData.firstName, formData.lastName, formData.phone, formData.email, getSelectedClient]);

  const hasAgentDirectoryChanges = useMemo(() => {
    const name = (formData.agentName || '').trim();
    if (!name) return false;

    const method = agentPaymentMethodInput.trim();
    const reference = agentPaymentReferenceInput.trim();
    if (!getSelectedAgent) return true;

    return name !== (getSelectedAgent.name || '').trim() ||
      method !== (getSelectedAgent.preferredPaymentMethod || '').trim() ||
      reference !== (getSelectedAgent.paymentReference || '').trim();
  }, [formData.agentName, agentPaymentMethodInput, agentPaymentReferenceInput, getSelectedAgent]);

  useEffect(() => {
    setAgentPaymentMethodInput(getSelectedAgent?.preferredPaymentMethod || '');
    setAgentPaymentReferenceInput(getSelectedAgent?.paymentReference || '');
  }, [getSelectedAgent]);

  useEffect(() => {
    setAgentSearch(formData.agentName || '');
  }, [formData.agentName]);

  const saveAgentDirectoryDetails = async () => {
    const name = (formData.agentName || '').trim();
    if (!name || !user?.uid || !hasAgentDirectoryChanges) return;
    try {
      const existing = agents.find(a => normalizeString(a.name) === normalizeString(name));
      const payload: Omit<AgentProfile, 'id'> = {
        name,
        preferredPaymentMethod: agentPaymentMethodInput.trim(),
        paymentReference: agentPaymentReferenceInput.trim(),
        notes: existing?.notes || '',
        updatedAt: new Date().toISOString(),
        createdAt: existing?.createdAt || new Date().toISOString(),
        authorUid: existing?.id ? (existing.authorUid || user.uid) : user.uid
      };
      if (existing?.id) {
        await setDoc(doc(db, 'agents', existing.id), payload, { merge: true });
      } else {
        await addDoc(collection(db, 'agents'), payload);
      }
      setAgents(prev => {
        const next = prev.filter(a => normalizeString(a.name) !== normalizeString(name));
        return [...next, { ...payload, id: existing?.id }];
      });
      setAlertType('success');
      setAlertMessage("Fiche agent mise à jour.");
    } catch (error) {
      console.error('Agent directory update failed:', error);
      setAlertType('error');
      setAlertMessage("Impossible de mettre à jour la fiche agent. Vérifiez les droits Firestore.");
    }
  };

  const saveClientDirectoryDetails = async () => {
    if (!user?.uid || !formData.lastName.trim() || !hasClientDirectoryChanges) return;
    try {
      const existing = getSelectedClient || clients.find(c =>
        normalizeString(`${c.firstName} ${c.lastName}`) === normalizeString(`${formData.firstName} ${formData.lastName}`)
      );
      const payload: Omit<ClientProfile, 'id'> = {
        firstName: (formData.firstName || '').trim(),
        lastName: (formData.lastName || '').trim(),
        phone: (formData.phone || '').trim(),
        email: (formData.email || '').trim(),
        updatedAt: new Date().toISOString(),
        createdAt: existing?.createdAt || new Date().toISOString(),
        authorUid: existing?.id ? (existing.authorUid || user.uid) : user.uid
      };
      if (existing?.id) {
        await setDoc(doc(db, 'clients', existing.id), payload, { merge: true });
      } else {
        await addDoc(collection(db, 'clients'), payload);
      }
      setClients(prev => {
        const next = prev.filter(c =>
          normalizeString(`${c.firstName} ${c.lastName}`) !== normalizeString(`${payload.firstName} ${payload.lastName}`)
        );
        return [...next, { ...payload, id: existing?.id }];
      });
      setAlertType('success');
      setAlertMessage("Fiche client mise à jour.");
    } catch (error) {
      console.error('Client directory update failed:', error);
      setAlertType('error');
      setAlertMessage("Impossible de mettre à jour la fiche client. Vérifiez les droits Firestore.");
    }
  };

  const softDeleteBooking = async () => {
    const isMainAdmin = isMainAdminEmail(userProfile?.email);
    const isAdmin = userProfile?.role === 'admin' || isMainAdmin;
    
    const allowedSites = userProfile?.allowedSites || [];
    const allowedApartments = isAdmin ? Object.keys(TARIFS) : allowedSites.flatMap(site => SITE_MAPPING[site] || []);
    
    const isAllowed = allowedApartments.includes(formData.apartmentName);
    
    if (!isAllowed) {
      setAlertType('error');
      setAlertMessage("Vous n'êtes pas autorisé à annuler cette réservation.");
      return;
    }

    const receiptDocId = formData.id || formData.receiptId;
    const backTarget = receiptReturnTarget ?? 'calendar';

    setIsSaving(true);
    try {
      await setDoc(doc(db, 'receipts', receiptDocId), {
        ...formData,
        status: 'ANNULE'
      }, { merge: true });

      // Ne pas faire échouer l’annulation si aucun rapport ménage n’existe (merge seul champ + règles Firestore).
      try {
        for (const seg of getReceiptSegments(formData)) {
          const cleaningReportId = `CR-${formData.receiptId}-${seg.calendarSlug}-${seg.endDate}`;
          await setDoc(doc(db, 'cleaning_reports', cleaningReportId), {
            status: 'ANNULÉ'
          }, { merge: true });
        }
      } catch (eClean) {
        console.warn('[annulation] synchro rapport ménage ignorée:', eClean);
      }

      await deleteAllReservationEventsForReceipt(formData.receiptId);

      setShowCancelConfirm(false);
      setReceiptReturnTarget(null);
      setFormData(getInitialState());
      setIsReadOnly(false);
      setShowMobileNav(false);
      setView(backTarget);

      setAlertType('success');
      setAlertMessage(
        'La réservation a été correctement annulée. Elle ne figure plus comme active dans le planning.'
      );
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, 'receipts');
      setShowCancelConfirm(false);
      setAlertType('error');
      setAlertMessage(
        "L'enregistrement de l'annulation a échoué. Vérifiez la connexion et vos droits, puis réessayez."
      );
    } finally {
      setIsSaving(false);
    }
  };

  // --- RENDER CLEANING ---
  // --- RENDER LOGIN ---
  if (!user && isAuthReady) {
    return (
      <div className="min-h-screen bg-[#141414] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-12 rounded-3xl shadow-2xl w-full max-w-md text-center"
        >
          <div className="mb-8">
            <h1 className="text-5xl font-black text-[#141414] italic tracking-tighter uppercase mb-2">YameHome</h1>
            <p className="text-xs font-mono text-gray-400 uppercase tracking-widest">Property Management Portal</p>
          </div>
          <button 
            onClick={handleLogin} 
            className="w-full bg-[#141414] text-white font-black py-5 rounded-2xl uppercase tracking-widest transition-all hover:bg-gray-800 flex items-center justify-center gap-3 shadow-xl"
          >
            <UserIcon size={18} />
            Se connecter avec Google
          </button>
          <p className="mt-8 text-[10px] text-gray-400 uppercase font-bold">Accès réservé au personnel autorisé</p>
        </motion.div>
      </div>
    );
  }

  const isMainAdmin = isMainAdminEmail(user?.email);

  if (user && !isMainAdmin && (!userProfile || !userProfile.isApproved)) {
    return (
      <div className="min-h-screen bg-[#141414] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-12 rounded-3xl shadow-2xl w-full max-w-md text-center"
        >
          <div className="w-20 h-20 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-8">
            <Lock size={40} />
          </div>
          <h2 className="text-2xl font-black text-[#141414] uppercase tracking-tighter mb-4">Accès Refusé</h2>
          <p className="text-sm text-gray-500 mb-8 leading-relaxed">
            Votre email <span className="font-bold text-gray-900">{user.email}</span> n'est pas autorisé à accéder à cette application.
            Veuillez contacter l'administrateur pour obtenir l'accès.
          </p>
          <button 
            onClick={handleLogout} 
            className="w-full bg-gray-100 text-gray-600 font-black py-4 rounded-2xl uppercase tracking-widest transition-all hover:bg-gray-200 flex items-center justify-center gap-3"
          >
            <LogOut size={18} />
            Se déconnecter
          </button>
        </motion.div>
      </div>
    );
  }

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#141414] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#F5F5F4] text-[#141414] font-sans selection:bg-blue-100 print:bg-white">
      {/* Cleaning Mode Overlay */}
      <AnimatePresence>
        {isCleaningMode && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-[#E4E3E0] text-[#141414] p-6 font-sans flex flex-col items-center overflow-y-auto"
          >
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-md bg-white p-8 rounded-2xl border border-[#141414]/10 shadow-2xl my-auto"
            >
              <div className="flex items-center gap-2 mb-6">
                <ClipboardCheck className="text-blue-600" size={24} />
                <h1 className="text-2xl font-black italic tracking-tighter uppercase">MÉNAGE YAMEHOME</h1>
              </div>
              
              <div className="bg-gray-50 p-4 rounded-xl mb-6 border border-gray-100">
                <p className="text-[10px] text-gray-400 uppercase font-black tracking-widest mb-1">Détails Intervention</p>
                <p className="text-sm font-bold">{cleaningReport.calendarSlug || 'N/A'} — {cleaningReport.dateIntervention}</p>
              </div>
              
              <div className="space-y-6">
                <div className="space-y-3">
                  <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest">Contrôle en 2 étapes — deux noms requis en fin de rapport</p>
                  <div>
                    <label className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-2 block">Agent — étape 1 (1er passage / contrôle)</label>
                    <input 
                      disabled={isCleaningReadOnly} 
                      type="text" 
                      name="agentEtape1" 
                      className="w-full bg-white border border-gray-200 rounded-xl p-4 text-sm outline-none focus:border-blue-500 transition-all disabled:bg-gray-50" 
                      placeholder="Nom de l'agent" 
                      value={cleaningReport.agentEtape1} 
                      onChange={handleCleaningChange} 
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-2 block">Agent — étape 2 (relecture / validation)</label>
                    <input 
                      disabled={isCleaningReadOnly} 
                      type="text" 
                      name="agentEtape2" 
                      className="w-full bg-white border border-gray-200 rounded-xl p-4 text-sm outline-none focus:border-blue-500 transition-all disabled:bg-gray-50" 
                      placeholder="Deuxième agent" 
                      value={cleaningReport.agentEtape2} 
                      onChange={handleCleaningChange} 
                    />
                  </div>
                </div>
                
                <div>
                  <label className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-2 block">Statut de l'Intervention</label>
                  <select 
                    disabled={isCleaningReadOnly} 
                    name="status" 
                    className="w-full bg-white border border-gray-200 rounded-xl p-4 text-sm outline-none focus:border-blue-500 transition-all disabled:bg-gray-50 appearance-none" 
                    value={cleaningReport.status} 
                    onChange={handleCleaningChange}
                  >
                    <option value="PRÉVU">📅 PRÉVU / PROGRAMMÉ</option>
                    <option value="EFFECTUÉ">✅ EFFECTUÉ</option>
                    <option value="ANOMALIE">⚠️ ANOMALIE SIGNALÉE</option>
                    <option value="REPORTÉ">⏳ REPORTÉ</option>
                  </select>
                </div>

                {(cleaningReport.status === 'EFFECTUÉ' || cleaningReport.status === 'ANOMALIE') && (
                  <div className="space-y-4 p-4 rounded-xl border border-gray-200 bg-gray-50/90">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Contrôles obligatoires</p>
                    <div>
                      <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest mb-1 block">kWh restants (compteur prépayé)</label>
                      <input
                        disabled={isCleaningReadOnly}
                        type="number"
                        name="kwhCompteurPrepaye"
                        min={0}
                        step="0.1"
                        inputMode="decimal"
                        className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-blue-500 disabled:bg-gray-50"
                        placeholder="ex. 42"
                        value={cleaningReport.kwhCompteurPrepaye ?? ''}
                        onChange={handleCleaningChange}
                      />
                    </div>

                    <div
                      className={`pt-3 border-t border-gray-200/90 space-y-3 rounded-xl p-3 -mx-1 ${
                        isOnduleurNonConcerne(cleaningReport.calendarSlug)
                          ? 'bg-gray-100/90 border border-gray-200/80 opacity-90 pointer-events-none'
                          : ''
                      }`}
                    >
                      <p className="text-[10px] text-amber-800 font-black uppercase tracking-widest">Anti-délestage / onduleur (backup)</p>
                      {isOnduleurNonConcerne(cleaningReport.calendarSlug) ? (
                        <div className="space-y-1.5">
                          <p className="text-xs text-gray-600 leading-relaxed">
                            <span className="font-bold text-gray-800">Non concerné</span> sur cette unité Gallaghers City : pas de dispositif anti-délestage / onduleur à ce jour. Aucune saisie requise ici.
                          </p>
                          <p className="text-[10px] text-gray-500">Les autres logements (dont les chambres Matera YameHome Odza) indiquent si le backup fonctionne et le niveau des batteries.</p>
                        </div>
                      ) : (
                        <>
                      <div>
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest mb-1 block">L’onduleur (backup) fonctionne-t-il ?</label>
                        <p className="text-[9px] text-gray-400 mb-1.5">Vérifiez l’appareil : voyants, bips anormaux, passage sur batterie.</p>
                        <select
                          disabled={isCleaningReadOnly}
                          name="backupOnduleurFonctionne"
                          className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-amber-500 disabled:bg-gray-50"
                          value={cleaningReport.backupOnduleurFonctionne}
                          onChange={handleCleaningChange}
                        >
                          <option value="">— Choisir —</option>
                          <option value="OUI">Oui</option>
                          <option value="NON">Non / défaut / alarme</option>
                        </select>
                      </div>
                      {cleaningReport.backupOnduleurFonctionne === 'OUI' && (
                        <div>
                          <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest mb-1 block">Niveau de batterie (barres sur l’écran de l’onduleur)</label>
                          <select
                            disabled={isCleaningReadOnly}
                            name="backupBatterieBarres"
                            className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-amber-500 disabled:bg-gray-50"
                            value={cleaningReport.backupBatterieBarres ?? ''}
                            onChange={handleCleaningChange}
                          >
                            <option value="">— Choisir 1, 2 ou 3 barres —</option>
                            <option value="1">1 barre — presque vide, à recharger vite</option>
                            <option value="2">2 barres — à mi-parcours</option>
                            <option value="3">3 barres — bon niveau / plein</option>
                          </select>
                        </div>
                      )}
                      {cleaningReport.backupOnduleurFonctionne === 'NON' && (
                        <p className="text-[10px] text-amber-900 bg-amber-50/90 border border-amber-200/80 p-2.5 rounded-lg leading-snug">
                          Détaillez l’onduleur dans le compte-rendu. Vous pouvez rester en <strong>« Effectué »</strong> si le ménage est fait : la case du planning s’affichera en <strong>orange</strong> pour attirer l’œil. Utilisez <strong>« Anomalie signalée »</strong> seulement si l’intervention n’a pas pu être menée correctement.
                        </p>
                      )}
                        </>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest mb-1 block">Eau</label>
                        <select
                          disabled={isCleaningReadOnly}
                          name="eau"
                          className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-blue-500 disabled:bg-gray-50"
                          value={cleaningReport.eau}
                          onChange={handleCleaningChange}
                        >
                          <option value="">— Choisir —</option>
                          <option value="OUI">Oui</option>
                          <option value="NON">Non</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest mb-1 block">Courant</label>
                        <select
                          disabled={isCleaningReadOnly}
                          name="courant"
                          className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-blue-500 disabled:bg-gray-50"
                          value={cleaningReport.courant}
                          onChange={handleCleaningChange}
                        >
                          <option value="">— Choisir —</option>
                          <option value="OUI">Oui</option>
                          <option value="NON">Non</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest mb-1 block">Internet</label>
                        <select
                          disabled={isCleaningReadOnly}
                          name="internet"
                          className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-blue-500 disabled:bg-gray-50"
                          value={cleaningReport.internet}
                          onChange={handleCleaningChange}
                        >
                          <option value="">— Choisir —</option>
                          <option value="OUI">Oui</option>
                          <option value="NON">Non</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                      <div>
                        <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest mb-1 block">Nombre de serviettes (propres, en place)</label>
                        <input
                          disabled={isCleaningReadOnly}
                          type="number"
                          name="nombreServiettes"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-blue-500 disabled:bg-gray-50"
                          placeholder="ex. 6"
                          value={cleaningReport.nombreServiettes ?? ''}
                          onChange={handleCleaningChange}
                        />
                      </div>
                      <label className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-white cursor-pointer">
                        <input
                          type="checkbox"
                          name="serviettesPropresRangees"
                          disabled={isCleaningReadOnly}
                          checked={cleaningReport.serviettesPropresRangees}
                          onChange={handleCleaningChange}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        <span className="text-xs font-bold text-gray-800">Serviettes propres et bien rangées</span>
                      </label>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest mb-2">Vérification par zone</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {[
                          ['checkEntreeSalon', 'Entrée & salon'] as const,
                          ['checkCuisine', 'Cuisine'] as const,
                          ['checkChambres', 'Chambres'] as const,
                          ['checkSdb', 'Salle de bain'] as const
                        ].map(([name, label]) => (
                          <label key={name} className="flex items-center gap-2 p-2 rounded-lg border border-gray-100 bg-white">
                            <input
                              type="checkbox"
                              name={name}
                              disabled={isCleaningReadOnly}
                              checked={Boolean((cleaningReport as unknown as Record<string, unknown>)[name])}
                              onChange={handleCleaningChange}
                              className="h-4 w-4 rounded border-gray-300"
                            />
                            <span className="text-xs font-semibold text-gray-800">{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {cleaningReport.status === 'REPORTÉ' && (
                  <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200/80 p-3 rounded-xl leading-relaxed">
                    Expliquez pourquoi le ménage est reporté (nouvelle date, accès, etc.) — 20 caractères minimum.
                  </p>
                )}

                <div>
                  <label className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-2 block">
                    {cleaningReport.status === 'PRÉVU'
                      ? 'Notes (optionnel)'
                      : 'Compte-rendu & observations'}
                  </label>
                  <textarea 
                    disabled={isCleaningReadOnly} 
                    name="feedback" 
                    rows={4} 
                    className="w-full bg-white border border-gray-200 rounded-xl p-4 text-sm outline-none focus:border-blue-500 transition-all disabled:bg-gray-50" 
                    placeholder={
                      cleaningReport.status === 'EFFECTUÉ' || cleaningReport.status === 'ANOMALIE'
                        ? "Décrivez l’état réel du logement (min. 30 caractères) : propreté, manques, remarques…"
                        : cleaningReport.status === 'REPORTÉ'
                          ? "Motif du report (20 caractères min.)…"
                          : "Commentaire sur l’état général…"
                    } 
                    value={cleaningReport.feedback} 
                    onChange={handleCleaningChange}
                  ></textarea>
                  {(cleaningReport.status === 'EFFECTUÉ' || cleaningReport.status === 'ANOMALIE') && (
                    <p className="text-[10px] text-gray-400 mt-1">Un simple « RAS » n’est plus accepté — soyez précis.</p>
                  )}
                </div>
                
                {cleaningReport.status !== 'PRÉVU' && (
                  <div>
                    <label className="text-[10px] text-red-400 font-black uppercase tracking-widest mb-2 block">Casse / dommages</label>
                    <textarea 
                      disabled={isCleaningReadOnly} 
                      name="damages" 
                      rows={3} 
                      className="w-full bg-white border border-red-100 rounded-xl p-3 text-sm outline-none focus:border-red-500 transition-all disabled:bg-gray-50" 
                      placeholder="Signaler une casse, une tache, un objet cassé… (laisser vide si rien)" 
                      value={cleaningReport.damages} 
                      onChange={handleCleaningChange}
                    ></textarea>
                  </div>
                )}
                
                {isCleaningReadOnly ? (
                   <div className="flex flex-col gap-3 mt-8">
                     <button 
                      onClick={() => setIsCleaningReadOnly(false)} 
                      className="w-full bg-orange-600 hover:bg-orange-700 text-white font-black py-4 rounded-xl uppercase text-xs tracking-widest transition-all shadow-lg shadow-orange-600/20"
                     >
                       Modifier le Rapport
                     </button>
                     {cleaningReport.id && (
                       <button 
                        onClick={() => setShowDeleteCleaningConfirm(true)} 
                        className="w-full bg-red-50 text-red-600 hover:bg-red-100 font-black py-4 rounded-xl uppercase text-xs tracking-widest transition-all"
                       >
                         Effacer le planning
                       </button>
                     )}
                     <button 
                      onClick={() => {
                        setIsCleaningMode(false);
                        setView('calendar');
                      }} 
                      className="w-full text-gray-400 hover:text-gray-600 text-center text-[10px] uppercase font-black tracking-widest"
                     >
                       Retour au planning
                     </button>
                   </div>
                ) : (
                  <div className="flex flex-col gap-3 mt-8">
                    <div className="flex gap-4">
                      <button 
                        type="button"
                        onClick={() => {
                          setIsCleaningMode(false);
                          setView('calendar');
                        }} 
                        className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black py-4 rounded-xl text-xs uppercase tracking-widest transition-all"
                      >
                        Annuler
                      </button>
                      <button 
                        type="button"
                        onClick={() => { void submitCleaningReport(); }} 
                        disabled={isSaving || (cleaningReport.status !== 'PRÉVU' && (!cleaningReport.agentEtape1?.trim() || !cleaningReport.agentEtape2?.trim()))} 
                        className="flex-[2] bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-xl shadow-lg shadow-blue-600/20 uppercase text-xs tracking-widest transition-all disabled:opacity-50"
                      >
                        {isSaving ? 'ENVOI...' : cleaningReport.status === 'PRÉVU' ? 'CONFIRMER LA PLANIFICATION' : 'VALIDER LE RAPPORT'}
                      </button>
                    </div>
                    {cleaningReport.status !== 'PRÉVU' && (!cleaningReport.agentEtape1?.trim() || !cleaningReport.agentEtape2?.trim()) && (
                      <p className="text-[10px] text-center text-amber-800 bg-amber-50 border border-amber-200/80 rounded-lg p-2">
                        Renseignez les <strong>deux noms d’agents</strong> (étape 1 et 2) pour activer l’enregistrement.
                      </p>
                    )}
                    {cleaningSubmitHint && (
                      <p className="text-xs text-center text-red-600 font-semibold leading-snug px-1">
                        {cleaningSubmitHint}
                      </p>
                    )}
                    {cleaningReport.id && (
                      <button 
                        onClick={() => setShowDeleteCleaningConfirm(true)} 
                        className="w-full bg-red-50 text-red-600 hover:bg-red-100 font-black py-4 rounded-xl uppercase text-xs tracking-widest transition-all"
                      >
                        Effacer le planning
                      </button>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Sidebar */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="sidebar fixed md:sticky top-0 left-0 w-full md:w-[23rem] lg:w-[24rem] h-full md:h-screen bg-white border-r border-gray-200 flex flex-col z-50 print:hidden shadow-2xl md:shadow-none"
          >
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <div className="flex flex-col leading-tight">
                <h1 className="text-2xl font-black italic tracking-tighter">YameHome</h1>
                <span className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase">Property Management</span>
              </div>
              <button onClick={() => setIsSidebarOpen(false)} className="md:hidden"><X size={20}/></button>
            </div>

            <div className="px-6 py-4 border-b border-gray-100 space-y-2">
              <div className="flex flex-col gap-2">
                <button 
                  onClick={handleNewReceipt}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'form' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  <Plus size={16} className={view === 'form' ? '' : 'text-blue-600'} />
                  Nouveau Reçu
                </button>

                {/* Toggle nav when in form view — visible on all screens */}
                {view === 'form' && (
                  <button 
                    onClick={() => setShowMobileNav(!showMobileNav)}
                    className="w-full flex items-center justify-between px-4 py-2 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-blue-600 transition-all"
                  >
                    <span>{showMobileNav ? '↑ Masquer le menu' : '↓ Autres vues'}</span>
                    <ChevronRight size={14} className={`transition-transform ${showMobileNav ? 'rotate-90' : ''}`} />
                  </button>
                )}
              </div>
              
              {/* Nav items hidden when in form edit mode — shown on all screens only if toggled */}
              <div className={`${(view === 'form' && !showMobileNav) ? 'hidden' : 'block'} space-y-2`}>
                <button 
                  onClick={() => {
                    setView('history');
                    setShowMobileNav(false);
                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'history' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  <History size={16} className={view === 'history' ? '' : 'text-indigo-500'} />
                  Historique
                </button>
                <button
                  onClick={() => {
                    setView('proInvoices');
                    setShowMobileNav(false);
                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'proInvoices' ? 'bg-[#2B4B8C] text-white shadow-lg shadow-[#2B4B8C]/20' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  <ScrollText size={16} className={view === 'proInvoices' ? '' : 'text-sky-600'} />
                  Factures société
                </button>
                <button 
                  onClick={() => {
                    setView('calendar');
                    setShowMobileNav(false);
                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'calendar' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  <CalendarIcon size={16} className={view === 'calendar' ? '' : 'text-teal-600'} />
                  Calendrier
                </button>
                <button
                  onClick={() => {
                    setView('prospects');
                    setShowMobileNav(false);
                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'prospects' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  <Search size={16} className={view === 'prospects' ? '' : 'text-violet-600'} />
                  Prospects
                </button>
                <button
                  onClick={() => {
                    setView('prepaidTokens');
                    setShowMobileNav(false);
                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'prepaidTokens' ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  <Zap size={16} className={view === 'prepaidTokens' ? '' : 'text-amber-600'} />
                  Prépayé (kWh)
                </button>
                {canSeeCostsMenu(userProfile, isMainAdminEmail) && (
                  <button
                    onClick={() => {
                      setView('costs');
                      setShowMobileNav(false);
                      if (window.innerWidth < 768) setIsSidebarOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'costs' ? 'bg-emerald-700 text-white shadow-lg shadow-emerald-900/20' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    <Wallet size={16} className={view === 'costs' ? '' : 'text-emerald-600'} />
                    Coûts & marges
                  </button>
                )}
                {(userProfile?.role === 'admin' || isMainAdmin) && (
                  <button 
                    onClick={() => {
                      setView('users');
                      setShowMobileNav(false);
                      if (window.innerWidth < 768) setIsSidebarOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'users' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    <Users size={16} className={view === 'users' ? '' : 'text-cyan-600'} />
                    Utilisateurs
                  </button>
                )}
                {isMainAdmin && (
                  <button
                    onClick={() => {
                      setView('maintenance');
                      setShowMobileNav(false);
                      if (window.innerWidth < 768) setIsSidebarOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'maintenance' ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    <Shield size={16} className={view === 'maintenance' ? '' : 'text-orange-600'} />
                    Maintenance
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {/* Search */}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Client intelligent (base clients)</label>
                <div className="flex gap-2 relative">
                  <input 
                    type="text" 
                    placeholder="Nom, téléphone ou email..." 
                    className="flex-1 bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all" 
                    value={clientSearch}
                    onChange={(e) => {
                      setClientSearch(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && filteredClients.length > 0) {
                        applyClientSuggestion(filteredClients[0]);
                      }
                    }}
                  />
                  <button 
                    onClick={() => {
                      if (filteredClients.length > 0) applyClientSuggestion(filteredClients[0]);
                    }} 
                    className="bg-[#141414] text-white p-3 rounded-xl hover:bg-gray-800 transition-all"
                  >
                    <Search size={16} />
                  </button>
                </div>
                {filteredClients.length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-xl p-2 space-y-1 max-h-44 overflow-y-auto">
                    {filteredClients.map((client, idx) => (
                      <button
                        key={`${client.id || 'legacy'}-${idx}`}
                        type="button"
                        onClick={() => applyClientSuggestion(client)}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-blue-50 transition-all"
                      >
                        <div className="text-[11px] font-black text-gray-800 uppercase">{client.firstName} {client.lastName}</div>
                        <div className="text-[10px] text-gray-500">{client.phone || '-'} | {client.email || '-'}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Form */}
              <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>

                {/* ── SECTION CLIENT ── */}
                <div className="rounded-2xl border border-blue-100 bg-blue-50/60 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-600">
                    <UserIcon size={13} className="text-white" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white">Client</span>
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <input disabled={isReadOnly} type="text" name="firstName" value={formData.firstName} placeholder="Prénom" className="w-full bg-white border border-blue-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all disabled:opacity-60" onChange={handleChange} />
                      <input disabled={isReadOnly} type="text" name="lastName" value={formData.lastName} placeholder="Nom *" className="w-full bg-white border border-blue-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all disabled:opacity-60 font-bold" onChange={handleChange} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <input disabled={isReadOnly} type="tel" name="phone" value={formData.phone} placeholder="Téléphone" className="w-full bg-white border border-blue-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all disabled:opacity-60" onChange={handleChange} />
                      <input disabled={isReadOnly} type="email" name="email" value={formData.email} placeholder="Email" className="w-full bg-white border border-blue-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all disabled:opacity-60" onChange={handleChange} />
                    </div>
                    {!isReadOnly && (
                      <button type="button" onClick={saveClientDirectoryDetails} disabled={!hasClientDirectoryChanges}
                        className={`w-full py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${hasClientDirectoryChanges ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm' : 'bg-white border border-blue-100 text-blue-300 cursor-not-allowed'}`}>
                        Enregistrer / Mettre à jour ce client
                      </button>
                    )}
                  </div>
                </div>

                {/* ── SECTION LOGEMENT + DATES ── */}
                {/* Pas de overflow-hidden ici : le popup DateRangePicker est positionné en absolu et serait sinon coupé */}
                <div className="rounded-2xl border border-violet-100 bg-violet-50/60">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 rounded-t-[15px]">
                    <Home size={13} className="text-white" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white">Logement &amp; Dates de séjour</span>
                  </div>
                  <div className="p-4 space-y-3">
                    {!isReadOnly && (
                      <div className="flex flex-col gap-2 rounded-xl border border-violet-200/80 bg-white/80 p-3">
                        <p className="text-[10px] text-violet-900 font-bold uppercase tracking-wider">
                          Plusieurs logements ou séjour enchaîné (Booking, etc.)
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {!stayMultiUi ? (
                            <button
                              type="button"
                              onClick={enableStayMultiMode}
                              className="text-[10px] font-black uppercase tracking-widest bg-violet-600 text-white px-3 py-2 rounded-lg hover:bg-violet-700"
                            >
                              Activer le mode multi-plages
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={disableStayMultiMode}
                              className="text-[10px] font-black uppercase tracking-widest bg-white border border-violet-300 text-violet-800 px-3 py-2 rounded-lg hover:bg-violet-50"
                            >
                              Repasser en un seul logement
                            </button>
                          )}
                        </div>
                        {stayMultiUi && (
                          <p className="text-[9px] text-violet-700 leading-snug">
                            Chaque ligne = une réservation réservable au calendrier. Les montants globaux (
                            tarifs, paiements, caution agrégée) restent sous la même fiche ; la répartition
                            ligne par ligne est facultative ci-dessous.
                          </p>
                        )}
                      </div>
                    )}

                    {!stayMultiUi ? (
                      <>
                    <select disabled={isReadOnly} name="apartmentName" value={formData.apartmentName}
                      className="w-full bg-white border border-violet-200 rounded-xl p-3 text-xs outline-none focus:border-violet-500 transition-all disabled:opacity-60 appearance-none font-bold"
                      onChange={handleChange}>
                      <option value="">-- Choisir Appartement --</option>
                      {selectableApartments.map((key) => (
                        <option key={key} value={key}>{key}</option>
                      ))}
                    </select>
                    {TARIFS[formData.apartmentName]?.units && TARIFS[formData.apartmentName].units!.length > 1 && (
                      <select disabled={isReadOnly} name="calendarSlug" value={formData.calendarSlug} onChange={handleChange}
                        className="w-full bg-white border border-violet-300 rounded-xl p-3 text-xs outline-none focus:border-violet-500 transition-all disabled:opacity-60 appearance-none font-bold text-violet-700">
                        <option value="">-- Préciser l'unité --</option>
                        {TARIFS[formData.apartmentName].units!.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    )}
                    <DateRangePicker
                      startDate={formData.startDate}
                      endDate={formData.endDate}
                      disabled={isReadOnly}
                      onChange={(start, end) => setFormData(prev => ({ ...prev, startDate: start, endDate: end }))}
                    />
                      </>
                    ) : (
                      <div className="space-y-3">
                        {(formData.staySegments || []).map((seg, idx) => {
                          const ud = seg.apartmentName ? TARIFS[seg.apartmentName]?.units : undefined;
                          return (
                            <div
                              key={seg.id}
                              className="rounded-xl border border-violet-200 bg-white p-3 space-y-2 shadow-sm"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-[10px] font-black text-violet-800 uppercase tracking-widest">
                                  Plage #{idx + 1}
                                </span>
                                {!isReadOnly && (formData.staySegments || []).length >= 2 && (
                                  <button
                                    type="button"
                                    onClick={() => removeStaySegmentRow(idx)}
                                    className="text-[9px] font-black uppercase text-red-600 hover:underline"
                                  >
                                    Supprimer
                                  </button>
                                )}
                              </div>
                              <select
                                disabled={isReadOnly}
                                value={seg.apartmentName}
                                onChange={(e) => updateStaySegmentRow(idx, { apartmentName: e.target.value, calendarSlug: '' })}
                                className="w-full bg-violet-50/80 border border-violet-200 rounded-xl p-2.5 text-[11px] font-bold outline-none focus:border-violet-500 disabled:opacity-60"
                              >
                                <option value="">-- Logement --</option>
                                {selectableApartments.map((key) => (
                                  <option key={key} value={key}>{key}</option>
                                ))}
                              </select>
                              {ud && ud.length > 1 && (
                                <select
                                  disabled={isReadOnly}
                                  value={seg.calendarSlug}
                                  onChange={(e) => updateStaySegmentRow(idx, { calendarSlug: e.target.value })}
                                  className="w-full bg-white border border-violet-300 rounded-xl p-2.5 text-[11px] font-bold text-violet-800 outline-none focus:border-violet-500 disabled:opacity-60"
                                >
                                  <option value="">-- Unité --</option>
                                  {ud.map((u) => (
                                    <option key={u} value={u}>{u}</option>
                                  ))}
                                </select>
                              )}
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[9px] font-bold text-violet-600 uppercase block mb-0.5">Début</label>
                                  <input
                                    type="date"
                                    disabled={isReadOnly}
                                    value={seg.startDate}
                                    onChange={(e) => updateStaySegmentRow(idx, { startDate: e.target.value })}
                                    className="w-full bg-white border border-violet-200 rounded-lg p-2 text-[11px] font-mono disabled:opacity-60"
                                  />
                                </div>
                                <div>
                                  <label className="text-[9px] font-bold text-violet-600 uppercase block mb-0.5">Fin (départ)</label>
                                  <input
                                    type="date"
                                    disabled={isReadOnly}
                                    value={seg.endDate}
                                    onChange={(e) => updateStaySegmentRow(idx, { endDate: e.target.value })}
                                    className="w-full bg-white border border-violet-200 rounded-lg p-2 text-[11px] font-mono disabled:opacity-60"
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="text-[9px] font-bold text-violet-600 uppercase block mb-0.5">
                                  Part hébergement (FCFA, optionnel)
                                </label>
                                <input
                                  type="number"
                                  disabled={isReadOnly}
                                  value={seg.lodgingAllocated ?? ''}
                                  placeholder="Répartition indicative"
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    updateStaySegmentRow(idx, {
                                      lodgingAllocated: v === '' ? null : parseFloat(v) || 0,
                                    });
                                  }}
                                  className="w-full bg-violet-50/50 border border-violet-100 rounded-lg p-2 text-[11px] font-mono disabled:opacity-60"
                                />
                              </div>
                            </div>
                          );
                        })}
                        {!isReadOnly && (
                          <button
                            type="button"
                            onClick={addStaySegmentRow}
                            className="w-full py-2.5 rounded-xl border-2 border-dashed border-violet-300 text-violet-700 text-[10px] font-black uppercase tracking-widest hover:bg-violet-50"
                          >
                            + Ajouter une plage logement / dates
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── SECTION TARIFICATION ── */}
                <div className="rounded-2xl border border-amber-100 bg-amber-50/60 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-500">
                    <FileText size={13} className="text-white" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white">Tarification</span>
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="flex gap-4">
                      <label className="flex items-center text-[10px] font-bold uppercase cursor-pointer select-none text-amber-800">
                        <input disabled={isReadOnly} type="checkbox" name="isCustomRate" checked={formData.isCustomRate} onChange={handleChange} className="mr-2 accent-amber-500" />
                        Plateforme
                      </label>
                      <label className="flex items-center text-[10px] font-bold uppercase cursor-pointer select-none text-amber-800">
                        <input disabled={isReadOnly} type="checkbox" name="isNegotiatedRate" checked={formData.isNegotiatedRate} onChange={handleChange} className="mr-2 accent-amber-500" />
                        Négocié
                      </label>
                    </div>
                    {formData.isCustomRate && <input disabled={isReadOnly} type="number" name="customLodgingTotal" value={formData.customLodgingTotal || ''} className="w-full bg-white border border-amber-300 rounded-xl p-3 text-xs outline-none focus:border-amber-500 transition-all font-mono font-bold" placeholder="Total Hébergement (FCFA)" onChange={handleChange} />}
                    {formData.isNegotiatedRate && <input disabled={isReadOnly} type="number" name="negotiatedPricePerNight" value={formData.negotiatedPricePerNight || ''} className="w-full bg-white border border-amber-300 rounded-xl p-3 text-xs outline-none focus:border-amber-500 transition-all font-mono font-bold" placeholder="Prix par nuit (FCFA)" onChange={handleChange} />}
                    {stayMultiUi && (
                      <p className="text-[10px] text-amber-900/90 leading-snug bg-amber-100/80 border border-amber-200/80 rounded-lg p-2">
                        Mode multi-plages : les <strong>nuits sont cumulées</strong> sur toutes les lignes. La <strong>caution</strong> est la{' '}
                        <strong>somme</strong> des cautions barémiques calculées pour chaque segment (selon ses nuitées et son type de logement).
                      </p>
                    )}
                  </div>
                </div>

                {/* ── SECTION VERSEMENTS ── */}
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-600">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={13} className="text-white" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-white">Versements</span>
                    </div>
                    {!isReadOnly && (
                      <button type="button"
                        onClick={() => setFormData(prev => ({...prev, payments: [...prev.payments, { id: Date.now().toString(), date: getLocalDateString(), amount: 0, method: 'Espèces' }]}))}
                        className="flex items-center gap-1 bg-white/20 hover:bg-white/30 text-white text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg transition-all">
                        <Plus size={11} /> Ajouter
                      </button>
                    )}
                  </div>
                  <div className="p-4 space-y-3">
                    {formData.payments.map((p) => (
                      <div key={p.id} className="bg-white p-3 rounded-xl border border-emerald-200 relative group shadow-sm">
                        {!isReadOnly && formData.payments.length > 1 && (
                          <button onClick={() => setFormData(prev => ({...prev, payments: prev.payments.filter(x => x.id !== p.id)}))}
                            className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-all shadow-lg">
                            <X size={10} />
                          </button>
                        )}
                        <input disabled={isReadOnly} type="date" value={p.date}
                          onChange={(e) => setFormData(prev => ({...prev, payments: prev.payments.map(x => x.id === p.id ? {...x, date: e.target.value} : x)}))}
                          className="bg-transparent text-[10px] font-bold text-emerald-700 mb-2 w-full outline-none" />
                        <div className="flex gap-2">
                          <input disabled={isReadOnly} type="number" value={p.amount || ''} placeholder="Montant FCFA"
                            onChange={(e) => setFormData(prev => ({...prev, payments: prev.payments.map(x => x.id === p.id ? {...x, amount: parseFloat(e.target.value) || 0} : x)}))}
                            className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 flex-1 font-mono font-bold text-emerald-700 text-xs outline-none focus:border-emerald-500" />
                          <select disabled={isReadOnly} value={p.method}
                            onChange={(e) => setFormData(prev => ({...prev, payments: prev.payments.map(x => x.id === p.id ? {...x, method: e.target.value} : x)}))}
                            className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 flex-1 text-[10px] outline-none appearance-none focus:border-emerald-500">
                            {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── SECTION OPTIONS ── */}
                <div className="rounded-2xl border border-teal-100 bg-teal-50/60 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-teal-600">
                    <ClipboardCheck size={13} className="text-white" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white">Options &amp; Services</span>
                  </div>
                  <div className="p-4 space-y-2">
                    <div className="flex flex-wrap gap-3">
                      <label className="flex items-center gap-2 text-[10px] font-bold uppercase cursor-pointer select-none text-teal-800 bg-white border border-teal-200 px-3 py-2 rounded-xl">
                        <input disabled={isReadOnly} type="checkbox" name="electricityCharge" checked={formData.electricityCharge} onChange={handleChange} className="accent-teal-600" />
                        Élec client
                      </label>
                      <label className="flex items-center gap-2 text-[10px] font-bold uppercase cursor-pointer select-none text-teal-800 bg-white border border-teal-200 px-3 py-2 rounded-xl">
                        <input disabled={isReadOnly} type="checkbox" name="packEco" checked={formData.packEco} onChange={handleChange} className="accent-teal-600" />
                        Pack ECO
                      </label>
                      <label className="flex items-center gap-2 text-[10px] font-bold uppercase cursor-pointer select-none text-teal-800 bg-white border border-teal-200 px-3 py-2 rounded-xl">
                        <input disabled={isReadOnly} type="checkbox" name="packConfort" checked={formData.packConfort} onChange={handleChange} className="accent-teal-600" />
                        Pack CONFORT
                      </label>
                    </div>
                  </div>
                </div>

                {/* ── SECTION HÔTES + AGENT + SIGNATURE ── */}
                <div className="rounded-2xl border border-orange-100 bg-orange-50/60 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-orange-500">
                    <Users size={13} className="text-white" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white">Hôtes &amp; Agent</span>
                  </div>
                  <div className="p-4 space-y-4">

                    {/* Contacts Utiles */}
                    <div className="space-y-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-orange-700">Contacts Utiles (Hôtes)</p>
                      <div className="grid grid-cols-1 gap-1.5">
                        {availableHosts.map(h => {
                          const isSelected = (formData.hosts || []).includes(h.label);
                          return (
                            <button key={h.id} type="button" disabled={isReadOnly}
                              onClick={() => {
                                setFormData(prev => {
                                  const current = prev.hosts || [];
                                  const hostAlreadySelected = current.includes(h.label);
                                  const next = hostAlreadySelected ? current.filter(x => x !== h.label) : [...current, h.label];
                                  const nextSignature = (!prev.signature && next.length > 0) ? next[0].split(' ')[0].toUpperCase() : prev.signature;
                                  return { ...prev, hosts: next, signature: nextSignature };
                                });
                              }}
                              className={`flex items-center justify-between p-2.5 rounded-xl border text-[10px] font-bold transition-all ${isSelected ? 'bg-orange-100 border-orange-300 text-orange-800' : 'bg-white border-orange-100 text-gray-500 hover:border-orange-200'}`}>
                              <span>{h.label}</span>
                              {isSelected && <Check size={12} className="text-orange-600" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Apporteur d'affaire */}
                    <div className="space-y-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-orange-700">Apporteur d'affaire (Agent)</p>
                      <div className="flex gap-2">
                        <input disabled={isReadOnly} type="text" name="agentName" value={formData.agentName || ''} placeholder="Nom de l'agent"
                          className="flex-1 bg-white border border-orange-200 rounded-xl p-3 text-xs outline-none focus:border-orange-400 transition-all disabled:opacity-60"
                          onChange={(e) => { setAgentSearch(e.target.value); setFormData(prev => ({ ...prev, agentName: e.target.value })); }} />
                        {formData.agentName && formData.commissionAmount > 0 && (
                          <div className="flex flex-col gap-1">
                            <div className="bg-orange-100 border border-orange-200 rounded-xl px-3 py-2 flex flex-col justify-center">
                              <span className="text-[8px] font-black text-orange-500 uppercase leading-none">Commission</span>
                              <span className="text-[10px] font-mono font-bold text-orange-700">{formatCurrency(formData.commissionAmount)}</span>
                            </div>
                            <label className="flex items-center text-[9px] font-bold uppercase cursor-pointer select-none text-orange-600 px-1">
                              <input disabled={isReadOnly} type="checkbox" name="isCommissionPaid" checked={formData.isCommissionPaid || false} onChange={handleChange} className="mr-1.5 accent-orange-600" />Payée
                            </label>
                          </div>
                        )}
                      </div>
                      {filteredAgents.length > 0 && !isReadOnly && (
                        <div className="bg-white border border-orange-200 rounded-xl p-2 space-y-1 max-h-40 overflow-y-auto">
                          {filteredAgents.map((agent, idx) => (
                            <button key={`${agent.id || 'legacy-agent'}-${idx}`} type="button"
                              onClick={() => { setFormData(prev => ({ ...prev, agentName: agent.name })); setAgentSearch(agent.name); }}
                              className="w-full text-left px-3 py-2 rounded-lg hover:bg-orange-50 transition-all">
                              <div className="text-[11px] font-black text-gray-800 uppercase">{agent.name}</div>
                              <div className="text-[10px] text-gray-500">{agent.preferredPaymentMethod || '-'} | {agent.paymentReference || '-'}</div>
                            </button>
                          ))}
                        </div>
                      )}
                      {formData.agentName && (
                        <div className="grid grid-cols-2 gap-2">
                          <input disabled={isReadOnly} type="text" value={agentPaymentMethodInput} placeholder="OM, MTN, Espèces..." className="w-full bg-white border border-orange-200 rounded-xl p-2 text-[10px] outline-none focus:border-orange-400 transition-all disabled:opacity-60" onChange={(e) => setAgentPaymentMethodInput(e.target.value)} />
                          <input disabled={isReadOnly} type="text" value={agentPaymentReferenceInput} placeholder="N° référence paiement" className="w-full bg-white border border-orange-200 rounded-xl p-2 text-[10px] outline-none focus:border-orange-400 transition-all disabled:opacity-60" onChange={(e) => setAgentPaymentReferenceInput(e.target.value)} />
                        </div>
                      )}
                      {!isReadOnly && formData.agentName && (
                        <button type="button" onClick={saveAgentDirectoryDetails} disabled={!hasAgentDirectoryChanges}
                          className={`w-full py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${hasAgentDirectoryChanges ? 'bg-orange-500 text-white hover:bg-orange-600 shadow-sm' : 'bg-white border border-orange-100 text-orange-300 cursor-not-allowed'}`}>
                          Enregistrer / Mettre à jour cet agent
                        </button>
                      )}
                    </div>

                    {/* Signature */}
                    <div className="space-y-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-orange-700">Signature (Gérant)</p>
                      <div className="flex flex-wrap gap-2">
                        {(formData.hosts || []).map(h => {
                          const name = h.split(' ')[0].toUpperCase();
                          return (
                            <button key={h} type="button" disabled={isReadOnly}
                              onClick={() => setFormData(prev => ({ ...prev, signature: name }))}
                              className={`px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-widest transition-all ${formData.signature === name ? 'bg-orange-500 border-orange-500 text-white shadow-sm' : 'bg-white border-orange-200 text-orange-400 hover:border-orange-300'}`}>
                              {name}
                            </button>
                          );
                        })}
                      </div>
                      <input disabled={isReadOnly} type="text" name="signature" value={formData.signature} placeholder="Signature (Nom)" className="w-full bg-white border border-orange-200 rounded-xl p-3 text-xs outline-none focus:border-orange-400 transition-all disabled:opacity-60" onChange={handleChange} />
                    </div>
                  </div>
                </div>

                {/* ── SECTION OBSERVATIONS ── */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50/60 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-500">
                    <Info size={13} className="text-white" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white">Observations</span>
                  </div>
                  <div className="p-4">
                    <textarea disabled={isReadOnly} name="observations" value={formData.observations} rows={3} placeholder="Observations particulières, notes spéciales..." className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs outline-none focus:border-slate-400 transition-all disabled:opacity-60 resize-none" onChange={handleChange}></textarea>
                  </div>
                </div>

                {/* ── SECTION NOTES INTERNES ── */}
                <div className="rounded-2xl border border-amber-200 bg-amber-50/60 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-500">
                    <Lock size={13} className="text-white" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white">Notes internes</span>
                    <span className="ml-auto text-[9px] font-bold text-amber-100 uppercase tracking-widest">Non imprimé sur le reçu</span>
                  </div>
                  <div className="p-4">
                    <textarea
                      disabled={isReadOnly}
                      name="internalNotes"
                      value={formData.internalNotes || ''}
                      rows={3}
                      placeholder="Remarques internes, instructions d'équipe, contexte confidentiel… (jamais visible sur le PDF client)"
                      className="w-full bg-white border border-amber-200 rounded-xl p-3 text-xs outline-none focus:border-amber-400 transition-all disabled:opacity-60 resize-none"
                      onChange={handleChange}
                    />
                  </div>
                </div>

                {/* Legacy closing div for Options section */}
                <div>
                  
                  {!isReadOnly && (
                    <>
                      <button
                        type="button"
                        onClick={() => setIsSidebarOpen(false)}
                        className="md:hidden w-full bg-blue-600 text-white py-4 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2"
                      >
                        <Eye size={16} />
                        Voir l'aperçu
                      </button>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={showReceiptPaymentMethods}
                        aria-label={
                          showReceiptPaymentMethods
                            ? 'Masquer les moyens de paiement sur le reçu'
                            : 'Afficher les moyens de paiement sur le reçu'
                        }
                        onClick={() => setShowReceiptPaymentMethods((v) => !v)}
                        className={`md:hidden w-full mt-2 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest border-2 flex items-center justify-center gap-2 transition-colors ${
                          showReceiptPaymentMethods
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <CreditCard size={16} className="shrink-0" aria-hidden />
                        <span className="text-center leading-tight px-1">
                          {showReceiptPaymentMethods
                            ? 'Moyens de paiement sur le reçu : affichés'
                            : 'Moyens de paiement sur le reçu : masqués'}
                        </span>
                      </button>
                      <p className="md:hidden text-[9px] text-gray-500 text-center mt-1.5 leading-snug px-1">
                        Sur ordinateur : même réglage dans la barre au-dessus du reçu (icône carte).
                      </p>
                    </>
                  )}
                </div>
              </form>
            </div>

            {/* Sidebar Footer */}
            <div className="p-6 border-t border-gray-100 bg-gray-50">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
                    {user?.displayName?.[0] || 'U'}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase tracking-tighter leading-none">{user?.displayName}</span>
                    <span className="text-[8px] text-gray-400 font-bold uppercase tracking-widest">{userProfile?.role}</span>
                  </div>
                </div>
                <button onClick={handleLogout} className="text-gray-400 hover:text-red-500 transition-all"><LogOut size={16}/></button>
              </div>
              <p
                className="text-[9px] text-gray-300 font-mono text-center leading-tight select-all"
                title="Identifiant du build déployé (comparez au hash court du dernier commit sur GitHub)"
              >
                build {__BUILD_REVISION__}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="main-content-wrapper flex-1 flex flex-col min-h-screen md:h-screen md:overflow-hidden relative print:overflow-visible print:h-auto">
        <Suspense fallback={
          <div className="flex-1 flex items-center justify-center bg-[#F5F5F4]">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          </div>
        }>
          {view === 'history' ? (
            <HistoryView 
              userProfile={userProfile}
              onMenuClick={() => setIsSidebarOpen(true)}
              onAlert={(msg, type) => {
                setAlertType(type || 'info');
                setAlertMessage(msg);
              }}
              onEdit={(receipt) => {
                setFormData(flattenStaySegmentsIfSingleton({ ...receipt }));
                setIsReadOnly(true);
                setReceiptReturnTarget('history');
                setView('form');
              }}
              onPrint={(receipt) => {
                setFormData(flattenStaySegmentsIfSingleton({ ...receipt }));
                setIsReadOnly(true);
                setReceiptReturnTarget('history');
                setView('form');
                // The useEffect will handle the title sync automatically
                setTimeout(() => {
                  window.print();
                }, 1000);
              }}
            />
          ) : view === 'calendar' ? (
            <CalendarView 
              viewMode={calendarViewMode}
              onViewModeChange={setCalendarViewMode}
              userProfile={userProfile}
              onMenuClick={() => setIsSidebarOpen(true)}
              onAlert={(msg, type) => {
                setAlertType(type || 'info');
                setAlertMessage(msg);
              }}
              initialScrollPosition={lastCalendarScroll}
              onScrollChange={setLastCalendarScroll}
              currentDate={calendarDate}
              onDateChange={setCalendarDate}
              onEdit={(receipt) => {
                setFormData(flattenStaySegmentsIfSingleton({ ...receipt }));
                setIsReadOnly(true);
                setReceiptReturnTarget('calendar');
                setView('form');
              }}
              onOpenCleaning={async (menageId, slug, date) => {
                const isMainAdmin = isMainAdminEmail(userProfile?.email);
                const isAdmin = userProfile?.role === 'admin' || isMainAdmin;
                
                const allowedSites = userProfile?.allowedSites || [];
                const allowedApartments = isAdmin ? Object.keys(TARIFS) : allowedSites.flatMap(site => SITE_MAPPING[site] || []);
                
                const isAllowed = allowedApartments.some(apt => TARIFS[apt]?.units?.includes(slug));
                
                if (!isAllowed) {
                  setAlertType('error');
                  setAlertMessage("Vous n'êtes pas autorisé à gérer le ménage pour ce logement.");
                  return;
                }

                setCleaningSubmitHint(null);
                // Check if report exists for this unit and date (regardless of menageId)
                const q = query(
                  collection(db, 'cleaning_reports'), 
                  where('calendarSlug', '==', slug),
                  where('dateIntervention', '==', date), 
                  limit(1)
                );
                const snap = await getDocs(q);
                const existingRaw = !snap.empty
                  ? ({ id: snap.docs[0].id, ...snap.docs[0].data() } as Record<string, unknown>)
                  : null;
                const existing = existingRaw ? normalizeCleaningReport(existingRaw) : null;
                
                if (existing && existing.status !== 'ANNULÉ') {
                  // If it's just planned (PRÉVU), open it directly without confirmation
                  if (existing.status === 'PRÉVU') {
                    setCleaningReport(existing);
                    setIsCleaningReadOnly(false);
                    setIsCleaningMode(true);
                  } else {
                    // Store pending data and show confirmation instead of opening directly
                    setPendingCleaningData({ menageId, slug, date, report: existing });
                    setShowCleaningConfirm(true);
                  }
                } else {
                  // No report or cancelled report -> New report
                  setCleaningReport({
                    menageId: menageId || 'MANUAL',
                    calendarSlug: slug,
                    dateIntervention: date,
                    agentEtape1: '',
                    agentEtape2: '',
                    status: 'PRÉVU',
                    feedback: '',
                    damages: '',
                    ...defaultCleaningChecklist,
                    createdAt: new Date().toISOString()
                  });
                  setIsCleaningReadOnly(false);
                  setIsCleaningMode(true);
                }
              }}
            />
          ) : view === 'users' ? (
            <UserManagement 
              onMenuClick={() => setIsSidebarOpen(true)}
              onAlert={(msg, type) => {
                setAlertType(type || 'info');
                setAlertMessage(msg);
              }} 
            />
          ) : view === 'prospects' ? (
            <ProspectsView
              userProfile={userProfile}
              onMenuClick={() => setIsSidebarOpen(true)}
              onAlert={(msg, type) => {
                setAlertType(type || 'info');
                setAlertMessage(msg);
              }}
              onConvert={handleConvertProspect}
            />
          ) : view === 'prepaidTokens' ? (
            <PrepaidElectricityTokensView
              userProfile={userProfile}
              onMenuClick={() => setIsSidebarOpen(true)}
              onAlert={(msg, type) => {
                setAlertType(type || 'info');
                setAlertMessage(msg);
              }}
            />
          ) : view === 'costs' ? (
            <CostsView
              userProfile={userProfile}
              onMenuClick={() => setIsSidebarOpen(true)}
              onAlert={(msg, type) => {
                setAlertType(type || 'info');
                setAlertMessage(msg);
              }}
              isMainAdmin={isMainAdminEmail(userProfile?.email)}
            />
          ) : view === 'proInvoices' ? (
            <ProInvoicesView
              userProfile={userProfile}
              onMenuClick={() => setIsSidebarOpen(true)}
              onAlert={(msg, type) => {
                setAlertType(type || 'info');
                setAlertMessage(msg);
              }}
            />
          ) : view === 'maintenance' ? (
            <div className="flex-1 flex flex-col bg-[#F5F5F4] overflow-y-auto">
              <header className="h-20 bg-white border-b border-gray-200 px-8 flex items-center gap-4 sticky top-0 z-40">
                <button onClick={() => setIsSidebarOpen(true)} className="md:hidden p-2 hover:bg-gray-100 rounded-xl">
                  <Menu size={20} />
                </button>
                <div>
                  <h2 className="text-base font-black uppercase tracking-widest">Maintenance</h2>
                  <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest">Outils admin — Base de données Firebase</p>
                </div>
              </header>
              <div className="p-8 max-w-2xl mx-auto w-full space-y-6">

                {/* Bloc : Population initiale */}
                <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm space-y-3">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center"><CalendarIcon size={16} className="text-blue-600" /></div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest">Synchroniser public_calendar</p>
                      <p className="text-[10px] text-gray-400">Alimente la vue publique avec toutes les réservations actuelles et futures (+ dates bloquées)</p>
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      setMaintenanceStatus(s => ({ ...s, sync: 'running' }));
                      const r = await populatePublicCalendar();
                      setMaintenanceStatus(s => ({
                        ...s,
                        sync: r.errors.length ? `Erreur : ${r.errors[0]}` : `✅ ${r.synced} entrée(s) synchronisée(s)`
                      }));
                    }}
                    disabled={maintenanceStatus.sync === 'running'}
                    className="w-full py-3 bg-blue-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {maintenanceStatus.sync === 'running' ? <><Loader2 size={14} className="animate-spin" /> En cours…</> : 'Lancer la synchronisation'}
                  </button>
                  {maintenanceStatus.sync && maintenanceStatus.sync !== 'running' && (
                    <p className="text-xs text-center text-gray-600 font-mono">{maintenanceStatus.sync}</p>
                  )}
                </div>

                {/* Bloc : Archivage */}
                <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm space-y-3">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-8 h-8 bg-orange-100 rounded-xl flex items-center justify-center"><FileText size={16} className="text-orange-600" /></div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest">Archiver les réservations passées</p>
                      <p className="text-[10px] text-gray-400">Copie dans 'archives' les séjours VALIDE terminés (fin &lt; aujourd'hui) et les retire de public_calendar</p>
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      setMaintenanceStatus(s => ({ ...s, archive: 'running' }));
                      const r = await archivePastReservations();
                      setMaintenanceStatus(s => ({
                        ...s,
                        archive: r.errors.length ? `Erreur : ${r.errors[0]}` : `✅ ${r.archived} archivée(s), ${r.cleaned} retirée(s) de public_calendar`
                      }));
                    }}
                    disabled={maintenanceStatus.archive === 'running'}
                    className="w-full py-3 bg-orange-500 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-orange-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {maintenanceStatus.archive === 'running' ? <><Loader2 size={14} className="animate-spin" /> En cours…</> : 'Archiver les séjours passés'}
                  </button>
                  {maintenanceStatus.archive && maintenanceStatus.archive !== 'running' && (
                    <p className="text-xs text-center text-gray-600 font-mono">{maintenanceStatus.archive}</p>
                  )}
                </div>

                <p className="text-[10px] text-center text-gray-400 font-mono">
                  Ces opérations sont sûres et idempotentes — tu peux les relancer sans risque.<br/>
                  L'archivage automatique nocturne tourne en parallèle via Cloud Scheduler.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Top Bar — lecture seule : barre compacte sur mobile (icônes + tooltips) */}
              <header className="top-bar bg-white border-b border-gray-200 px-3 sm:px-4 md:px-8 py-2 md:h-20 md:py-0 flex flex-col gap-2 md:flex-row md:items-center md:justify-between sticky top-0 z-40 print:hidden">
              <div className="flex items-center gap-2 md:gap-4 min-w-0 shrink">
                {!isSidebarOpen && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsSidebarOpen(true);
                    }} 
                    className="p-2 hover:bg-gray-100 rounded-xl transition-all shrink-0 touch-manipulation"
                    type="button"
                    aria-label="Ouvrir le menu"
                  >
                    <Menu size={20} />
                  </button>
                )}
                <div className="flex flex-col min-w-0">
                  <h2 className="text-[11px] sm:text-sm font-black uppercase tracking-widest truncate">Aperçu du Reçu</h2>
                  <span className="text-[9px] sm:text-[10px] font-mono text-gray-400 font-bold truncate">{formData.receiptId}</span>
                </div>
              </div>

              <div className="flex flex-nowrap items-center justify-end gap-1 sm:gap-1.5 md:gap-3 w-full md:w-auto md:shrink-0 border-t border-gray-100/80 pt-2 md:border-0 md:pt-0 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <button
                  type="button"
                  role="switch"
                  aria-checked={showReceiptPaymentMethods}
                  aria-label={
                    showReceiptPaymentMethods
                      ? 'Masquer les moyens de paiement sur le reçu'
                      : 'Afficher les moyens de paiement sur le reçu'
                  }
                  onClick={() => setShowReceiptPaymentMethods((v) => !v)}
                  className={`inline-flex items-center justify-center gap-1 h-10 shrink-0 px-2 sm:px-2.5 rounded-xl font-black text-[9px] sm:text-[10px] uppercase tracking-tight sm:tracking-widest transition-all touch-manipulation border ${
                    showReceiptPaymentMethods
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                  title={
                    showReceiptPaymentMethods
                      ? 'Masquer le bloc moyens de paiement sur le reçu et le PDF'
                      : 'Afficher le bloc moyens de paiement (Orange / MTN / RIB / espèces) sur le reçu et le PDF'
                  }
                >
                  <CreditCard size={15} className="shrink-0" aria-hidden />
                  <span className="hidden sm:inline max-w-[7rem] truncate md:max-w-none">
                    {showReceiptPaymentMethods ? 'Paiements affichés' : 'Paiements masqués'}
                  </span>
                </button>
                {!isReadOnly ? (
                  <div className="flex flex-nowrap items-center gap-1 sm:gap-1.5 md:gap-2 ml-auto">
                    <button 
                      onClick={() => setIsSidebarOpen(true)} 
                      className="md:hidden h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 touch-manipulation"
                      type="button"
                      title="Modifier le reçu"
                      aria-label="Modifier le reçu"
                    >
                      <Edit size={18} />
                    </button>
                    <button 
                      onClick={saveToFirestore} 
                      disabled={isSaving || formData.status === 'ANNULE'} 
                      type="button"
                      aria-label={isSaving ? 'Enregistrement en cours' : saveStatus === 'success' ? 'Enregistré' : 'Sauvegarder'}
                      title={isSaving ? 'Enregistrement...' : saveStatus === 'success' ? 'Enregistré' : 'Sauvegarder le reçu'}
                      className={`inline-flex items-center justify-center gap-2 h-10 px-3 sm:px-4 md:h-auto md:px-6 md:py-3 rounded-xl font-black text-[10px] md:text-xs uppercase tracking-widest transition-all shadow-lg touch-manipulation ${formData.status === 'ANNULE' ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : saveStatus === 'success' ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-600/20'}`}
                    >
                      {isSaving ? <Clock size={16} className="animate-spin shrink-0"/> : saveStatus === 'success' ? <CheckCircle2 size={16} className="shrink-0"/> : <Save size={16} className="shrink-0"/>}
                      <span className="hidden sm:inline md:inline max-w-[7rem] sm:max-w-none truncate">
                        {isSaving ? 'Enregistrement...' : saveStatus === 'success' ? 'Enregistré' : 'Sauvegarder'}
                      </span>
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-nowrap items-center gap-1 sm:gap-1.5 md:gap-2 ml-auto">
                    {/* 1 — Fermer (le plus utilisé) */}
                    <button
                      type="button"
                      onClick={handleCloseReceiptPreview}
                      className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 touch-manipulation md:h-auto md:w-auto md:px-5 md:py-3 md:gap-2"
                      title="Fermer l'aperçu"
                      aria-label="Fermer l'aperçu"
                    >
                      <X size={18} className="md:hidden" />
                      <ArrowLeft size={14} className="hidden md:block" />
                      <span className="hidden md:inline font-black text-[10px] md:text-xs uppercase tracking-widest">Fermer</span>
                    </button>
                    {/* 2 — PDF : libellé « PDF » toujours visible sur mobile */}
                    <button
                      onClick={handlePrint}
                      type="button"
                      title="Exporter le reçu en PDF"
                      aria-label="Exporter en PDF"
                      className="inline-flex items-center justify-center gap-1.5 h-10 shrink-0 px-2.5 md:gap-2 md:px-6 md:py-3 rounded-xl font-black text-[10px] md:text-xs uppercase tracking-widest transition-all shadow-xl touch-manipulation bg-[#141414] text-white hover:bg-gray-800 shadow-black/10"
                    >
                      <Printer size={18} className="md:hidden shrink-0" />
                      <Printer size={14} className="hidden md:block shrink-0" />
                      <span className="inline md:hidden font-black text-[10px] uppercase tracking-widest">PDF</span>
                      <span className="hidden md:inline">Exporter PDF</span>
                    </button>
                    {/* 3 — Modifier */}
                    {(!formData.status || formData.status === 'VALIDE') && (
                      <button 
                        onClick={() => setIsReadOnly(false)} 
                        type="button"
                        className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-xl bg-orange-50 text-orange-600 border border-orange-200/80 hover:bg-orange-100 touch-manipulation md:h-auto md:w-auto md:px-6 md:py-3 md:border-0 md:gap-2"
                        title="Modifier le texte du reçu avant impression"
                        aria-label="Modifier le reçu"
                      >
                        <Edit size={18} className="md:hidden shrink-0" />
                        <Edit size={14} className="hidden md:block shrink-0" />
                        <span className="hidden md:inline font-black text-[10px] md:text-xs uppercase tracking-widest">Modifier</span>
                      </button>
                    )}
                    {/* 4 — Annuler la réservation (action sensible, en dernier) */}
                    {(!formData.status || formData.status === 'VALIDE') && (
                      <button 
                        onClick={() => setShowCancelConfirm(true)} 
                        type="button"
                        className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-xl bg-red-50 text-red-600 border border-red-200/80 hover:bg-red-100 touch-manipulation md:h-auto md:w-auto md:px-6 md:py-3 md:border-0 md:gap-2"
                        title="Annuler définitivement la réservation (irréversible)"
                        aria-label="Annuler la réservation"
                      >
                        <Trash2 size={18} className="md:hidden shrink-0" />
                        <Trash2 size={14} className="hidden md:block shrink-0" />
                        <span className="hidden md:inline font-black text-[10px] md:text-xs uppercase tracking-widest">Annuler</span>
                      </button>
                    )}
                  </div>
                )}
                {!isReadOnly && (
                <button 
                  onClick={handlePrint} 
                  disabled
                  type="button"
                  title="Enregistrez le reçu pour exporter en PDF"
                  aria-label="Exporter en PDF"
                  className={`inline-flex items-center justify-center gap-1.5 h-10 shrink-0 px-2.5 md:gap-2 md:px-6 md:py-3 rounded-xl font-black text-[10px] md:text-xs uppercase tracking-widest transition-all shadow-xl touch-manipulation bg-gray-100 text-gray-400 cursor-not-allowed`}
                >
                  <Printer size={18} className="md:hidden shrink-0" />
                  <Printer size={14} className="hidden md:block shrink-0" />
                  <span className="inline md:hidden font-black text-[10px] uppercase tracking-widest">PDF</span>
                  <span className="hidden md:inline">Exporter PDF</span>
                </button>
                )}
              </div>
            </header>

            {/* Preview Area */}
            <main className="receipt-viewer-main flex-1 overflow-y-auto bg-[#F5F5F4] p-4 md:p-8 flex justify-center scroll-smooth print:bg-white print:p-0 print:overflow-visible">
              {isSaving && (urlParams.has('id') || urlParams.has('menageId')) ? (
                <div className="flex items-center justify-center w-full h-full">
                  <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="receipt-motion-wrapper w-full max-w-[210mm] print:m-0 print:p-0 print:max-w-none"
                >
                  <div className="mobile-receipt-container w-full flex flex-col items-center overflow-hidden md:overflow-visible">
                    {isSyncing && (
                      <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600 animate-pulse flex items-center gap-2">
                        <Loader2 size={10} className="animate-spin" /> Mise à jour de l'aperçu...
                      </div>
                    )}
                    <div className="mobile-receipt-zoom origin-top transition-transform will-change-transform">
                      <ReceiptPreview data={debouncedFormData} showPaymentMethods={showReceiptPaymentMethods} />
                    </div>
                  </div>
                </motion.div>
              )}
            </main>
          </>
        )}
        </Suspense>
      </div>
      {/* Modals */}
      <AnimatePresence>
        {showCleaningConfirm && pendingCleaningData && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <ClipboardCheck size={32} />
              </div>
              <h3 className="text-xl font-black uppercase tracking-tight mb-2">Rapport existant</h3>
              <p className="text-sm text-gray-500 mb-8 leading-relaxed">
                Un rapport de ménage a déjà été effectué pour <span className="font-bold text-gray-900">{pendingCleaningData.slug}</span> le <span className="font-bold text-gray-900">{pendingCleaningData.date}</span>. 
                Souhaitez-vous le consulter ou le modifier ?
              </p>
              <div className="flex flex-col gap-3">
                <button 
                  type="button"
                  onClick={() => {
                    if (pendingCleaningData.report) {
                      setCleaningReport(pendingCleaningData.report);
                      setIsCleaningReadOnly(true);
                      setIsCleaningMode(true);
                      setCleaningSubmitHint(null);
                    }
                    setShowCleaningConfirm(false);
                    setPendingCleaningData(null);
                  }}
                  className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl uppercase text-xs tracking-widest shadow-xl shadow-blue-600/20 hover:bg-blue-700 transition-all"
                >
                  Consulter le rapport
                </button>
                <button 
                  onClick={() => {
                    if (pendingCleaningData.report) {
                      setCleaningReport(pendingCleaningData.report);
                    } else {
                      setCleaningReport({
                        menageId: pendingCleaningData.menageId || 'MANUAL',
                        calendarSlug: pendingCleaningData.slug,
                        dateIntervention: pendingCleaningData.date,
                        agentEtape1: '',
                        agentEtape2: '',
                        status: 'PRÉVU',
                        feedback: '',
                        damages: '',
                        ...defaultCleaningChecklist,
                        createdAt: new Date().toISOString()
                      });
                    }
                    setShowDeleteCleaningConfirm(true);
                  }}
                  className="w-full bg-red-50 text-red-600 font-black py-4 rounded-2xl uppercase text-xs tracking-widest hover:bg-red-100 transition-all"
                >
                  Effacer le planning
                </button>
                <button 
                  onClick={() => {
                    setShowCleaningConfirm(false);
                    setPendingCleaningData(null);
                  }}
                  className="w-full bg-gray-100 text-gray-600 font-black py-4 rounded-2xl uppercase text-xs tracking-widest hover:bg-gray-200 transition-all"
                >
                  Annuler
                </button>
              </div>
            </motion.div>
          </div>
        )}

         {showDeleteCleaningConfirm && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <Trash2 size={32} />
              </div>
              <h3 className="text-xl font-black uppercase tracking-tight mb-2">Effacer le planning ?</h3>
              <p className="text-sm text-gray-500 mb-8 leading-relaxed">
                Le ménage prévu pour <span className="font-bold text-gray-900">{cleaningReport.calendarSlug}</span> le <span className="font-bold text-gray-900">{cleaningReport.dateIntervention}</span> sera retiré du calendrier.
              </p>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={deleteCleaningReport}
                  disabled={isSaving}
                  className="w-full bg-red-600 text-white font-black py-4 rounded-2xl uppercase text-xs tracking-widest shadow-xl shadow-red-600/20 hover:bg-red-700 transition-all disabled:opacity-50"
                >
                  {isSaving ? 'Suppression...' : 'Confirmer la suppression'}
                </button>
                <button 
                  onClick={() => setShowDeleteCleaningConfirm(false)}
                  className="w-full bg-gray-100 text-gray-600 font-black py-4 rounded-2xl uppercase text-xs tracking-widest hover:bg-gray-200 transition-all"
                >
                  Retour
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showCancelConfirm && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertCircle size={32} />
              </div>
              <h3 className="text-xl font-black uppercase tracking-tight mb-2">Annuler la réservation ?</h3>
              <p className="text-sm text-gray-500 mb-8 leading-relaxed">
                Cette action est irréversible. Le reçu sera marqué comme ANNULÉ et disparaîtra du planning.
              </p>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={softDeleteBooking}
                  disabled={isSaving}
                  className="w-full bg-red-600 text-white font-black py-4 rounded-2xl uppercase text-xs tracking-widest shadow-xl shadow-red-600/20 hover:bg-red-700 transition-all disabled:opacity-50"
                >
                  {isSaving ? 'Annulation...' : 'Confirmer l\'annulation'}
                </button>
                <button 
                  onClick={() => setShowCancelConfirm(false)}
                  className="w-full bg-gray-100 text-gray-600 font-black py-4 rounded-2xl uppercase text-xs tracking-widest hover:bg-gray-200 transition-all"
                >
                  Retour
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {alertMessage && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl text-center"
            >
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 ${
                alertType === 'error' ? 'bg-red-50 text-red-600' : 
                alertType === 'success' ? 'bg-green-50 text-green-600' : 
                'bg-blue-50 text-blue-600'
              }`}>
                {alertType === 'error' ? <AlertCircle size={32} /> : 
                 alertType === 'success' ? <CheckCircle2 size={32} /> : 
                 <Info size={32} />}
              </div>
              <h3 className="text-xl font-black uppercase tracking-tight mb-2">
                {alertType === 'error' ? 'Attention' : 
                 alertType === 'success' ? 'Succès' : 
                 'Information'}
              </h3>
              <p className="text-sm text-gray-500 mb-8 leading-relaxed">
                {alertMessage}
              </p>
              <button 
                onClick={() => setAlertMessage(null)}
                className={`w-full font-black py-4 rounded-2xl uppercase text-xs tracking-widest transition-all ${
                  alertType === 'error' ? 'bg-red-600 text-white shadow-xl shadow-red-600/20 hover:bg-red-700' : 
                  alertType === 'success' ? 'bg-green-600 text-white shadow-xl shadow-green-600/20 hover:bg-green-700' : 
                  'bg-blue-600 text-white shadow-xl shadow-blue-600/20 hover:bg-blue-700'
                }`}
              >
                D'accord
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
