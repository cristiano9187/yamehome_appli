import React, { useState, useRef, useEffect } from 'react';
import { DayPicker, DateRange } from 'react-day-picker';
import { format, parseISO, isValid, isAfter, isBefore } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Calendar as CalendarIcon, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onChange: (start: string, end: string) => void;
  disabled?: boolean;
}

export default function DateRangePicker({ startDate, endDate, onChange, disabled }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [localRange, setLocalRange] = useState<DateRange | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize local range when opening
  useEffect(() => {
    if (isOpen) {
      setLocalRange({
        from: startDate ? parseISO(startDate) : undefined,
        to: endDate ? parseISO(endDate) : undefined,
      });
    }
  }, [isOpen, startDate, endDate]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (selectedRange: DateRange | undefined) => {
    setLocalRange(selectedRange);
  };

  const handleValidate = () => {
    if (localRange?.from && localRange?.to) {
      const fromStr = format(localRange.from, 'yyyy-MM-dd');
      const toStr = format(localRange.to, 'yyyy-MM-dd');
      onChange(fromStr, toStr);
      setIsOpen(false);
    }
  };

  const displayValue = () => {
    if (!startDate) return 'Sélectionner les dates';
    const start = format(parseISO(startDate), 'dd MMM yyyy', { locale: fr });
    if (!endDate) return `${start} - ...`;
    const end = format(parseISO(endDate), 'dd MMM yyyy', { locale: fr });
    return `${start} au ${end}`;
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[9px] font-bold text-gray-400 uppercase ml-1">Arrivée</label>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setIsOpen(true)}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none disabled:opacity-50 text-left flex items-center justify-between hover:border-blue-500 transition-all"
          >
            <span className={startDate ? 'text-gray-900' : 'text-gray-400'}>
              {startDate ? format(parseISO(startDate), 'dd/MM/yyyy') : 'Arrivée'}
            </span>
            <CalendarIcon size={12} className="text-gray-400" />
          </button>
        </div>
        <div className="space-y-1">
          <label className="text-[9px] font-bold text-gray-400 uppercase ml-1">Départ</label>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setIsOpen(true)}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none disabled:opacity-50 text-left flex items-center justify-between hover:border-blue-500 transition-all"
          >
            <span className={endDate ? 'text-gray-900' : 'text-gray-400'}>
              {endDate ? format(parseISO(endDate), 'dd/MM/yyyy') : 'Départ'}
            </span>
            <CalendarIcon size={12} className="text-gray-400" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute z-[100] mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 p-4 left-0 right-0 md:right-auto md:left-0 md:w-[320px]"
          >
            <div className="flex justify-between items-center mb-4">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Période de séjour</span>
              <button 
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-gray-100 rounded-full transition-all"
              >
                <X size={14} className="text-gray-400" />
              </button>
            </div>

            <DayPicker
              mode="range"
              selected={localRange}
              onSelect={handleSelect}
              locale={fr}
              startMonth={new Date(2024, 0)}
              endMonth={new Date(2030, 11)}
              className="rdp-custom"
              classNames={{
                months: "flex flex-col space-y-4",
                month: "space-y-4",
                month_caption: "flex justify-center pt-1 relative items-center mb-4",
                caption_label: "text-sm font-black uppercase tracking-widest text-gray-900",
                nav: "flex items-center",
                nav_button: "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 transition-all flex items-center justify-center rounded-lg hover:bg-gray-100",
                nav_button_previous: "absolute left-1",
                nav_button_next: "absolute right-1",
                month_grid: "w-full border-collapse space-y-1",
                weekdays: "flex",
                weekday: "text-gray-400 rounded-md w-9 font-black text-[10px] uppercase flex items-center justify-center h-8",
                week: "flex w-full mt-1",
                day: "h-9 w-9 p-0 relative flex items-center justify-center",
                day_button: "h-9 w-9 p-0 font-bold aria-selected:opacity-100 hover:bg-blue-50 rounded-lg transition-all flex items-center justify-center",
                range_start: "bg-blue-600 text-white hover:bg-blue-600 rounded-r-none",
                range_end: "bg-blue-600 text-white hover:bg-blue-600 rounded-l-none",
                selected: "bg-blue-100 text-blue-600 rounded-none first:rounded-l-lg last:rounded-r-lg",
                today: "text-blue-600 font-black underline underline-offset-4",
                outside: "text-gray-300 opacity-50",
                disabled: "text-gray-300 opacity-50 cursor-not-allowed",
                range_middle: "bg-blue-50 text-blue-600",
                hidden: "invisible",
              }}
              components={{
                Chevron: (props) => {
                  if (props.orientation === 'left') return <ChevronLeft size={16} />;
                  return <ChevronRight size={16} />;
                }
              }}
            />

            <div className="mt-4 pt-4 border-t border-gray-50 flex justify-between items-center">
              <div className="flex flex-col">
                <span className="text-[8px] font-black text-gray-400 uppercase">Séjour sélectionné</span>
                <span className="text-[10px] font-bold text-blue-600">
                  {localRange?.from && localRange?.to 
                    ? `${format(localRange.from, 'dd/MM')} au ${format(localRange.to, 'dd/MM')}` 
                    : localRange?.from 
                      ? `Arrivée le ${format(localRange.from, 'dd/MM')}`
                      : 'Sélectionnez vos dates'}
                </span>
              </div>
              {localRange?.from && localRange?.to && (
                <button 
                  onClick={handleValidate}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all"
                >
                  Valider
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
