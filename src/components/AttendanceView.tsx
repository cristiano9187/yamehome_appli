import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  setDoc, 
  deleteDoc, 
  getDoc,
  where,
  orderBy,
  Timestamp
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Employee, AttendanceRecord, UserProfile } from '../types';
import { SITES } from '../constants';
import { 
  Users, 
  Calendar as CalendarIcon, 
  Clock, 
  MapPin, 
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
  Info
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
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [newEmployee, setNewEmployee] = useState({ name: '', role: '' });
  const planningScrollRef = useRef<HTMLDivElement>(null);

  const isMainAdmin = userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' || userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
  const isAdmin = userProfile?.role === 'admin' || isMainAdmin;

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

  const filteredSites = useMemo(() => {
    const isMainAdmin = userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' || userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
    const isAdmin = userProfile?.role === 'admin' || isMainAdmin;
    if (isAdmin) return SITES;

    const allowedSites = userProfile?.allowedSites || [];
    if (allowedSites.length === 0) return SITES;

    return SITES.filter(site => {
      const upperSite = site.toUpperCase();
      return allowedSites.some(s => {
        const upperS = s.toUpperCase();
        if (upperSite === 'BGT') return upperS.includes('GALLAGHERS') || upperS.includes('CITY');
        return upperS.includes(upperSite);
      });
    });
  }, [userProfile?.allowedSites, userProfile?.role, userProfile?.email]);

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

  const handleCheckIn = (employeeId: string) => {
    const record = attendance[employeeId];
    if (!record?.checkInSite) {
      onAlert("Veuillez sélectionner un site d'entrée", "info");
      return;
    }
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    updateAttendance(employeeId, { 
      checkInTime: timeStr, 
      status: 'PRÉSENT'
    });
  };

  const handleCheckOut = (employeeId: string) => {
    const record = attendance[employeeId];
    if (!record?.checkOutSite) {
      onAlert("Veuillez sélectionner un site de sortie", "info");
      return;
    }
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    updateAttendance(employeeId, { checkOutTime: timeStr });
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

          <div className="grid gap-4">
            {employees.filter(e => e.active).map(emp => {
              const record = attendance[emp.id];
              const isRepos = record?.status === 'REPOS' || record?.status === 'PRÉVU_REPOS';
              
              return (
                <motion.div 
                  key={emp.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row md:items-center gap-6"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-900 text-lg">{emp.name}</h3>
                      {record?.status === 'PRÉVU_REPOS' && (
                        <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">Repos Programmé</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500">{emp.role}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button 
                      onClick={() => updateAttendance(emp.id, { status: 'PRÉSENT' })}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all ${record?.status === 'PRÉSENT' ? 'bg-emerald-100 text-emerald-700 border-2 border-emerald-200' : 'bg-slate-50 text-slate-600 border-2 border-transparent hover:bg-slate-100'}`}
                    >
                      <CheckCircle2 className="w-4 h-4" /> Présent
                    </button>
                    <button 
                      onClick={() => updateAttendance(emp.id, { status: 'ABSENT', checkInTime: '', checkOutTime: '' })}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all ${record?.status === 'ABSENT' ? 'bg-rose-100 text-rose-700 border-2 border-rose-200' : 'bg-slate-50 text-slate-600 border-2 border-transparent hover:bg-slate-100'}`}
                    >
                      <XCircle className="w-4 h-4" /> Absent
                    </button>
                    <button 
                      onClick={() => updateAttendance(emp.id, { status: 'REPOS', checkInTime: '', checkOutTime: '' })}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all ${isRepos ? 'bg-amber-100 text-amber-700 border-2 border-amber-200' : 'bg-slate-50 text-slate-600 border-2 border-transparent hover:bg-slate-100'}`}
                    >
                      <Coffee className="w-4 h-4" /> Repos
                    </button>
                  </div>

                  <div className="flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-8 border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-8">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                        <Clock className="w-4 h-4" /> Entrée / Sortie
                      </div>
                      <div className="flex items-center gap-2">
                        {!record?.checkInTime ? (
                          <button 
                            onClick={() => handleCheckIn(emp.id)}
                            className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors"
                          >
                            Valider Entrée
                          </button>
                        ) : (
                          <span className="text-lg font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">
                            {record.checkInTime}
                          </span>
                        )}
                        <span className="text-slate-300">—</span>
                        {!record?.checkOutTime ? (
                          <button 
                            onClick={() => handleCheckOut(emp.id)}
                            disabled={!record?.checkInTime}
                            className="text-xs bg-slate-800 text-white px-3 py-1.5 rounded-lg hover:bg-slate-900 transition-colors disabled:opacity-50"
                          >
                            Valider Sortie
                          </button>
                        ) : (
                          <span className="text-lg font-mono font-bold text-slate-800 bg-slate-100 px-2 py-1 rounded-lg">
                            {record.checkOutTime}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
                      <div className="space-y-2 w-full md:w-40">
                        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          <MapPin className="w-3 h-3" /> Site Entrée
                        </div>
                        <select 
                          value={record?.checkInSite || ''}
                          onChange={(e) => updateAttendance(emp.id, { checkInSite: e.target.value })}
                          className="w-full text-xs border-slate-200 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 py-1.5"
                        >
                          <option value="">Site Entrée</option>
                          {filteredSites.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>

                      <div className="space-y-2 w-full md:w-40">
                        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          <MapPin className="w-3 h-3" /> Site Sortie
                        </div>
                        <select 
                          value={record?.checkOutSite || ''}
                          onChange={(e) => updateAttendance(emp.id, { checkOutSite: e.target.value })}
                          className="w-full text-xs border-slate-200 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 py-1.5"
                        >
                          <option value="">Site Sortie</option>
                          {filteredSites.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-2 w-full md:w-64">
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                        <Edit2 className="w-4 h-4" /> Notes / Justification
                      </div>
                      <input 
                        type="text"
                        placeholder="Retard, absence..."
                        value={record?.notes || ''}
                        onChange={(e) => updateAttendance(emp.id, { notes: e.target.value })}
                        className="w-full text-sm border-slate-200 rounded-xl focus:ring-indigo-500 focus:border-indigo-500"
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
            <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg">
              <Info className="w-4 h-4 text-indigo-500" />
              Cliquez sur une case pour définir un repos programmé
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
                      
                      return (
                        <td key={i} className={`p-2 border-b border-slate-100 text-center transition-colors ${isToday ? 'bg-slate-500/[0.05]' : ''}`}>
                          <button 
                            onClick={() => {
                              if (isRepos) {
                                // If it was PRÉVU_REPOS, delete it or set to ABSENT
                                updateAttendance(emp.id, { status: 'ABSENT' }, dateStr);
                              } else {
                                updateAttendance(emp.id, { status: 'PRÉVU_REPOS' }, dateStr);
                              }
                            }}
                            className={`w-full h-12 rounded-xl transition-all flex items-center justify-center group ${
                              isRepos 
                                ? 'bg-amber-100 text-amber-600 shadow-inner' 
                                : 'bg-slate-50 text-slate-300 hover:bg-slate-100 hover:text-slate-400'
                            }`}
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
    </div>
  );
}
