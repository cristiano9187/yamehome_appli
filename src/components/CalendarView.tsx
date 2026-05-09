import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import { auth, db } from '../firebase';
import {
  ReceiptData,
  CleaningReport,
  UserProfile,
  BlockedDate,
  ReceiptStaySegment,
  GuestCheckInRecord,
} from '../types';
import { TARIFS, SITES, SITE_MAPPING } from '../constants';
const AttendanceView = lazy(() => import('./AttendanceView'));
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar as CalendarIcon,
  Home,
  User as UserIcon,
  Info,
  ClipboardCheck,
  Search,
  Filter,
  ArrowRight,
  X,
  Lock,
  Unlock,
  AlertTriangle,
  Menu,
  BadgeCheck,
} from 'lucide-react';
import { AptBadge, PhoneLinks } from '../utils/aptDisplay';
import { effectuéMériteAffichageAlerte } from '../cleaningReportUtils';
import { getReceiptSegments } from '../utils/receiptSegments';
import { 
  collection, 
  query, 
  onSnapshot,
  where,
  addDoc,
  deleteDoc,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { upsertPublicCalendar, deletePublicCalendar } from '../utils/publicCalendar';
import { motion, AnimatePresence } from 'motion/react';
import { isCameroonStrictlyBefore18h, formatCameroonDateTimeVerbose } from '../utils/cameroonTime';

/** YYYY-MM-DD (local) */
function ymdLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Dates de passage ménage théoriques pour **un segment** de réservation (check-in, +3j, check-out).
 * Le jour de départ (`endDate`) est inclus alors que `getBookingForUnitAndDay` l’exclut.
 */
function getCleaningTaskDates(booking: ReceiptData): string[] {
  const tasks: string[] = [];
  const start = new Date(booking.startDate);
  const end = new Date(booking.endDate);

  tasks.push(booking.startDate);

  let current = new Date(start);
  current.setDate(current.getDate() + 3);
  while (current < end) {
    tasks.push(ymdLocal(current));
    current.setDate(current.getDate() + 3);
  }

  tasks.push(booking.endDate);
  return [...new Set(tasks)];
}

/**
 * Agrégation des passages ménage par unité pour un reçu (mono ou multi-segments).
 */
function getCleaningTaskDatesForReceipt(booking: ReceiptData): Array<{ slug: string; dateStr: string }> {
  const out: Array<{ slug: string; dateStr: string }> = [];
  for (const seg of getReceiptSegments(booking)) {
    const pseudo: ReceiptData = {
      ...booking,
      calendarSlug: seg.calendarSlug,
      startDate: seg.startDate,
      endDate: seg.endDate,
    };
    for (const dateStr of getCleaningTaskDates(pseudo)) {
      out.push({ slug: seg.calendarSlug, dateStr });
    }
  }
  return out;
}

function getActiveSegmentForCell(
  booking: ReceiptData,
  unitSlug: string,
  dateStr: string
): ReceiptStaySegment | null {
  return (
    getReceiptSegments(booking).find(
      (s) =>
        s.calendarSlug === unitSlug &&
        dateStr >= s.startDate &&
        dateStr < s.endDate
    ) ?? null
  );
}

function userCanManageUnitOnCalendar(
  userProfile: UserProfile | null,
  unitSlug: string
): boolean {
  if (!userProfile) return false;
  const isMainAdmin =
    userProfile.email?.toLowerCase() === 'christian.yamepi@gmail.com' ||
    userProfile.email?.toLowerCase() === 'cyamepi@gmail.com';
  const isAdmin = userProfile.role === 'admin' || isMainAdmin;
  const allowedSites = userProfile.allowedSites || [];
  const allowedApartments = isAdmin
    ? Object.keys(TARIFS)
    : allowedSites.flatMap((site) => SITE_MAPPING[site] || []);
  return allowedApartments.some((apt) => TARIFS[apt]?.units?.includes(unitSlug));
}

interface CalendarViewProps {
  onEdit: (receipt: ReceiptData) => void;
  onOpenCleaning: (menageId: string, slug: string, date: string) => void;
  onMenuClick?: () => void;
  viewMode: 'reservations' | 'cleaning' | 'presence';
  onViewModeChange: (mode: 'reservations' | 'cleaning' | 'presence') => void;
  userProfile: UserProfile | null;
  onAlert: (msg: string, type?: 'success' | 'error' | 'info') => void;
  initialScrollPosition?: number;
  onScrollChange?: (scrollLeft: number) => void;
  currentDate: Date;
  onDateChange: (date: Date) => void;
}

/** Suivi Ménage : anomalie ou effectué avec point(s) d’attention (orange signature) */
const CLEANING_ISSUE_SURFACE = 'bg-[#ec7f54]/18 border-[#ec7f54] text-[#a9432c] shadow-md border-2';

/** Rapport REPORTÉ — teinte indigo/bleu discret, distincte de l’orange anomalie */
const CLEANING_POSTPONED_SURFACE =
  'bg-indigo-100/90 border-indigo-400/95 text-indigo-900 shadow-md border-2';

export default function CalendarView({ 
  onEdit, 
  onOpenCleaning, 
  onMenuClick,
  viewMode, 
  onViewModeChange, 
  userProfile, 
  onAlert,
  initialScrollPosition = 0,
  onScrollChange,
  currentDate,
  onDateChange
}: CalendarViewProps) {
  const [receipts, setReceipts] = useState<ReceiptData[]>([]);
  const [cleaningReports, setCleaningReports] = useState<CleaningReport[]>([]);
  const [blockedDates, setBlockedDates] = useState<BlockedDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBookingContext, setSelectedBookingContext] = useState<{
    receipt: ReceiptData;
    segment: ReceiptStaySegment;
  } | null>(null);
  const [checkInDraft, setCheckInDraft] = useState({ kwh: '', idPiece: '' as '' | 'OUI' | 'NON', comment: '' });
  const [checkInSubmitting, setCheckInSubmitting] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ unitSlug: string, date: string } | null>(null);
  const [expandedUnitSlug, setExpandedUnitSlug] = useState<string | null>(null);
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasRestoredScroll = useRef(false);

  // Close expanded unit on click outside
  useEffect(() => {
    const handleClickOutside = () => setExpandedUnitSlug(null);
    window.addEventListener('pointerdown', handleClickOutside);
    return () => window.removeEventListener('pointerdown', handleClickOutside);
  }, []);

  useEffect(() => {
    setCheckInDraft({ kwh: '', idPiece: '', comment: '' });
  }, [selectedBookingContext?.receipt.id, selectedBookingContext?.segment.id]);

  // Restore scroll position on mount
  useEffect(() => {
    if (scrollContainerRef.current && initialScrollPosition > 0 && !hasRestoredScroll.current) {
      const container = scrollContainerRef.current;
      const timeoutId = setTimeout(() => {
        if (container) {
          container.scrollLeft = initialScrollPosition;
          hasRestoredScroll.current = true;
        }
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [initialScrollPosition]);

  // Auto-scroll to current day
  useEffect(() => {
    if (loading) return;
    if ((viewMode === 'reservations' || viewMode === 'cleaning') && scrollContainerRef.current) {
      // If we've already restored a specific scroll position, don't auto-scroll to today
      if (hasRestoredScroll.current) return;

      const today = new Date();
      if (today.getMonth() === currentDate.getMonth() && today.getFullYear() === currentDate.getFullYear()) {
        const timeoutId = setTimeout(() => {
          const container = scrollContainerRef.current;
          // Re-check if we restored scroll during the timeout
          if (hasRestoredScroll.current) return;
          
          const todayEl = document.getElementById('calendar-today-column');
          const firstCol = container?.querySelector('th.sticky') as HTMLElement;
          
          if (container && todayEl && firstCol) {
            const todayRect = todayEl.getBoundingClientRect();
            const firstColRect = firstCol.getBoundingClientRect();
            
            // We want today to be at: firstCol.right + (4 * today.width)
            // The distance from the container's left to today's desired position
            const targetLeft = firstColRect.right + (4 * todayRect.width);
            const diff = todayRect.left - targetLeft;
            
            container.scrollTo({
              left: container.scrollLeft + diff,
              behavior: 'smooth'
            });
          }
        }, 100);
        return () => clearTimeout(timeoutId);
      } else if (!hasRestoredScroll.current) {
        // Only scroll to 0 if we haven't restored a position
        scrollContainerRef.current.scrollTo({ left: 0, behavior: 'smooth' });
      }
    }
  }, [loading, viewMode, currentDate.getTime()]);

  useEffect(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDayStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDayStr = `${year}-${String(month + 1).padStart(2, '0')}-${new Date(year, month + 1, 0).getDate()}`;

    const qReceipts = query(
      collection(db, 'receipts'),
      where('endDate', '>=', firstDayStr)
    );

    const unsubReceipts = onSnapshot(qReceipts, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ReceiptData[];
      // Filter out only those that are explicitly ANNULE, keeping VALIDE and those without status
      setReceipts(data.filter(r => r.status !== 'ANNULE'));
    });

    const qCleaning = query(
      collection(db, 'cleaning_reports'),
      where('dateIntervention', '>=', firstDayStr),
      where('dateIntervention', '<=', lastDayStr)
    );
    const unsubCleaning = onSnapshot(qCleaning, (snapshot) => {
      setCleaningReports(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as CleaningReport[]);
      setLoading(false);
    });

    const qBlocked = query(
      collection(db, 'blocked_dates'),
      where('date', '>=', firstDayStr),
      where('date', '<=', lastDayStr)
    );
    const unsubBlocked = onSnapshot(qBlocked, (snapshot) => {
      setBlockedDates(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as BlockedDate[]);
    });

    return () => {
      unsubReceipts();
      unsubCleaning();
      unsubBlocked();
    };
  }, [currentDate.getMonth(), currentDate.getFullYear()]);

  // Flatten all units for the left column
  const allUnits = useMemo(() => {
    const units: { slug: string, category: string, color: string, site: string, shortName: string }[] = [];
    
    const SITE_COLORS: { [key: string]: string } = {
      'RIETI': 'bg-emerald-500',
      'MODENA': 'bg-blue-500',
      'MATERA': 'bg-orange-500',
      'GALLAGHERS': 'bg-purple-500',
      'BGT': 'bg-purple-500',
      'DEFAULT': 'bg-gray-500'
    };

    const SITE_NAMES: { [key: string]: string } = {
      'RIETI': 'Rieti',
      'MODENA': 'Modena',
      'MATERA': 'Matera',
      'GALLAGHERS': 'Gallagers',
      'BGT': 'Gallagers',
      'DEFAULT': 'Autres'
    };

    Object.entries(TARIFS).forEach(([category, data]) => {
      // Filter by allowed sites
      const isMainAdmin = userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' || userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
      const isAdmin = userProfile?.role === 'admin' || isMainAdmin;

      const allowedSites = userProfile?.allowedSites || [];
      const allowedApartments = isAdmin ? [] : allowedSites.flatMap(site => SITE_MAPPING[site] || []);

      const isAllowed = isAdmin || allowedApartments.includes(category);
      
      if (!isAllowed) {
        return;
      }

      const upperCategory = category.toUpperCase();
      let siteKey = 'DEFAULT';
      
      if (upperCategory.includes('RIETI')) siteKey = 'RIETI';
      else if (upperCategory.includes('MODENA')) siteKey = 'MODENA';
      else if (upperCategory.includes('MATERA')) siteKey = 'MATERA';
      else if (upperCategory.includes('GALLAGHERS') || upperCategory.includes('CITY')) siteKey = 'GALLAGHERS';

      const color = SITE_COLORS[siteKey] || SITE_COLORS.DEFAULT;
      const siteName = SITE_NAMES[siteKey] || SITE_NAMES.DEFAULT;

      // Extract short name from category
      let shortName = category;
      if (category.includes(' - ')) {
        shortName = category.split(' - ')[1]
          .replace('APPARTEMENT ', '')
          .replace('STUDIO ', '')
          .replace('CHAMBRE ', '')
          .replace('mode STUDIO', '(Studio)')
          .trim();
      }

      if (data.units) {
        data.units.forEach(slug => {
          if (!units.find(u => u.slug === slug)) {
            // Refine short name based on slug for specific units
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
        if (!units.find(u => u.slug === slug)) {
          units.push({ slug, category, color, site: siteName, shortName });
        }
      }
    });
    
    // Sort units to keep sites together with specific priority
    const SITE_PRIORITY: { [key: string]: number } = {
      'Matera': 1,
      'Rieti': 2,
      'Modena': 3,
      'Gallagers': 4,
      'Autres': 5
    };

    return units.sort((a, b) => {
      const pA = SITE_PRIORITY[a.site] || 99;
      const pB = SITE_PRIORITY[b.site] || 99;
      if (pA !== pB) return pA - pB;
      return a.shortName.localeCompare(b.shortName);
    });
  }, [userProfile]);

  // Alternating booking colors per unit — even index = light shade, odd = dark shade
  const COLOR_VARIANTS: Record<string, [string, string]> = {
    'bg-emerald-500': ['bg-emerald-400', 'bg-emerald-700'],
    'bg-blue-500':    ['bg-blue-400',    'bg-blue-700'],
    'bg-orange-500':  ['bg-orange-400',  'bg-orange-700'],
    'bg-purple-500':  ['bg-purple-400',  'bg-purple-700'],
    'bg-gray-500':    ['bg-gray-400',    'bg-gray-700'],
  };

  const bookingIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    const byUnit = new Map<string, ReceiptData[]>();
    for (const r of receipts) {
      if (!byUnit.has(r.calendarSlug)) byUnit.set(r.calendarSlug, []);
      byUnit.get(r.calendarSlug)!.push(r);
    }
    for (const [, bookings] of byUnit) {
      bookings.sort((a, b) => a.startDate.localeCompare(b.startDate));
      bookings.forEach((b, i) => { if (b.id) map.set(b.id, i); });
    }
    return map;
  }, [receipts]);

  const getBookingColor = (baseColor: string, bookingId: string | undefined) => {
    const variants = COLOR_VARIANTS[baseColor];
    if (!variants || !bookingId) return baseColor;
    return variants[(bookingIndexMap.get(bookingId) ?? 0) % 2];
  };

  const groupedUnits = useMemo(() => {
    const groups: { site: string, color: string, units: typeof allUnits }[] = [];
    allUnits.forEach(unit => {
      let group = groups.find(g => g.site === unit.site);
      if (!group) {
        group = { site: unit.site, color: unit.color, units: [] };
        groups.push(group);
      }
      group.units.push(unit);
    });
    return groups;
  }, [allUnits]);

  const daysInMonth = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 1; i <= totalDays; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  }, [currentDate]);

  const getLocalDateString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getBookingForUnitAndDay = (unitSlug: string, date: Date) => {
    const dateStr = getLocalDateString(date);
    return receipts.find((r) => {
      if (r.status === 'ANNULE') return false;
      return getReceiptSegments(r).some(
        (s) => s.calendarSlug === unitSlug && dateStr >= s.startDate && dateStr < s.endDate
      );
    });
  };

  const cleaningBookingByCell = useMemo(() => {
    const map = new Map<string, ReceiptData>();
    for (const r of receipts) {
      if (r.status === 'ANNULE') continue;
      for (const { slug, dateStr } of getCleaningTaskDatesForReceipt(r)) {
        const k = `${slug}|${dateStr}`;
        if (!map.has(k)) map.set(k, r);
      }
    }
    return map;
  }, [receipts]);

  const getCleaningReport = (unitSlug: string, dateStr: string) => {
    return cleaningReports.find(r => r.calendarSlug === unitSlug && r.dateIntervention === dateStr);
  };

  const nextMonth = () => onDateChange(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  const prevMonth = () => onDateChange(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const monthName = currentDate.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });

  const handleBlockDate = async (unitSlug: string, date: string) => {
    const isMainAdmin = userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' || userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
    if (userProfile?.role !== 'admin' && !isMainAdmin) {
      onAlert("Seuls les administrateurs peuvent bloquer des dates.", "error");
      return;
    }

    const isAdmin = userProfile?.role === 'admin' || isMainAdmin;
    
    const allowedSites = userProfile?.allowedSites || [];
    const allowedApartments = isAdmin ? Object.keys(TARIFS) : allowedSites.flatMap(site => SITE_MAPPING[site] || []);
    
    const isAllowed = allowedApartments.some(apt => TARIFS[apt]?.units?.includes(unitSlug));
    if (!isAllowed) {
      onAlert("Vous n'êtes pas autorisé à bloquer des dates pour ce logement.", "error");
      return;
    }

    // Check if date is in the past
    const selectedDate = new Date(date);
    selectedDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (selectedDate < today) {
      onAlert("Vous ne pouvez bloquer que des dates présentes ou futures", "error");
      return;
    }

    try {
      const newBlockRef = await addDoc(collection(db, 'blocked_dates'), {
        date,
        calendarSlug: unitSlug,
        createdAt: new Date().toISOString(),
        authorUid: userProfile?.uid || '',
        reason: 'Travaux / Maintenance'
      });

      // Sync vue publique
      await upsertPublicCalendar({
        id: unitSlug,
        start: date,
        end: date,
        client: 'Fermé',
        ref_id: `block_${newBlockRef.id}`,
        type: 'blocked',
        updatedAt: new Date().toISOString(),
      });

      onAlert("Date bloquée avec succès", "success");
      setSelectedCell(null);
    } catch (error: any) {
      console.error("Error blocking date:", error);
      const errorMsg = error.message?.includes('permission-denied') 
        ? "Permission refusée. Vérifiez vos droits admin." 
        : "Erreur lors du blocage de la date";
      onAlert(errorMsg, "error");
    }
  };

  const handleUnblockDate = async (blockedId: string) => {
    const isMainAdminLocal = userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' || userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
    if (userProfile?.role !== 'admin' && !isMainAdminLocal) {
      onAlert("Seuls les administrateurs peuvent débloquer des dates.", "error");
      return;
    }

    const blocked = blockedDates.find(b => b.id === blockedId);
    if (blocked) {
      const isAdminLocal = userProfile?.role === 'admin' || isMainAdminLocal;
      
      const allowedSites = userProfile?.allowedSites || [];
      const allowedApartments = isAdminLocal ? Object.keys(TARIFS) : allowedSites.flatMap(site => SITE_MAPPING[site] || []);
      
      const isAllowed = allowedApartments.some(apt => TARIFS[apt]?.units?.includes(blocked.calendarSlug));
      if (!isAllowed) {
        onAlert("Vous n'êtes pas autorisé à débloquer des dates pour ce logement.", "error");
        return;
      }
    }

    try {
      await deleteDoc(doc(db, 'blocked_dates', blockedId));
      // Retirer de la vue publique
      await deletePublicCalendar(`block_${blockedId}`);
      onAlert("Date débloquée avec succès", "success");
      setSelectedCell(null);
    } catch (error) {
      console.error("Error unblocking date:", error);
      onAlert("Erreur lors du déblocage de la date", "error");
    }
  };

  const handleValidateGuestCheckIn = async () => {
    const ctx = selectedBookingContext;
    if (!ctx || !ctx.receipt.id || checkInSubmitting) return;

    if (!userCanManageUnitOnCalendar(userProfile, ctx.segment.calendarSlug)) {
      onAlert("Vous n'êtes pas autorisé à enregistrer un check-in pour ce logement.", 'error');
      return;
    }

    const existing = ctx.receipt.checkInsBySegmentId?.[ctx.segment.id];
    if (existing) {
      onAlert('Le check-in est déjà enregistré pour ce bloc de séjour.', 'info');
      return;
    }

    const now = new Date();
    const kwhMandatory = isCameroonStrictlyBefore18h(now);
    let kwhCompteurPrepaye: number | null = null;
    const kwhTrim = checkInDraft.kwh.trim();

    if (kwhMandatory) {
      if (!kwhTrim) {
        onAlert('Entrée journée : le relevé kWh du compteur prépayé est obligatoire (avant 18h au Cameroun).', 'error');
        return;
      }
      const parsed = Number(kwhTrim.replace(',', '.'));
      if (Number.isNaN(parsed) || parsed < 0) {
        onAlert('Indiquez un nombre de kWh valide (≥ 0).', 'error');
        return;
      }
      kwhCompteurPrepaye = parsed;
    } else if (kwhTrim) {
      const parsed = Number(kwhTrim.replace(',', '.'));
      if (Number.isNaN(parsed) || parsed < 0) {
        onAlert('Indiquez un nombre de kWh valide (≥ 0) ou laissez vide pour une entrée nocturne.', 'error');
        return;
      }
      kwhCompteurPrepaye = parsed;
    }

    if (checkInDraft.idPiece !== 'OUI' && checkInDraft.idPiece !== 'NON') {
      onAlert('Indiquez si la pièce d’identité a été contrôlée (Oui / Non).', 'error');
      return;
    }

    const authorDisplayName =
      (auth.currentUser?.displayName ||
        userProfile?.displayName ||
        userProfile?.email ||
        'Agent')
        .trim() || 'Agent';

    const record: GuestCheckInRecord = {
      validatedAt: now.toISOString(),
      kwhCompteurPrepaye,
      idPieceControlee: checkInDraft.idPiece,
      commentaire: checkInDraft.comment.trim(),
      authorUid: auth.currentUser?.uid || userProfile?.uid || '',
      authorDisplayName,
    };

    setCheckInSubmitting(true);
    try {
      await updateDoc(doc(db, 'receipts', ctx.receipt.id), {
        [`checkInsBySegmentId.${ctx.segment.id}`]: record,
      });
      onAlert('Check-in enregistré (heure du Cameroun).', 'success');
    } catch (e: any) {
      console.error(e);
      onAlert(
        e?.message?.includes?.('permission-denied')
          ? 'Permission refusée. Vérifiez vos droits Firestore.'
          : 'Erreur lors de l’enregistrement du check-in.',
        'error'
      );
    } finally {
      setCheckInSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F5F5F4]">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const detailCtx = selectedBookingContext;
  const detailReceipt = detailCtx?.receipt;
  const detailSegment = detailCtx?.segment;
  const detailCheckIn =
    detailReceipt && detailSegment
      ? detailReceipt.checkInsBySegmentId?.[detailSegment.id]
      : undefined;
  const detailCanManageCheckIn =
    !!detailSegment && userCanManageUnitOnCalendar(userProfile, detailSegment.calendarSlug);
  const kwhRequiredNow = isCameroonStrictlyBefore18h(new Date());

  return (
    <div className="flex-1 flex flex-col md:h-full bg-[#F5F5F4] md:overflow-hidden">
      {/* Header */}
      <div className="h-auto md:h-20 bg-white border-b border-gray-200 px-4 md:px-8 py-4 md:py-0 flex flex-col md:flex-row items-start md:items-center justify-between sticky top-0 z-40 gap-4">
        <div className="flex items-center gap-4 md:gap-8">
          {onMenuClick && (
            <button 
              onClick={(e) => {
                e.stopPropagation();
                onMenuClick();
              }} 
              className="md:hidden p-2 hover:bg-gray-100 rounded-xl transition-all"
            >
              <Menu size={20} />
            </button>
          )}
          <div className="flex flex-col">
            <h2 className="text-sm font-black uppercase tracking-widest">Planning YameHome</h2>
            <span className="text-[10px] font-mono text-gray-400 font-bold uppercase">{monthName}</span>
          </div>

          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button 
              onClick={() => onViewModeChange('reservations')}
              className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${viewMode === 'reservations' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400'}`}
            >
              Réservations
            </button>
            <button 
              onClick={() => onViewModeChange('cleaning')}
              className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${viewMode === 'cleaning' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400'}`}
            >
              Suivi Ménage
            </button>
            <button 
              onClick={() => onViewModeChange('presence')}
              className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${viewMode === 'presence' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400'}`}
            >
              Présence
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-xl border border-gray-200">
            <button onClick={prevMonth} className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-gray-600">
              <ChevronLeft size={18} />
            </button>
            <div className="px-4 text-xs font-black uppercase tracking-widest text-gray-900 min-w-[140px] text-center">
              {monthName}
            </div>
            <button onClick={nextMonth} className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-gray-600">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Grid Container */}
      <div className="flex-1 md:overflow-hidden flex flex-col">
        {viewMode === 'presence' ? (
          <div className="flex-1 overflow-y-auto bg-[#F5F5F4]">
            <Suspense fallback={
              <div className="flex-1 flex items-center justify-center bg-[#F5F5F4]">
                <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              </div>
            }>
              <AttendanceView userProfile={userProfile} onAlert={onAlert} currentDate={currentDate} />
            </Suspense>
          </div>
        ) : (
          <div 
            className="flex-1 overflow-auto relative" 
            ref={scrollContainerRef}
            onScroll={(e) => {
              const target = e.currentTarget;
              onScrollChange?.(target.scrollLeft);
            }}
          >
            <table className="w-full border-collapse table-fixed min-w-[2600px]">
            <thead className="sticky top-0 z-30">
              <tr className="bg-zinc-900 text-white">
                <th className="w-[80px] md:w-64 sticky left-0 z-40 bg-zinc-900 border-b border-r border-white/10 p-2 md:p-4 text-left text-[8px] md:text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Logements
                </th>
                {daysInMonth.map(date => {
                  const isToday = date.toDateString() === new Date().toDateString();
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  return (
                    <th 
                      key={date.toISOString()} 
                      id={isToday ? 'calendar-today-column' : undefined}
                      className={`w-[5.5rem] min-w-[5.5rem] border-b border-white/10 p-2 text-center ${isToday ? 'bg-blue-900/50' : isWeekend ? 'bg-white/5' : ''}`}
                    >
                      <div className="flex flex-col items-center">
                        <span className={`text-[10px] font-black ${isToday ? 'text-blue-400' : 'text-white'}`}>
                          {date.getDate()}
                        </span>
                        <span className={`text-[8px] uppercase font-bold ${isToday ? 'text-blue-300' : 'text-gray-400'}`}>
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
                      <td className={`sticky left-0 ${expandedUnitSlug === unit.slug ? 'z-[30]' : 'z-20'} bg-white border-r border-b border-gray-100 p-0 group-hover:bg-gray-50 transition-all w-[80px] md:w-64`}>
                        <div className="flex h-full items-stretch relative">
                          {/* Site Vertical Bar */}
                          <div className={`w-1 md:w-6 flex items-center justify-center ${group.color} relative`}>
                            <span className="hidden md:block text-[8px] font-black text-white uppercase tracking-widest -rotate-90 whitespace-nowrap origin-center">
                              {group.site}
                            </span>
                          </div>
                          
                          {/* Unit Details */}
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

                          {/* Expanded Bubble */}
                          {expandedUnitSlug === unit.slug && (
                            <div className="absolute left-[calc(100%-4px)] top-1/2 -translate-y-1/2 w-56 md:w-72 bg-white shadow-2xl rounded-xl p-3 md:p-4 z-[100] border-2 border-blue-500 animate-in fade-in zoom-in duration-200 pointer-events-none">
                              <div className="flex flex-col gap-1">
                                <span className="text-[8px] md:text-[10px] font-black text-blue-600 uppercase tracking-widest">{group.site}</span>
                                <span className="text-sm md:text-base font-black text-gray-900 uppercase tracking-tight">
                                  {unit.slug}
                                </span>
                                <span className="text-[8px] md:text-[10px] font-medium text-gray-400 leading-tight whitespace-normal">{unit.category}</span>
                              </div>
                              {/* Arrow */}
                              <div className="absolute right-full top-1/2 -translate-y-1/2 border-8 border-transparent border-r-blue-500" />
                            </div>
                          )}
                        </div>
                      </td>
                  {daysInMonth.map(date => {
                    const dateStr = getLocalDateString(date);
                    const booking = getBookingForUnitAndDay(unit.slug, date);
                    const cleaningBooking =
                      viewMode === 'cleaning'
                        ? cleaningBookingByCell.get(`${unit.slug}|${dateStr}`) ?? null
                        : null;
                    const menageIdForCleaningOpen = cleaningBooking?.receiptId || 'MANUAL';
                    const isToday = date.toDateString() === new Date().toDateString();
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                    
                    const blockedDate = blockedDates.find(b => b.calendarSlug === unit.slug && b.date === dateStr);
                    const isBlocked = !!blockedDate;

                    const activeSegment =
                      booking && viewMode === 'reservations'
                        ? getActiveSegmentForCell(booking, unit.slug, dateStr)
                        : null;
                    const isFirstNightOfSegment =
                      !!activeSegment && dateStr === activeSegment.startDate;
                    const segmentCheckIn =
                      activeSegment && booking?.checkInsBySegmentId?.[activeSegment.id];

                    // Cleaning Logic — même ligne de résa que pour le ménage le jour du check-out
                    const isCalculatedCleaningDay = viewMode === 'cleaning' && !!cleaningBooking;
                    const report = getCleaningReport(unit.slug, dateStr);
                    const currentReport =
                      report && report.status !== 'ANNULÉ' ? report : null;
                    const isCleaningDay =
                      (isCalculatedCleaningDay && (!report || report.status !== 'ANNULÉ')) ||
                      !!currentReport;

                    return (
                      <td 
                        key={date.toISOString()} 
                        onClick={() => {
                          if (viewMode === 'reservations') {
                            if (booking) {
                              const seg = getActiveSegmentForCell(booking, unit.slug, dateStr);
                              if (seg) {
                                setSelectedBookingContext({ receipt: booking, segment: seg });
                              } else {
                                onAlert('Segment de séjour introuvable pour cette cellule.', 'error');
                              }
                            } else {
                              setSelectedCell({ unitSlug: unit.slug, date: dateStr });
                            }
                          } else if (viewMode === 'cleaning') {
                            onOpenCleaning(menageIdForCleaningOpen, unit.slug, dateStr);
                          }
                        }}
                        className={`border-r border-b border-gray-50 h-16 relative transition-colors cursor-pointer group ${isToday ? 'bg-slate-500/[0.05]' : isWeekend ? 'bg-gray-50/30' : ''}`}
                      >
                        {viewMode === 'reservations' && isBlocked && (
                          <div className="absolute inset-0 bg-red-50/50 flex items-center justify-center overflow-hidden">
                            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #ef4444, #ef4444 10px, transparent 10px, transparent 20px)' }} />
                            <Lock size={14} className="text-red-400 relative z-10" />
                          </div>
                        )}

                        {viewMode === 'reservations' && booking && (
                          <div 
                            className={`absolute inset-x-px inset-y-3 rounded-md flex items-center justify-center pointer-events-none transition-all group-hover:scale-[1.01] shadow-sm ${getBookingColor(unit.color, booking.id)} text-white min-h-0 px-1`}
                          >
                            {isFirstNightOfSegment && segmentCheckIn && (
                              <div
                                className="absolute top-0.5 left-0.5 z-10 flex items-center justify-center rounded-sm bg-white/95 p-px shadow-sm"
                                title={`Check-in enregistré — ${formatCameroonDateTimeVerbose(new Date(segmentCheckIn.validatedAt))} (heure Cameroun)`}
                              >
                                <BadgeCheck size={11} className="text-emerald-600 shrink-0" strokeWidth={2.5} />
                              </div>
                            )}
                            <span className="text-[10px] leading-tight font-black uppercase tracking-tight text-center w-full min-w-0 whitespace-nowrap overflow-hidden text-ellipsis px-0.5">
                              {booking.lastName}
                            </span>
                            {booking.internalNotes && (
                              <div className="absolute top-0.5 right-0.5 w-2 h-2 bg-amber-400 rounded-full border border-white shadow-sm z-10" title="Note interne" />
                            )}
                          </div>
                        )}

                        {viewMode === 'cleaning' && isCleaningDay && (() => {
                          const showOrangeOnEffectué =
                            currentReport?.status === 'EFFECTUÉ' &&
                            effectuéMériteAffichageAlerte(currentReport);
                          const cellTitle =
                            currentReport?.status === 'REPORTÉ'
                              ? 'Ménage reporté — consulter le compte-rendu pour la suite'
                              : showOrangeOnEffectué
                                ? "Effectué : point(s) d'attention (mesures, serviettes, texte) — surlignage discret"
                                : undefined;
                          return (
                          <div 
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenCleaning(menageIdForCleaningOpen, unit.slug, dateStr);
                            }}
                            title={cellTitle}
                            className={`absolute inset-x-px inset-y-3 rounded-lg flex items-center justify-center cursor-pointer transition-all hover:scale-110 border ${
                              currentReport 
                                ? currentReport.status === 'EFFECTUÉ' 
                                    ? (showOrangeOnEffectué
                                        ? CLEANING_ISSUE_SURFACE 
                                        : 'bg-green-100 border-green-500 text-green-600 shadow-md border-2')
                                    : currentReport.status === 'PRÉVU' ? 'bg-white border-blue-500 text-blue-600 shadow-md border-2' :
                                    currentReport.status === 'REPORTÉ'
                                      ? CLEANING_POSTPONED_SURFACE
                                      : CLEANING_ISSUE_SURFACE
                                : isCalculatedCleaningDay 
                                  ? 'bg-white border-blue-500 text-blue-600 shadow-md border-2' 
                                  : 'bg-transparent border-gray-200 text-gray-300 opacity-20 hover:opacity-100 hover:bg-white hover:border-blue-300'
                            }`}
                          >
                            <ClipboardCheck size={14} />
                            {currentReport && (
                              <div
                                className={`absolute -top-1 -right-1 w-2 h-2 rounded-full animate-pulse ${
                                  currentReport.status === 'EFFECTUÉ' && !showOrangeOnEffectué
                                    ? 'bg-green-500'
                                    : currentReport.status === 'PRÉVU'
                                      ? 'bg-blue-500'
                                      : currentReport.status === 'REPORTÉ'
                                        ? 'bg-indigo-500'
                                        : 'bg-[#ec7f54]'
                                }`}
                              />
                            )}
                          </div>
                          );
                        })()}
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
      </div>

      {/* Booking Sidebar */}
      <AnimatePresence>
        {selectedCell && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600">
                    <CalendarIcon size={20} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-black uppercase tracking-widest text-gray-900">Gestion Date</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase">{new Date(selectedCell.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                  </div>
                </div>
                <button onClick={() => setSelectedCell(null)} className="p-2 hover:bg-gray-200 rounded-full transition-all">
                  <X size={18} />
                </button>
              </div>

              <div className="p-8 space-y-6">
                <div className="flex flex-col items-center text-center space-y-2">
                  <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-gray-400 mb-2">
                    <Home size={32} />
                  </div>
                  <span className="text-sm font-black uppercase tracking-tighter text-gray-900">{selectedCell.unitSlug}</span>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    Souhaitez-vous modifier la disponibilité de ce logement pour cette date ?
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  { (userProfile?.role === 'admin' || (userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' || userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com')) ? (
                    blockedDates.find(b => b.calendarSlug === selectedCell.unitSlug && b.date === selectedCell.date) ? (
                      <button 
                        onClick={() => {
                          const b = blockedDates.find(b => b.calendarSlug === selectedCell.unitSlug && b.date === selectedCell.date);
                          if (b?.id) handleUnblockDate(b.id);
                        }}
                        className="w-full flex items-center justify-center gap-3 bg-emerald-600 text-white font-black py-4 rounded-2xl uppercase text-[10px] tracking-widest shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 transition-all"
                      >
                        <Unlock size={16} />
                        Ouvrir la date
                      </button>
                    ) : (() => {
                      const d = new Date(selectedCell.date);
                      d.setHours(0, 0, 0, 0);
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      const isPast = d < today;

                      return isPast ? (
                        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 flex items-center gap-3 text-gray-400">
                          <AlertTriangle size={18} />
                          <span className="text-[10px] font-bold uppercase">Impossible de bloquer une date passée</span>
                        </div>
                      ) : (
                        <button 
                          onClick={() => handleBlockDate(selectedCell.unitSlug, selectedCell.date)}
                          className="w-full flex items-center justify-center gap-3 bg-zinc-900 text-white font-black py-4 rounded-2xl uppercase text-[10px] tracking-widest shadow-lg shadow-zinc-900/20 hover:bg-black transition-all"
                        >
                          <Lock size={16} />
                          Fermer la date
                        </button>
                      );
                    })()
                  ) : (
                    <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-center gap-3 text-amber-600">
                      <AlertTriangle size={18} />
                      <span className="text-[10px] font-bold uppercase">Seul l'admin peut modifier</span>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {detailCtx && detailReceipt && detailSegment && (
          <motion.div 
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            exit={{ x: 400 }}
            className="fixed right-0 top-0 bottom-0 w-[min(100vw,28rem)] max-w-full bg-white border-l border-gray-200 shadow-2xl z-50 flex flex-col"
          >
            <div className="p-6 md:p-8 border-b border-gray-100 flex justify-between items-center shrink-0">
              <h3 className="text-sm font-black uppercase tracking-widest">Détails Réservation</h3>
              <button onClick={() => setSelectedBookingContext(null)} className="p-2 hover:bg-gray-100 rounded-full transition-all">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                    <UserIcon size={24} />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-lg font-black uppercase tracking-tighter text-gray-900 truncate">
                      {detailReceipt.firstName} {detailReceipt.lastName}
                    </span>
                    {detailReceipt.phone
                      ? <PhoneLinks phone={detailReceipt.phone} />
                      : <span className="text-xs text-gray-400">Pas de tél</span>}
                  </div>
                </div>

                <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 space-y-4">
                  <div className="flex items-start gap-3">
                    <Home size={16} className="text-gray-400 mt-1 shrink-0" />
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Bloc logement (check-in)</span>
                      <AptBadge name={detailSegment.apartmentName || ''} />
                      <span className="text-[10px] font-mono text-gray-500 truncate">{detailSegment.calendarSlug}</span>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <CalendarIcon size={16} className="text-gray-400 mt-1 shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Dates sur cet appartement</span>
                      <span className="text-xs font-bold text-gray-900">
                        Du {new Date(detailSegment.startDate).toLocaleDateString('fr-FR')} au {new Date(detailSegment.endDate).toLocaleDateString('fr-FR')}
                      </span>
                      <span className="text-[10px] text-gray-400 mt-1">
                        Récap. reçu : {new Date(detailReceipt.startDate).toLocaleDateString('fr-FR')} — {new Date(detailReceipt.endDate).toLocaleDateString('fr-FR')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-2">
                  <BadgeCheck size={14} className="text-emerald-600" />
                  Check-in client (ce logement)
                </h4>
                <p className="text-[10px] text-gray-500 leading-snug">
                  Heure enregistrée au fuseau <span className="font-semibold">Africa/Douala</span> (affichage ci-dessous). kWh obligatoire si validation avant 18h au Cameroun.
                </p>

                {detailCheckIn ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-2 text-xs">
                    <div className="flex justify-between gap-2 flex-wrap">
                      <span className="font-black uppercase tracking-widest text-[10px] text-emerald-800">Enregistré</span>
                      <span className="font-mono font-bold text-emerald-900">
                        {formatCameroonDateTimeVerbose(new Date(detailCheckIn.validatedAt))}
                      </span>
                    </div>
                    <p>
                      <span className="text-gray-500">Enregistré par :</span>{' '}
                      <span className="font-bold">
                        {detailCheckIn.authorDisplayName?.trim() || '—'}
                      </span>
                    </p>
                    <p><span className="text-gray-500">kWh compteur :</span>{' '}
                      <span className="font-bold">{detailCheckIn.kwhCompteurPrepaye ?? '—'}</span>
                    </p>
                    <p><span className="text-gray-500">Pièce d’identité contrôlée :</span>{' '}
                      <span className="font-bold">{detailCheckIn.idPieceControlee}</span>
                    </p>
                    {detailCheckIn.commentaire.trim() ? (
                      <p className="text-gray-700 whitespace-pre-wrap border-t border-emerald-200/80 pt-2 mt-2">{detailCheckIn.commentaire}</p>
                    ) : null}
                  </div>
                ) : detailCanManageCheckIn ? (
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
                    <label className="block">
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                        kWh affichés sur le compteur prépayé {kwhRequiredNow ? '(obligatoire)' : '(facultatif, entrée ≥ 18h CM)'}
                      </span>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={checkInDraft.kwh}
                        onChange={(e) => setCheckInDraft((d) => ({ ...d, kwh: e.target.value }))}
                        className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono"
                        placeholder={kwhRequiredNow ? 'ex. 124.5' : 'Laisser vide si non renseigné'}
                      />
                    </label>
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 block mb-1">Pièce d’identité contrôlée</span>
                      <div className="flex gap-2">
                        {(['OUI', 'NON'] as const).map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => setCheckInDraft((d) => ({ ...d, idPiece: v }))}
                            className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                              checkInDraft.idPiece === v
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            {v === 'OUI' ? 'Oui' : 'Non'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="block">
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Commentaire libre</span>
                      <textarea
                        value={checkInDraft.comment}
                        onChange={(e) => setCheckInDraft((d) => ({ ...d, comment: e.target.value }))}
                        rows={3}
                        className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-xs resize-none"
                        placeholder="Optionnel…"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={checkInSubmitting}
                      onClick={handleValidateGuestCheckIn}
                      className="w-full bg-emerald-600 text-white font-black py-3 rounded-2xl uppercase text-[10px] tracking-widest shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 disabled:opacity-60 transition-all"
                    >
                      {checkInSubmitting ? '…' : 'Valider le check-in'}
                    </button>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-[10px] font-bold uppercase text-amber-800">
                    Pas encore enregistré — vous n’avez pas les droits pour ce logement ou votre profil est incomplet.
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400">Notes & Observations</h4>
                <div className="bg-blue-50/50 rounded-2xl p-6 border border-blue-100">
                  <p className="text-xs text-blue-900 italic leading-relaxed">
                    {detailReceipt.observations || "Aucune observation particulière pour ce séjour."}
                  </p>
                </div>
              </div>

              {detailReceipt.internalNotes && (
                <div className="space-y-4">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-amber-500 flex items-center gap-2">
                    <Lock size={10} />
                    Note interne
                  </h4>
                  <div className="bg-amber-50 rounded-2xl p-6 border border-amber-200">
                    <p className="text-xs text-amber-900 leading-relaxed whitespace-pre-wrap">
                      {detailReceipt.internalNotes}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 md:p-8 border-t border-gray-100 bg-gray-50 shrink-0">
              <button 
                onClick={() => {
                  onEdit(detailReceipt);
                  setSelectedBookingContext(null);
                }}
                className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl uppercase text-xs tracking-widest shadow-xl shadow-blue-600/20 hover:bg-blue-700 transition-all"
              >
                Voir le Reçu Complet
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
