/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  deleteDoc
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { TARIFS, PAYMENT_METHODS, HOSTS, getRateForApartment, formatCurrency } from './constants';
import { ReceiptData, CleaningReport, Payment, UserProfile, AuthorizedEmail } from './types';
import ReceiptPreview from './components/ReceiptPreview';
import HistoryView from './components/HistoryView';
import CalendarView from './components/CalendarView';
import UserManagement from './components/UserManagement';
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
  Calendar as CalendarIcon
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
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
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
    payments: [{ id: Date.now().toString(), date: new Date().toISOString().split('T')[0], amount: 0, method: 'Espèces' }],
    signature: '', hosts: [], electricityCharge: false, packEco: false, observations: '',
    status: 'VALIDE', grandTotal: 0, totalPaid: 0, remaining: 0,
    agentName: '', commissionAmount: 0, isCommissionPaid: false,
    createdAt: new Date().toISOString(),
    authorUid: auth.currentUser?.uid || ''
  });

  // --- STATES ---
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState<'form' | 'history' | 'calendar' | 'users'>('form');
  const [formData, setFormData] = useState<ReceiptData>(getInitialState());
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [searchId, setSearchId] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  
  const urlParams = new URLSearchParams(window.location.search);
  const [isCleaningMode, setIsCleaningMode] = useState(urlParams.has('menageId'));
  const [isReadOnly, setIsReadOnly] = useState(urlParams.has('id'));
  const [isCleaningReadOnly, setIsCleaningReadOnly] = useState(false);

  const [cleaningReport, setCleaningReport] = useState<CleaningReport>({
    menageId: urlParams.get('menageId') || '',
    calendarSlug: urlParams.get('slug') || '',
    dateIntervention: urlParams.get('date') || new Date().toISOString().split('T')[0],
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
      setUser(u);
      if (u) {
        try {
          const docRef = doc(db, 'users', u.uid);
          const snap = await getDoc(docRef);
          
          if (snap.exists()) {
            const profile = snap.data() as UserProfile;
            if (profile.isApproved) {
              setUserProfile(profile);
            } else {
              // Check whitelist if not approved yet
              const q = query(collection(db, 'authorized_emails'), where('email', '==', u.email?.toLowerCase()));
              const whiteSnap = await getDocs(q);
              if (!whiteSnap.empty || u.email === 'christian.yamepi@gmail.com') {
                const whiteData = whiteSnap.docs[0]?.data() as AuthorizedEmail;
                const updatedProfile = { 
                  ...profile, 
                  isApproved: true, 
                  role: u.email === 'christian.yamepi@gmail.com' ? 'admin' : (whiteData?.role || 'agent')
                };
                await setDoc(docRef, updatedProfile);
                setUserProfile(updatedProfile);
              } else {
                setUserProfile(profile);
              }
            }
          } else {
            const q = query(collection(db, 'authorized_emails'), where('email', '==', u.email?.toLowerCase()));
            const whiteSnap = await getDocs(q);
            const isMainAdmin = u.email === 'christian.yamepi@gmail.com';
            const isApproved = !whiteSnap.empty || isMainAdmin;
            const whiteData = whiteSnap.docs[0]?.data() as AuthorizedEmail;
            
            const newProfile: UserProfile = {
              uid: u.uid,
              email: u.email || '',
              displayName: u.displayName || 'Utilisateur',
              role: isMainAdmin ? 'admin' : (whiteData?.role || 'agent'),
              isApproved: isApproved
            };
            await setDoc(docRef, newProfile);
            setUserProfile(newProfile);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, 'users');
        }
      } else {
        setUserProfile(null);
      }
      setIsAuthReady(true);
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
      return { nights: 0, grandTotal: 0, totalPaid: 0, remaining: 0 };
    }
    const diffTime = new Date(formData.endDate).getTime() - new Date(formData.startDate).getTime();
    const nights = Math.max(0, Math.ceil(diffTime / (1000 * 3600 * 24)));
    const rates = getRateForApartment(formData.apartmentName, nights);
    const pricePerNight = formData.isNegotiatedRate ? (formData.negotiatedPricePerNight || 0) : rates.prix;
    const totalLodging = formData.isCustomRate ? formData.customLodgingTotal : (pricePerNight * nights);
    const grandTotal = totalLodging + rates.caution;
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
      commissionAmount
    };
  }, [formData]);

  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      grandTotal: totals.grandTotal,
      totalPaid: totals.totalPaid,
      remaining: totals.remaining,
      commissionAmount: totals.commissionAmount
    }));
  }, [totals]);

  const handlePrint = useCallback(() => {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = `${now.getHours()}h${now.getMinutes().toString().padStart(2, '0')}`;
    const name = `${formData.firstName}_${formData.lastName}`.toLowerCase().replace(/\s+/g, '_');
    const apartment = (formData.apartmentName || 'logement').toLowerCase().replace(/\s+/g, '_');
    const fileName = `reçu_${name}_${apartment}_${dateStr}_${timeStr}`;
    
    const originalTitle = document.title;
    document.title = fileName;
    window.print();
    // Restore title after print dialog opens
    setTimeout(() => {
      document.title = originalTitle;
    }, 1000);
  }, [formData.firstName, formData.lastName, formData.apartmentName]);

  // --- HANDLERS ---
  const handleChange = (e: any) => {
    if (isReadOnly) return;
    const { name, value, type, checked } = e.target;
    if (type === 'checkbox') {
      if (name === 'isCustomRate') setFormData(prev => ({ ...prev, isCustomRate: checked, isNegotiatedRate: checked ? false : prev.isNegotiatedRate }));
      else if (name === 'isNegotiatedRate') setFormData(prev => ({ ...prev, isNegotiatedRate: checked, isCustomRate: checked ? false : prev.isCustomRate }));
      else if (name === 'electricityCharge') setFormData(prev => ({ ...prev, electricityCharge: checked, packEco: checked ? false : prev.packEco }));
      else if (name === 'packEco') setFormData(prev => ({ ...prev, packEco: checked, electricityCharge: checked ? false : prev.electricityCharge }));
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
    if (cleaningReport.status !== 'PRÉVU' && !cleaningReport.agent) return alert("Nom agent requis");
    setIsSaving(true);
    try {
      // Create a unique deterministic ID if not already present
      const reportId = cleaningReport.id || `CR-${cleaningReport.menageId}-${cleaningReport.calendarSlug}-${cleaningReport.dateIntervention}`;
      await setDoc(doc(db, 'cleaning_reports', reportId), {
        ...cleaningReport,
        id: reportId,
        createdAt: new Date().toISOString()
      });
      alert("Rapport enregistré !");
      setIsCleaningMode(false);
      setView('calendar');
    } catch (e) { 
      handleFirestoreError(e, OperationType.WRITE, 'cleaning_reports');
      alert("Erreur d'enregistrement");
    } finally { 
      setIsSaving(false); 
    }
  };

  const saveToFirestore = async () => {
    if (isReadOnly) return;
    if (!formData.apartmentName || !formData.lastName) return alert("Remplir Nom et Logement");
    
    const apartmentData = TARIFS[formData.apartmentName];
    const units = apartmentData?.units || [];
    const finalSlug = units.length === 1 ? units[0] : formData.calendarSlug;
    if (units.length > 1 && !finalSlug) return alert("Précisez l'unité");

    setIsSaving(true);
    try {
      const docId = formData.id || formData.receiptId;
      await setDoc(doc(db, 'receipts', docId), {
        ...formData,
        id: docId,
        calendarSlug: finalSlug,
        authorUid: user?.uid,
        createdAt: formData.createdAt || new Date().toISOString(),
        status: formData.status || 'VALIDE'
      });
      setSaveStatus('success'); 
      setTimeout(() => setSaveStatus('idle'), 3000);
      setIsReadOnly(true);
    } catch (error) { 
      handleFirestoreError(error, OperationType.WRITE, 'receipts');
      setSaveStatus('error'); 
    } finally { 
      setIsSaving(false); 
    }
  };

  const handleNewReceipt = () => {
    setFormData(getInitialState());
    setIsReadOnly(false);
    setView('form');
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
        setSearchId(''); // Clear search after success
      } else {
        // Try original if it was different
        if (searchId !== id.trim()) {
          const q2 = query(collection(db, 'receipts'), where('receiptId', '==', id.trim()), limit(1));
          const snap2 = await getDocs(q2);
          if (!snap2.empty) {
            setFormData(snap2.docs[0].data() as ReceiptData);
            setIsReadOnly(true);
            setView('form');
            setSearchId('');
            return;
          }
        }
        alert("Reçu non trouvé");
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, 'receipts');
    } finally {
      setIsSaving(false);
    }
  };

  const softDeleteBooking = async () => {
    setIsSaving(true);
    try {
      await setDoc(doc(db, 'receipts', formData.id || formData.receiptId), {
        ...formData,
        status: 'ANNULE'
      }, { merge: true });
      setFormData(getInitialState()); 
      setIsReadOnly(false); 
      setShowCancelConfirm(false);
    } catch (e) { 
      handleFirestoreError(e, OperationType.UPDATE, 'receipts');
    } finally { 
      setIsSaving(false); 
    }
  };

  // --- RENDER CLEANING ---
  if (isCleaningMode) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] text-[#141414] p-6 font-sans flex flex-col items-center">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-white p-8 rounded-2xl border border-[#141414]/10 shadow-2xl"
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
              <div className="flex gap-4 mt-8">
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
            )}
          </div>
        </motion.div>
      </div>
    );
  }

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

  if (user && userProfile && !userProfile.isApproved) {
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
      {/* Sidebar */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="sidebar w-full md:w-80 bg-white border-b md:border-b-0 md:border-r border-gray-200 h-auto md:h-screen md:sticky md:top-0 flex flex-col z-50 print:hidden"
          >
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h1 className="text-2xl font-black italic tracking-tighter uppercase">YAMEHOME</h1>
              <button onClick={() => setIsSidebarOpen(false)} className="md:hidden"><X size={20}/></button>
            </div>

            <div className="px-6 py-4 border-b border-gray-100 space-y-2">
              <button 
                onClick={handleNewReceipt}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'form' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-400 hover:bg-gray-50'}`}
              >
                <Plus size={16} />
                Nouveau Reçu
              </button>
              <button 
                onClick={() => setView('history')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'history' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-400 hover:bg-gray-50'}`}
              >
                <History size={16} />
                Historique
              </button>
              <button 
                onClick={() => setView('calendar')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'calendar' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-400 hover:bg-gray-50'}`}
              >
                <CalendarIcon size={16} />
                Calendrier
              </button>
              {userProfile?.role === 'admin' && (
                <button 
                  onClick={() => setView('users')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'users' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-400 hover:bg-gray-50'}`}
                >
                  <Users size={16} />
                  Utilisateurs
                </button>
              )}
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
                    {Object.keys(TARIFS).map(key => <option key={key} value={key}>{key}</option>)}
                  </select>
                  
                  {TARIFS[formData.apartmentName]?.units && TARIFS[formData.apartmentName].units!.length > 1 && (
                    <select disabled={isReadOnly} name="calendarSlug" value={formData.calendarSlug} onChange={handleChange} className="w-full bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all disabled:opacity-50 appearance-none">
                      <option value="">-- Préciser l'unité --</option>
                      {TARIFS[formData.apartmentName].units!.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-400 uppercase ml-1">Arrivée</label>
                      <input disabled={isReadOnly} type="date" name="startDate" value={formData.startDate} className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none disabled:opacity-50" onChange={handleChange} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-400 uppercase ml-1">Départ</label>
                      <input disabled={isReadOnly} type="date" name="endDate" value={formData.endDate} className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none disabled:opacity-50" onChange={handleChange} />
                    </div>
                  </div>
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
                          onClick={() => setFormData(prev => ({...prev, payments: [...prev.payments, { id: Date.now().toString(), date: new Date().toISOString().split('T')[0], amount: 0, method: 'Espèces' }]}))} 
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
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Contacts Utiles (Hôtes)</label>
                    <select disabled={isReadOnly} name="hosts" multiple value={formData.hosts || []} onChange={handleChange} className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-[10px] h-32 outline-none focus:border-blue-500 transition-all">
                      {HOSTS.map(h => <option key={h.id} value={h.label} className="p-1">{h.label}</option>)}
                    </select>
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

                  <input disabled={isReadOnly} type="text" name="signature" value={formData.signature} placeholder="Signature (Nom)" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all disabled:opacity-50" onChange={handleChange} />
                  <textarea disabled={isReadOnly} name="observations" value={formData.observations} rows={2} placeholder="Observations particulières..." className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all disabled:opacity-50" onChange={handleChange}></textarea>
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
        {view === 'history' ? (
          <HistoryView 
            onEdit={(receipt) => {
              setFormData(receipt);
              setIsReadOnly(false);
              setView('form');
            }}
            onPrint={(receipt) => {
              setFormData(receipt);
              setIsReadOnly(true);
              setView('form');
              // Use a slightly longer timeout to ensure state update and title change
              setTimeout(() => {
                const now = new Date();
                const dateStr = now.toISOString().split('T')[0];
                const timeStr = `${now.getHours()}h${now.getMinutes().toString().padStart(2, '0')}`;
                const name = `${receipt.firstName}_${receipt.lastName}`.toLowerCase().replace(/\s+/g, '_');
                const apartment = (receipt.apartmentName || 'logement').toLowerCase().replace(/\s+/g, '_');
                const fileName = `reçu_${name}_${apartment}_${dateStr}_${timeStr}`;
                
                const originalTitle = document.title;
                document.title = fileName;
                window.print();
                setTimeout(() => { document.title = originalTitle; }, 1000);
              }, 600);
            }}
          />
        ) : view === 'calendar' ? (
          <CalendarView 
            onEdit={(receipt) => {
              setFormData(receipt);
              setIsReadOnly(false);
              setView('form');
            }}
            onOpenCleaning={async (menageId, slug, date) => {
              // Check if report exists for this unit and date (regardless of menageId)
              const q = query(
                collection(db, 'cleaning_reports'), 
                where('calendarSlug', '==', slug),
                where('dateIntervention', '==', date), 
                limit(1)
              );
              const snap = await getDocs(q);
              
              if (!snap.empty) {
                const existing = snap.docs[0].data() as CleaningReport;
                // Warning as requested by user
                alert(`Note : Un rapport de ménage existe déjà pour ${slug} le ${date}. Vous allez consulter/modifier le rapport existant.`);
                setCleaningReport(existing);
                setIsCleaningReadOnly(true);
              } else {
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
              }
              setIsCleaningMode(true);
            }}
          />
        ) : view === 'users' ? (
          <UserManagement />
        ) : (
          <>
            {/* Top Bar */}
            <header className="top-bar h-20 bg-white border-b border-gray-200 px-8 flex items-center justify-between sticky top-0 z-40 print:hidden">
              <div className="flex items-center gap-4">
                {!isSidebarOpen && (
                  <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-gray-100 rounded-xl transition-all">
                    <Menu size={20} />
                  </button>
                )}
                <div className="flex flex-col">
                  <h2 className="text-sm font-black uppercase tracking-widest">Aperçu du Reçu</h2>
                  <span className="text-[10px] font-mono text-gray-400 font-bold">{formData.receiptId}</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {!isReadOnly ? (
                  <button 
                    onClick={saveToFirestore} 
                    disabled={isSaving || formData.status === 'ANNULE'} 
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-lg ${formData.status === 'ANNULE' ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : saveStatus === 'success' ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-600/20'}`}
                  >
                    {isSaving ? <Clock size={14} className="animate-spin"/> : saveStatus === 'success' ? <CheckCircle2 size={14}/> : <Save size={14}/>}
                    {isSaving ? 'Enregistrement...' : saveStatus === 'success' ? 'Enregistré' : 'Sauvegarder'}
                  </button>
                ) : (
                  <div className="flex gap-2">
                    {(!formData.status || formData.status === 'VALIDE') && (
                      <button 
                        onClick={() => setIsReadOnly(false)} 
                        className="flex items-center gap-2 px-6 py-3 bg-orange-50 text-orange-600 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-orange-100 transition-all"
                      >
                        <Edit size={14}/> Modifier
                      </button>
                    )}
                    <button 
                      onClick={() => { setFormData(getInitialState()); setIsReadOnly(false); setSearchId(''); }} 
                      className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-200 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-50 transition-all"
                    >
                      <Plus size={14}/> Nouveau
                    </button>
                    {userProfile?.role === 'admin' && (!formData.status || formData.status === 'VALIDE') && (
                      <button 
                        onClick={() => setShowCancelConfirm(true)} 
                        className="flex items-center gap-2 px-6 py-3 bg-red-50 text-red-600 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-red-100 transition-all"
                      >
                        <Trash2 size={14}/> Annuler
                      </button>
                    )}
                  </div>
                )}
                <button 
                  onClick={handlePrint} 
                  className="flex items-center gap-2 px-6 py-3 bg-[#141414] text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-800 transition-all shadow-xl shadow-black/10"
                >
                  <Printer size={14}/> Exporter PDF
                </button>
              </div>
            </header>

            {/* Preview Area */}
            <main className="receipt-viewer-main flex-1 overflow-y-auto bg-[#F5F5F4] p-4 md:p-8 flex justify-center scroll-smooth print:bg-white print:p-0 print:overflow-visible">
              <motion.div 
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="receipt-motion-wrapper w-full max-w-[210mm] print:m-0 print:p-0 print:max-w-none"
              >
                <div className="mobile-receipt-container w-full flex justify-center overflow-hidden md:overflow-visible">
                  <div className="mobile-receipt-zoom origin-top transition-transform">
                    <ReceiptPreview data={formData} />
                  </div>
                </div>
              </motion.div>
            </main>
          </>
        )}
      </div>
      {/* Modals */}
      <AnimatePresence>
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
      </AnimatePresence>
    </div>
  );
}
