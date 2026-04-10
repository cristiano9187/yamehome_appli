import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, onSnapshot, orderBy, query, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { Prospect, ProspectSource, ProspectStatus, UserProfile } from '../types';
import { SITE_MAPPING, TARIFS } from '../constants';
import { Menu, Save, Search, ArrowRightLeft, UserRound } from 'lucide-react';
import { motion } from 'motion/react';
import DateRangePicker from './DateRangePicker';

interface ProspectsViewProps {
  onMenuClick?: () => void;
  userProfile: UserProfile | null;
  onAlert: (message: string, type?: 'info' | 'error' | 'success') => void;
  onConvert: (prospect: Prospect) => void;
}

const STATUS_OPTIONS: ProspectStatus[] = ['NOUVEAU', 'A_RELANCER', 'EN_NEGOCIATION', 'CONVERTI', 'PERDU', 'ANNULE'];
const SOURCE_OPTIONS: ProspectSource[] = ['FACEBOOK', 'AIRBNB', 'BOOKING', 'TELEPHONE', 'WHATSAPP', 'AUTRE'];

const getLocalDateString = (date: Date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getEmptyProspect = (uid: string): Prospect => ({
  source: 'AUTRE',
  status: 'NOUVEAU',
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  apartmentName: '',
  calendarSlug: '',
  startDate: '',
  endDate: '',
  totalStayPrice: 0,
  guestCount: 1,
  budget: 0,
  assignedTo: '',
  nextFollowUpDate: getLocalDateString(),
  notes: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  authorUid: uid
});

export default function ProspectsView({ onMenuClick, userProfile, onAlert, onConvert }: ProspectsViewProps) {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState<Prospect>(getEmptyProspect(userProfile?.uid || ''));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'prospects'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as Prospect[];
        setProspects(data);
        setLoading(false);
      },
      (error) => {
        console.error('Error loading prospects:', error);
        setLoading(false);
        onAlert("Impossible de charger les prospects (droits Firestore ou connexion).", 'error');
      }
    );
    return unsubscribe;
  }, [onAlert]);

  const filteredProspects = useMemo(() => {
    const isMainAdmin = userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' || userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
    const isAdmin = userProfile?.role === 'admin' || isMainAdmin;
    const allowedSites = userProfile?.allowedSites || [];
    const allowedApartments = isAdmin ? [] : allowedSites.flatMap(site => SITE_MAPPING[site] || []);

    return prospects.filter((p) => {
      const textMatch = `${p.firstName} ${p.lastName} ${p.phone} ${p.source} ${p.status} ${p.apartmentName || ''}`
        .toLowerCase()
        .includes(searchTerm.toLowerCase());
      const aptAllowed = !p.apartmentName || isAdmin || allowedApartments.includes(p.apartmentName);
      return textMatch && aptAllowed;
    });
  }, [prospects, searchTerm, userProfile]);

  const allowedApartments = useMemo(() => {
    if (!userProfile) return [];
    const isMainAdmin = userProfile.email?.toLowerCase() === 'christian.yamepi@gmail.com' || userProfile.email?.toLowerCase() === 'cyamepi@gmail.com';
    if (userProfile.role === 'admin' || isMainAdmin) return Object.keys(TARIFS);
    const sites = userProfile.allowedSites || [];
    return sites.flatMap((site) => SITE_MAPPING[site] || []);
  }, [userProfile]);

  const resetForm = () => {
    setFormData(getEmptyProspect(userProfile?.uid || ''));
    setEditingId(null);
  };

  const selectedApartmentUnits = useMemo(() => {
    if (!formData.apartmentName) return [];
    return TARIFS[formData.apartmentName]?.units || [];
  }, [formData.apartmentName]);

  const handleSave = async () => {
    if (!formData.lastName || !formData.phone) {
      onAlert('Nom et téléphone sont requis pour enregistrer un prospect.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const { id: _ignoredId, ...baseData } = formData;

      if (editingId) {
        const payload = {
          ...baseData,
          totalStayPrice: formData.totalStayPrice || 0,
          updatedAt: new Date().toISOString(),
          // Keep original creator to satisfy rules and audit trail.
          authorUid: formData.authorUid || ''
        };
        await updateDoc(doc(db, 'prospects', editingId), payload);
        onAlert('Prospect mis à jour.', 'success');
      } else {
        const payload = {
          ...baseData,
          totalStayPrice: formData.totalStayPrice || 0,
          updatedAt: new Date().toISOString(),
          authorUid: userProfile?.uid || ''
        };
        await addDoc(collection(db, 'prospects'), {
          ...payload,
          createdAt: new Date().toISOString()
        });
        onAlert('Prospect créé.', 'success');
      }
      resetForm();
    } catch (error) {
      console.error('Error saving prospect:', error);
      onAlert("Erreur lors de l'enregistrement du prospect.", 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (prospect: Prospect) => {
    setEditingId(prospect.id || null);
    setFormData({
      ...prospect,
      calendarSlug: prospect.calendarSlug || '',
      totalStayPrice: prospect.totalStayPrice || 0,
      guestCount: prospect.guestCount || 1,
      budget: prospect.budget || 0
    });
  };

  const handleQuickStatus = async (prospect: Prospect, status: ProspectStatus) => {
    if (!prospect.id) return;
    try {
      await updateDoc(doc(db, 'prospects', prospect.id), { status, updatedAt: new Date().toISOString() });
    } catch (error) {
      console.error('Error updating status:', error);
      onAlert('Impossible de mettre a jour le statut.', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F5F5F4]">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col md:h-full bg-[#F5F5F4] md:overflow-hidden">
      <div className="h-auto md:h-20 bg-white border-b border-gray-200 px-4 md:px-8 py-4 md:py-0 flex flex-col md:flex-row items-start md:items-center justify-between sticky top-0 z-40 gap-4">
        <div className="flex items-center gap-4">
          {onMenuClick && (
            <button onClick={onMenuClick} className="md:hidden p-2 hover:bg-gray-100 rounded-xl transition-all">
              <Menu size={20} />
            </button>
          )}
          <div className="flex flex-col">
            <h2 className="text-sm font-black uppercase tracking-widest">Prospects</h2>
            <span className="text-[10px] font-mono text-gray-400 font-bold">{filteredProspects.length} en suivi</span>
          </div>
        </div>

        <div className="relative w-full md:w-96">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder="Rechercher un prospect..."
            className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-12 pr-4 text-xs outline-none focus:border-blue-500 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 md:overflow-y-auto p-4 md:p-8">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 bg-white rounded-2xl border border-gray-200 p-4 md:p-6 shadow-sm space-y-3">
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-500">
              {editingId ? 'Modifier Prospect' : 'Nouveau Prospect'}
            </h3>

            <div className="grid grid-cols-2 gap-2">
              <input className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs" placeholder="Prenom" value={formData.firstName} onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))} />
              <input className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs" placeholder="Nom*" value={formData.lastName} onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs" placeholder="Telephone*" value={formData.phone} onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))} />
              <input className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs" placeholder="Email" value={formData.email} onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs" value={formData.source} onChange={(e) => setFormData(prev => ({ ...prev, source: e.target.value as ProspectSource }))}>
                {SOURCE_OPTIONS.map((source) => <option key={source} value={source}>{source}</option>)}
              </select>
              <select className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs" value={formData.status} onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value as ProspectStatus }))}>
                {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
            <select className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs" value={formData.apartmentName || ''} onChange={(e) => {
              const nextApartment = e.target.value;
              const units = nextApartment ? (TARIFS[nextApartment]?.units || []) : [];
              setFormData(prev => ({
                ...prev,
                apartmentName: nextApartment,
                calendarSlug: units.length === 1 ? units[0] : ''
              }));
            }}>
              <option value="">Logement cible (optionnel)</option>
              {allowedApartments.map((apt) => <option key={apt} value={apt}>{apt}</option>)}
            </select>
            {selectedApartmentUnits.length > 1 && (
              <select
                className="w-full bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs"
                value={formData.calendarSlug || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, calendarSlug: e.target.value }))}
              >
                <option value="">-- Préciser l'unité --</option>
                {selectedApartmentUnits.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            )}

            <DateRangePicker
              startDate={formData.startDate || ''}
              endDate={formData.endDate || ''}
              onChange={(start, end) => setFormData(prev => ({ ...prev, startDate: start, endDate: end }))}
            />
            <input
              type="number"
              className="w-full bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs"
              placeholder="Prix total séjour (optionnel)"
              value={formData.totalStayPrice || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, totalStayPrice: parseFloat(e.target.value) || 0 }))}
            />
            <textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs" rows={3} placeholder="Notes, besoin client, contexte..." value={formData.notes || ''} onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}></textarea>

            <div className="flex gap-2">
              <button onClick={handleSave} disabled={isSaving} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50">
                <Save size={14} />
                {isSaving ? 'Enregistrement...' : editingId ? 'Mettre a jour' : 'Enregistrer'}
              </button>
              <button onClick={resetForm} className="px-4 py-3 bg-gray-100 hover:bg-gray-200 rounded-xl text-[10px] font-black uppercase tracking-widest">
                Reset
              </button>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-3">
            {filteredProspects.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-gray-400 text-sm">
                Aucun prospect pour le moment.
              </div>
            )}

            {filteredProspects.map((prospect) => (
              <motion.div key={prospect.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white rounded-2xl border border-gray-200 p-4 md:p-5 shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <UserRound size={14} className="text-gray-400" />
                      <span className="text-sm font-black uppercase tracking-tight">{`${prospect.firstName || ''} ${prospect.lastName || ''}`.trim() || 'Sans nom'}</span>
                      <span className="text-[10px] px-2 py-1 rounded-lg bg-gray-100 font-black uppercase">{prospect.source}</span>
                      <span className="text-[10px] px-2 py-1 rounded-lg bg-blue-50 text-blue-700 font-black uppercase">{prospect.status}</span>
                    </div>
                    <p className="text-xs text-gray-600">
                      {prospect.phone || 'Pas de telephone'} {prospect.apartmentName ? `- ${prospect.apartmentName}` : ''} {prospect.calendarSlug ? `(${prospect.calendarSlug})` : ''}
                    </p>
                    {(prospect.startDate || prospect.endDate || (prospect.totalStayPrice || 0) > 0) && (
                      <p className="text-[11px] text-gray-500">
                        {prospect.startDate && prospect.endDate ? `${prospect.startDate} -> ${prospect.endDate}` : 'Dates a definir'}
                        {(prospect.totalStayPrice || 0) > 0 ? ` - ${prospect.totalStayPrice} FCFA` : ''}
                      </p>
                    )}
                    <p className="text-[11px] text-gray-400">{prospect.notes || 'Aucune note'}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => handleEdit(prospect)} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-[10px] font-black uppercase tracking-widest">Editer</button>
                    {prospect.status !== 'CONVERTI' && (
                      <>
                        <button onClick={() => handleQuickStatus(prospect, 'A_RELANCER')} className="px-3 py-2 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 rounded-xl text-[10px] font-black uppercase tracking-widest">Relance</button>
                        <button onClick={() => handleQuickStatus(prospect, 'EN_NEGOCIATION')} className="px-3 py-2 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-xl text-[10px] font-black uppercase tracking-widest">Negociation</button>
                        <button
                          onClick={() => onConvert(prospect)}
                          className="px-3 py-2 bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1"
                        >
                          <ArrowRightLeft size={12} />
                          Convertir
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
