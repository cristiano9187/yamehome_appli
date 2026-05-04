import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, onSnapshot, orderBy, query, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { Prospect, ProspectSource, ProspectStatus, UserProfile } from '../types';
import { SITE_MAPPING, TARIFS } from '../constants';
import {
  ArrowRightLeft, Building2, CalendarDays, Globe, HelpCircle, Home,
  Menu, MessageCircle, Phone, Save, Search, UserRound, Users,
} from 'lucide-react';
import { motion } from 'motion/react';
import DateRangePicker from './DateRangePicker';

interface ProspectsViewProps {
  onMenuClick?: () => void;
  userProfile: UserProfile | null;
  onAlert: (message: string, type?: 'info' | 'error' | 'success') => void;
  onConvert: (prospect: Prospect) => void;
}

const STATUS_OPTIONS: ProspectStatus[] = ['NOUVEAU', 'EN_NEGOCIATION', 'CONVERTI', 'PERDU'];

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string; pill: string }> = {
  NOUVEAU:        { label: 'Nouveau',   bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500',    pill: 'bg-blue-600 text-white' },
  EN_NEGOCIATION: { label: 'En négo',  bg: 'bg-purple-50',  text: 'text-purple-700',  dot: 'bg-purple-500',  pill: 'bg-purple-600 text-white' },
  CONVERTI:       { label: 'Converti', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', pill: 'bg-emerald-600 text-white' },
  PERDU:          { label: 'Perdu',    bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-400',     pill: 'bg-red-500 text-white' },
  A_RELANCER:     { label: 'À relancer', bg: 'bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-400',  pill: 'bg-yellow-500 text-white' },
  ANNULE:         { label: 'Annulé',   bg: 'bg-gray-100',   text: 'text-gray-500',    dot: 'bg-gray-400',    pill: 'bg-gray-400 text-white' },
};

const SOURCE_CONFIG: Record<ProspectSource, { label: string; bg: string; color: string; icon: React.ReactNode }> = {
  BOOKING:   { label: 'Booking',  bg: 'bg-blue-600',  color: 'text-white', icon: <Globe size={11} /> },
  AIRBNB:    { label: 'Airbnb',   bg: 'bg-rose-500',  color: 'text-white', icon: <Home size={11} /> },
  FACEBOOK:  { label: 'Facebook', bg: 'bg-blue-800',  color: 'text-white', icon: <Users size={11} /> },
  WHATSAPP:  { label: 'WhatsApp', bg: 'bg-green-500', color: 'text-white', icon: <MessageCircle size={11} /> },
  TELEPHONE: { label: 'Tél.',     bg: 'bg-gray-500',  color: 'text-white', icon: <Phone size={11} /> },
  SITE_WEB:  { label: 'Site web', bg: 'bg-amber-600', color: 'text-white', icon: <Globe size={11} /> },
  AUTRE:     { label: 'Autre',    bg: 'bg-gray-400',  color: 'text-white', icon: <HelpCircle size={11} /> },
};

const SOURCE_OPTIONS: ProspectSource[] = ['FACEBOOK', 'AIRBNB', 'BOOKING', 'SITE_WEB', 'TELEPHONE', 'WHATSAPP', 'AUTRE'];

function normalizePhone(raw: string): { tel: string; wa: string } {
  if (!raw) return { tel: '', wa: '' };
  const digits = raw.replace(/[\s\-\.\(\)]/g, '');
  let international = digits;
  if (digits.startsWith('00')) international = '+' + digits.slice(2);
  else if (digits.startsWith('237') && !digits.startsWith('+')) international = '+' + digits;
  else if (!digits.startsWith('+')) international = '+237' + digits;
  const waDigits = international.replace(/[^\d]/g, '');
  return { tel: international, wa: waDigits };
}

const getLocalDateString = (date: Date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
  authorUid: uid,
});

export default function ProspectsView({ onMenuClick, userProfile, onAlert, onConvert }: ProspectsViewProps) {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProspectStatus | 'TOUS'>('TOUS');
  const [apartmentFilter, setApartmentFilter] = useState('');
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
        onAlert('Impossible de charger les prospects (droits Firestore ou connexion).', 'error');
      }
    );
    return unsubscribe;
  }, [onAlert]);

  const isAdminUser = useMemo(() => {
    const isMainAdmin =
      userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' ||
      userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
    return userProfile?.role === 'admin' || isMainAdmin;
  }, [userProfile]);

  const allowedApartmentsList = useMemo(() => {
    if (!userProfile) return [];
    if (isAdminUser) return Object.keys(TARIFS);
    return (userProfile.allowedSites || []).flatMap((site) => SITE_MAPPING[site] || []);
  }, [userProfile, isAdminUser]);

  const filteredProspects = useMemo(() => {
    const allowedApts = isAdminUser
      ? []
      : (userProfile?.allowedSites || []).flatMap((site) => SITE_MAPPING[site] || []);

    return prospects.filter((p) => {
      const textMatch = `${p.firstName} ${p.lastName} ${p.phone} ${p.source} ${p.status} ${p.apartmentName || ''}`
        .toLowerCase()
        .includes(searchTerm.toLowerCase());
      const aptAllowed = !p.apartmentName || isAdminUser || allowedApts.includes(p.apartmentName);
      const statusMatch = statusFilter === 'TOUS' || p.status === statusFilter;
      const aptFilterMatch = !apartmentFilter || p.apartmentName === apartmentFilter;
      return textMatch && aptAllowed && statusMatch && aptFilterMatch;
    });
  }, [prospects, searchTerm, statusFilter, apartmentFilter, userProfile, isAdminUser]);

  const statusCounts = useMemo(
    () =>
      STATUS_OPTIONS.reduce((acc, s) => {
        acc[s] = prospects.filter((p) => p.status === s).length;
        return acc;
      }, {} as Record<string, number>),
    [prospects]
  );

  const resetForm = () => {
    setFormData(getEmptyProspect(userProfile?.uid || ''));
    setEditingId(null);
  };

  const selectedApartmentUnits = useMemo(
    () => (formData.apartmentName ? TARIFS[formData.apartmentName]?.units || [] : []),
    [formData.apartmentName]
  );

  const handleSave = async () => {
    if (!formData.lastName || !formData.phone) {
      onAlert('Nom et téléphone sont requis pour enregistrer un prospect.', 'error');
      return;
    }
    setIsSaving(true);
    try {
      const { id: _id, ...baseData } = formData;
      const payload = {
        ...baseData,
        totalStayPrice: formData.totalStayPrice || 0,
        updatedAt: new Date().toISOString(),
        authorUid: formData.authorUid || userProfile?.uid || '',
      };
      if (editingId) {
        await updateDoc(doc(db, 'prospects', editingId), payload);
        onAlert('Prospect mis à jour.', 'success');
      } else {
        await addDoc(collection(db, 'prospects'), { ...payload, createdAt: new Date().toISOString() });
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
      budget: prospect.budget || 0,
    });
  };

  const handleQuickStatus = async (prospect: Prospect, status: ProspectStatus) => {
    if (!prospect.id) return;
    try {
      await updateDoc(doc(db, 'prospects', prospect.id), { status, updatedAt: new Date().toISOString() });
    } catch (error) {
      console.error('Error updating status:', error);
      onAlert('Impossible de mettre à jour le statut.', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F5F5F4]">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col md:h-full bg-[#F5F5F4] md:overflow-hidden">
      {/* ── Header ── */}
      <div className="h-auto md:h-20 bg-white border-b border-gray-200 px-4 md:px-8 py-4 md:py-0 flex flex-col md:flex-row items-start md:items-center justify-between sticky top-0 z-40 gap-4">
        <div className="flex items-center gap-4">
          {onMenuClick && (
            <button onClick={onMenuClick} className="md:hidden p-2 hover:bg-gray-100 rounded-xl transition-all">
              <Menu size={20} />
            </button>
          )}
          <div className="flex flex-col">
            <h2 className="text-sm font-black uppercase tracking-widest">Prospects</h2>
            <span className="text-[10px] font-mono text-gray-400 font-bold">
              {filteredProspects.length} en suivi
            </span>
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

          {/* ── Formulaire ── */}
          <div className="lg:col-span-1 bg-white rounded-2xl border border-gray-200 p-4 md:p-6 shadow-sm space-y-3">
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-500">
              {editingId ? 'Modifier Prospect' : 'Nouveau Prospect'}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <input
                className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs"
                placeholder="Prénom"
                value={formData.firstName}
                onChange={(e) => setFormData((p) => ({ ...p, firstName: e.target.value }))}
              />
              <input
                className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs"
                placeholder="Nom *"
                value={formData.lastName}
                onChange={(e) => setFormData((p) => ({ ...p, lastName: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs"
                placeholder="Téléphone *"
                value={formData.phone}
                onChange={(e) => setFormData((p) => ({ ...p, phone: e.target.value }))}
              />
              <input
                className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs"
                placeholder="Email"
                value={formData.email}
                onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs"
                value={formData.source}
                onChange={(e) => setFormData((p) => ({ ...p, source: e.target.value as ProspectSource }))}
              >
                {SOURCE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{SOURCE_CONFIG[s].label}</option>
                ))}
              </select>
              <select
                className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs"
                value={formData.status}
                onChange={(e) => setFormData((p) => ({ ...p, status: e.target.value as ProspectStatus }))}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                ))}
              </select>
            </div>
            <select
              className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs"
              value={formData.apartmentName || ''}
              onChange={(e) => {
                const next = e.target.value;
                const units = next ? TARIFS[next]?.units || [] : [];
                setFormData((p) => ({ ...p, apartmentName: next, calendarSlug: units.length === 1 ? units[0] : '' }));
              }}
            >
              <option value="">Logement cible (optionnel)</option>
              {allowedApartmentsList.map((apt) => <option key={apt} value={apt}>{apt}</option>)}
            </select>
            {selectedApartmentUnits.length > 1 && (
              <select
                className="w-full bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs"
                value={formData.calendarSlug || ''}
                onChange={(e) => setFormData((p) => ({ ...p, calendarSlug: e.target.value }))}
              >
                <option value="">-- Préciser l'unité --</option>
                {selectedApartmentUnits.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            )}
            <DateRangePicker
              startDate={formData.startDate || ''}
              endDate={formData.endDate || ''}
              onChange={(start, end) => setFormData((p) => ({ ...p, startDate: start, endDate: end }))}
            />
            <input
              type="number"
              className="w-full bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs"
              placeholder="Prix total séjour (optionnel)"
              value={formData.totalStayPrice || ''}
              onChange={(e) => setFormData((p) => ({ ...p, totalStayPrice: parseFloat(e.target.value) || 0 }))}
            />
            <textarea
              className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs"
              rows={3}
              placeholder="Notes, besoin client, contexte..."
              value={formData.notes || ''}
              onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))}
            />
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Save size={14} />
                {isSaving ? 'Enregistrement...' : editingId ? 'Mettre à jour' : 'Enregistrer'}
              </button>
              <button
                onClick={resetForm}
                className="px-4 py-3 bg-gray-100 hover:bg-gray-200 rounded-xl text-[10px] font-black uppercase tracking-widest"
              >
                Reset
              </button>
            </div>
          </div>

          {/* ── Liste ── */}
          <div className="lg:col-span-2 space-y-3">

            {/* Filtres */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setStatusFilter('TOUS')}
                className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  statusFilter === 'TOUS'
                    ? 'bg-gray-800 text-white'
                    : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                Tous ({prospects.length})
              </button>

              {STATUS_OPTIONS.map((s) => {
                const cfg = STATUS_CONFIG[s];
                const active = statusFilter === s;
                return (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(active ? 'TOUS' : s)}
                    className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${
                      active
                        ? cfg.pill
                        : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-white/70' : cfg.dot}`} />
                    {cfg.label}
                    {statusCounts[s] > 0 && (
                      <span className={`${active ? 'opacity-80' : 'text-gray-400'}`}>
                        ({statusCounts[s]})
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Filtre logement */}
              <select
                className="ml-auto bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-[10px] font-bold text-gray-600 outline-none focus:border-blue-400 transition-all"
                value={apartmentFilter}
                onChange={(e) => setApartmentFilter(e.target.value)}
              >
                <option value="">Tous logements</option>
                {allowedApartmentsList.map((apt) => <option key={apt} value={apt}>{apt}</option>)}
              </select>
            </div>

            {filteredProspects.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-gray-400 text-sm">
                Aucun prospect pour le moment.
              </div>
            )}

            {filteredProspects.map((prospect) => {
              const sCfg = STATUS_CONFIG[prospect.status] || STATUS_CONFIG['NOUVEAU'];
              const srcCfg = SOURCE_CONFIG[prospect.source] || SOURCE_CONFIG['AUTRE'];
              const { tel, wa } = normalizePhone(prospect.phone || '');
              const price = prospect.totalStayPrice || 0;

              return (
                <motion.div
                  key={prospect.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-2xl border border-gray-200 p-4 md:p-5 shadow-sm"
                >
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div className="space-y-1.5 min-w-0">

                      {/* Nom + source + statut */}
                      <div className="flex flex-wrap items-center gap-2">
                        <UserRound size={14} className="text-gray-400 shrink-0" />
                        <span className="text-sm font-black uppercase tracking-tight">
                          {`${prospect.firstName || ''} ${prospect.lastName || ''}`.trim() || 'Sans nom'}
                        </span>

                        {/* Badge source */}
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black ${srcCfg.bg} ${srcCfg.color}`}>
                          {srcCfg.icon}
                          {srcCfg.label}
                        </span>

                        {/* Badge statut */}
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black ${sCfg.bg} ${sCfg.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sCfg.dot}`} />
                          {sCfg.label}
                        </span>
                      </div>

                      {/* Téléphone cliquable */}
                      {prospect.phone && (
                        <div className="flex items-center gap-2">
                          <a
                            href={`tel:${tel}`}
                            className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white px-2.5 py-1 rounded-xl text-xs font-bold transition-colors"
                          >
                            <Phone size={11} />
                            {prospect.phone}
                          </a>
                          <a
                            href={`https://wa.me/${wa}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] font-black transition-colors"
                          >
                            <MessageCircle size={11} />
                            WA
                          </a>
                        </div>
                      )}

                      {/* Logement */}
                      {prospect.apartmentName && (
                        <p className="text-xs text-gray-500 flex items-center gap-1">
                          <Building2 size={11} className="text-gray-400 shrink-0" />
                          {prospect.apartmentName}
                          {prospect.calendarSlug ? ` · ${prospect.calendarSlug}` : ''}
                        </p>
                      )}

                      {/* Dates de séjour */}
                      {(prospect.startDate || prospect.endDate) && (
                        <div className="inline-flex items-center gap-1.5 bg-slate-800 px-2.5 py-1 rounded-xl">
                          <CalendarDays size={11} className="text-slate-400 shrink-0" />
                          <span className="text-xs font-bold text-white tracking-wide">
                            {prospect.startDate && prospect.endDate
                              ? `${prospect.startDate} → ${prospect.endDate}`
                              : prospect.startDate
                              ? `Dès ${prospect.startDate}`
                              : `Jusqu'au ${prospect.endDate}`}
                          </span>
                        </div>
                      )}

                      {/* Prix */}
                      {price > 0 && (
                        <div className="inline-flex items-center gap-1 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-xl">
                          <span className="text-xs font-black text-amber-700">
                            {price.toLocaleString('fr-FR')} FCFA
                          </span>
                        </div>
                      )}

                      {/* Notes */}
                      {prospect.notes && (
                        <p className="text-[11px] text-gray-400 italic line-clamp-1">{prospect.notes}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <button
                        onClick={() => handleEdit(prospect)}
                        className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-[10px] font-black uppercase tracking-widest"
                      >
                        Éditer
                      </button>
                      {prospect.status !== 'CONVERTI' && prospect.status !== 'PERDU' && (
                        <>
                          {prospect.status !== 'EN_NEGOCIATION' && (
                            <button
                              onClick={() => handleQuickStatus(prospect, 'EN_NEGOCIATION')}
                              className="px-3 py-2 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-xl text-[10px] font-black uppercase tracking-widest"
                            >
                              En négo
                            </button>
                          )}
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
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
