import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import { db } from '../firebase';
import { ReceiptData, CleaningReport, UserProfile, BlockedDate } from '../types';
import { TARIFS, SITES } from '../constants';
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
  AlertTriangle
} from 'lucide-react';
import { 
  collection, 
  query, 
  onSnapshot,
  where,
  addDoc,
  deleteDoc,
  doc
} from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';

interface CalendarViewProps {
  onEdit: (receipt: ReceiptData) => void;
  onOpenCleaning: (menageId: string, slug: string, date: string) => void;
  viewMode: 'reservations' | 'cleaning' | 'presence';
  onViewModeChange: (mode: 'reservations' | 'cleaning' | 'presence') => void;
  userProfile: UserProfile | null;
  onAlert: (msg: string, type?: 'success' | 'error' | 'info') => void;
  initialScrollPosition?: number;
  onScrollChange?: (scrollLeft: number) => void;
  currentDate: Date;
  onDateChange: (date: Date) => void;
}

export default function CalendarView({ 
  onEdit, 
  onOpenCleaning, 
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
  const [selectedBooking, setSelectedBooking] = useState<ReceiptData | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ unitSlug: string, date: string } | null>(null);
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasRestoredScroll = useRef(false);

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
            const containerRect = container.getBoundingClientRect();
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
        }, 150); // Slightly longer timeout to ensure layout is stable
        return () => clearTimeout(timeoutId);
      } else if (!hasRestoredScroll.current) {
        // Only scroll to 0 if we haven't restored a position
        scrollContainerRef.current.scrollTo({ left: 0, behavior: 'smooth' });
      }
    }
  }, [viewMode, currentDate.getTime()]);

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
    const units: { slug: string, category: string, color: string }[] = [];
    
    const SITE_COLORS: { [key: string]: string } = {
      'RIETI': 'bg-emerald-500',
      'MODENA': 'bg-blue-500',
      'MATERA': 'bg-orange-500',
      'GALLAGHERS': 'bg-purple-500',
      'BGT': 'bg-purple-500', // Gallagers is in Bangangté (BGT)
      'DEFAULT': 'bg-gray-500'
    };

    Object.entries(TARIFS).forEach(([category, data]) => {
      const upperCategory = category.toUpperCase();
      let color = SITE_COLORS.DEFAULT;
      
      if (upperCategory.includes('RIETI')) color = SITE_COLORS.RIETI;
      else if (upperCategory.includes('MODENA')) color = SITE_COLORS.MODENA;
      else if (upperCategory.includes('MATERA')) color = SITE_COLORS.MATERA;
      else if (upperCategory.includes('GALLAGHERS') || upperCategory.includes('CITY')) color = SITE_COLORS.GALLAGHERS;

      if (data.units) {
        data.units.forEach(slug => {
          // Avoid duplicates if multiple categories point to same unit
          if (!units.find(u => u.slug === slug)) {
            units.push({ slug, category, color });
          }
        });
      } else {
        const slug = category.toLowerCase();
        if (!units.find(u => u.slug === slug)) {
          units.push({ slug, category, color });
        }
      }
    });
    
    // Sort units to keep sites together with specific priority
    const SITE_PRIORITY: { [key: string]: number } = {
      'MATERA': 1,
      'RIETI': 2,
      'MODENA': 3,
      'GALLAGHERS': 4,
      'CITY': 4,
      'BGT': 4
    };

    return units.sort((a, b) => {
      const getPriority = (cat: string) => {
        const upper = cat.toUpperCase();
        if (upper.includes('MATERA')) return SITE_PRIORITY.MATERA;
        if (upper.includes('RIETI')) return SITE_PRIORITY.RIETI;
        if (upper.includes('MODENA')) return SITE_PRIORITY.MODENA;
        if (upper.includes('GALLAGHERS') || upper.includes('CITY')) return SITE_PRIORITY.GALLAGHERS;
        return 99;
      };

      const priorityA = getPriority(a.category);
      const priorityB = getPriority(b.category);

      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      return a.slug.localeCompare(b.slug);
    });
  }, []);

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
    return receipts.find(r => 
      r.calendarSlug === unitSlug && 
      dateStr >= r.startDate && 
      dateStr < r.endDate
    );
  };

  const getCleaningTasks = (booking: ReceiptData) => {
    const tasks: string[] = [];
    const start = new Date(booking.startDate);
    const end = new Date(booking.endDate);
    
    // Rule: Check-in (control)
    tasks.push(booking.startDate);
    
    // Rule: Every 3 days
    let current = new Date(start);
    current.setDate(current.getDate() + 3);
    while (current < end) {
      tasks.push(getLocalDateString(current));
      current.setDate(current.getDate() + 3);
    }
    
    // Rule: Check-out
    tasks.push(booking.endDate);
    
    return [...new Set(tasks)]; // Unique dates
  };

  const getCleaningReport = (unitSlug: string, dateStr: string) => {
    return cleaningReports.find(r => r.calendarSlug === unitSlug && r.dateIntervention === dateStr);
  };

  const nextMonth = () => onDateChange(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  const prevMonth = () => onDateChange(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const monthName = currentDate.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });

  const handleBlockDate = async (unitSlug: string, date: string) => {
    if (userProfile?.role !== 'admin') {
      onAlert("Seul l'administrateur peut bloquer des dates", "error");
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
      await addDoc(collection(db, 'blocked_dates'), {
        date,
        calendarSlug: unitSlug,
        createdAt: new Date().toISOString(),
        authorUid: userProfile.uid,
        reason: 'Travaux / Maintenance'
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
    if (userProfile?.role !== 'admin') {
      onAlert("Seul l'administrateur peut débloquer des dates", "error");
      return;
    }
    try {
      await deleteDoc(doc(db, 'blocked_dates', blockedId));
      onAlert("Date débloquée avec succès", "success");
      setSelectedCell(null);
    } catch (error) {
      console.error("Error unblocking date:", error);
      onAlert("Erreur lors du déblocage de la date", "error");
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
      {/* Header */}
      <div className="h-auto md:h-20 bg-white border-b border-gray-200 px-4 md:px-8 py-4 md:py-0 flex flex-col md:flex-row items-start md:items-center justify-between sticky top-0 z-40 gap-4">
        <div className="flex items-center gap-4 md:gap-8">
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
            <table className="w-full border-collapse table-fixed min-w-[1500px]">
            <thead className="sticky top-0 z-30">
              <tr className="bg-zinc-900 text-white">
                <th className="w-[120px] md:w-64 sticky left-0 z-40 bg-zinc-900 border-b border-r border-white/10 p-4 text-left text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Logements
                </th>
                {daysInMonth.map(date => {
                  const isToday = date.toDateString() === new Date().toDateString();
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  return (
                    <th 
                      key={date.toISOString()} 
                      id={isToday ? 'calendar-today-column' : undefined}
                      className={`w-16 border-b border-white/10 p-2 text-center ${isToday ? 'bg-blue-900/50' : isWeekend ? 'bg-white/5' : ''}`}
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
              {allUnits.map((unit) => (
                <tr key={unit.slug} className="group hover:bg-gray-50/50 transition-all">
                  <td className="sticky left-0 z-20 bg-white border-r border-b border-gray-100 p-4 group-hover:bg-gray-50 transition-all w-[120px] md:w-64">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-8 rounded-full ${unit.color}`} />
                      <div className="flex flex-col overflow-hidden">
                        <span className="text-[10px] font-black uppercase tracking-tight text-gray-900 truncate w-20 md:w-40">
                          {unit.slug}
                        </span>
                        <span className="text-[8px] font-bold text-gray-400 uppercase tracking-widest truncate">
                          {unit.category}
                        </span>
                      </div>
                    </div>
                  </td>
                  {daysInMonth.map(date => {
                    const dateStr = getLocalDateString(date);
                    const booking = getBookingForUnitAndDay(unit.slug, date);
                    const isToday = date.toDateString() === new Date().toDateString();
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                    
                    const blockedDate = blockedDates.find(b => b.calendarSlug === unit.slug && b.date === dateStr);
                    const isBlocked = !!blockedDate;

                    // Cleaning Logic
                    const cleaningDates = booking ? getCleaningTasks(booking) : [];
                    const isCalculatedCleaningDay = cleaningDates.includes(dateStr);
                    const report = getCleaningReport(unit.slug, dateStr);
                    // Only show report if it's MANUAL or associated with a VALID receipt
                    const isValidReport = report && (report.menageId === 'MANUAL' || receipts.some(r => r.receiptId === report.menageId));
                    const currentReport = isValidReport ? report : null;
                    const isCleaningDay = isCalculatedCleaningDay || !!currentReport;

                    return (
                      <td 
                        key={date.toISOString()} 
                        onClick={() => {
                          if (viewMode === 'reservations' && !booking) {
                            setSelectedCell({ unitSlug: unit.slug, date: dateStr });
                          }
                        }}
                        className={`border-r border-b border-gray-50 h-16 relative transition-colors cursor-pointer ${isToday ? 'bg-slate-500/[0.05]' : isWeekend ? 'bg-gray-50/30' : ''}`}
                      >
                        {viewMode === 'reservations' && isBlocked && (
                          <div className="absolute inset-0 bg-red-50/50 flex items-center justify-center overflow-hidden">
                            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #ef4444, #ef4444 10px, transparent 10px, transparent 20px)' }} />
                            <Lock size={14} className="text-red-400 relative z-10" />
                          </div>
                        )}

                        {viewMode === 'reservations' && booking && (
                          <div 
                            onClick={() => setSelectedBooking(booking)}
                            className={`absolute inset-y-2 inset-x-0 mx-1 rounded-md flex items-center justify-center cursor-pointer transition-all hover:scale-[1.02] shadow-sm ${unit.color} text-white`}
                          >
                            <span className="text-[9px] font-black uppercase tracking-tighter truncate px-1">
                              {booking.lastName}
                            </span>
                          </div>
                        )}

                        {viewMode === 'cleaning' && (
                          <div 
                            onClick={() => onOpenCleaning(booking?.receiptId || 'MANUAL', unit.slug, dateStr)}
                            className={`absolute inset-y-2 inset-x-2 rounded-lg flex items-center justify-center cursor-pointer transition-all hover:scale-110 shadow-sm border ${
                              currentReport 
                                ? currentReport.status === 'EFFECTUÉ' ? 'bg-green-100 border-green-500 text-green-600 shadow-md border-2' : 
                                  currentReport.status === 'PRÉVU' ? 'bg-white border-blue-500 text-blue-600 shadow-md border-2' :
                                  'bg-orange-100 border-orange-500 text-orange-600 shadow-md border-2'
                                : isCalculatedCleaningDay 
                                  ? 'bg-white border-blue-500 text-blue-600 shadow-md border-2' 
                                  : 'bg-transparent border-gray-200 text-gray-300 opacity-20 hover:opacity-100 hover:bg-white hover:border-blue-300'
                            }`}
                          >
                            <ClipboardCheck size={14} />
                            {currentReport && <div className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
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
                  {userProfile?.role === 'admin' ? (
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

        {selectedBooking && (
          <motion.div 
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            exit={{ x: 400 }}
            className="fixed right-0 top-0 bottom-0 w-96 bg-white border-l border-gray-200 shadow-2xl z-50 flex flex-col"
          >
            <div className="p-8 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-sm font-black uppercase tracking-widest">Détails Réservation</h3>
              <button onClick={() => setSelectedBooking(null)} className="p-2 hover:bg-gray-100 rounded-full transition-all">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-8">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                    <UserIcon size={24} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-lg font-black uppercase tracking-tighter text-gray-900">
                      {selectedBooking.firstName} {selectedBooking.lastName}
                    </span>
                    <span className="text-xs text-gray-400 font-bold">{selectedBooking.phone}</span>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 space-y-4">
                  <div className="flex items-start gap-3">
                    <Home size={16} className="text-gray-400 mt-1" />
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Logement</span>
                      <span className="text-xs font-bold text-gray-900">{selectedBooking.apartmentName}</span>
                      <span className="text-[10px] text-blue-600 font-bold uppercase mt-1">{selectedBooking.calendarSlug}</span>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <CalendarIcon size={16} className="text-gray-400 mt-1" />
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Séjour</span>
                      <span className="text-xs font-bold text-gray-900">
                        Du {new Date(selectedBooking.startDate).toLocaleDateString('fr-FR')} au {new Date(selectedBooking.endDate).toLocaleDateString('fr-FR')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400">Notes & Observations</h4>
                <div className="bg-blue-50/50 rounded-2xl p-6 border border-blue-100">
                  <p className="text-xs text-blue-900 italic leading-relaxed">
                    {selectedBooking.observations || "Aucune observation particulière pour ce séjour."}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-8 border-t border-gray-100 bg-gray-50">
              <button 
                onClick={() => {
                  onEdit(selectedBooking);
                  setSelectedBooking(null);
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
