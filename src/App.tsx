/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, Suspense, lazy, useDeferredValue } from 'react';
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
import { TARIFS, PAYMENT_METHODS, HOSTS, getRateForApartment, formatCurrency, SITES, SITE_MAPPING } from './constants';
import { ReceiptData, CleaningReport, Payment, UserProfile, AuthorizedEmail, BlockedDate } from './types';
import ReceiptPreview from './components/ReceiptPreview';
import DateRangePicker from './components/DateRangePicker';
const HistoryView = lazy(() => import('./components/HistoryView'));
const CalendarView = lazy(() => import('./components/CalendarView'));
const UserManagement = lazy(() => import('./components/UserManagement'));
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
  Loader2
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
  
  if (errInfo.error.toLowerCase().includes('permission') || errInfo.error.toLowerCase().includes('insufficient')) {
    throw new Error(JSON.stringify(errInfo));
  }
}

const getLocalDateString = (date: Date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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
    signature: '', hosts: [], electricityCharge: false, packEco: false, packConfort: false, observations: '',
    status: 'VALIDE', grandTotal: 0, totalPaid: 0, remaining: 0,
    agentName: '', commissionAmount: 0, isCommissionPaid: false,
    cautionAmount: 0, isCautionRefunded: false,
    createdAt: new Date().toISOString(),
    authorUid: auth.currentUser?.uid || ''
  });

  // --- STATES ---
  const urlParams = new URLSearchParams(window.location.search);
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState<'form' | 'history' | 'calendar' | 'users'>('form');
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
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [searchId, setSearchId] = useState('');
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
  
  const [isCleaningMode, setIsCleaningMode] = useState(urlParams.has('menageId'));
  const [isReadOnly, setIsReadOnly] = useState(urlParams.has('id'));
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
    agent: '', 
    status: 'PRÉVU', 
    feedback: '', 
    damages: '', 
    maintenance: '',
    createdAt: new Date().toISOString()
  });

  // --- AUTH ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      console.log("Auth state changed:", u?.email);
      setUser(u);
      if (u) {
        try {
          const userEmail = u.email?.toLowerCase();
          const isMainAdmin = userEmail === 'christian.yamepi@gmail.com' || userEmail === 'cyamepi@gmail.com';
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

            const { allowedApartments, ...restProfile } = profile as any;
            const updatedProfile: UserProfile = { 
              ...restProfile, 
              isApproved: shouldBeApproved,
              role: finalRole,
              allowedSites: finalSites
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
            setUserProfile(updatedProfile);
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
            console.log("Setting user profile (new):", newProfile);
            try {
              await setDoc(docRef, newProfile);
            } catch (e) {
              console.error("Error creating user profile:", e);
              handleFirestoreError(e, OperationType.WRITE, `users/${u.uid}`);
            }
            setUserProfile(newProfile);
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
          setFormData(data);
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
          const data = snap.docs[0].data() as CleaningReport;
          setCleaningReport(data);
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

  // --- CALCULATIONS ---
  const totals = useMemo(() => {
    if (!formData.startDate || !formData.endDate || !formData.apartmentName) {
      return { nights: 0, grandTotal: 0, totalPaid: 0, remaining: 0, commissionAmount: 0, cautionAmount: 0 };
    }
    
    const start = new Date(formData.startDate);
    const end = new Date(formData.endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return { nights: 0, grandTotal: 0, totalPaid: 0, remaining: 0, commissionAmount: 0, cautionAmount: 0 };
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
  }, [
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
  }, [view, isReadOnly, formData, formData.receiptId]);

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

  const handleCleaningChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setCleaningReport(prev => ({ ...prev, [name]: value as any }));
  };

  const submitCleaningReport = async () => {
    const allowedSites = userProfile?.allowedSites || [];
    const isMainAdmin = userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' || userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
    
    const allowedApartments = userProfile?.role === 'admin' || isMainAdmin 
      ? Object.keys(TARIFS) 
      : allowedSites.flatMap(site => SITE_MAPPING[site] || []);

    const isAllowed = allowedApartments.some(apt => TARIFS[apt]?.units?.includes(cleaningReport.calendarSlug));

    if (!isAllowed) {
      setAlertType('error');
      setAlertMessage("Vous n'êtes pas autorisé à gérer le ménage pour ce logement.");
      return;
    }

    if (cleaningReport.status !== 'PRÉVU' && cleaningReport.status !== 'ANNULÉ' && !cleaningReport.agent) {
      setAlertType('error');
      setAlertMessage("Nom agent requis");
      return;
    }
    setIsSaving(true);
    try {
      // Create a unique deterministic ID if not already present
      const reportId = cleaningReport.id || `CR-${cleaningReport.menageId}-${cleaningReport.calendarSlug}-${cleaningReport.dateIntervention}`;
      await setDoc(doc(db, 'cleaning_reports', reportId), {
        ...cleaningReport,
        id: reportId,
        createdAt: new Date().toISOString()
      });

      // Close modals first
      setIsCleaningMode(false);
      setView('calendar');

      // Then show alert
      setTimeout(() => {
        setAlertType('success');
        setAlertMessage(cleaningReport.status === 'ANNULÉ' ? "Planning effacé !" : "Rapport enregistré !");
      }, 100);
    } catch (e) { 
      handleFirestoreError(e, OperationType.WRITE, 'cleaning_reports');
      setAlertType('error');
      setAlertMessage("Erreur d'enregistrement");
    } finally { 
      setIsSaving(false); 
    }
  };

  const deleteCleaningReport = async () => {
    const dataToUse = pendingCleaningData?.report || cleaningReport;
    const slug = dataToUse.calendarSlug || pendingCleaningData?.slug || '';
    
    const isMainAdmin = userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' || userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
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
    if (!formData.apartmentName || !formData.lastName) {
      setAlertType('error');
      setAlertMessage("Remplir Nom et Logement");
      return;
    }
    if (!formData.startDate || !formData.endDate) {
      setAlertType('error');
      setAlertMessage("Précisez les dates d'arrivée et de départ");
      return;
    }
    
    const apartmentData = TARIFS[formData.apartmentName];
    const units = apartmentData?.units || [];
    const finalSlug = units.length === 1 ? units[0] : formData.calendarSlug;
    if (units.length > 1 && !finalSlug) {
      setAlertType('error');
      setAlertMessage("Précisez l'unité");
      return;
    }

    const isMainAdmin = userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' || userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
    const isAdmin = userProfile?.role === 'admin' || isMainAdmin;
    
    const allowedSites = userProfile?.allowedSites || [];
    const allowedApartments = isAdmin ? Object.keys(TARIFS) : allowedSites.flatMap(site => SITE_MAPPING[site] || []);
    
    const isAllowed = allowedApartments.includes(formData.apartmentName);
    
    if (!isAllowed) {
      setAlertType('error');
      setAlertMessage("Vous n'êtes pas autorisé à gérer cet appartement.");
      return;
    }

    setIsSaving(true);
    try {
      const docId = formData.id || formData.receiptId;

      // Helper for timeout to prevent hanging on weak networks
      const withTimeout = async (p: Promise<any>, ms: number = 10000) => {
        return Promise.race([
          p,
          new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), ms))
        ]);
      };

      // --- OVERLAP CHECK ---
      // Get all apartment names that share this physical unit (slug)
      const relatedApartments = Object.entries(TARIFS)
        .filter(([_, data]) => data.units?.includes(finalSlug))
        .map(([name, _]) => name);

      // Query by slug (modern) AND by apartment names (legacy/fallback)
      const qSlug = query(collection(db, 'receipts'), where('calendarSlug', '==', finalSlug));
      
      let snapAptDocs: any[] = [];
      if (relatedApartments.length > 0) {
        const qApt = query(collection(db, 'receipts'), where('apartmentName', 'in', relatedApartments));
        const snapApt = await withTimeout(getDocs(qApt)) as any;
        snapAptDocs = snapApt.docs;
      }
      
      const snapSlug = await withTimeout(getDocs(qSlug)) as any;
      
      // Merge results and remove duplicates
      const allDocs = [...snapSlug.docs, ...snapAptDocs];
      const docMap = new Map();
      allDocs.forEach(d => docMap.set(d.id, { id: d.id, ...d.data() }));
      
      const existingBookings = Array.from(docMap.values()) as ReceiptData[];
      const activeBookings = existingBookings.filter(b => b.status !== 'ANNULE');
      
      const newStart = formData.startDate;
      const newEnd = formData.endDate;
      
      const overlap = activeBookings.find(b => {
        // Skip current booking if updating
        if (b.id === docId || b.receiptId === docId || b.receiptId === formData.receiptId) return false;
        
        // If both have slugs, they only conflict if slugs match
        if (b.calendarSlug && finalSlug && b.calendarSlug !== finalSlug) return false;
        
        const bStart = b.startDate;
        const bEnd = b.endDate;
        
        if (!bStart || !bEnd) return false;

        // Overlap logic (exclusive of checkout day): (StartA < EndB) and (EndA > StartB)
        return newStart < bEnd && newEnd > bStart;
      });
      
      if (overlap) {
        setIsSaving(false);
        const overlapName = `${overlap.firstName} ${overlap.lastName}`.trim() || 'un autre client';
        setAlertType('error');
        setAlertMessage(`CONFLIT DE RÉSERVATION : Le logement "${finalSlug}" est déjà réservé par ${overlapName} du ${overlap.startDate} au ${overlap.endDate}. Veuillez annuler ou déplacer l'ancienne réservation avant de continuer.`);
        return;
      }

      // --- BLOCKED DATES CHECK ---
      const qBlocked = query(collection(db, 'blocked_dates'), where('calendarSlug', '==', finalSlug));
      const snapBlocked = await withTimeout(getDocs(qBlocked)) as any;
      const blockedDates = snapBlocked.docs.map((d: any) => d.data() as BlockedDate);
      
      const blocked = blockedDates.find(b => {
        return b.date >= newStart && b.date < newEnd;
      });
      
      if (blocked) {
        setIsSaving(false);
        setAlertType('error');
        setAlertMessage(`DATE BLOQUÉE : Le logement "${finalSlug}" est bloqué pour maintenance le ${blocked.date}. Veuillez choisir une autre date ou un autre logement.`);
        return;
      }

      await withTimeout(setDoc(doc(db, 'receipts', docId), {
        ...formData,
        id: docId,
        calendarSlug: finalSlug,
        authorUid: user?.uid,
        createdAt: formData.createdAt || new Date().toISOString(),
        status: formData.status || 'VALIDE'
      }));

      // --- AUTOMATIC CLEANING GENERATION ---
      // Generate a cleaning report for the checkout date (endDate)
      if (formData.status !== 'ANNULE') {
        const cleaningReportId = `CR-${formData.receiptId}-${finalSlug}-${formData.endDate}`;
        await withTimeout(setDoc(doc(db, 'cleaning_reports', cleaningReportId), {
          menageId: formData.receiptId,
          calendarSlug: finalSlug,
          dateIntervention: formData.endDate,
          agent: '',
          status: 'PRÉVU',
          feedback: '',
          damages: '',
          maintenance: '',
          createdAt: new Date().toISOString()
        }, { merge: true }));
      }

      // Ensure data is synchronized with the server
      try {
        await withTimeout(waitForPendingWrites(db), 5000);
      } catch (e) {
        console.warn("Server sync timeout, data will sync in background");
      }

      setSaveStatus('success'); 
      setAlertType('success');
      setAlertMessage("Reçu enregistré avec succès !");
      setTimeout(() => setSaveStatus('idle'), 3000);
      setIsReadOnly(true);
      setShowMobileNav(false);
    } catch (error: any) { 
      if (error.message === 'TIMEOUT') {
        setAlertType('error');
        setAlertMessage("DÉLAI DÉPASSÉ : La connexion est trop lente. Vos données sont peut-être enregistrées localement et seront synchronisées dès que possible.");
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
    setIsReadOnly(false);
    setView('form');
    setShowMobileNav(false);
  };

  const loadReceipt = async (id: string) => {
    if (!id) return;
    setIsSaving(true);
    try {
      let searchId = id.trim();
      // If it's just numbers, prepend RC-
      if (/^\d+$/.test(searchId)) {
        searchId = `RC-${searchId}`;
      } else if (searchId.toLowerCase().startsWith('rc-')) {
        // Normalize rc- to RC-
        searchId = `RC-${searchId.slice(3)}`;
      }
      
      const q = query(collection(db, 'receipts'), where('receiptId', '==', searchId), limit(1));
      const snap = await getDocs(q);
      
      if (!snap.empty) {
        setFormData(snap.docs[0].data() as ReceiptData);
        setIsReadOnly(true);
        setView('form');
        setShowMobileNav(false);
        setSearchId(''); // Clear search after success
        if (window.innerWidth < 768) setIsSidebarOpen(false);
      } else {
        // Try original if it was different
        if (searchId !== id.trim()) {
          const q2 = query(collection(db, 'receipts'), where('receiptId', '==', id.trim()), limit(1));
          const snap2 = await getDocs(q2);
          if (!snap2.empty) {
            setFormData(snap2.docs[0].data() as ReceiptData);
            setIsReadOnly(true);
            setView('form');
            setShowMobileNav(false);
            setSearchId('');
            if (window.innerWidth < 768) setIsSidebarOpen(false);
            return;
          }
        }
        setAlertType('error');
        setAlertMessage("Reçu non trouvé");
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, 'receipts');
    } finally {
      setIsSaving(false);
    }
  };

  const softDeleteBooking = async () => {
    const isMainAdmin = userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' || userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
    const isAdmin = userProfile?.role === 'admin' || isMainAdmin;
    
    const allowedSites = userProfile?.allowedSites || [];
    const allowedApartments = isAdmin ? Object.keys(TARIFS) : allowedSites.flatMap(site => SITE_MAPPING[site] || []);
    
    const isAllowed = allowedApartments.includes(formData.apartmentName);
    
    if (!isAllowed) {
      setAlertType('error');
      setAlertMessage("Vous n'êtes pas autorisé à annuler cette réservation.");
      return;
    }

    setIsSaving(true);
    try {
      await setDoc(doc(db, 'receipts', formData.id || formData.receiptId), {
        ...formData,
        status: 'ANNULE'
      }, { merge: true });

      // --- CANCEL ASSOCIATED CLEANING ---
      const cleaningReportId = `CR-${formData.receiptId}-${formData.calendarSlug}-${formData.endDate}`;
      await setDoc(doc(db, 'cleaning_reports', cleaningReportId), {
        status: 'ANNULÉ'
      }, { merge: true });
      setFormData(getInitialState()); 
      setIsReadOnly(false); 
      setShowMobileNav(false);
      setShowCancelConfirm(false);
      setAlertType('success');
      setAlertMessage("Réservation annulée avec succès !");
    } catch (e) { 
      handleFirestoreError(e, OperationType.UPDATE, 'receipts');
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

  const isMainAdmin = user?.email?.toLowerCase() === 'christian.yamepi@gmail.com' || user?.email?.toLowerCase() === 'cyamepi@gmail.com';

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
                <div>
                  <label className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-2 block">Agent Responsable</label>
                  <input 
                    disabled={isCleaningReadOnly} 
                    type="text" 
                    name="agent" 
                    className="w-full bg-white border border-gray-200 rounded-xl p-4 text-sm outline-none focus:border-blue-500 transition-all disabled:bg-gray-50" 
                    placeholder="Nom de l'agent" 
                    value={cleaningReport.agent} 
                    onChange={handleCleaningChange} 
                  />
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
                
                <div>
                  <label className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-2 block">Feedback & Observations</label>
                  <textarea 
                    disabled={isCleaningReadOnly} 
                    name="feedback" 
                    rows={3} 
                    className="w-full bg-white border border-gray-200 rounded-xl p-4 text-sm outline-none focus:border-blue-500 transition-all disabled:bg-gray-50" 
                    placeholder="Commentaire sur l'état général..." 
                    value={cleaningReport.feedback} 
                    onChange={handleCleaningChange}
                  ></textarea>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] text-red-400 font-black uppercase tracking-widest mb-2 block">Casse / Dommages</label>
                    <textarea 
                      disabled={isCleaningReadOnly} 
                      name="damages" 
                      rows={2} 
                      className="w-full bg-white border border-red-100 rounded-xl p-3 text-xs outline-none focus:border-red-500 transition-all disabled:bg-gray-50" 
                      placeholder="Signaler une casse..." 
                      value={cleaningReport.damages} 
                      onChange={handleCleaningChange}
                    ></textarea>
                  </div>
                  <div>
                    <label className="text-[10px] text-orange-400 font-black uppercase tracking-widest mb-2 block">Maintenance</label>
                    <textarea 
                      disabled={isCleaningReadOnly} 
                      name="maintenance" 
                      rows={2} 
                      className="w-full bg-white border border-orange-100 rounded-xl p-3 text-xs outline-none focus:border-orange-500 transition-all disabled:bg-gray-50" 
                      placeholder="Besoin technique ?" 
                      value={cleaningReport.maintenance} 
                      onChange={handleCleaningChange}
                    ></textarea>
                  </div>
                </div>
                
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
                        onClick={() => {
                          setIsCleaningMode(false);
                          setView('calendar');
                        }} 
                        className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black py-4 rounded-xl text-xs uppercase tracking-widest transition-all"
                      >
                        Annuler
                      </button>
                      <button 
                        onClick={submitCleaningReport} 
                        disabled={isSaving || (cleaningReport.status !== 'PRÉVU' && !cleaningReport.agent)} 
                        className="flex-[2] bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-xl shadow-lg shadow-blue-600/20 uppercase text-xs tracking-widest transition-all disabled:opacity-50"
                      >
                        {isSaving ? 'ENVOI...' : cleaningReport.status === 'PRÉVU' ? 'CONFIRMER LA PLANIFICATION' : 'VALIDER LE RAPPORT'}
                      </button>
                    </div>
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
            className="sidebar fixed md:sticky top-0 left-0 w-full md:w-80 h-full md:h-screen bg-white border-r border-gray-200 flex flex-col z-50 print:hidden shadow-2xl md:shadow-none"
          >
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h1 className="text-2xl font-black italic tracking-tighter uppercase">YAMEHOME</h1>
              <button onClick={() => setIsSidebarOpen(false)} className="md:hidden"><X size={20}/></button>
            </div>

            <div className="px-6 py-4 border-b border-gray-100 space-y-2">
              <div className="flex flex-col gap-2">
                <button 
                  onClick={handleNewReceipt}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'form' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-400 hover:bg-gray-50'}`}
                >
                  <Plus size={16} />
                  Nouveau Reçu
                </button>

                {/* Mobile-only toggle to show/hide other menus when in form view */}
                {view === 'form' && (
                  <button 
                    onClick={() => setShowMobileNav(!showMobileNav)}
                    className="md:hidden w-full flex items-center justify-between px-4 py-2 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-blue-600 transition-all"
                  >
                    <span>{showMobileNav ? 'Masquer le menu' : 'Afficher le menu'}</span>
                    <ChevronRight size={14} className={`transition-transform ${showMobileNav ? 'rotate-90' : ''}`} />
                  </button>
                )}
              </div>
              
              {/* Hide other nav on mobile when editing a receipt to focus on the form, unless toggled */}
              <div className={`${(view === 'form' && !showMobileNav) ? 'hidden md:block' : 'block'} space-y-2`}>
                <button 
                  onClick={() => {
                    setView('history');
                    setShowMobileNav(false);
                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'history' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-400 hover:bg-gray-50'}`}
                >
                  <History size={16} />
                  Historique
                </button>
                <button 
                  onClick={() => {
                    setView('calendar');
                    setShowMobileNav(false);
                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'calendar' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-400 hover:bg-gray-50'}`}
                >
                  <CalendarIcon size={16} />
                  Calendrier
                </button>
                {(userProfile?.role === 'admin' || isMainAdmin) && (
                  <button 
                    onClick={() => {
                      setView('users');
                      setShowMobileNav(false);
                      if (window.innerWidth < 768) setIsSidebarOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'users' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-400 hover:bg-gray-50'}`}
                  >
                    <Users size={16} />
                    Utilisateurs
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {/* Search */}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Rechercher un reçu</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="ID Reçu..." 
                    className="flex-1 bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all" 
                    value={searchId} 
                    onChange={(e) => setSearchId(e.target.value)} 
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        loadReceipt(searchId);
                      }
                    }}
                  />
                  <button 
                    onClick={() => loadReceipt(searchId)} 
                    className="bg-[#141414] text-white p-3 rounded-xl hover:bg-gray-800 transition-all"
                  >
                    <Search size={16} />
                  </button>
                </div>
              </div>

              {/* Form */}
              <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
                {/* Client Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
                    <UserIcon size={12} />
                    <span>Informations Client</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input disabled={isReadOnly} type="text" name="firstName" value={formData.firstName} placeholder="Prénom" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all disabled:opacity-50" onChange={handleChange} />
                    <input disabled={isReadOnly} type="text" name="lastName" value={formData.lastName} placeholder="Nom" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all disabled:opacity-50" onChange={handleChange} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input disabled={isReadOnly} type="tel" name="phone" value={formData.phone} placeholder="Téléphone" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all disabled:opacity-50" onChange={handleChange} />
                    <input disabled={isReadOnly} type="email" name="email" value={formData.email} placeholder="Email" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all disabled:opacity-50" onChange={handleChange} />
                  </div>
                </div>

                {/* Apartment Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
                    <Home size={12} />
                    <span>Logement</span>
                  </div>
                  <select disabled={isReadOnly} name="apartmentName" value={formData.apartmentName} className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all disabled:opacity-50 appearance-none" onChange={handleChange}>
                    <option value="">-- Choisir Appartement --</option>
                    {Object.keys(TARIFS)
                      .filter(key => {
                        if (!userProfile) return false;
                        const isMainAdmin = userProfile.email?.toLowerCase() === 'christian.yamepi@gmail.com' || userProfile.email?.toLowerCase() === 'cyamepi@gmail.com';
                        if (userProfile.role === 'admin' || isMainAdmin) return true;
                        const allowedSites = userProfile.allowedSites || [];
                        const allowedApartments = allowedSites.flatMap(site => SITE_MAPPING[site] || []);
                        return allowedApartments.includes(key);
                      })
                      .map(key => <option key={key} value={key}>{key}</option>)}
                  </select>
                  
                  {TARIFS[formData.apartmentName]?.units && TARIFS[formData.apartmentName].units!.length > 1 && (
                    <select disabled={isReadOnly} name="calendarSlug" value={formData.calendarSlug} onChange={handleChange} className="w-full bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all disabled:opacity-50 appearance-none">
                      <option value="">-- Préciser l'unité --</option>
                      {TARIFS[formData.apartmentName].units!.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  )}

                  <DateRangePicker 
                    startDate={formData.startDate}
                    endDate={formData.endDate}
                    disabled={isReadOnly}
                    onChange={(start, end) => {
                      setFormData(prev => ({ ...prev, startDate: start, endDate: end }));
                    }}
                  />
                </div>

                {/* Pricing Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
                    <FileText size={12} />
                    <span>Tarification</span>
                  </div>
                  <div className="flex gap-4">
                    <label className="flex items-center text-[10px] font-bold uppercase cursor-pointer select-none">
                      <input disabled={isReadOnly} type="checkbox" name="isCustomRate" checked={formData.isCustomRate} onChange={handleChange} className="mr-2 accent-blue-600" /> 
                      Plateforme
                    </label>
                    <label className="flex items-center text-[10px] font-bold uppercase cursor-pointer select-none">
                      <input disabled={isReadOnly} type="checkbox" name="isNegotiatedRate" checked={formData.isNegotiatedRate} onChange={handleChange} className="mr-2 accent-blue-600" /> 
                      Négocié
                    </label>
                  </div>
                  {formData.isCustomRate && <input disabled={isReadOnly} type="number" name="customLodgingTotal" value={formData.customLodgingTotal || ''} className="w-full bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs outline-none focus:border-yellow-500 transition-all" placeholder="Total Hébergement" onChange={handleChange} />}
                  {formData.isNegotiatedRate && <input disabled={isReadOnly} type="number" name="negotiatedPricePerNight" value={formData.negotiatedPricePerNight || ''} className="w-full bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all" placeholder="Prix par nuit" onChange={handleChange} />}
                  
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Versements</span>
                      {!isReadOnly && (
                        <button 
                          type="button" 
                          onClick={() => setFormData(prev => ({...prev, payments: [...prev.payments, { id: Date.now().toString(), date: getLocalDateString(), amount: 0, method: 'Espèces' }]}))} 
                          className="text-blue-600 hover:text-blue-700 font-black text-[10px] uppercase tracking-widest flex items-center gap-1"
                        >
                          <Plus size={12} /> Ajouter
                        </button>
                      )}
                    </div>
                    {formData.payments.map((p) => (
                      <div key={p.id} className="bg-gray-50 p-3 rounded-xl border border-gray-100 relative group">
                         {!isReadOnly && formData.payments.length > 1 && (
                           <button 
                            onClick={() => setFormData(prev => ({...prev, payments: prev.payments.filter(x => x.id !== p.id)}))} 
                            className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-all shadow-lg"
                           >
                             <X size={10} />
                           </button>
                         )}
                         <input disabled={isReadOnly} type="date" value={p.date} onChange={(e) => setFormData(prev => ({...prev, payments: prev.payments.map(x => x.id === p.id ? {...x, date: e.target.value} : x)}))} className="bg-transparent text-[10px] font-bold text-gray-400 mb-2 w-full outline-none" />
                         <div className="flex gap-2">
                          <input disabled={isReadOnly} type="number" value={p.amount || ''} placeholder="Montant" onChange={(e) => setFormData(prev => ({...prev, payments: prev.payments.map(x => x.id === p.id ? {...x, amount: parseFloat(e.target.value) || 0} : x)}))} className="bg-white border border-gray-200 rounded-lg p-2 flex-1 font-mono font-bold text-green-600 text-xs outline-none" />
                          <select disabled={isReadOnly} value={p.method} onChange={(e) => setFormData(prev => ({...prev, payments: prev.payments.map(x => x.id === p.id ? {...x, method: e.target.value} : x)}))} className="bg-white border border-gray-200 rounded-lg p-2 flex-1 text-[10px] outline-none appearance-none">{PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}</select>
                         </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Options Section */}
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <label className="flex items-center text-[10px] font-bold uppercase cursor-pointer select-none">
                      <input disabled={isReadOnly} type="checkbox" name="electricityCharge" checked={formData.electricityCharge} onChange={handleChange} className="mr-2 accent-blue-600" /> 
                      Élec client
                    </label>
                    <label className="flex items-center text-[10px] font-bold uppercase cursor-pointer select-none">
                      <input disabled={isReadOnly} type="checkbox" name="packEco" checked={formData.packEco} onChange={handleChange} className="mr-2 accent-green-600" /> 
                      Pack ECO
                    </label>
                    <label className="flex items-center text-[10px] font-bold uppercase cursor-pointer select-none">
                      <input disabled={isReadOnly} type="checkbox" name="packConfort" checked={formData.packConfort} onChange={handleChange} className="mr-2 accent-purple-600" /> 
                      Pack CONFORT
                    </label>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Contacts Utiles (Hôtes)</label>
                    <div className="grid grid-cols-1 gap-1.5">
                      {HOSTS.map(h => {
                        const isSelected = (formData.hosts || []).includes(h.label);
                        return (
                          <button
                            key={h.id}
                            type="button"
                            disabled={isReadOnly}
                            onClick={() => {
                              const current = formData.hosts || [];
                              const next = isSelected 
                                ? current.filter(x => x !== h.label)
                                : [...current, h.label];
                              setFormData(prev => ({ ...prev, hosts: next }));
                              
                              // Auto-set signature if empty
                              if (!formData.signature && next.length > 0) {
                                const firstHostName = next[0].split(' ')[0].toUpperCase();
                                setFormData(prev => ({ ...prev, signature: firstHostName, hosts: next }));
                              }
                            }}
                            className={`flex items-center justify-between p-2.5 rounded-xl border text-[10px] font-bold transition-all ${
                              isSelected 
                                ? 'bg-blue-50 border-blue-200 text-blue-700' 
                                : 'bg-white border-gray-100 text-gray-500 hover:border-gray-200'
                            }`}
                          >
                            <span>{h.label}</span>
                            {isSelected && <Check size={12} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Apporteur d'affaire (Agent)</label>
                    <div className="flex gap-2">
                      <input 
                        disabled={isReadOnly} 
                        type="text" 
                        name="agentName" 
                        value={formData.agentName || ''} 
                        placeholder="Nom de l'agent" 
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all disabled:opacity-50" 
                        onChange={handleChange} 
                      />
                      {formData.agentName && formData.commissionAmount > 0 && (
                        <div className="flex flex-col gap-2">
                          <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-2 flex flex-col justify-center">
                            <span className="text-[8px] font-black text-orange-400 uppercase leading-none">Commission</span>
                            <span className="text-[10px] font-mono font-bold text-orange-600">{formatCurrency(formData.commissionAmount)}</span>
                          </div>
                          <label className="flex items-center text-[9px] font-bold uppercase cursor-pointer select-none text-orange-600">
                            <input 
                              disabled={isReadOnly} 
                              type="checkbox" 
                              name="isCommissionPaid" 
                              checked={formData.isCommissionPaid || false} 
                              onChange={handleChange} 
                              className="mr-2 accent-orange-600" 
                            /> 
                            Payée
                          </label>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Signature (Gérant)</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {(formData.hosts || []).map(h => {
                        const name = h.split(' ')[0].toUpperCase();
                        return (
                          <button
                            key={h}
                            type="button"
                            disabled={isReadOnly}
                            onClick={() => setFormData(prev => ({ ...prev, signature: name }))}
                            className={`px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-widest transition-all ${
                              formData.signature === name 
                                ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-600/20' 
                                : 'bg-white border-gray-100 text-gray-400 hover:border-gray-200'
                            }`}
                          >
                            {name}
                          </button>
                        );
                      })}
                    </div>
                    <input disabled={isReadOnly} type="text" name="signature" value={formData.signature} placeholder="Signature (Nom)" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all disabled:opacity-50" onChange={handleChange} />
                  </div>
                  <textarea disabled={isReadOnly} name="observations" value={formData.observations} rows={2} placeholder="Observations particulières..." className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all disabled:opacity-50" onChange={handleChange}></textarea>
                  
                  {/* Mobile-only Preview Button */}
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={() => setIsSidebarOpen(false)}
                      className="md:hidden w-full bg-blue-600 text-white py-4 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2"
                    >
                      <Eye size={16} />
                      Voir l'aperçu
                    </button>
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
                setFormData(receipt);
                setIsReadOnly(true);
                setView('form');
              }}
              onPrint={(receipt) => {
                setFormData(receipt);
                setIsReadOnly(true);
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
                setFormData(receipt);
                setIsReadOnly(true);
                setView('form');
              }}
              onOpenCleaning={async (menageId, slug, date) => {
                const isMainAdmin = userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' || userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
                const isAdmin = userProfile?.role === 'admin' || isMainAdmin;
                
                const allowedSites = userProfile?.allowedSites || [];
                const allowedApartments = isAdmin ? Object.keys(TARIFS) : allowedSites.flatMap(site => SITE_MAPPING[site] || []);
                
                const isAllowed = allowedApartments.some(apt => TARIFS[apt]?.units?.includes(slug));
                
                if (!isAllowed) {
                  setAlertType('error');
                  setAlertMessage("Vous n'êtes pas autorisé à gérer le ménage pour ce logement.");
                  return;
                }

                // Check if report exists for this unit and date (regardless of menageId)
                const q = query(
                  collection(db, 'cleaning_reports'), 
                  where('calendarSlug', '==', slug),
                  where('dateIntervention', '==', date), 
                  limit(1)
                );
                const snap = await getDocs(q);
                const existing = !snap.empty ? snap.docs[0].data() as CleaningReport : null;
                
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
                    agent: '',
                    status: 'PRÉVU',
                    feedback: '',
                    damages: '',
                    maintenance: '',
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
          ) : (
            <>
              {/* Top Bar */}
              <header className="top-bar h-20 bg-white border-b border-gray-200 px-8 flex items-center justify-between sticky top-0 z-40 print:hidden">
              <div className="flex items-center gap-4">
                {!isSidebarOpen && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsSidebarOpen(true);
                    }} 
                    className="p-2 hover:bg-gray-100 rounded-xl transition-all"
                  >
                    <Menu size={20} />
                  </button>
                )}
                <div className="flex flex-col">
                  <h2 className="text-sm font-black uppercase tracking-widest">Aperçu du Reçu</h2>
                  <span className="text-[10px] font-mono text-gray-400 font-bold">{formData.receiptId}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 md:gap-3">
                {!isReadOnly ? (
                  <div className="flex gap-2">
                    {/* Mobile-only Edit Button to go back to sidebar */}
                    <button 
                      onClick={() => setIsSidebarOpen(true)} 
                      className="md:hidden flex items-center gap-2 px-4 py-3 bg-white border border-gray-200 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-gray-50 transition-all"
                    >
                      <Edit size={12}/> Modifier
                    </button>
                    <button 
                      onClick={saveToFirestore} 
                      disabled={isSaving || formData.status === 'ANNULE'} 
                      className={`flex items-center gap-2 px-4 md:px-6 py-3 rounded-xl font-black text-[10px] md:text-xs uppercase tracking-widest transition-all shadow-lg ${formData.status === 'ANNULE' ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : saveStatus === 'success' ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-600/20'}`}
                    >
                      {isSaving ? <Clock size={14} className="animate-spin"/> : saveStatus === 'success' ? <CheckCircle2 size={14}/> : <Save size={14}/>}
                      {isSaving ? 'Enregistrement...' : saveStatus === 'success' ? 'Enregistré' : 'Sauvegarder'}
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {(!formData.status || formData.status === 'VALIDE') && (
                      <button 
                        onClick={() => setIsReadOnly(false)} 
                        className="flex items-center gap-2 px-4 md:px-6 py-3 bg-orange-50 text-orange-600 rounded-xl font-black text-[10px] md:text-xs uppercase tracking-widest hover:bg-orange-100 transition-all"
                      >
                        <Edit size={14}/> Modifier
                      </button>
                    )}
                    <button 
                      onClick={() => { 
                        setFormData(getInitialState()); 
                        setIsReadOnly(false); 
                        setSearchId(''); 
                        setIsSidebarOpen(true);
                      }} 
                      className="flex items-center gap-2 px-4 md:px-6 py-3 bg-white border border-gray-200 rounded-xl font-black text-[10px] md:text-xs uppercase tracking-widest hover:bg-gray-50 transition-all"
                    >
                      <Plus size={14}/> Nouveau
                    </button>
                    {(!formData.status || formData.status === 'VALIDE') && (
                      <button 
                        onClick={() => setShowCancelConfirm(true)} 
                        className="flex items-center gap-2 px-4 md:px-6 py-3 bg-red-50 text-red-600 rounded-xl font-black text-[10px] md:text-xs uppercase tracking-widest hover:bg-red-100 transition-all"
                      >
                        <Trash2 size={14}/> Annuler
                      </button>
                    )}
                  </div>
                )}
                <button 
                  onClick={handlePrint} 
                  disabled={!isReadOnly}
                  className={`flex items-center gap-2 px-4 md:px-6 py-3 rounded-xl font-black text-[10px] md:text-xs uppercase tracking-widest transition-all shadow-xl ${!isReadOnly ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-[#141414] text-white hover:bg-gray-800 shadow-black/10'}`}
                >
                  <Printer size={14}/> Exporter PDF
                </button>
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
                      <ReceiptPreview data={debouncedFormData} />
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
                  onClick={() => {
                    if (pendingCleaningData.report) {
                      setCleaningReport(pendingCleaningData.report);
                      setIsCleaningReadOnly(true);
                      setIsCleaningMode(true);
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
                        agent: '',
                        status: 'PRÉVU',
                        feedback: '',
                        damages: '',
                        maintenance: '',
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
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
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
