import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  setDoc, 
  deleteDoc, 
  where,
  orderBy,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Employee, AttendanceRecord, UserProfile } from '../types';
import { 
  Users, 
  Calendar as CalendarIcon, 
  Clock, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  Coffee,
  ChevronLeft,
  ChevronRight,
  Save,
  Edit2,
  X,
  AlertCircle,
  Info,
  LogIn,
  LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AttendanceViewProps {
  userProfile: UserProfile | null;
  onAlert: (msg: string, type?: 'success' | 'error' | 'info') => void;
  currentDate: Date;
}

export default function AttendanceView({ userProfile, onAlert, currentDate }: AttendanceViewProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttendanceRecord>>({});
  const [planningData, setPlanningData] = useState<Record<string, AttendanceRecord>>({});
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [mode, setMode] = useState<'daily' | 'planning' | 'employees'>('daily');
  /** Modale entrée/sortie (remplace window.confirm — texte FR, même style que reçus / ménage) */
  const [presenceConfirm, setPresenceConfirm] = useState<
    null | { type: 'checkIn' | 'checkOut'; employeeId: string; employeeName: string; timeStr: string }
  >(null);
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [newEmployee, setNewEmployee] = useState({ name: '', role: '' });
  const planningScrollRef = useRef<HTMLDivElement>(null);

  const isMainAdmin = userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' || userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
  const isAdmin = userProfile?.role === 'admin' || isMainAdmin;
  const linkedEmployeeId = userProfile?.linkedEmployeeId;

  const canEditPresenceFor = (employeeId: string) =>
    isAdmin || (!!linkedEmployeeId && linkedEmployeeId === employeeId);

  // Auto-scroll to current day in planning mode
  useEffect(() => {
    if (mode === 'planning' && planningScrollRef.current) {
      const today = new Date();
      if (today.getMonth() === currentDate.getMonth() && today.getFullYear() === currentDate.getFullYear()) {
        const timeoutId = setTimeout(() => {
          const container = planningScrollRef.current;
          const todayEl = document.getElementById('attendance-today-column');
          const firstCol = container?.querySelector('th.sticky') as HTMLElement;
          
          if (container && todayEl && firstCol) {
            const todayRect = todayEl.getBoundingClientRect();
            const firstColRect = firstCol.getBoundingClientRect();
            
            // Position today as the 5th day (4 days of offset after the sticky column)
            const targetLeft = firstColRect.right + (4 * todayRect.width);
            const diff = todayRect.left - targetLeft;
            
            container.scrollTo({
              left: container.scrollLeft + diff,
              behavior: 'smooth'
            });
          }
        }, 150);
        return () => clearTimeout(timeoutId);
      } else {
        planningScrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
      }
    }
  }, [mode, currentDate.getTime()]);

  /**
   * Statut affiché uniquement (non cliquable) :
   * - Présent : entrée enregistrée
   * - Repos : jour de repos (planning PRÉVU_REPOS / REPOS) et pas d'entrée
   * - Absent : en service (pas de repos prévu) et pas d'entrée
   */
  const deriveStatusDisplay = (record: AttendanceRecord | undefined): 'PRÉSENT' | 'REPOS' | 'ABSENT' => {
    if (record?.checkInTime) return 'PRÉSENT';
    if (record?.status === 'PRÉVU_REPOS' || record?.status === 'REPOS') return 'REPOS';
    return 'ABSENT';
  };

  // Fetch Employees
  useEffect(() => {
    const q = query(collection(db, 'employees'), where('active', '==', true), orderBy('name'));
    return onSnapshot(q, (snap) => {
      setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
      setLoading(false);
    });
  }, []);

  // Fetch Attendance for selected date
  useEffect(() => {
    const q = query(collection(db, 'attendance'), where('date', '==', selectedDate));
    return onSnapshot(q, (snap) => {
      const data: Record<string, AttendanceRecord> = {};
      snap.docs.forEach(d => {
        const record = d.data() as AttendanceRecord;
        data[record.employeeId] = { ...record, id: d.id };
      });
      setAttendance(data);
    });
  }, [selectedDate]);

  // Fetch Planning Data (for the selected month)
  useEffect(() => {
    if (mode !== 'planning') return;
    
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const startStr = new Date(year, month, 1).toISOString().split('T')[0];
    const endStr = new Date(year, month + 1, 0).toISOString().split('T')[0];

    const q = query(
      collection(db, 'attendance'), 
      where('date', '>=', startStr),
      where('date', '<=', endStr)
    );

    return onSnapshot(q, (snap) => {
      const data: Record<string, AttendanceRecord> = {};
      snap.docs.forEach(d => {
        const record = d.data() as AttendanceRecord;
        data[`${record.employeeId}_${record.date}`] = { ...record, id: d.id };
      });
      setPlanningData(data);
    });
  }, [mode, currentDate.getTime()]);

  const handleAddEmployee = async () => {
    if (!isAdmin) {
      onAlert("Seuls les administrateurs peuvent ajouter des employés.", "error");
      return;
    }
    if (!newEmployee.name || !newEmployee.role) return;
    try {
      const id = `emp-${Date.now()}`;
      await setDoc(doc(db, 'employees', id), {
        ...newEmployee,
        active: true,
        createdAt: new Date().toISOString()
      });
      setNewEmployee({ name: '', role: '' });
      setIsAddingEmployee(false);
      onAlert("Employé ajouté", "success");
    } catch (e) {
      onAlert("Erreur lors de l'ajout", "error");
    }
  };

  const handleUpdateEmployee = async () => {
    if (!isAdmin) {
      onAlert("Seuls les administrateurs peuvent modifier des employés.", "error");
      return;
    }
    if (!editingEmployee || !editingEmployee.name || !editingEmployee.role) return;
    try {
      setLoading(true);
      await setDoc(doc(db, 'employees', editingEmployee.id), {
        ...editingEmployee,
        updatedAt: new Date().toISOString()
      });
      setEditingEmployee(null);
      onAlert("Employé mis à jour", "success");
    } catch (e) {
      onAlert("Erreur lors de la mise à jour", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEmployee = async (id: string) => {
    if (!isAdmin) {
      onAlert("Seuls les administrateurs peuvent supprimer des employés.", "error");
      return;
    }
    // Using a simple check instead of window.confirm for better iframe compatibility
    try {
      await deleteDoc(doc(db, 'employees', id));
      onAlert("Employé supprimé", "success");
    } catch (e) {
      onAlert("Erreur lors de la suppression", "error");
    }
  };

  const updateAttendance = async (employeeId: string, updates: Partial<AttendanceRecord>, customDate?: string) => {
    if (!canEditPresenceFor(employeeId)) {
      onAlert("Vous ne pouvez enregistrer la présence que pour votre fiche. Les administrateurs peuvent tout modifier.", "error");
      return;
    }
    const date = customDate || selectedDate;
    const recordId = `${employeeId}_${date}`;
    
    // Check if record already exists in local state to avoid overwriting other fields
    const existing = (customDate ? planningData[recordId] : attendance[employeeId]) || {
      employeeId,
      date,
      status: 'ABSENT',
      updatedAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(db, 'attendance', recordId), {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString()
      });
    } catch (e) {
      onAlert("Erreur de mise à jour", "error");
    }
  };

  const formatNowTime = () => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  };

  const handleCheckIn = (employeeId: string) => {
    const emp = employees.find(e => e.id === employeeId);
    setPresenceConfirm({
      type: 'checkIn',
      employeeId,
      employeeName: emp?.name ?? 'Employé',
      timeStr: formatNowTime()
    });
  };

  const handleCheckOut = (employeeId: string) => {
    const record = attendance[employeeId];
    if (!record?.checkInTime) {
      onAlert("Enregistrez d'abord l'entrée.", "info");
      return;
    }
    const emp = employees.find(e => e.id === employeeId);
    setPresenceConfirm({
      type: 'checkOut',
      employeeId,
      employeeName: emp?.name ?? 'Employé',
      timeStr: formatNowTime()
    });
  };

  const confirmPresenceAction = () => {
    if (!presenceConfirm) return;
    const { type, employeeId, timeStr } = presenceConfirm;
    setPresenceConfirm(null);
    if (type === 'checkIn') {
      void updateAttendance(employeeId, { checkInTime: timeStr, status: 'PRÉSENT' });
    } else {
      void updateAttendance(employeeId, { checkOutTime: timeStr });
    }
  };

  const planningDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 1; i <= totalDays; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  }, [currentDate.getTime()]);

  if (loading && employees.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F5F5F4]">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header & Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-8 h-8 text-indigo-600" />
            Gestion des Présences
          </h1>
          <p className="text-slate-500">Suivi quotidien et planning des employés</p>
        </div>

        <div className="flex bg-slate-100 p-1 rounded-xl self-start">
          <button 
            onClick={() => setMode('daily')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'daily' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            Quotidien
          </button>
          <button 
            onClick={() => setMode('planning')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'planning' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            Planning
          </button>
          {isAdmin && (
            <button 
              onClick={() => setMode('employees')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'employees' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Employés
            </button>
          )}
        </div>
      </div>

      {/* Daily View Content */}
      {mode === 'daily' && (
        <div className="space-y-6">
          <div className="flex items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
            <CalendarIcon className="w-5 h-5 text-slate-400" />
            <input 
              type="date" 
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent border-none focus:ring-0 font-medium text-slate-700"
            />
            <div className="flex gap-2 ml-auto">
              <button 
                onClick={() => {
                  const d = new Date(selectedDate);
                  d.setDate(d.getDate() - 1);
                  setSelectedDate(d.toISOString().split('T')[0]);
                }}
                className="p-2 hover:bg-slate-50 rounded-lg transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button 
                onClick={() => {
                  const d = new Date(selectedDate);
                  d.setDate(d.getDate() + 1);
                  setSelectedDate(d.toISOString().split('T')[0]);
                }}
                className="p-2 hover:bg-slate-50 rounded-lg transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          {!isAdmin && !linkedEmployeeId && (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">
              <Info className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
              <p>
                Pour enregistrer <strong>votre</strong> entrée / sortie, un administrateur doit d’abord lier ce compte à votre fiche employé dans
                <span className="whitespace-nowrap"> « Gestion des accès »</span> (colonne Présence).
              </p>
            </div>
          )}

          <div className="grid gap-4">
            {employees.filter(e => e.active).map(emp => {
              const record = attendance[emp.id];
              const display = deriveStatusDisplay(record);
              const isPlannedRepos = record?.status === 'PRÉVU_REPOS';
              const canEdit = canEditPresenceFor(emp.id);
              
              return (
                <motion.div 
                  key={emp.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row md:items-center gap-6 ${
                    !isAdmin && !canEdit ? 'opacity-80' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-slate-900 text-lg">{emp.name}</h3>
                      {isPlannedRepos && (
                        <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">Repos au planning</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500">{emp.role}</p>
                  </div>

                  <div
                    className="flex items-center justify-center"
                    title="Statut calculé automatiquement (non modifiable ici)"
                  >
                    {display === 'PRÉSENT' && (
                      <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-emerald-100 text-emerald-800 border border-emerald-200/80 select-none">
                        <CheckCircle2 className="w-4 h-4 shrink-0" /> Présent
                      </span>
                    )}
                    {display === 'ABSENT' && (
                      <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-rose-100 text-rose-800 border border-rose-200/80 select-none">
                        <XCircle className="w-4 h-4 shrink-0" /> Absent
                      </span>
                    )}
                    {display === 'REPOS' && (
                      <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-amber-100 text-amber-900 border border-amber-200/80 select-none">
                        <Coffee className="w-4 h-4 shrink-0" /> Repos
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col md:flex-row items-start md:items-stretch gap-4 md:gap-8 border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-8 w-full md:w-auto">
                    <div className="space-y-2 shrink-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                        <Clock className="w-4 h-4" /> Entrée / Sortie
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {!record?.checkInTime ? (
                          <button
                            type="button"
                            onClick={() => handleCheckIn(emp.id)}
                            disabled={!canEdit}
                            className="text-xs font-bold bg-indigo-600 text-white px-3 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
                          >
                            Valider Entrée
                          </button>
                        ) : (
                          <span className="text-lg font-mono font-bold text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-lg tabular-nums" title="Heure d'entrée enregistrée">
                            {record.checkInTime}
                          </span>
                        )}
                        <span className="text-slate-300">—</span>
                        {!record?.checkOutTime ? (
                          <button
                            type="button"
                            onClick={() => handleCheckOut(emp.id)}
                            disabled={!record?.checkInTime || !canEdit}
                            className="text-xs font-bold bg-slate-700 text-white px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Valider Sortie
                          </button>
                        ) : (
                          <span className="text-lg font-mono font-bold text-slate-800 bg-slate-100 px-3 py-1.5 rounded-lg tabular-nums" title="Heure de sortie enregistrée">
                            {record.checkOutTime}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 flex-1 w-full min-w-0 max-w-md">
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                        <Edit2 className="w-4 h-4" /> Note / justificatif
                      </div>
                      <input 
                        type="text"
                        placeholder="Retard, absence…"
                        value={record?.notes || ''}
                        onChange={(e) => updateAttendance(emp.id, { notes: e.target.value })}
                        readOnly={!canEdit}
                        className={`w-full text-sm border-slate-200 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 ${
                          !canEdit ? 'bg-slate-50 cursor-not-allowed text-slate-500' : ''
                        }`}
                      />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* Planning View Content */}
      {mode === 'planning' && (
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-900">Planning des Repos</h2>
            <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg max-w-md">
              <Info className="w-4 h-4 text-indigo-500 shrink-0" />
              <span>
                {isAdmin
                  ? 'Cliquez sur une case pour définir un repos programmé (tous les employés).'
                  : 'Vous ne pouvez modifier le planning que sur votre propre ligne (cellules de votre ligne).'}
              </span>
            </div>
          </div>
          <div className="overflow-x-auto" ref={planningScrollRef}>
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className="p-4 text-left text-sm font-bold text-slate-600 border-b border-slate-100 sticky left-0 bg-slate-50 z-10">Employé</th>
                  {planningDays.map((d, i) => {
                    const isToday = d.toDateString() === new Date().toDateString();
                    return (
                      <th 
                        key={i} 
                        id={isToday ? 'attendance-today-column' : undefined}
                        className="p-4 text-center text-xs font-bold text-slate-600 border-b border-slate-100 min-w-[100px]"
                      >
                        <div className="uppercase opacity-50">{d.toLocaleDateString('fr-FR', { weekday: 'short' })}</div>
                        <div className="text-sm">{d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {employees.filter(e => e.active).map(emp => (
                  <tr key={emp.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-4 text-sm font-bold text-slate-900 border-b border-slate-100 sticky left-0 bg-white z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                      {emp.name}
                    </td>
                    {planningDays.map((d, i) => {
                      const dateStr = d.toISOString().split('T')[0];
                      const record = planningData[`${emp.id}_${dateStr}`];
                      const isRepos = record?.status === 'PRÉVU_REPOS' || record?.status === 'REPOS';
                      const isToday = d.toDateString() === new Date().toDateString();
                      const canEdit = canEditPresenceFor(emp.id);
                      
                      return (
                        <td key={i} className={`p-2 border-b border-slate-100 text-center transition-colors ${isToday ? 'bg-slate-500/[0.05]' : ''}`}>
                          <button 
                            type="button"
                            disabled={!canEdit}
                            onClick={() => {
                              if (isRepos) {
                                updateAttendance(emp.id, { status: 'ABSENT' }, dateStr);
                              } else {
                                updateAttendance(emp.id, { status: 'PRÉVU_REPOS' }, dateStr);
                              }
                            }}
                            className={`w-full h-12 rounded-xl transition-all flex items-center justify-center group ${
                              isRepos 
                                ? 'bg-amber-100 text-amber-600 shadow-inner' 
                                : 'bg-slate-50 text-slate-300 hover:bg-slate-100 hover:text-slate-400'
                            } ${!canEdit ? 'opacity-50 cursor-not-allowed hover:bg-slate-50' : ''}`}
                          >
                            <Coffee className={`w-5 h-5 transition-transform group-active:scale-90 ${isRepos ? 'scale-110' : ''}`} />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Employees Management Content */}
      {mode === 'employees' && isAdmin && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-slate-900">Liste des Employés</h2>
            <button 
              onClick={() => setIsAddingEmployee(true)}
              className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-md active:scale-95"
            >
              <Plus className="w-4 h-4" /> Ajouter Employé
            </button>
          </div>

          <AnimatePresence>
            {isAddingEmployee && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-white p-6 rounded-2xl shadow-sm border border-indigo-100 overflow-hidden"
              >
                <div className="grid md:grid-cols-3 gap-4 items-end">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nom Complet</label>
                    <input 
                      type="text" 
                      value={newEmployee.name}
                      onChange={(e) => setNewEmployee({...newEmployee, name: e.target.value})}
                      className="w-full border-slate-200 rounded-xl focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="Ex: Paola"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Rôle / Poste</label>
                    <input 
                      type="text" 
                      value={newEmployee.role}
                      onChange={(e) => setNewEmployee({...newEmployee, role: e.target.value})}
                      className="w-full border-slate-200 rounded-xl focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="Ex: Ménagère"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={handleAddEmployee}
                      className="flex-1 bg-indigo-600 text-white px-4 py-2.5 rounded-xl font-bold hover:bg-indigo-700 transition-colors"
                    >
                      Enregistrer
                    </button>
                    <button 
                      onClick={() => setIsAddingEmployee(false)}
                      className="px-4 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {employees.map(emp => (
              <div key={emp.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between group">
                {editingEmployee?.id === emp.id ? (
                  <div className="flex-1 space-y-3 p-2">
                    <input 
                      type="text" 
                      value={editingEmployee.name}
                      onChange={(e) => setEditingEmployee({...editingEmployee, name: e.target.value})}
                      className="w-full text-sm border-slate-200 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    <input 
                      type="text" 
                      value={editingEmployee.role}
                      onChange={(e) => setEditingEmployee({...editingEmployee, role: e.target.value})}
                      className="w-full text-sm border-slate-200 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    <div className="flex gap-2">
                      <button 
                        onClick={handleUpdateEmployee}
                        className="flex-1 bg-emerald-600 text-white py-1.5 rounded-lg text-xs font-bold"
                      >
                        OK
                      </button>
                      <button 
                        onClick={() => setEditingEmployee(null)}
                        className="flex-1 bg-slate-100 text-slate-600 py-1.5 rounded-lg text-xs font-bold"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <h4 className="font-bold text-slate-900">{emp.name}</h4>
                      <p className="text-xs text-slate-500">{emp.role}</p>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => setEditingEmployee(emp)}
                        className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDeleteEmployee(emp.id)}
                        className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {presenceConfirm && (
          <motion.div
            key={`presence-confirm-${presenceConfirm.employeeId}-${presenceConfirm.type}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="presence-confirm-title"
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setPresenceConfirm(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl text-center pointer-events-auto max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain touch-manipulation"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center mx-auto mb-5 ${
                  presenceConfirm.type === 'checkIn' ? 'bg-blue-50 text-blue-600' : 'bg-slate-800 text-white'
                }`}
              >
                {presenceConfirm.type === 'checkIn' ? (
                  <LogIn className="w-7 h-7 sm:w-8 sm:h-8" strokeWidth={2} />
                ) : (
                  <LogOut className="w-7 h-7 sm:w-8 sm:h-8" strokeWidth={2} />
                )}
              </div>
              <h3
                id="presence-confirm-title"
                className="text-lg sm:text-xl font-black uppercase tracking-tight text-gray-900 mb-2"
              >
                {presenceConfirm.type === 'checkIn' ? 'Valider l’entrée ?' : 'Valider la sortie ?'}
              </h3>
              <p className="text-sm text-gray-500 mb-2 leading-relaxed">
                <span className="font-bold text-gray-900">{presenceConfirm.employeeName}</span>
              </p>
              <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                Enregistrer l’heure à{' '}
                <span className="font-mono font-bold text-gray-900 tabular-nums">{presenceConfirm.timeStr}</span> — non
                modifiable après validation.
              </p>
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={confirmPresenceAction}
                  className={
                    presenceConfirm.type === 'checkIn'
                      ? 'w-full bg-blue-600 text-white font-black py-3.5 sm:py-4 rounded-2xl uppercase text-xs tracking-widest shadow-xl shadow-blue-600/20 hover:bg-blue-700 transition-colors active:scale-[0.99]'
                      : 'w-full bg-slate-800 text-white font-black py-3.5 sm:py-4 rounded-2xl uppercase text-xs tracking-widest shadow-xl shadow-slate-800/20 hover:bg-slate-900 transition-colors active:scale-[0.99]'
                  }
                >
                  Confirmer
                </button>
                <button
                  type="button"
                  onClick={() => setPresenceConfirm(null)}
                  className="w-full bg-gray-100 text-gray-600 font-black py-3.5 sm:py-4 rounded-2xl uppercase text-xs tracking-widest hover:bg-gray-200 transition-colors"
                >
                  Annuler
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
