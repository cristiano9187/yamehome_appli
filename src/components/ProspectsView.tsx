import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  deleteDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Prospect, ProspectSource, ProspectStatus, ReceiptData, UserProfile } from '../types';
import { SITE_MAPPING, TARIFS } from '../constants';
import { getReceiptSegments } from '../utils/receiptSegments';
import {
  apartmentNameForUnitSlug,
  buildProspectsByCell,
  resolveProspectUnitSlug,
  ymdAddDays,
} from '../utils/prospectPlanning';
import {
  embedProformaDraftInNotes,
  parseProformaDraftJson,
  stripProformaDraftFromNotes,
} from '../utils/proformaProspectDraft';
import {
  ArrowRightLeft,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  Globe,
  HelpCircle,
  Home,
  LayoutGrid,
  LayoutList,
  Menu,
  MessageCircle,
  Phone,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import DateRangePicker from './DateRangePicker';

interface ProspectsViewProps {
  onMenuClick?: () => void;
  userProfile: UserProfile | null;
  onAlert: (message: string, type?: 'info' | 'error' | 'success') => void;
  onConvert: (prospect: Prospect) => void;
  /** Ouvre le formulaire en mode proforma (PDF sans bloquer le calendrier). */
  onProforma: (prospect: Prospect) => void;
}

const ALL_STATUSES: ProspectStatus[] = [
  'NOUVEAU',
  'EN_NEGOCIATION',
  'CONVERTI',
  'PERDU',
  'ANNULE',
];

const STATUS_CONFIG: Record<
  ProspectStatus,
  { label: string; bg: string; text: string; dot: string; pill: string }
> = {
  NOUVEAU: {
    label: 'Nouveau',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    dot: 'bg-blue-500',
    pill: 'bg-blue-600 text-white',
  },
  EN_NEGOCIATION: {
    label: 'En négo',
    bg: 'bg-purple-50',
    text: 'text-purple-700',
    dot: 'bg-purple-500',
    pill: 'bg-purple-600 text-white',
  },
  CONVERTI: {
    label: 'Converti',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
    pill: 'bg-emerald-600 text-white',
  },
  PERDU: {
    label: 'Perdu',
    bg: 'bg-red-50',
    text: 'text-red-700',
    dot: 'bg-red-400',
    pill: 'bg-red-500 text-white',
  },
  A_RELANCER: {
    label: 'À relancer',
    bg: 'bg-yellow-50',
    text: 'text-yellow-700',
    dot: 'bg-yellow-400',
    pill: 'bg-yellow-500 text-white',
  },
  ANNULE: {
    label: 'Annulé',
    bg: 'bg-gray-100',
    text: 'text-gray-500',
    dot: 'bg-gray-400',
    pill: 'bg-gray-400 text-white',
  },
};

const SOURCE_CONFIG: Record<ProspectSource, { label: string; bg: string; color: string; icon: React.ReactNode }> = {
  BOOKING: { label: 'Booking', bg: 'bg-blue-600', color: 'text-white', icon: <Globe size={11} /> },
  AIRBNB: { label: 'Airbnb', bg: 'bg-rose-500', color: 'text-white', icon: <Home size={11} /> },
  FACEBOOK: { label: 'Facebook', bg: 'bg-blue-800', color: 'text-white', icon: <Users size={11} /> },
  WHATSAPP: { label: 'WhatsApp', bg: 'bg-green-500', color: 'text-white', icon: <MessageCircle size={11} /> },
  TELEPHONE: { label: 'Tél.', bg: 'bg-gray-500', color: 'text-white', icon: <Phone size={11} /> },
  SITE_WEB: { label: 'Site web', bg: 'bg-amber-600', color: 'text-white', icon: <Globe size={11} /> },
  AUTRE: { label: 'Autre', bg: 'bg-gray-400', color: 'text-white', icon: <HelpCircle size={11} /> },
};

const SOURCE_OPTIONS: ProspectSource[] = [
  'FACEBOOK',
  'AIRBNB',
  'BOOKING',
  'SITE_WEB',
  'TELEPHONE',
  'WHATSAPP',
  'AUTRE',
];

/** Manque dates et/ou unité → pas placé sur la grille planning. */
function isProspectIncomplete(p: Prospect): boolean {
  const missingDates = !(p.startDate || '').trim() || !(p.endDate || '').trim();
  const missingUnit = !resolveProspectUnitSlug(p);
  return missingDates || missingUnit;
}

function incompleteHints(p: Prospect): string[] {
  const hints: string[] = [];
  if (!(p.startDate || '').trim() || !(p.endDate || '').trim()) hints.push('dates');
  if (!resolveProspectUnitSlug(p)) hints.push('unité');
  return hints;
}

function formatStayRange(start?: string, end?: string): string {
  if (!(start || '').trim()) return 'Dates non définies';
  const fmt = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number);
    if (!y || !m || !d) return ymd;
    return new Date(y, m - 1, d).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
    });
  };
  if (!(end || '').trim()) return `Dès ${fmt(start!)}`;
  return `${fmt(start!)} → ${fmt(end!)}`;
}

function prospectDisplayName(p: Prospect): string {
  return `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Sans nom';
}

function compareProspectsForList(a: Prospect, b: Prospect): number {
  const aStart = (a.startDate || '').trim();
  const bStart = (b.startDate || '').trim();
  if (aStart && bStart && aStart !== bStart) return aStart.localeCompare(bStart);
  if (aStart && !bStart) return -1;
  if (!aStart && bStart) return 1;
  return (b.updatedAt || '').localeCompare(a.updatedAt || '');
}

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

function getBookingForUnitAndDay(receipts: ReceiptData[], unitSlug: string, dateStr: string) {
  return receipts.find((r) => {
    if (r.status === 'ANNULE') return false;
    return getReceiptSegments(r).some(
      (s) =>
        (s.calendarSlug || '').trim() === unitSlug &&
        dateStr >= s.startDate &&
        dateStr < s.endDate
    );
  });
}

export default function ProspectsView({ onMenuClick, userProfile, onAlert, onConvert, onProforma }: ProspectsViewProps) {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [receipts, setReceipts] = useState<ReceiptData[]>([]);
  const [loadingProspects, setLoadingProspects] = useState(true);
  const [loadingReceipts, setLoadingReceipts] = useState(true);
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [searchTerm, setSearchTerm] = useState('');
  /** Vide = tous les statuts visibles ; sinon filtre OU sur les statuts choisis */
  const [selectedStatuses, setSelectedStatuses] = useState<ProspectStatus[]>([]);
  /** Prospects sans dates ou sans unité (absents de la grille) */
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(false);
  const [apartmentFilter, setApartmentFilter] = useState('');
  const [formData, setFormData] = useState<Prospect>(getEmptyProspect(userProfile?.uid || ''));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [expandedUnitSlug, setExpandedUnitSlug] = useState<string | null>(null);
  const [cellPanel, setCellPanel] = useState<{
    unitSlug: string;
    dateStr: string;
    prospects: Prospect[];
  } | null>(null);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  /** Mobile : liste par défaut ; grille planning en option. Desktop ignore ce mode. */
  const [mobileViewMode, setMobileViewMode] = useState<'list' | 'grid'>('list');
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const apply = () => setIsNarrowViewport(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    const handleClickOutside = () => setExpandedUnitSlug(null);
    window.addEventListener('pointerdown', handleClickOutside);
    return () => window.removeEventListener('pointerdown', handleClickOutside);
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'prospects'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as Prospect[];
        setProspects(data);
        setLoadingProspects(false);
      },
      (error) => {
        console.error('Error loading prospects:', error);
        setLoadingProspects(false);
        onAlert('Impossible de charger les prospects (droits Firestore ou connexion).', 'error');
      }
    );
    return unsubscribe;
  }, [onAlert]);

  useEffect(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDayStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    setLoadingReceipts(true);
    const qReceipts = query(collection(db, 'receipts'), where('endDate', '>=', firstDayStr));
    const unsub = onSnapshot(
      qReceipts,
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ ...d.data(), id: d.id })) as ReceiptData[];
        setReceipts(data.filter((r) => r.status !== 'ANNULE'));
        setLoadingReceipts(false);
      },
      (error) => {
        console.error('Error loading receipts for prospects grid:', error);
        setLoadingReceipts(false);
        onAlert('Impossible de charger les réservations pour le planning prospects.', 'error');
      }
    );
    return unsub;
  }, [currentDate.getMonth(), currentDate.getFullYear(), onAlert]);

  const loading = loadingProspects || loadingReceipts;

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

  const toggleStatusFilter = (s: ProspectStatus) => {
    setSelectedStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const filteredProspects = useMemo(() => {
    const allowedApts = isAdminUser
      ? []
      : (userProfile?.allowedSites || []).flatMap((site) => SITE_MAPPING[site] || []);

    return prospects.filter((p) => {
      const textMatch = `${p.firstName} ${p.lastName} ${p.phone} ${p.source} ${p.status} ${p.apartmentName || ''} ${p.calendarSlug || ''}`
        .toLowerCase()
        .includes(searchTerm.toLowerCase());
      const aptAllowed = !p.apartmentName || isAdminUser || allowedApts.includes(p.apartmentName);
      const statusMatch =
        selectedStatuses.length === 0 || selectedStatuses.includes(p.status);
      const aptFilterMatch = !apartmentFilter || p.apartmentName === apartmentFilter;
      const incompleteMatch = !showIncompleteOnly || isProspectIncomplete(p);
      return textMatch && aptAllowed && statusMatch && aptFilterMatch && incompleteMatch;
    });
  }, [prospects, searchTerm, selectedStatuses, apartmentFilter, showIncompleteOnly, userProfile, isAdminUser]);

  const incompleteCount = useMemo(
    () => prospects.filter((p) => isProspectIncomplete(p)).length,
    [prospects]
  );

  const listProspects = useMemo(
    () => [...filteredProspects].sort(compareProspectsForList),
    [filteredProspects]
  );

  const activeFilterCount =
    selectedStatuses.length + (apartmentFilter ? 1 : 0) + (showIncompleteOnly ? 1 : 0);

  const showMobileList =
    isNarrowViewport && (mobileViewMode === 'list' || showIncompleteOnly);

  const monthBounds = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthFirst = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastD = new Date(year, month + 1, 0).getDate();
    const monthLast = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`;
    return { monthFirst, monthLast };
  }, [currentDate]);

  const daysInMonth = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const days: Date[] = [];
    for (let i = 1; i <= totalDays; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  }, [currentDate]);

  const daysYmd = useMemo(
    () =>
      daysInMonth.map((d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }),
    [daysInMonth]
  );

  const allUnits = useMemo(() => {
    const units: { slug: string; category: string; color: string; site: string; shortName: string }[] = [];

    const SITE_COLORS: Record<string, string> = {
      RIETI: 'bg-emerald-500',
      MODENA: 'bg-blue-500',
      MATERA: 'bg-orange-500',
      GALLAGHERS: 'bg-purple-500',
      BGT: 'bg-purple-500',
      DEFAULT: 'bg-gray-500',
    };

    const SITE_NAMES: Record<string, string> = {
      RIETI: 'Rieti',
      MODENA: 'Modena',
      MATERA: 'Matera',
      GALLAGHERS: 'Gallagers',
      BGT: 'Gallagers',
      DEFAULT: 'Autres',
    };

    Object.entries(TARIFS).forEach(([category, data]) => {
      const isMainAdmin =
        userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' ||
        userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
      const isAdmin = userProfile?.role === 'admin' || isMainAdmin;
      const allowedSites = userProfile?.allowedSites || [];
      const allowedApartments = isAdmin ? [] : allowedSites.flatMap((site) => SITE_MAPPING[site] || []);
      const isAllowed = isAdmin || allowedApartments.includes(category);
      if (!isAllowed) return;

      const upperCategory = category.toUpperCase();
      let siteKey = 'DEFAULT';
      if (upperCategory.includes('RIETI')) siteKey = 'RIETI';
      else if (upperCategory.includes('MODENA')) siteKey = 'MODENA';
      else if (upperCategory.includes('MATERA')) siteKey = 'MATERA';
      else if (upperCategory.includes('GALLAGHERS') || upperCategory.includes('CITY')) siteKey = 'GALLAGHERS';

      const color = SITE_COLORS[siteKey] || SITE_COLORS.DEFAULT;
      const siteName = SITE_NAMES[siteKey] || SITE_NAMES.DEFAULT;

      let shortName = category;
      if (category.includes(' - ')) {
        shortName = category
          .split(' - ')[1]
          .replace('APPARTEMENT ', '')
          .replace('STUDIO ', '')
          .replace('CHAMBRE ', '')
          .replace('mode STUDIO', '(Studio)')
          .trim();
      }

      if (data.units) {
        data.units.forEach((slug) => {
          if (!units.find((u) => u.slug === slug)) {
            let refinedShortName = shortName;
            if (slug.includes('superior')) refinedShortName = 'Americain Sup';
            else if (slug.includes('studio') && !slug.includes('superior')) refinedShortName = 'Americain';
            else if (slug.includes('chambre-a')) refinedShortName = 'Chambre Std A';
            else if (slug.includes('chambre-b')) refinedShortName = 'Chambre Std B';
            else if (slug.includes('standard-a')) refinedShortName = 'Chambre A';
            else if (slug.includes('standard-b')) refinedShortName = 'Chambre B';
            else if (slug.includes('standard-c')) refinedShortName = 'Chambre C';
            else if (slug.includes('cuisine')) refinedShortName = 'Chambre Cuisine';
            else if (slug.includes('deluxe')) refinedShortName = 'Deluxe';
            else if (slug.includes('emeraude')) refinedShortName = 'Emeraude';
            else if (slug.includes('terracotta')) refinedShortName = 'Terracotta';
            else if (slug.includes('haut-standing')) refinedShortName = 'Haut Standing';

            units.push({ slug, category, color, site: siteName, shortName: refinedShortName });
          }
        });
      } else {
        const slug = category.toLowerCase();
        if (!units.find((u) => u.slug === slug)) {
          units.push({ slug, category, color, site: siteName, shortName });
        }
      }
    });

    const SITE_PRIORITY: Record<string, number> = {
      Matera: 1,
      Rieti: 2,
      Modena: 3,
      Gallagers: 4,
      Autres: 5,
    };

    return units.sort((a, b) => {
      const pA = SITE_PRIORITY[a.site] || 99;
      const pB = SITE_PRIORITY[b.site] || 99;
      if (pA !== pB) return pA - pB;
      return a.shortName.localeCompare(b.shortName);
    });
  }, [userProfile]);

  const groupedUnits = useMemo(() => {
    const groups: { site: string; color: string; units: typeof allUnits }[] = [];
    allUnits.forEach((unit) => {
      let group = groups.find((g) => g.site === unit.site);
      if (!group) {
        group = { site: unit.site, color: unit.color, units: [] };
        groups.push(group);
      }
      group.units.push(unit);
    });
    return groups;
  }, [allUnits]);

  const unitSlugList = useMemo(() => allUnits.map((u) => u.slug), [allUnits]);

  const prospectsByCell = useMemo(
    () => buildProspectsByCell(filteredProspects, unitSlugList, daysYmd),
    [filteredProspects, unitSlugList, daysYmd]
  );

  // Garde le panneau cellule aligné sur les données live (évite de rouvrir un proforma périmé).
  useEffect(() => {
    if (!cellPanel) return;
    const list = prospectsByCell.get(`${cellPanel.unitSlug}|${cellPanel.dateStr}`) || [];
    setCellPanel((prev) => {
      if (!prev) return prev;
      if (prev.unitSlug !== cellPanel.unitSlug || prev.dateStr !== cellPanel.dateStr) return prev;
      const same =
        prev.prospects.length === list.length &&
        prev.prospects.every(
          (p, i) => p.id === list[i]?.id && p.updatedAt === list[i]?.updatedAt
        );
      if (same) return prev;
      return { ...prev, prospects: list };
    });
  }, [prospects, cellPanel?.unitSlug, cellPanel?.dateStr, prospectsByCell]);

  const statusCounts = useMemo(() => {
    const acc = {} as Record<ProspectStatus, number>;
    for (const s of Object.keys(STATUS_CONFIG) as ProspectStatus[]) acc[s] = 0;
    for (const p of prospects) {
      if (acc[p.status] !== undefined) acc[p.status]++;
    }
    return acc;
  }, [prospects]);

  const monthName = currentDate.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
  const nextMonth = () =>
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  const prevMonth = () =>
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));

  const resetForm = () => {
    setFormData(getEmptyProspect(userProfile?.uid || ''));
    setEditingId(null);
  };

  const openNewProspectForm = (partial?: Partial<Prospect>) => {
    setEditingId(null);
    setFormData({
      ...getEmptyProspect(userProfile?.uid || ''),
      ...partial,
      authorUid: userProfile?.uid || '',
    });
    setFormOpen(true);
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

    const units = formData.apartmentName ? TARIFS[formData.apartmentName]?.units || [] : [];
    if (units.length > 1 && !(formData.calendarSlug || '').trim()) {
      onAlert('Ce logement a plusieurs unités : précisez l’unité pour placer le prospect sur la grille.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const { id: _id, ...baseData } = formData;
      const live = editingId ? prospects.find((p) => p.id === editingId) : undefined;
      const { draft: draftFromNotes } = stripProformaDraftFromNotes(live?.notes || '');
      const draft = parseProformaDraftJson(live?.proformaDraft) || draftFromNotes;
      const notes = draft
        ? embedProformaDraftInNotes(formData.notes || '', draft)
        : formData.notes || '';
      const payload = {
        ...baseData,
        notes,
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
      setFormOpen(false);
      setCellPanel(null);
    } catch (error) {
      console.error('Error saving prospect:', error);
      onAlert("Erreur lors de l'enregistrement du prospect.", 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (prospect: Prospect) => {
    const { cleanNotes } = stripProformaDraftFromNotes(prospect.notes || '');
    setEditingId(prospect.id || null);
    setFormData({
      ...prospect,
      notes: cleanNotes,
      calendarSlug: prospect.calendarSlug || '',
      totalStayPrice: prospect.totalStayPrice || 0,
      guestCount: prospect.guestCount || 1,
      budget: prospect.budget || 0,
    });
    setFormOpen(true);
    setCellPanel(null);
  };

  const handleQuickStatus = async (prospect: Prospect, status: ProspectStatus) => {
    if (!prospect.id) return;
    try {
      await updateDoc(doc(db, 'prospects', prospect.id), {
        status,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error updating status:', error);
      onAlert('Impossible de mettre à jour le statut.', 'error');
    }
  };

  const handleDeleteProspect = async (prospect: Prospect) => {
    if (!isAdminUser || !prospect.id) return;
    const label = `${prospect.firstName || ''} ${prospect.lastName || ''}`.trim() || 'ce prospect';
    const ok = window.confirm(
      `Supprimer définitivement « ${label} » ?\n\nUtile pour les doublons. Cette action est irréversible.`
    );
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'prospects', prospect.id));
      if (editingId === prospect.id) {
        resetForm();
        setFormOpen(false);
      }
      setCellPanel((prev) => {
        if (!prev) return prev;
        const next = prev.prospects.filter((p) => p.id !== prospect.id);
        if (next.length === 0) return null;
        return { ...prev, prospects: next };
      });
      onAlert('Prospect supprimé.', 'success');
    } catch (error) {
      console.error('Error deleting prospect:', error);
      onAlert('Suppression impossible (droits ou connexion).', 'error');
    }
  };

  const openCell = (unitSlug: string, dateStr: string) => {
    const list = prospectsByCell.get(`${unitSlug}|${dateStr}`) || [];
    if (list.length > 0) {
      setCellPanel({ unitSlug, dateStr, prospects: list });
    } else {
      const apt = apartmentNameForUnitSlug(unitSlug);
      openNewProspectForm({
        calendarSlug: unitSlug,
        apartmentName: apt,
        startDate: dateStr,
        endDate: ymdAddDays(dateStr, 1),
      });
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
    <div className="flex-1 flex flex-col min-h-0 max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:overflow-hidden md:h-full bg-[#F5F5F4] md:overflow-hidden">
      <div className="shrink-0 bg-white border-b border-gray-200 max-md:z-[100] max-md:shadow-[0_8px_20px_-12px_rgba(0,0,0,0.18)]">
        {/* Mobile header compact */}
        <div className="md:hidden px-3 pt-3 pb-2 space-y-2">
          <div className="flex items-center gap-2">
            {onMenuClick && (
              <button type="button" onClick={onMenuClick} className="p-2 -ml-1 hover:bg-gray-100 rounded-xl shrink-0">
                <Menu size={20} />
              </button>
            )}
            <h2 className="text-sm font-black uppercase tracking-widest shrink-0">Prospects</h2>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => openNewProspectForm()}
              className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest shrink-0"
            >
              <Plus size={14} />
              Nouveau
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
              <input
                type="text"
                placeholder="Rechercher…"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 pl-9 pr-3 text-xs outline-none focus:border-blue-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={() => setFiltersExpanded((v) => !v)}
              className={`relative p-2.5 rounded-xl border shrink-0 ${
                filtersExpanded || activeFilterCount > 0
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
              aria-label="Filtres"
              title="Filtres"
            >
              <SlidersHorizontal size={16} />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[9px] font-black flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {!showIncompleteOnly && (
              <div className="flex items-center bg-gray-100 rounded-xl p-0.5 shrink-0 border border-gray-200">
                <button
                  type="button"
                  onClick={() => setMobileViewMode('list')}
                  className={`p-2 rounded-lg transition-all ${
                    mobileViewMode === 'list' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400'
                  }`}
                  aria-label="Vue liste"
                  title="Liste"
                >
                  <LayoutList size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setMobileViewMode('grid')}
                  className={`p-2 rounded-lg transition-all ${
                    mobileViewMode === 'grid' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400'
                  }`}
                  aria-label="Vue grille"
                  title="Grille planning"
                >
                  <LayoutGrid size={16} />
                </button>
              </div>
            )}
          </div>

          {(filtersExpanded || mobileViewMode === 'grid') && (
            <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-xl border border-gray-200 w-fit max-w-full">
              <button type="button" onClick={prevMonth} className="p-1.5 hover:bg-white rounded-lg text-gray-600">
                <ChevronLeft size={16} />
              </button>
              <span className="px-2 text-[10px] font-black uppercase text-gray-700 min-w-[7.5rem] text-center truncate">
                {monthName}
              </span>
              <button type="button" onClick={nextMonth} className="p-1.5 hover:bg-white rounded-lg text-gray-600">
                <ChevronRight size={16} />
              </button>
            </div>
          )}

          {filtersExpanded && (
            <div className="space-y-2 pb-1">
              <div className="overflow-x-auto overscroll-x-contain touch-pan-x [-webkit-overflow-scrolling:touch] flex items-center gap-2 flex-nowrap pb-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStatuses([]);
                    setShowIncompleteOnly(false);
                  }}
                  className={`shrink-0 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${
                    selectedStatuses.length === 0 && !showIncompleteOnly
                      ? 'bg-gray-800 text-white'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  Tous ({prospects.length})
                </button>
                <button
                  type="button"
                  onClick={() => setShowIncompleteOnly((v) => !v)}
                  className={`shrink-0 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 ${
                    showIncompleteOnly
                      ? 'bg-amber-500 text-white'
                      : 'bg-white text-amber-800 border border-amber-200'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${showIncompleteOnly ? 'bg-white' : 'bg-amber-500'}`} />
                  À compléter
                  {incompleteCount > 0 && <span>({incompleteCount})</span>}
                </button>
                {ALL_STATUSES.map((s) => {
                  const cfg = STATUS_CONFIG[s];
                  const active = selectedStatuses.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleStatusFilter(s)}
                      className={`shrink-0 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 ${
                        selectedStatuses.length > 0 && active
                          ? cfg.pill
                          : 'bg-white text-gray-500 border border-gray-200'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                      {cfg.label}
                      {statusCounts[s] > 0 && <span className="opacity-80">({statusCounts[s]})</span>}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <select
                  className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2 text-[10px] font-bold text-gray-600 outline-none"
                  value={apartmentFilter}
                  onChange={(e) => setApartmentFilter(e.target.value)}
                >
                  <option value="">Tous logements</option>
                  {allowedApartmentsList.map((apt) => (
                    <option key={apt} value={apt}>
                      {apt}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] font-mono text-gray-400 whitespace-nowrap">
                  {filteredProspects.length} affiché{filteredProspects.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Desktop header (inchangé) */}
        <div className="hidden md:block">
          <div className="h-20 bg-white px-8 flex items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex flex-col min-w-0">
                <h2 className="text-sm font-black uppercase tracking-widest">Prospects</h2>
                <span className="text-[10px] font-mono text-gray-400 font-bold uppercase truncate">{monthName}</span>
              </div>
              <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-xl border border-gray-200">
                <button type="button" onClick={prevMonth} className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-gray-600">
                  <ChevronLeft size={18} />
                </button>
                <span className="px-3 text-[10px] font-black uppercase text-gray-700 min-w-[120px] text-center">{monthName}</span>
                <button type="button" onClick={nextMonth} className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-gray-600">
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 flex-1 justify-end">
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Rechercher…"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 pl-10 pr-3 text-xs outline-none focus:border-blue-500 transition-all"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={() => openNewProspectForm()}
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-2.5 text-[10px] font-black uppercase tracking-widest shrink-0"
              >
                <Plus size={14} />
                Nouveau
              </button>
            </div>
          </div>
          <div className="bg-white px-8 py-3 flex flex-col gap-3 border-b border-gray-200">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 shrink-0">Statuts</span>
              <div className="flex-1 min-w-0 overflow-x-auto flex items-center gap-2 flex-nowrap [scrollbar-width:thin]">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStatuses([]);
                    setShowIncompleteOnly(false);
                  }}
                  className={`shrink-0 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    selectedStatuses.length === 0 && !showIncompleteOnly
                      ? 'bg-gray-800 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Tous ({prospects.length})
                </button>
                <button
                  type="button"
                  onClick={() => setShowIncompleteOnly((v) => !v)}
                  className={`shrink-0 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${
                    showIncompleteOnly
                      ? 'bg-amber-500 text-white'
                      : 'bg-white text-amber-800 border border-amber-200 hover:bg-amber-50'
                  }`}
                  title="Prospects sans dates ou sans unité — absents de la grille"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${showIncompleteOnly ? 'bg-white' : 'bg-amber-500'}`} />
                  À compléter
                  {incompleteCount > 0 && <span className="opacity-90">({incompleteCount})</span>}
                </button>
                {ALL_STATUSES.map((s) => {
                  const cfg = STATUS_CONFIG[s];
                  const active = selectedStatuses.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleStatusFilter(s)}
                      className={`shrink-0 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${
                        selectedStatuses.length > 0 && active
                          ? cfg.pill
                          : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                      {cfg.label}
                      {statusCounts[s] > 0 && <span className="opacity-80">({statusCounts[s]})</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-end">
              <select
                className="bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-[10px] font-bold text-gray-600 outline-none focus:border-blue-400"
                value={apartmentFilter}
                onChange={(e) => setApartmentFilter(e.target.value)}
              >
                <option value="">Tous logements</option>
                {allowedApartmentsList.map((apt) => (
                  <option key={apt} value={apt}>
                    {apt}
                  </option>
                ))}
              </select>
              <span className="text-[10px] font-mono text-gray-400 whitespace-nowrap">
                {filteredProspects.length} affiché{filteredProspects.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Contenu : liste mobile / À compléter / grille */}
      {showMobileList ? (
        <div
          className={`flex-1 min-h-0 overflow-auto overscroll-contain px-3 py-3 md:px-8 md:py-5 ${
            showIncompleteOnly ? 'bg-amber-50/40' : 'bg-[#F5F5F4]'
          }`}
        >
          {!filtersExpanded && (
            <p className="text-[10px] font-mono text-gray-400 mb-2 px-0.5">
              {filteredProspects.length} affiché{filteredProspects.length !== 1 ? 's' : ''}
              {activeFilterCount > 0 ? ' · filtres actifs' : ''}
            </p>
          )}
          {showIncompleteOnly && (
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-900 mb-3">
              À compléter — dates ou unité manquantes
            </p>
          )}
          {listProspects.length === 0 ? (
            <p className="text-sm text-gray-500 py-12 text-center">Aucun prospect avec ces filtres.</p>
          ) : (
            <ul className="space-y-2">
              {listProspects.map((p) => {
                const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.NOUVEAU;
                const src = SOURCE_CONFIG[p.source] || SOURCE_CONFIG.AUTRE;
                const incomplete = isProspectIncomplete(p);
                const hints = incomplete ? incompleteHints(p) : [];
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => handleEdit(p)}
                      className={`w-full text-left rounded-2xl bg-white px-4 py-3.5 shadow-sm border transition-all active:scale-[0.99] ${
                        incomplete ? 'border-amber-200' : 'border-gray-100'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-bold text-gray-900 leading-snug truncate">
                            {prospectDisplayName(p)}
                          </p>
                          <p className="text-[12px] text-gray-500 mt-1 flex items-center gap-1.5">
                            <CalendarDays size={12} className="shrink-0 text-gray-400" />
                            <span className="truncate">{formatStayRange(p.startDate, p.endDate)}</span>
                          </p>
                          {(p.apartmentName || p.calendarSlug) && (
                            <p className="text-[11px] text-gray-400 mt-1 truncate font-medium">
                              {p.apartmentName || p.calendarSlug}
                              {p.calendarSlug && p.apartmentName ? ` · ${p.calendarSlug}` : ''}
                            </p>
                          )}
                          {p.phone ? (
                            <p className="text-[11px] text-gray-400 mt-0.5 font-mono truncate">{p.phone}</p>
                          ) : null}
                          {incomplete && (
                            <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 mt-2">
                              Manque : {hints.join(' · ')}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg ${cfg.pill}`}>
                            {cfg.label}
                          </span>
                          <span
                            className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${src.bg} ${src.color}`}
                          >
                            {src.label}
                          </span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : showIncompleteOnly ? (
        <div className="flex-1 min-h-0 overflow-auto overscroll-contain bg-amber-50/40 px-4 py-4 md:px-8 md:py-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-900 mb-3">
            À compléter — dates ou unité manquantes ({filteredProspects.length})
          </p>
          {filteredProspects.length === 0 ? (
            <p className="text-sm text-amber-800/80 py-8 text-center">Aucun prospect incomplet avec ces filtres.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {filteredProspects.map((p) => {
                const hints = incompleteHints(p);
                const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.NOUVEAU;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => handleEdit(p)}
                      className="w-full text-left rounded-xl bg-white border border-amber-200 hover:border-amber-400 px-4 py-3 shadow-sm transition-all"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-bold text-gray-900 leading-snug">{prospectDisplayName(p)}</span>
                        <span className={`shrink-0 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg ${cfg.pill}`}>
                          {cfg.label}
                        </span>
                      </div>
                      {p.phone ? <p className="text-[11px] text-gray-500 mt-1 font-mono">{p.phone}</p> : null}
                      <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 mt-2">
                        Manque : {hints.join(' · ')}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
      <div
        className="flex-1 min-h-0 overflow-auto overscroll-contain relative touch-pan-x touch-pan-y isolate md:overflow-auto"
        ref={scrollContainerRef}
      >
        <table className="w-full border-collapse table-fixed min-w-[calc(5rem+31*5rem)] md:min-w-[2600px]">
          <thead className="[&_tr]:bg-zinc-900">
            <tr className="text-white">
              <th className="w-[80px] md:w-64 sticky left-0 top-0 z-[110] bg-zinc-900 border-b border-r border-white/10 p-2 md:p-4 text-left text-[8px] md:text-[10px] font-black uppercase tracking-widest text-gray-400 shadow-[4px_0_12px_-2px_rgba(0,0,0,0.25)]">
                Unités
              </th>
              {daysInMonth.map((date) => {
                const isToday = date.toDateString() === new Date().toDateString();
                const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                const headBg = isToday ? 'bg-blue-950' : isWeekend ? 'bg-zinc-800' : 'bg-zinc-900';
                return (
                  <th
                    key={date.toISOString()}
                    id={isToday ? 'prospects-today-column' : undefined}
                    className={`sticky top-0 z-[45] w-[5rem] min-w-[5rem] md:w-[5.5rem] md:min-w-[5.5rem] border-b border-white/10 p-1.5 md:p-2 text-center ${headBg}`}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={`text-[11px] md:text-[10px] font-black ${isToday ? 'text-blue-400' : 'text-white'}`}>
                        {date.getDate()}
                      </span>
                      <span className={`text-[9px] md:text-[8px] uppercase font-bold ${isToday ? 'text-blue-300' : 'text-gray-400'}`}>
                        {date.toLocaleString('fr-FR', { weekday: 'short' })}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {groupedUnits.map((group) => (
              <React.Fragment key={group.site}>
                {group.units.map((unit) => (
                  <tr key={unit.slug} className="group hover:bg-gray-50/50 transition-all">
                    <td
                      className={`sticky left-0 ${expandedUnitSlug === unit.slug ? 'z-[35]' : 'z-[25]'} bg-white border-r border-b border-gray-100 p-0 group-hover:bg-gray-50 transition-all w-[80px] md:w-64 shadow-[6px_0_14px_-6px_rgba(0,0,0,0.12)]`}
                    >
                      <div className="flex h-full items-stretch relative">
                        <div className={`w-1 md:w-6 flex items-center justify-center ${group.color} relative`}>
                          <span className="hidden md:block text-[8px] font-black text-white uppercase tracking-widest -rotate-90 whitespace-nowrap origin-center">
                            {group.site}
                          </span>
                        </div>
                        <div
                          className="flex-1 flex flex-col justify-center p-2 md:p-3 overflow-hidden cursor-pointer"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            setExpandedUnitSlug(expandedUnitSlug === unit.slug ? null : unit.slug);
                          }}
                        >
                          <span className="text-[9px] md:text-[11px] font-black uppercase tracking-tight text-gray-900 truncate">
                            {unit.shortName}
                          </span>
                          <span className="text-[7px] md:text-[8px] font-bold text-gray-400 uppercase tracking-widest truncate">
                            {unit.slug}
                          </span>
                        </div>
                        {expandedUnitSlug === unit.slug && (
                          <div className="absolute left-[calc(100%-4px)] top-1/2 -translate-y-1/2 w-56 md:w-72 bg-white shadow-2xl rounded-xl p-3 md:p-4 z-[100] border-2 border-amber-500 animate-in fade-in zoom-in duration-200 pointer-events-none">
                            <div className="flex flex-col gap-1">
                              <span className="text-[8px] md:text-[10px] font-black text-amber-600 uppercase tracking-widest">{group.site}</span>
                              <span className="text-sm md:text-base font-black text-gray-900 uppercase tracking-tight">{unit.slug}</span>
                              <span className="text-[8px] md:text-[10px] font-medium text-gray-400 leading-tight whitespace-normal">{unit.category}</span>
                            </div>
                            <div className="absolute right-full top-1/2 -translate-y-1/2 border-8 border-transparent border-r-amber-500" />
                          </div>
                        )}
                      </div>
                    </td>
                    {daysInMonth.map((date) => {
                      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                      const booking = getBookingForUnitAndDay(receipts, unit.slug, dateStr);
                      const cellProspects = prospectsByCell.get(`${unit.slug}|${dateStr}`) || [];
                      const isToday = date.toDateString() === new Date().toDateString();
                      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                      const maxChips = isNarrowViewport ? 2 : 3;

                      return (
                        <td
                          key={date.toISOString()}
                          role="button"
                          tabIndex={0}
                          onClick={() => openCell(unit.slug, dateStr)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openCell(unit.slug, dateStr);
                            }
                          }}
                          className={`border-r border-b border-gray-50 ${
                            isNarrowViewport ? 'min-h-[2.75rem] h-[2.75rem]' : 'min-h-[5.5rem] md:min-h-[4rem] h-auto py-1 md:py-1'
                          } relative transition-colors cursor-pointer group align-top active:bg-blue-50/40 ${
                            isToday ? 'bg-slate-500/[0.05]' : isWeekend ? 'bg-gray-50/30' : ''
                          }`}
                        >
                          {isNarrowViewport ? (
                            <div className="relative z-[1] h-full flex flex-col items-center justify-center gap-0.5 px-0.5">
                              {booking && (
                                <span
                                  className="w-1.5 h-1.5 rounded-full bg-slate-500"
                                  title={`Résa · ${booking.lastName}`}
                                />
                              )}
                              {cellProspects.length === 0 && !booking ? (
                                <span className="text-[8px] text-gray-200">·</span>
                              ) : (
                                <div className="flex items-center justify-center gap-0.5 flex-wrap max-w-full">
                                  {cellProspects.slice(0, 3).map((p) => {
                                    const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.NOUVEAU;
                                    return (
                                      <span
                                        key={p.id}
                                        className={`w-2 h-2 rounded-full ${cfg.dot}`}
                                        title={prospectDisplayName(p)}
                                      />
                                    );
                                  })}
                                  {cellProspects.length > 3 && (
                                    <span className="text-[8px] font-black text-gray-500">+{cellProspects.length - 3}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <>
                              {booking && (
                                <div
                                  className="absolute inset-x-0 bottom-0 z-0 px-1 pb-0.5 pt-7 md:pt-6 bg-gradient-to-t from-slate-700/12 to-transparent pointer-events-none"
                                  title={`Réservation officielle : ${booking.lastName}`}
                                >
                                  <div className="text-[9px] md:text-[8px] font-bold text-slate-600 truncate leading-tight bg-white/90 rounded px-1 py-px border border-slate-200/80">
                                    Résa · {booking.lastName}
                                  </div>
                                </div>
                              )}
                              <div className="relative z-[1] flex flex-col gap-1 px-0.5 pt-1">
                                {cellProspects.slice(0, maxChips).map((p) => {
                                  const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.NOUVEAU;
                                  const label = prospectDisplayName(p);
                                  return (
                                    <div
                                      key={p.id}
                                      className={`rounded-md px-1 py-1 md:py-0.5 text-[10px] md:text-[8px] font-black uppercase tracking-tight leading-snug line-clamp-2 md:line-clamp-none md:truncate shadow-sm border border-white/40 ${cfg.pill}`}
                                      title={`${label} — ${cfg.label}`}
                                    >
                                      {label}
                                    </div>
                                  );
                                })}
                                {cellProspects.length > maxChips && (
                                  <div className="text-[10px] md:text-[8px] font-black text-gray-500 text-center leading-none py-0.5">
                                    +{cellProspects.length - maxChips}
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      )}

      <AnimatePresence>
        {formOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[140] flex justify-end md:justify-end bg-black/25 backdrop-blur-[2px] pb-[env(safe-area-inset-bottom)]"
            onClick={() => {
              resetForm();
              setFormOpen(false);
            }}
          >
            <motion.aside
              initial={{ x: 360 }}
              animate={{ x: 0 }}
              exit={{ x: 360 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="w-full h-full max-md:max-w-none md:max-w-md bg-white shadow-2xl md:border-l border-gray-200 overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between z-10">
                <h3 className="text-xs font-black uppercase tracking-widest text-gray-700">
                  {editingId ? 'Modifier prospect' : 'Nouveau prospect'}
                </h3>
                <button
                  type="button"
                  className="p-2 rounded-xl hover:bg-gray-100 text-gray-500"
                  onClick={() => {
                    resetForm();
                    setFormOpen(false);
                  }}
                  aria-label="Fermer"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-5 space-y-3">
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
                      <option key={s} value={s}>
                        {SOURCE_CONFIG[s].label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs"
                    value={formData.status}
                    onChange={(e) => setFormData((p) => ({ ...p, status: e.target.value as ProspectStatus }))}
                  >
                    {formData.status === 'A_RELANCER' && (
                      <option value="A_RELANCER">{STATUS_CONFIG.A_RELANCER.label} (ancien)</option>
                    )}
                    {ALL_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_CONFIG[s].label}
                      </option>
                    ))}
                  </select>
                </div>
                <select
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs"
                  value={formData.apartmentName || ''}
                  onChange={(e) => {
                    const next = e.target.value;
                    const units = next ? TARIFS[next]?.units || [] : [];
                    setFormData((p) => ({
                      ...p,
                      apartmentName: next,
                      calendarSlug: units.length === 1 ? units[0] : '',
                    }));
                  }}
                >
                  <option value="">Logement cible (optionnel)</option>
                  {allowedApartmentsList.map((apt) => (
                    <option key={apt} value={apt}>
                      {apt}
                    </option>
                  ))}
                </select>
                {selectedApartmentUnits.length > 1 && (
                  <select
                    className="w-full bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs font-bold"
                    value={formData.calendarSlug || ''}
                    onChange={(e) => setFormData((p) => ({ ...p, calendarSlug: e.target.value }))}
                  >
                    <option value="">— Unité (obligatoire) —</option>
                    {selectedApartmentUnits.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
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
                  rows={4}
                  placeholder="Notes…"
                  value={formData.notes || ''}
                  onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))}
                />
                <div className="flex flex-col gap-2 pt-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={isSaving}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <Save size={14} />
                      {isSaving ? '…' : editingId ? 'Mettre à jour' : 'Enregistrer'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        resetForm();
                        setFormOpen(false);
                      }}
                      className="px-4 py-3 bg-gray-100 hover:bg-gray-200 rounded-xl text-[10px] font-black uppercase tracking-widest"
                    >
                      Fermer
                    </button>
                  </div>
                  {editingId && isAdminUser ? (
                    <button
                      type="button"
                      onClick={() =>
                        handleDeleteProspect({
                          ...formData,
                          id: editingId,
                        })
                      }
                      className="w-full py-3 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-[10px] font-black uppercase tracking-widest inline-flex items-center justify-center gap-2"
                    >
                      <Trash2 size={14} />
                      Supprimer ce prospect
                    </button>
                  ) : null}
                </div>
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {cellPanel && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[135] flex items-end md:items-center justify-center p-0 md:p-4 bg-black/30 backdrop-blur-sm"
            onClick={() => setCellPanel(null)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              className="w-full md:max-w-lg max-h-[85vh] overflow-y-auto bg-white rounded-t-2xl md:rounded-2xl shadow-2xl border border-gray-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Cellule</p>
                  <p className="text-sm font-black text-gray-900">
                    {cellPanel.unitSlug} · {cellPanel.dateStr}
                  </p>
                </div>
                <button type="button" className="p-2 rounded-xl hover:bg-gray-100" onClick={() => setCellPanel(null)} aria-label="Fermer">
                  <X size={18} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <button
                  type="button"
                  onClick={() => {
                    const apt = apartmentNameForUnitSlug(cellPanel.unitSlug);
                    openNewProspectForm({
                      calendarSlug: cellPanel.unitSlug,
                      apartmentName: apt,
                      startDate: cellPanel.dateStr,
                      endDate: ymdAddDays(cellPanel.dateStr, 1),
                    });
                  }}
                  className="w-full py-3 rounded-xl border-2 border-dashed border-blue-300 text-blue-700 text-[10px] font-black uppercase tracking-widest hover:bg-blue-50 transition-all"
                >
                  + Autre prospect sur ce créneau
                </button>
                {cellPanel.prospects.map((prospect) => {
                  const sCfg = STATUS_CONFIG[prospect.status] || STATUS_CONFIG.NOUVEAU;
                  const srcCfg = SOURCE_CONFIG[prospect.source] || SOURCE_CONFIG.AUTRE;
                  const { tel, wa } = normalizePhone(prospect.phone || '');
                  return (
                    <div key={prospect.id} className="rounded-2xl border border-gray-200 p-4 space-y-3 bg-gray-50/50">
                      <div className="flex flex-wrap items-center gap-2">
                        <UserRound size={14} className="text-gray-400 shrink-0" />
                        <span className="text-sm font-black uppercase tracking-tight">
                          {`${prospect.firstName || ''} ${prospect.lastName || ''}`.trim() || 'Sans nom'}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black ${srcCfg.bg} ${srcCfg.color}`}>
                          {srcCfg.icon}
                          {srcCfg.label}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black ${sCfg.bg} ${sCfg.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sCfg.dot}`} />
                          {sCfg.label}
                        </span>
                      </div>
                      {prospect.phone && (
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={`tel:${tel}`}
                            className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white px-2.5 py-1 rounded-xl text-xs font-bold"
                          >
                            <Phone size={11} />
                            {prospect.phone}
                          </a>
                          <a
                            href={`https://wa.me/${wa}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-gray-200 rounded-xl text-[10px] font-black"
                          >
                            <MessageCircle size={11} />
                            WhatsApp
                          </a>
                        </div>
                      )}
                      {(prospect.startDate || prospect.endDate) && (
                        <div className="inline-flex items-center gap-1.5 bg-slate-800 px-2.5 py-1 rounded-xl">
                          <CalendarDays size={11} className="text-slate-400 shrink-0" />
                          <span className="text-xs font-bold text-white tracking-wide">
                            {prospect.startDate} → {prospect.endDate}
                          </span>
                        </div>
                      )}
                      {prospect.apartmentName && (
                        <p className="text-xs text-gray-500 flex items-center gap-1">
                          <Building2 size={11} className="text-gray-400 shrink-0" />
                          {prospect.apartmentName}
                          {prospect.calendarSlug ? ` · ${prospect.calendarSlug}` : ''}
                        </p>
                      )}
                      {(() => {
                        const clean = stripProformaDraftFromNotes(prospect.notes || '').cleanNotes;
                        return clean ? (
                          <p className="text-[11px] text-gray-600 whitespace-pre-wrap">{clean}</p>
                        ) : null;
                      })()}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(prospect)}
                          className="px-3 py-2 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl text-[10px] font-black uppercase tracking-widest"
                        >
                          Éditer
                        </button>
                        {prospect.status !== 'CONVERTI' && prospect.status !== 'PERDU' && prospect.status !== 'ANNULE' && (
                          <>
                            {prospect.status !== 'EN_NEGOCIATION' && (
                              <button
                                type="button"
                                onClick={() => handleQuickStatus(prospect, 'EN_NEGOCIATION')}
                                className="px-3 py-2 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-xl text-[10px] font-black uppercase tracking-widest"
                              >
                                En négo
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                const fresh = prospects.find((p) => p.id && p.id === prospect.id) || prospect;
                                setCellPanel(null);
                                onProforma(fresh);
                              }}
                              className="px-3 py-2 bg-orange-50 text-orange-700 hover:bg-orange-100 rounded-xl text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-1"
                            >
                              <FileText size={12} />
                              Proforma
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const fresh = prospects.find((p) => p.id && p.id === prospect.id) || prospect;
                                setCellPanel(null);
                                onConvert(fresh);
                              }}
                              className="px-3 py-2 bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-1"
                            >
                              <ArrowRightLeft size={12} />
                              Convertir
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => handleQuickStatus(prospect, 'PERDU')}
                          className="px-3 py-2 bg-red-50 text-red-700 rounded-xl text-[10px] font-black uppercase tracking-widest"
                        >
                          Perdu
                        </button>
                        <button
                          type="button"
                          onClick={() => handleQuickStatus(prospect, 'ANNULE')}
                          className="px-3 py-2 bg-gray-100 text-gray-600 rounded-xl text-[10px] font-black uppercase tracking-widest"
                        >
                          Annulé
                        </button>
                        {isAdminUser ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteProspect(prospect)}
                            className="px-3 py-2 bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded-xl text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-1"
                            title="Supprimer le doublon / fiche erronée"
                          >
                            <Trash2 size={12} />
                            Supprimer
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
