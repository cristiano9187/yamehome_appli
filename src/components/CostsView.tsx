import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Employee, FinanceEntry, ReceiptData, UserProfile } from '../types';
import {
  FINANCE_QUICK_INTERNET_AMOUNT,
  FINANCE_QUICK_RENT_AMOUNT_FALLBACK,
  FINANCE_QUICK_SALARY_AMOUNT_BY_HINT,
  formatCurrency,
  getFinanceCostsRentQuickFillUnitRows,
  getFinanceCostsUnitRowsFromTarifs,
  getFinanceQuickRentDefaultAmount,
} from '../constants';
import {
  Menu,
  Wallet,
  TrendingDown,
  TrendingUp,
  Target,
  Trash2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  PiggyBank,
  Edit2,
  Sparkles,
  Wifi,
} from 'lucide-react';

/** Aligné sur les employés actifs — prénom suffit si le nom contient la clé (insensible à la casse). */
const QUICK_SALARY_NAME_HINTS = ['paola', 'madeleine', 'idriss'] as const;

/** Note commune — doublons titres ; montants = défauts modifiables au crayon. */
const QUICK_FILL_NOTE =
  'Montants par défaut (saisie rapide) — à ajuster au besoin avec la direction.';

/** Libellé fixe pour dédoublonner Internet mois par mois. */
const INTERNET_QUICK_TITLE = 'Internet mensuel';

function findEmployeeByHint(employees: Employee[], hint: string): Employee | undefined {
  const h = hint.toLowerCase();
  return employees.find((e) => e.name.toLowerCase().includes(h));
}

function ymBounds(ym: string): { start: string; end: string } {
  const [y, m] = ym.split('-').map(Number);
  const start = `${ym}-01`;
  const last = new Date(y, m, 0).getDate();
  const end = `${ym}-${String(last).padStart(2, '0')}`;
  return { start, end };
}

function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Date ISO affichée sur 2 lignes (compact mobile, comme un mini-tableau). */
function splitIsoDateLines(iso: string): { year: string; monthDay: string } {
  const m = /^(\d{4})-(\d{2}-\d{2})$/.exec(iso.trim());
  if (m) return { year: m[1], monthDay: m[2] };
  return { year: iso, monthDay: '' };
}

/** Versements enregistrés (repli somme paiements si besoin), uniquement pour borner la part « séjour ». */
function totalPaidEffective(r: ReceiptData): number {
  const v = Number(r.totalPaid);
  if (Number.isFinite(v) && v >= 0) return v;
  return (r.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

/**
 * Revenu séjour « comptable » (hors caution remboursable) : cohérent avec grandTotal − caution.
 * Les versements au-delà du plafond sont traités comme caution / dépôt, pas comme chiffre d’affaires locatif.
 */
function lodgingRevenueCeiling(r: ReceiptData): number {
  const gt = Number(r.grandTotal) || 0;
  const cau = Number(r.cautionAmount) || 0;
  return Math.max(0, gt - cau);
}

function encaissedLodgingRevenue(r: ReceiptData): number {
  return Math.min(totalPaidEffective(r), lodgingRevenueCeiling(r));
}

const EXPENSE_LABELS: Record<string, string> = {
  SALARY: 'Salaire',
  RENT: 'Loyer',
  BILL: 'Facture / charges',
  REPAIR: 'Réparation',
  PURCHASE: 'Achat / équipement',
  OTHER_EXPENSE: 'Autre dépense',
};

const REVENUE_LABELS: Record<string, string> = {
  MISC_SALE: 'Vente diverse',
  OTHER_REVENUE: 'Autre revenu',
};

interface CostsViewProps {
  userProfile: UserProfile | null;
  onMenuClick?: () => void;
  onAlert: (msg: string, type?: 'success' | 'error' | 'info') => void;
  isMainAdmin: boolean;
}

export default function CostsView({ userProfile, onMenuClick, onAlert, isMainAdmin }: CostsViewProps) {
  const [monthYm, setMonthYm] = useState(currentYm);
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [bookingTotals, setBookingTotals] = useState({
    /** Σ min(versements, plafond séjour) — entrées résa = séjour uniquement, caution exclue */
    sumEncaissedLodging: 0,
    /** Σ plafond séjour si tout était soldé — hors caution */
    sumPotentialLodging: 0,
  });
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [saving, setSaving] = useState(false);
  const [bulkSeeding, setBulkSeeding] = useState(false);

  const [kind, setKind] = useState<FinanceEntry['kind']>('EXPENSE');
  const [category, setCategory] = useState<string>('PURCHASE');
  const [amountStr, setAmountStr] = useState('');
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  /** Unité du parc — vide = non affecté */
  const [selectedUnitSlug, setSelectedUnitSlug] = useState('');
  /** Ligne en cours d’édition (null = formulaire « nouvelle ligne ») */
  const [editingEntry, setEditingEntry] = useState<FinanceEntry | null>(null);

  const unitRowsBase = useMemo(() => getFinanceCostsUnitRowsFromTarifs(), []);
  /** Loyers saisie rapide — sans Gallaghers / Bangangté (propriété familiale). */
  const unitRowsRentQuickFill = useMemo(() => getFinanceCostsRentQuickFillUnitRows(), []);

  /** Liste déroulante + conservation d’une unité historique absente du filtre (ex. ancienne ligne studio). */
  const unitRows = useMemo(() => {
    if (editingEntry?.unitSlug && !unitRowsBase.some((r) => r.unitSlug === editingEntry.unitSlug)) {
      return [
        {
          unitSlug: editingEntry.unitSlug,
          apartmentName: editingEntry.apartmentName || '—',
        },
        ...unitRowsBase,
      ];
    }
    return unitRowsBase;
  }, [unitRowsBase, editingEntry]);

  const { start, end } = useMemo(() => ymBounds(monthYm), [monthYm]);

  useEffect(() => {
    const q = query(collection(db, 'employees'), where('active', '==', true));
    return onSnapshot(q, (snap) => {
      setEmployees(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingBookings(true);
    const rq = query(
      collection(db, 'receipts'),
      where('status', '==', 'VALIDE'),
      where('endDate', '>=', start),
      where('endDate', '<=', end)
    );
    getDocs(rq)
      .then((snap) => {
        if (cancelled) return;
        let sumEncaissedLodging = 0;
        let sumPotentialLodging = 0;
        snap.docs.forEach((d) => {
          const r = d.data() as ReceiptData;
          sumEncaissedLodging += encaissedLodgingRevenue(r);
          sumPotentialLodging += lodgingRevenueCeiling(r);
        });
        setBookingTotals({ sumEncaissedLodging, sumPotentialLodging });
      })
      .catch(() => {
        if (!cancelled) {
          console.error('CostsView: receipts query failed — créez l’index composites ou vérifiez les règles.');
          onAlert('Impossible de charger les revenus réservations (index Firestore ou réseau).', 'error');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingBookings(false);
      });
    return () => {
      cancelled = true;
    };
  }, [start, end]);

  useEffect(() => {
    setLoadingEntries(true);
    const q = query(
      collection(db, 'finance_entries'),
      where('date', '>=', start),
      where('date', '<=', end)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: FinanceEntry[] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceEntry));
        rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
        setEntries(rows);
        setLoadingEntries(false);
      },
      () => {
        setLoadingEntries(false);
        onAlert('Erreur de lecture des lignes comptables.', 'error');
      }
    );
    return () => unsub();
  }, [start, end]);

  useEffect(() => {
    setEntryDate((prev) => {
      if (prev < start || prev > end) return start;
      return prev;
    });
  }, [start, end]);

  const expenseManual = useMemo(
    () => entries.filter((e) => e.kind === 'EXPENSE').reduce((s, e) => s + e.amount, 0),
    [entries]
  );
  const revenueManual = useMemo(
    () => entries.filter((e) => e.kind === 'REVENUE').reduce((s, e) => s + e.amount, 0),
    [entries]
  );

  /** Marge : entrées résas (séjour hors caution uniquement) + autres revenus saisis − dépenses */
  const totalRevenueForMargin = bookingTotals.sumEncaissedLodging + revenueManual;
  const totalExpense = expenseManual;
  const grossMargin = totalRevenueForMargin - totalExpense;
  /** Après chargement : marge strictement négative → style d’alerte (évite un flash si totaux pas encore là). */
  const marginIsNegativeStyle =
    !loadingBookings && !loadingEntries && grossMargin < 0;

  const categoryOptions =
    kind === 'EXPENSE'
      ? Object.entries(EXPENSE_LABELS)
      : Object.entries(REVENUE_LABELS);

  /** Changement manuel du type — réinitialise une catégorie par défaut cohérente */
  const handleKindChange = (next: FinanceEntry['kind']) => {
    setKind(next);
    if (next === 'EXPENSE') setCategory('PURCHASE');
    else setCategory('MISC_SALE');
  };

  const canModifyRow = (row: FinanceEntry) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return false;
    return row.authorUid === uid || isMainAdmin || userProfile?.role === 'admin';
  };

  useEffect(() => {
    setEditingEntry(null);
  }, [monthYm]);

  const shiftMonth = (delta: number) => {
    const [y, m] = monthYm.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonthYm(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const amount = Math.round(parseFloat(amountStr.replace(',', '.')) || 0);
    if (amount <= 0) {
      onAlert('Montant invalide.', 'error');
      return;
    }
    if (!title.trim()) {
      onAlert('Donnez un libellé.', 'error');
      return;
    }
    if (kind === 'EXPENSE' && category === 'SALARY' && !employeeId) {
      onAlert('Choisissez un employé pour une ligne salaire.', 'error');
      return;
    }
    setSaving(true);
    const now = new Date().toISOString();
    try {
      const nt = notes.trim();
      const payload: Record<string, unknown> = {
        kind,
        category,
        amount,
        currency: 'XAF',
        date: entryDate,
        title: title.trim(),
        updatedAt: now,
        notes: nt,
      };

      if (kind === 'EXPENSE' && category === 'SALARY' && employeeId) {
        payload.employeeId = employeeId;
      } else {
        payload.employeeId = null;
      }

      if (selectedUnitSlug) {
        const u = unitRows.find((r) => r.unitSlug === selectedUnitSlug);
        if (u) {
          payload.unitSlug = u.unitSlug;
          payload.apartmentName = u.apartmentName;
        }
      } else {
        payload.unitSlug = null;
        payload.apartmentName = null;
      }

      if (editingEntry?.id) {
        payload.createdAt = editingEntry.createdAt;
        payload.authorUid = editingEntry.authorUid;
        await updateDoc(doc(db, 'finance_entries', editingEntry.id), payload);
        setEditingEntry(null);
        onAlert('Ligne mise à jour.', 'success');
      } else {
        payload.createdAt = now;
        payload.authorUid = uid;
        await addDoc(collection(db, 'finance_entries'), payload as Omit<FinanceEntry, 'id'>);
        onAlert('Ligne enregistrée.', 'success');
      }

      setAmountStr('');
      setTitle('');
      setNotes('');
      setEmployeeId('');
      setSelectedUnitSlug('');
      handleKindChange('EXPENSE');
    } catch (err) {
      console.error(err);
      onAlert("Erreur d'enregistrement (droits Firestore ou réseau).", 'error');
    } finally {
      setSaving(false);
    }
  };

  const cancelEditing = () => {
    setEditingEntry(null);
    setAmountStr('');
    setTitle('');
    setNotes('');
    setEmployeeId('');
    setSelectedUnitSlug('');
    handleKindChange('EXPENSE');
    setEntryDate(start);
  };

  const beginEdit = (row: FinanceEntry) => {
    if (!canModifyRow(row)) return;
    setEditingEntry(row);
    setKind(row.kind);
    setCategory(row.category);
    setAmountStr(String(row.amount));
    setEntryDate(row.date);
    setTitle(row.title);
    setNotes(row.notes ?? '');
    setEmployeeId(row.employeeId ?? '');
    setSelectedUnitSlug(row.unitSlug ?? '');
  };

  const handleDelete = async (row: FinanceEntry) => {
    if (!row.id) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    if (!canModifyRow(row)) {
      onAlert('Vous ne pouvez pas modifier ou supprimer cette ligne.', 'error');
      return;
    }
    if (!window.confirm('Supprimer cette ligne ?')) return;
    try {
      await deleteDoc(doc(db, 'finance_entries', row.id));
      onAlert('Ligne supprimée.', 'success');
    } catch {
      onAlert('Suppression impossible.', 'error');
    }
  };

  const hasSalaryForEmployeeThisMonth = (employeeId: string) =>
    entries.some(
      (e) =>
        e.kind === 'EXPENSE' &&
        e.category === 'SALARY' &&
        e.employeeId === employeeId &&
        e.date >= start &&
        e.date <= end
    );

  /** Loyer = dépense (bail long terme) — pas les revenus locatifs courts séjours (reçus). */
  const hasQuickRentForUnitThisMonth = (unitSlug: string) =>
    entries.some(
      (e) =>
        e.kind === 'EXPENSE' &&
        e.category === 'RENT' &&
        e.unitSlug === unitSlug &&
        e.date >= start &&
        e.date <= end &&
        e.title === `Loyer mensuel — ${unitSlug}`
    );

  const hasInternetQuickFillThisMonth = () =>
    entries.some(
      (e) =>
        e.kind === 'EXPENSE' &&
        e.category === 'BILL' &&
        e.date >= start &&
        e.date <= end &&
        e.title === INTERNET_QUICK_TITLE
    );

  const seedPlaceholderSalaries = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setBulkSeeding(true);
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(db);
      let count = 0;
      const missing: string[] = [];
      const skipped: string[] = [];

      for (const hint of QUICK_SALARY_NAME_HINTS) {
        const emp = findEmployeeByHint(employees, hint);
        if (!emp) {
          missing.push(hint.charAt(0).toUpperCase() + hint.slice(1));
          continue;
        }
        if (hasSalaryForEmployeeThisMonth(emp.id)) {
          skipped.push(emp.name);
          continue;
        }
        const amount = FINANCE_QUICK_SALARY_AMOUNT_BY_HINT[hint];
        if (amount == null) {
          missing.push(`${hint} (montant défaut manquant)`);
          continue;
        }
        const ref = doc(collection(db, 'finance_entries'));
        batch.set(ref, {
          kind: 'EXPENSE',
          category: 'SALARY',
          amount,
          currency: 'XAF',
          date: start,
          title: `Salaire mensuel — ${emp.name}`,
          notes: QUICK_FILL_NOTE,
          employeeId: emp.id,
          unitSlug: null,
          apartmentName: null,
          createdAt: now,
          updatedAt: now,
          authorUid: uid,
        });
        count++;
      }

      if (count === 0) {
        const parts: string[] = [];
        if (missing.length) parts.push(`Introuvable : ${missing.join(', ')} (vérifiez Présences → Employés).`);
        if (skipped.length) parts.push(`Déjà une ligne salaire ce mois pour : ${skipped.join(', ')}.`);
        onAlert(parts.join(' ') || 'Rien à insérer.', 'info');
        return;
      }

      await batch.commit();
      const tail = [
        missing.length ? `Non trouvé(s) : ${missing.join(', ')}.` : '',
        skipped.length ? `Ignoré(s), déjà saisi : ${skipped.join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join(' ');
      onAlert(`${count} salaire(s) ajouté(s) avec les montants par défaut. ${tail}`.trim(), 'success');
    } catch (err) {
      console.error(err);
      onAlert('Insertion groupée impossible (réseau ou droits Firestore).', 'error');
    } finally {
      setBulkSeeding(false);
    }
  };

  const seedPlaceholderRents = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setBulkSeeding(true);
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(db);
      let count = 0;
      const skippedSlugs: string[] = [];

      for (const row of unitRowsRentQuickFill) {
        if (hasQuickRentForUnitThisMonth(row.unitSlug)) {
          skippedSlugs.push(row.unitSlug);
          continue;
        }
        const ref = doc(collection(db, 'finance_entries'));
        batch.set(ref, {
          kind: 'EXPENSE',
          category: 'RENT',
          amount: getFinanceQuickRentDefaultAmount(row.unitSlug),
          currency: 'XAF',
          date: start,
          title: `Loyer mensuel — ${row.unitSlug}`,
          notes: QUICK_FILL_NOTE,
          employeeId: null,
          unitSlug: row.unitSlug,
          apartmentName: row.apartmentName,
          createdAt: now,
          updatedAt: now,
          authorUid: uid,
        });
        count++;
      }

      if (count === 0) {
        onAlert(
          skippedSlugs.length
            ? `Chaque logement a déjà une ligne « Loyer mensuel — … » pour ce mois (${skippedSlugs.length} unités).`
            : 'Aucun logement dans la liste.',
          'info'
        );
        return;
      }

      await batch.commit();
      onAlert(
        `${count} ligne(s) de loyer (dépense bail) ajoutée(s), montants par défaut (modifiables au crayon). ${
          skippedSlugs.length ? `${skippedSlugs.length} déjà présentes.` : ''
        }`.trim(),
        'success'
      );
    } catch (err) {
      console.error(err);
      onAlert('Insertion groupée impossible (réseau ou droits Firestore).', 'error');
    } finally {
      setBulkSeeding(false);
    }
  };

  const seedPlaceholderInternet = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    if (hasInternetQuickFillThisMonth()) {
      onAlert(`Une ligne « ${INTERNET_QUICK_TITLE} » existe déjà pour ce mois.`, 'info');
      return;
    }
    setBulkSeeding(true);
    try {
      const now = new Date().toISOString();
      await addDoc(collection(db, 'finance_entries'), {
        kind: 'EXPENSE',
        category: 'BILL',
        amount: FINANCE_QUICK_INTERNET_AMOUNT,
        currency: 'XAF',
        date: start,
        title: INTERNET_QUICK_TITLE,
        notes: QUICK_FILL_NOTE,
        employeeId: null,
        unitSlug: null,
        apartmentName: null,
        createdAt: now,
        updatedAt: now,
        authorUid: uid,
      } as Omit<FinanceEntry, 'id'>);
      onAlert('Internet ajouté. Modifiable au crayon si besoin.', 'success');
    } catch (err) {
      console.error(err);
      onAlert('Insertion impossible (réseau ou droits Firestore).', 'error');
    } finally {
      setBulkSeeding(false);
    }
  };

  const labelCat = (e: FinanceEntry) =>
    e.kind === 'EXPENSE' ? EXPENSE_LABELS[e.category] ?? e.category : REVENUE_LABELS[e.category] ?? e.category;

  const formatLogementCell = (e: FinanceEntry) => {
    if (!e.unitSlug && !e.apartmentName) return '—';
    if (e.apartmentName && e.unitSlug) return `${e.apartmentName} · ${e.unitSlug}`;
    return e.unitSlug || e.apartmentName || '—';
  };

  return (
    <div className="flex-1 flex flex-col bg-[#F5F5F4] overflow-y-auto">
      <header className="h-auto md:h-20 bg-white border-b border-gray-200 px-4 md:px-8 py-4 md:py-0 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-40">
        <div className="flex items-center gap-4">
          {onMenuClick && (
            <button type="button" onClick={onMenuClick} className="md:hidden p-2 hover:bg-gray-100 rounded-xl">
              <Menu size={20} />
            </button>
          )}
          <div>
            <h2 className="text-base font-black uppercase tracking-widest flex items-center gap-2">
              <Wallet className="text-emerald-700" size={22} />
              Coûts & marges
            </h2>
            <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest">
              Entrées séjour (hors caution) + saisies — vue mensuelle
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-xl border border-gray-200 self-start md:self-auto">
          <button type="button" onClick={() => shiftMonth(-1)} className="p-2 hover:bg-white rounded-lg text-gray-600">
            <ChevronLeft size={18} />
          </button>
          <input
            type="month"
            value={monthYm}
            onChange={(e) => setMonthYm(e.target.value)}
            className="bg-transparent text-xs font-black uppercase tracking-widest text-gray-900 px-2 py-1 rounded-lg border-none focus:ring-2 focus:ring-emerald-500/30"
          />
          <button type="button" onClick={() => shiftMonth(1)} className="p-2 hover:bg-white rounded-lg text-gray-600">
            <ChevronRight size={18} />
          </button>
        </div>
      </header>

      <div className="p-4 md:p-8 max-w-6xl mx-auto w-full min-w-0 space-y-8 pb-16 overflow-x-hidden">
        <p className="text-xs text-gray-500 leading-relaxed bg-white/80 rounded-2xl border border-gray-100 px-4 py-3">
          Reçus <strong>VALIDE</strong>, <strong>date de fin de séjour</strong> dans le mois. Les{' '}
          <strong>entrées réservations</strong> utilisent uniquement la part <strong>séjour</strong>, jamais la caution&nbsp;:{' '}
          <code className="text-[10px] bg-gray-100 px-1 rounded">min(versements, grandTotal − caution)</code>. Ainsi un client qui règle d’un coup séjour{' '}
          <em>et</em> caution ne gonfle pas vos revenus — le surplus au-delà du plafond séjour est ignoré comme entrée CA. « Potentiel séjour » = somme des plafonds
          séjour si tout était réglé. <strong>Marge</strong>&nbsp;: entrées séjour + autres revenus saisis − dépenses.
        </p>

        <div className="bg-gradient-to-br from-amber-50 to-orange-50/80 rounded-3xl border border-amber-100/80 shadow-sm p-5 md:p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-white text-amber-700 shadow-sm shrink-0">
              <Sparkles size={20} />
            </div>
            <div className="space-y-1 min-w-0">
              <h3 className="text-xs font-black uppercase tracking-widest text-amber-950">Saisie rapide (mois affiché)</h3>
              <p className="text-xs text-amber-950/80 leading-relaxed">
                Insère les <strong>montants par défaut</strong> (base direction, modifiables au crayon) : salaires, loyers bail par unité Yaoundé (pas Gallaghers),
                et une ligne <strong>Internet</strong>. Les autres unités
                utilisent un loyer par défaut ({formatCurrency(FINANCE_QUICK_RENT_AMOUNT_FALLBACK)}) jusqu’à édition. Les lignes déjà présentes pour ce mois sont
                ignorées.
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <button
              type="button"
              disabled={bulkSeeding || loadingEntries}
              onClick={() => void seedPlaceholderSalaries()}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-white border border-amber-200 text-amber-950 text-xs font-black uppercase tracking-widest shadow-sm hover:bg-amber-50 disabled:opacity-50 disabled:pointer-events-none transition-colors"
            >
              {bulkSeeding ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
              Salaires
            </button>
            <button
              type="button"
              disabled={bulkSeeding || loadingEntries}
              onClick={() => void seedPlaceholderRents()}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-amber-700 text-white text-xs font-black uppercase tracking-widest shadow-md hover:bg-amber-800 disabled:opacity-50 disabled:pointer-events-none transition-colors"
            >
              {bulkSeeding ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
              Loyers par logement
            </button>
            <button
              type="button"
              disabled={bulkSeeding || loadingEntries}
              onClick={() => void seedPlaceholderInternet()}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-white border border-sky-200 text-sky-900 text-xs font-black uppercase tracking-widest shadow-sm hover:bg-sky-50 disabled:opacity-50 disabled:pointer-events-none transition-colors"
            >
              {bulkSeeding ? <Loader2 className="animate-spin" size={16} /> : <Wifi size={16} />}
              Internet
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          <div className="bg-white rounded-2xl border border-teal-200 ring-1 ring-teal-100 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-teal-800 mb-2">
              <TrendingUp size={14} /> Entrées résas (séjour encaissé)
            </div>
            <p className="text-xl font-black text-gray-900 tabular-nums">
              {loadingBookings ? '…' : formatCurrency(bookingTotals.sumEncaissedLodging)}
            </p>
            <p className="text-[9px] text-gray-400 mt-2 leading-snug font-medium">
              Uniquement le séjour déjà couvert par les versements, plafonné à grandTotal − caution — la partie caution n’entre pas ici même si elle est dans le TOTAL REÇU
              du PDF.
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-cyan-100 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-cyan-800 mb-2">
              <Target size={14} /> Potentiel séjour (hors caution)
            </div>
            <p className="text-xl font-black text-gray-900 tabular-nums">
              {loadingBookings ? '…' : formatCurrency(bookingTotals.sumPotentialLodging)}
            </p>
            <p className="text-[9px] text-gray-400 mt-2 leading-snug font-medium">
              Si tous les montants séjour étaient encaissés (excluant la caution remboursable).
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-blue-100 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-blue-700 mb-2">
              <PiggyBank size={14} /> Autres revenus (saisis)
            </div>
            <p className="text-xl font-black text-gray-900 tabular-nums">{formatCurrency(revenueManual)}</p>
          </div>
          <div className="bg-white rounded-2xl border border-rose-100 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-rose-700 mb-2">
              <TrendingDown size={14} /> Total dépenses
            </div>
            <p className="text-xl font-black text-gray-900 tabular-nums">{formatCurrency(totalExpense)}</p>
          </div>
          <div
            className={
              marginIsNegativeStyle
                ? 'bg-gradient-to-br from-rose-800 to-neutral-950 rounded-2xl p-5 text-white shadow-lg ring-1 ring-rose-900/40'
                : 'bg-gradient-to-br from-[#0f766e] to-emerald-900 rounded-2xl p-5 text-white shadow-lg'
            }
          >
            <div
              className={
                marginIsNegativeStyle
                  ? 'text-[10px] font-black uppercase tracking-widest text-rose-200 mb-2'
                  : 'text-[10px] font-black uppercase tracking-widest text-emerald-100 mb-2'
              }
            >
              Marge brute (mois)
            </div>
            <p className={`text-2xl font-black tabular-nums ${marginIsNegativeStyle ? 'text-white' : ''}`}>
              {loadingBookings || loadingEntries ? (
                <Loader2 className="animate-spin inline" size={22} />
              ) : (
                formatCurrency(grossMargin)
              )}
            </p>
            <p
              className={
                marginIsNegativeStyle
                  ? 'text-[10px] text-rose-200/90 mt-2 leading-snug'
                  : 'text-[10px] text-emerald-200 mt-2 opacity-90 leading-snug'
              }
            >
              Entrées séjour ({formatCurrency(bookingTotals.sumEncaissedLodging)}) + autres revenus ({formatCurrency(revenueManual)}) − dépenses (
              {formatCurrency(totalExpense)})
            </p>
          </div>
        </div>

        <div
          className={`bg-white rounded-3xl border shadow-sm p-6 md:p-8 ${
            editingEntry ? 'border-emerald-300 ring-1 ring-emerald-100' : 'border-gray-100'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">
              {editingEntry ? 'Modifier la ligne' : 'Nouvelle ligne'}
            </h3>
            {editingEntry && (
              <button
                type="button"
                onClick={cancelEditing}
                className="text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-800 px-3 py-2 rounded-xl border border-gray-200 bg-gray-50"
              >
                Annuler la modification
              </button>
            )}
          </div>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">Type</label>
              <select
                value={kind}
                onChange={(e) => handleKindChange(e.target.value as FinanceEntry['kind'])}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold"
              >
                <option value="EXPENSE">Dépense</option>
                <option value="REVENUE">Revenu (manuel)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">Catégorie</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm"
              >
                {categoryOptions.map(([key, lab]) => (
                  <option key={key} value={key}>
                    {lab}
                  </option>
                ))}
              </select>
            </div>
            {kind === 'EXPENSE' && category === 'SALARY' && (
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">Employé</label>
                <select
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm"
                  required
                >
                  <option value="">— Choisir —</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">Montant (FCFA)</label>
              <input
                type="text"
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="ex. 150000"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">Date</label>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                min={start}
                max={end}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">Libellé</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex. Achat vaisselle Direction"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm"
              />
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">
                Logement concerné <span className="text-gray-300 font-normal normal-case">(optionnel)</span>
              </label>
              <select
                value={selectedUnitSlug}
                onChange={(e) => setSelectedUnitSlug(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm"
              >
                <option value="">— Non affecté (groupe / général) —</option>
                {unitRows.map((row) => (
                  <option key={row.unitSlug} value={row.unitSlug}>
                    {row.apartmentName} — {row.unitSlug}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-gray-400 mt-1.5 leading-snug">
                Utile pour suivre loyer, réparations ou ventes rattachées à une unité précise.
              </p>
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">Notes (optionnel)</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm"
              />
            </div>
            <div className="md:col-span-2 lg:col-span-3 flex justify-end gap-3 flex-wrap">
              <button
                type="submit"
                disabled={saving}
                className="px-8 py-3 bg-emerald-700 text-white font-black rounded-2xl uppercase text-xs tracking-widest hover:bg-emerald-800 transition-colors disabled:opacity-50 shadow-lg shadow-emerald-900/10"
              >
                {saving ? (
                  <Loader2 className="animate-spin inline" size={16} />
                ) : editingEntry ? (
                  'Enregistrer les modifications'
                ) : (
                  'Enregistrer la ligne'
                )}
              </button>
            </div>
          </form>
        </div>

        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 md:p-6 border-b border-gray-50 flex items-center justify-between">
            <h3 className="text-xs md:text-sm font-black uppercase tracking-widest text-gray-900">Lignes du mois</h3>
            {loadingEntries && <Loader2 className="animate-spin text-gray-400" size={18} />}
          </div>
          {/* Desktop / large écran : tableau (à partir de lg pour éviter tableau trop large en portrait) */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-400">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Catégorie</th>
                  <th className="px-4 py-3 min-w-[140px]">Logement</th>
                  <th className="px-4 py-3">Libellé</th>
                  <th className="px-4 py-3 text-right">Montant</th>
                  <th className="px-4 py-3 text-right w-[88px]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {entries.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">{row.date}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                          row.kind === 'REVENUE' ? 'bg-blue-100 text-blue-800' : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {row.kind === 'REVENUE' ? 'Revenu' : 'Dépense'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">{labelCat(row)}</td>
                    <td className="px-4 py-3 text-[11px] text-gray-600 max-w-[180px]" title={formatLogementCell(row)}>
                      {formatLogementCell(row)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-800 max-w-[200px] truncate" title={row.title}>
                      {row.title}
                      {row.category === 'SALARY' && row.employeeId && (
                        <span className="block text-[10px] text-gray-400">
                          {employees.find((e) => e.id === row.employeeId)?.name ?? row.employeeId}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">{formatCurrency(row.amount)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-0.5">
                        {canModifyRow(row) && (
                          <button
                            type="button"
                            onClick={() => beginEdit(row)}
                            className={`p-2 rounded-lg transition-colors ${
                              editingEntry?.id === row.id
                                ? 'text-emerald-700 bg-emerald-50'
                                : 'text-gray-300 hover:text-emerald-700 hover:bg-emerald-50'
                            }`}
                            title="Modifier"
                          >
                            <Edit2 size={16} />
                          </button>
                        )}
                        {canModifyRow(row) && (
                          <button
                            type="button"
                            onClick={() => handleDelete(row)}
                            className="p-2 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Supprimer"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && !loadingEntries && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-gray-400 text-sm">
                      Aucune ligne saisie pour ce mois.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile & tablette portrait : petits blocs (même esprit que Historique des reçus) */}
          <div className="lg:hidden bg-[#F5F5F4] p-3 space-y-3">
            {entries.map((row) => {
              const logementLine = formatLogementCell(row);
              const { year, monthDay } = splitIsoDateLines(row.date);
              const salaryName =
                row.category === 'SALARY' && row.employeeId
                  ? employees.find((e) => e.id === row.employeeId)?.name ?? row.employeeId
                  : null;
              return (
                <div
                  key={row.id}
                  className={`rounded-2xl border bg-white p-4 shadow-sm space-y-3 min-w-0 ${
                    editingEntry?.id === row.id
                      ? 'border-emerald-300 ring-2 ring-emerald-100'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="font-mono text-[10px] tabular-nums font-bold text-gray-500 leading-tight text-center shrink-0 select-none">
                          <span className="block">{year}</span>
                          {monthDay ? <span className="block text-gray-400 font-semibold">{monthDay}</span> : null}
                        </div>
                        <span
                          className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full shrink-0 ${
                            row.kind === 'REVENUE' ? 'bg-blue-100 text-blue-800' : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {row.kind === 'REVENUE' ? 'Revenu' : 'Dépense'}
                        </span>
                      </div>
                      <p className="text-sm font-black uppercase tracking-tight text-gray-900 leading-snug line-clamp-3" title={row.title}>
                        {row.title}
                      </p>
                      {salaryName && <p className="text-[10px] text-gray-400 font-bold">{salaryName}</p>}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {canModifyRow(row) && (
                        <button
                          type="button"
                          onClick={() => beginEdit(row)}
                          className={`p-2 rounded-xl transition-colors ${
                            editingEntry?.id === row.id
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                          title="Modifier"
                        >
                          <Edit2 size={16} />
                        </button>
                      )}
                      {canModifyRow(row) && (
                        <button
                          type="button"
                          onClick={() => handleDelete(row)}
                          className="p-2 rounded-xl bg-gray-50 text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 py-3 border-y border-gray-50">
                    <div className="min-w-0">
                      <span className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-1 block">Catégorie</span>
                      <span className="text-xs font-bold text-gray-800 leading-snug">{labelCat(row)}</span>
                    </div>
                    <div className="min-w-0 text-right">
                      <span className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-1 block">Montant</span>
                      <span className="text-sm font-black font-mono tabular-nums text-gray-900">{formatCurrency(row.amount)}</span>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <span className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-1 block">Logement</span>
                    <p className="text-[11px] text-gray-700 leading-snug break-words">{logementLine}</p>
                  </div>
                </div>
              );
            })}
            {entries.length === 0 && !loadingEntries && (
              <div className="rounded-2xl border border-gray-200 bg-white py-12 px-4 text-center text-gray-400 text-xs shadow-sm">
                Aucune ligne saisie pour ce mois.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
