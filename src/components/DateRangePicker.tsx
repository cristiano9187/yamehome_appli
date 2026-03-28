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
            className="absolute z-[100] mt-2 bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-gray-100 p-5 left-1/2 -translate-x-1/2 md:left-0 md:translate-x-0 w-[320px]"
          >
            <div className="relative flex justify-center items-center mb-6">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Période de séjour</span>
              <button 
                onClick={() => setIsOpen(false)}
                className="absolute right-0 p-2 hover:bg-gray-100 rounded-full transition-all"
              >
                <X size={16} className="text-gray-400" />
              </button>
            </div>

            <DayPicker
              mode="range"
              selected={localRange}
              onSelect={handleSelect}
              locale={fr}
              startMonth={new Date(2024, 0)}
              endMonth={new Date(2030, 11)}
              className="rdp-custom mx-auto"
              classNames={{
                months: "flex flex-col",
                month: "relative",
                month_caption: "flex justify-center items-center h-14 bg-blue-50/80 rounded-2xl border border-blue-100/50 mb-6",
                caption_label: "text-sm font-black uppercase tracking-[0.15em] text-blue-800",
                month_grid: "w-full border-collapse",
                weekdays: "flex mb-2",
                weekday: "text-gray-400 w-10 font-black text-[10px] uppercase flex items-center justify-center h-8",
                week: "flex w-full mt-1",
                day: "h-10 w-10 p-0 relative flex items-center justify-center",
                day_button: "h-9 w-9 p-0 font-bold aria-selected:opacity-100 hover:bg-blue-50 rounded-xl transition-all flex items-center justify-center text-sm",
                range_start: "bg-blue-600 text-white hover:bg-blue-600 rounded-r-none",
                range_end: "bg-blue-600 text-white hover:bg-blue-600 rounded-l-none",
                selected: "bg-blue-100 text-blue-600 rounded-none first:rounded-l-xl last:rounded-r-xl",
                today: "text-blue-600 font-black ring-2 ring-blue-100 ring-offset-2 rounded-xl",
                outside: "text-gray-300 opacity-30",
                disabled: "text-gray-300 opacity-30 cursor-not-allowed",
                range_middle: "bg-blue-50 text-blue-600",
                hidden: "invisible",
              }}
              components={{
                Nav: (props) => (
                  <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-2 h-14 z-10 pointer-events-none">
                    <button
                      type="button"
                      onClick={props.onPreviousClick}
                      disabled={!props.previousMonth}
                      className="h-10 w-10 bg-white border-2 border-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all flex items-center justify-center rounded-xl shadow-sm pointer-events-auto disabled:opacity-20 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={props.onNextClick}
                      disabled={!props.nextMonth}
                      className="h-10 w-10 bg-white border-2 border-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all flex items-center justify-center rounded-xl shadow-sm pointer-events-auto disabled:opacity-20 disabled:cursor-not-allowed"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                )
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
