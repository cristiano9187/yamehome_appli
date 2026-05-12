import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { deleteObject, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from '../firebase';
import {
  ObligationCategory,
  ObligationOccurrence,
  ObligationTemplate,
  ObligationOneOff,
  UserProfile,
  Employee,
} from '../types';
import {
  formatCurrency,
  getFinanceCostsRentQuickFillUnitRows,
  getFinanceQuickRentDefaultAmount,
  FINANCE_QUICK_SALARY_AMOUNT_BY_HINT,
} from '../constants';
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  Plus,
  Trash2,
  Upload,
  Sparkles,
  PanelRightClose,
  Pencil,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const WARN_DAYS_BEFORE = 5;

const CATEGORY_LABELS: Record<ObligationCategory, string> = {
  RENT: 'Loyer',
  UTILITIES: 'Eau / électricité',
  INTERNET: 'Internet',
  SALARY: 'Salaires',
  OTHER: 'Autre',
};

const MOIS_FR = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
] as const;

function getLocalDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function currentYear(): number {
  return new Date().getFullYear();
}

function dueDateForMonth(periodYm: string, dueDayOfMonth: number): string {
  const [y, m] = periodYm.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const d = Math.min(Math.max(1, dueDayOfMonth), last);
  return `${periodYm}-${String(d).padStart(2, '0')}`;
}

function occDocId(templateId: string, periodYm: string): string {
  return `${templateId}__${periodYm}`;
}

function recurringRowTitle(occ: ObligationOccurrence, tpl: ObligationTemplate): string {
  const t = occ.displayTitle?.trim();
  return t ? t : tpl.title;
}

function recurringRowExpectedAmount(occ: ObligationOccurrence, tpl: ObligationTemplate): number | null {
  if (
    occ.expectedAmountOverride != null &&
    Number.isFinite(occ.expectedAmountOverride) &&
    occ.expectedAmountOverride >= 0
  ) {
    return occ.expectedAmountOverride;
  }
  return tpl.expectedAmount != null ? tpl.expectedAmount : null;
}

function urgencyLabel(status: ObligationOccurrence['status'], dueDate: string): string | null {
  if (status === 'PAID') return null;
  const today = getLocalDateString();
  if (today > dueDate) return 'Dépassé';
  const t0 = new Date(today + 'T12:00:00').getTime();
  const t1 = new Date(dueDate + 'T12:00:00').getTime();
  const diffDays = Math.ceil((t1 - t0) / 86400000);
  if (diffDays <= WARN_DAYS_BEFORE) return 'À régler';
  return null;
}

function salaryAmountForEmployeeName(name: string): number | null {
  const n = name.toLowerCase();
  for (const [hint, amt] of Object.entries(FINANCE_QUICK_SALARY_AMOUNT_BY_HINT)) {
    if (n.includes(hint)) return amt;
  }
  return null;
}

interface ObligationsDeskRailProps {
  userProfile: UserProfile;
  userUid: string;
  onAlert: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

type SheetRow =
  | { kind: 'recurring'; occ: ObligationOccurrence; tpl: ObligationTemplate }
  | { kind: 'oneoff'; oo: ObligationOneOff };

export default function ObligationsDeskRail({
  userProfile,
  userUid,
  onAlert,
}: ObligationsDeskRailProps) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(currentYear);
  const [templates, setTemplates] = useState<ObligationTemplate[]>([]);
  const [occurrencesYear, setOccurrencesYear] = useState<ObligationOccurrence[]>([]);
  const [oneOffsYear, setOneOffsYear] = useState<ObligationOneOff[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [loadingOcc, setLoadingOcc] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [ensuringYear, setEnsuringYear] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [showTemplatesEditor, setShowTemplatesEditor] = useState(false);
  /** Formulaire obligation ponctuelle par mois (periodYm ou null = fermé) */
  const [oneOffFormYm, setOneOffFormYm] = useState<string | null>(null);
  const [oneOffForm, setOneOffForm] = useState({
    title: '',
    category: 'OTHER' as ObligationCategory,
    dueDate: '',
    expectedAmount: '' as string,
  });
  const [editRecurring, setEditRecurring] = useState<{
    occ: ObligationOccurrence;
    tpl: ObligationTemplate;
  } | null>(null);
  const [editRecurringSaving, setEditRecurringSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    displayTitle: '',
    dueDate: '',
    expectedAmount: '' as string,
    notes: '',
  });
  /** Dates de règlement saisies (yyyy-mm-dd) avant validation */
  const [paidDateDraft, setPaidDateDraft] = useState<Record<string, string>>({});

  const rentRows = useMemo(() => getFinanceCostsRentQuickFillUnitRows(), []);

  const newTemplateFormEmpty = useMemo(
    () => ({
      title: '',
      category: 'OTHER' as ObligationCategory,
      dueDayOfMonth: 5,
      expectedAmount: '' as string,
      unitSlug: '' as string,
      apartmentName: '' as string,
      notes: '',
    }),
    []
  );
  const [newTpl, setNewTpl] = useState(newTemplateFormEmpty);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'obligation_templates'), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ObligationTemplate));
      rows.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      setTemplates(rows);
      setLoadingTemplates(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'employees'), where('active', '==', true));
    return onSnapshot(q, (snap) => {
      setEmployees(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
    });
  }, []);

  const ymStart = `${year}-01`;
  const ymEnd = `${year}-12`;

  useEffect(() => {
    setLoadingOcc(true);
    const q = query(
      collection(db, 'obligation_occurrences'),
      where('periodYm', '>=', ymStart),
      where('periodYm', '<=', ymEnd)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ObligationOccurrence));
        setOccurrencesYear(rows);
        setLoadingOcc(false);
      },
      () => {
        setLoadingOcc(false);
        onAlert('Erreur de lecture des échéances pour cette année.', 'error');
      }
    );
    return () => unsub();
  }, [year, ymStart, ymEnd, onAlert]);

  useEffect(() => {
    const q = query(
      collection(db, 'obligation_one_offs'),
      where('periodYm', '>=', ymStart),
      where('periodYm', '<=', ymEnd)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setOneOffsYear(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ObligationOneOff)));
      },
      () => {
        onAlert('Erreur de lecture des charges ponctuelles.', 'error');
      }
    );
    return () => unsub();
  }, [year, ymStart, ymEnd, onAlert]);

  useEffect(() => {
    const m: Record<string, string> = {};
    occurrencesYear.forEach((o) => {
      if (o.id) m[o.id] = o.paidAt ?? '';
    });
    oneOffsYear.forEach((o) => {
      if (o.id) m[o.id] = o.paidAt ?? '';
    });
    setPaidDateDraft(m);
  }, [occurrencesYear, oneOffsYear]);

  useEffect(() => {
    if (!open) setEditRecurring(null);
  }, [open]);

  const ensureOccurrencesForYear = useCallback(async () => {
    const active = templates.filter((t) => t.active && t.id);
    if (!active.length || !userUid || loadingTemplates) return;
    setEnsuringYear(true);
    try {
      const q = query(
        collection(db, 'obligation_occurrences'),
        where('periodYm', '>=', ymStart),
        where('periodYm', '<=', ymEnd)
      );
      const snap = await getDocs(q);
      const existing = new Set(snap.docs.map((d) => d.id));
      const sq = query(
        collection(db, 'obligation_occurrence_suppressions'),
        where('periodYm', '>=', ymStart),
        where('periodYm', '<=', ymEnd)
      );
      const sSnap = await getDocs(sq);
      const suppressed = new Set(sSnap.docs.map((d) => d.id));
      let batch = writeBatch(db);
      let ops = 0;
      const now = new Date().toISOString();
      for (const t of active) {
        for (let mo = 1; mo <= 12; mo++) {
          const periodYm = `${year}-${String(mo).padStart(2, '0')}`;
          const did = occDocId(t.id!, periodYm);
          if (existing.has(did) || suppressed.has(did)) continue;
          batch.set(doc(db, 'obligation_occurrences', did), {
            templateId: t.id,
            periodYm,
            dueDate: dueDateForMonth(periodYm, t.dueDayOfMonth),
            status: 'PENDING',
            paidAt: null,
            paidAmount: null,
            proofStoragePath: null,
            proofDownloadUrl: null,
            notes: '',
            createdAt: now,
            updatedAt: now,
            authorUid: userUid,
          });
          existing.add(did);
          ops++;
          if (ops >= 450) {
            await batch.commit();
            batch = writeBatch(db);
            ops = 0;
          }
        }
      }
      if (ops > 0) await batch.commit();
    } catch (e) {
      console.error(e);
      onAlert('Impossible de créer les lignes manquantes pour l’année.', 'error');
    } finally {
      setEnsuringYear(false);
    }
  }, [templates, userUid, loadingTemplates, year, ymStart, ymEnd, onAlert]);

  useEffect(() => {
    if (!loadingTemplates && templates.some((t) => t.active && t.id)) {
      void ensureOccurrencesForYear();
    }
  }, [loadingTemplates, templates, year, ensureOccurrencesForYear]);

  const templateById = useMemo(() => {
    const m = new Map<string, ObligationTemplate>();
    templates.forEach((t) => {
      if (t.id) m.set(t.id, t);
    });
    return m;
  }, [templates]);

  const rowsByMonth = useMemo(() => {
    const map = new Map<string, SheetRow[]>();
    for (let mo = 1; mo <= 12; mo++) {
      map.set(`${year}-${String(mo).padStart(2, '0')}`, []);
    }
    occurrencesYear.forEach((occ) => {
      const tpl = templateById.get(occ.templateId);
      if (!tpl || !tpl.active) return;
      const list = map.get(occ.periodYm);
      if (!list) return;
      list.push({ kind: 'recurring', occ, tpl });
    });
    oneOffsYear.forEach((oo) => {
      const list = map.get(oo.periodYm);
      if (!list) return;
      list.push({ kind: 'oneoff', oo });
    });
    map.forEach((list) => {
      list.sort((a, b) => {
        const dueA = a.kind === 'recurring' ? a.occ.dueDate : a.oo.dueDate;
        const dueB = b.kind === 'recurring' ? b.occ.dueDate : b.oo.dueDate;
        const da = dueA.localeCompare(dueB);
        if (da !== 0) return da;
        const titleA = a.kind === 'recurring' ? a.tpl.title : a.oo.title;
        const titleB = b.kind === 'recurring' ? b.tpl.title : b.oo.title;
        return titleA.localeCompare(titleB);
      });
    });
    return map;
  }, [occurrencesYear, oneOffsYear, templateById, year]);

  const handleSeedFromPark = async () => {
    const uid = auth.currentUser?.uid || userUid;
    const now = new Date().toISOString();
    setSeeding(true);
    try {
      let added = 0;

      for (const row of rentRows) {
        const dup = templates.some(
          (t) => t.active && t.category === 'RENT' && t.unitSlug === row.unitSlug
        );
        if (dup) continue;
        await addDoc(collection(db, 'obligation_templates'), {
          title: `Loyer — ${row.apartmentName}`,
          category: 'RENT',
          dueDayOfMonth: 5,
          expectedAmount: getFinanceQuickRentDefaultAmount(row.unitSlug),
          unitSlug: row.unitSlug,
          apartmentName: row.apartmentName,
          active: true,
          notes: `unitSlug:${row.unitSlug}`,
          createdAt: now,
          updatedAt: now,
          authorUid: uid,
        });
        added++;
      }

      for (const emp of employees) {
        const title = `Salaire — ${emp.name}`;
        const dup = templates.some((t) => t.active && t.category === 'SALARY' && t.title === title);
        if (dup) continue;
        const expectedAmount = salaryAmountForEmployeeName(emp.name);
        await addDoc(collection(db, 'obligation_templates'), {
          title,
          category: 'SALARY',
          dueDayOfMonth: 28,
          expectedAmount,
          unitSlug: null,
          apartmentName: null,
          active: true,
          notes: `employeeId:${emp.id}`,
          createdAt: now,
          updatedAt: now,
          authorUid: uid,
        });
        added++;
      }

      onAlert(
        added
          ? `${added} obligation(s) ajoutée(s) depuis le parc (loyers + salaires).`
          : 'Rien à ajouter : les modèles existent déjà.',
        added ? 'success' : 'info'
      );
    } catch (e) {
      console.error(e);
      onAlert('Import depuis le parc impossible.', 'error');
    } finally {
      setSeeding(false);
    }
  };

  const applyPayment = async (occ: ObligationOccurrence, tpl: ObligationTemplate) => {
    const draft = paidDateDraft[occ.id!]?.trim();
    const paidAt = draft || getLocalDateString();
    const hint = recurringRowExpectedAmount(occ, tpl);
    const amt = hint != null && hint > 0 ? hint : occ.paidAmount || 0;
    try {
      await updateDoc(doc(db, 'obligation_occurrences', occ.id!), {
        status: 'PAID',
        paidAt,
        paidAmount: amt,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error(e);
      onAlert('Enregistrement impossible.', 'error');
    }
  };

  const clearPayment = async (occ: ObligationOccurrence) => {
    try {
      await updateDoc(doc(db, 'obligation_occurrences', occ.id!), {
        status: 'PENDING',
        paidAt: null,
        paidAmount: null,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error(e);
      onAlert('Échec.', 'error');
    }
  };

  const updatePaidDateOnly = async (occ: ObligationOccurrence) => {
    const draft = paidDateDraft[occ.id!]?.trim();
    if (!draft || occ.status !== 'PAID') return;
    try {
      await updateDoc(doc(db, 'obligation_occurrences', occ.id!), {
        paidAt: draft,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error(e);
      onAlert('Mise à jour de la date impossible.', 'error');
    }
  };

  const handleDeleteRecurringOccurrence = async (occ: ObligationOccurrence) => {
    const did = occ.id!;
    if (
      !confirm(
        `Supprimer cette ligne pour ${occ.periodYm} uniquement ?\nLe modèle récurrent reste ; cette case ne sera pas recréée automatiquement pour ce mois.`
      )
    ) {
      return;
    }
    const uid = auth.currentUser?.uid;
    if (!uid) {
      onAlert('Session requise pour enregistrer la suppression.', 'error');
      return;
    }
    try {
      if (occ.proofStoragePath) {
        try {
          await deleteObject(ref(storage, occ.proofStoragePath));
        } catch {
          /* */
        }
      }
      await deleteDoc(doc(db, 'obligation_occurrences', did));
      await setDoc(doc(db, 'obligation_occurrence_suppressions', did), {
        templateId: occ.templateId,
        periodYm: occ.periodYm,
        createdAt: new Date().toISOString(),
        authorUid: uid,
      });
      onAlert('Ligne retirée pour ce mois.', 'success');
    } catch (e) {
      console.error(e);
      onAlert('Suppression impossible.', 'error');
    }
  };

  const openEditRecurring = (occ: ObligationOccurrence, tpl: ObligationTemplate) => {
    setEditRecurring({ occ, tpl });
    setEditForm({
      displayTitle: (occ.displayTitle ?? '').trim(),
      dueDate: occ.dueDate,
      expectedAmount:
        occ.expectedAmountOverride != null && Number.isFinite(occ.expectedAmountOverride)
          ? String(occ.expectedAmountOverride)
          : '',
      notes: occ.notes ?? '',
    });
  };

  const handleSaveEditRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editRecurring?.occ.id) return;
    const { occ } = editRecurring;
    const due = editForm.dueDate.trim();
    if (!due.startsWith(occ.periodYm)) {
      onAlert('L’échéance doit rester dans le mois de cette ligne.', 'error');
      return;
    }
    setEditRecurringSaving(true);
    try {
      const titleTrim = editForm.displayTitle.trim();
      const amtTrim = editForm.expectedAmount.trim();
      await updateDoc(doc(db, 'obligation_occurrences', occ.id), {
        dueDate: due,
        displayTitle: titleTrim === '' ? null : titleTrim,
        expectedAmountOverride: amtTrim === '' ? null : Math.max(0, Number(amtTrim) || 0),
        notes: editForm.notes.trim() === '' ? null : editForm.notes.trim(),
        updatedAt: new Date().toISOString(),
      });
      setEditRecurring(null);
      onAlert('Ligne mise à jour.', 'success');
    } catch (err) {
      console.error(err);
      onAlert('Enregistrement impossible.', 'error');
    } finally {
      setEditRecurringSaving(false);
    }
  };

  const handleUploadProof = async (occ: ObligationOccurrence, file: File) => {
    if (!occ.id) return;
    setUploadingId(occ.id);
    try {
      const safe = file.name.replace(/[^\w.-]/g, '_').slice(0, 80);
      const path = `obligation_proofs/${occ.id}/${Date.now()}_${safe}`;
      const sref = ref(storage, path);
      await uploadBytes(sref, file, { contentType: file.type || undefined });
      const url = await getDownloadURL(sref);
      await updateDoc(doc(db, 'obligation_occurrences', occ.id), {
        proofStoragePath: path,
        proofDownloadUrl: url,
        updatedAt: new Date().toISOString(),
      });
      onAlert('Preuve enregistrée.', 'success');
    } catch (e) {
      console.error(e);
      onAlert('Upload impossible (Storage / règles).', 'error');
    } finally {
      setUploadingId(null);
    }
  };

  const handleRemoveProof = async (occ: ObligationOccurrence) => {
    if (!occ.id || !occ.proofStoragePath) return;
    try {
      await deleteObject(ref(storage, occ.proofStoragePath));
    } catch {
      /* absent */
    }
    try {
      await updateDoc(doc(db, 'obligation_occurrences', occ.id), {
        proofStoragePath: null,
        proofDownloadUrl: null,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error(e);
      onAlert('Erreur suppression preuve.', 'error');
    }
  };

  const handleSubmitOneOff = async (e: React.FormEvent, periodYm: string) => {
    e.preventDefault();
    const title = oneOffForm.title.trim();
    if (!title) {
      onAlert('Indiquez un libellé.', 'error');
      return;
    }
    const due = oneOffForm.dueDate.trim();
    if (!due.startsWith(periodYm)) {
      onAlert('La date d’échéance doit être dans le mois affiché.', 'error');
      return;
    }
    const uid = auth.currentUser?.uid || userUid;
    const now = new Date().toISOString();
    try {
      await addDoc(collection(db, 'obligation_one_offs'), {
        periodYm,
        title,
        category: oneOffForm.category,
        dueDate: due,
        expectedAmount:
          oneOffForm.expectedAmount.trim() === '' ? null : Math.max(0, Number(oneOffForm.expectedAmount) || 0),
        status: 'PENDING',
        paidAt: null,
        paidAmount: null,
        proofStoragePath: null,
        proofDownloadUrl: null,
        createdAt: now,
        updatedAt: now,
        authorUid: uid,
      });
      setOneOffFormYm(null);
      setOneOffForm({
        title: '',
        category: 'OTHER',
        dueDate: `${periodYm}-15`,
        expectedAmount: '',
      });
      onAlert('Obligation ponctuelle ajoutée.', 'success');
    } catch (err) {
      console.error(err);
      onAlert('Création impossible.', 'error');
    }
  };

  const handleDeleteOneOff = async (oo: ObligationOneOff) => {
    if (
      !oo.id ||
      !confirm(`Supprimer la ligne ponctuelle « ${oo.title} » pour ${oo.periodYm} ?`)
    ) {
      return;
    }
    if (oo.proofStoragePath) {
      try {
        await deleteObject(ref(storage, oo.proofStoragePath));
      } catch {
        /* */
      }
    }
    try {
      await deleteDoc(doc(db, 'obligation_one_offs', oo.id));
      onAlert('Ligne supprimée.', 'success');
    } catch (e) {
      console.error(e);
      onAlert('Suppression impossible.', 'error');
    }
  };

  const applyPaymentOneOff = async (oo: ObligationOneOff) => {
    const draft = paidDateDraft[oo.id!]?.trim();
    const paidAt = draft || getLocalDateString();
    const amt =
      oo.expectedAmount != null && oo.expectedAmount > 0 ? oo.expectedAmount : oo.paidAmount || 0;
    try {
      await updateDoc(doc(db, 'obligation_one_offs', oo.id!), {
        status: 'PAID',
        paidAt,
        paidAmount: amt,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error(e);
      onAlert('Enregistrement impossible.', 'error');
    }
  };

  const clearPaymentOneOff = async (oo: ObligationOneOff) => {
    try {
      await updateDoc(doc(db, 'obligation_one_offs', oo.id!), {
        status: 'PENDING',
        paidAt: null,
        paidAmount: null,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error(e);
      onAlert('Échec.', 'error');
    }
  };

  const updatePaidDateOnlyOneOff = async (oo: ObligationOneOff) => {
    const draft = paidDateDraft[oo.id!]?.trim();
    if (!draft || oo.status !== 'PAID') return;
    try {
      await updateDoc(doc(db, 'obligation_one_offs', oo.id!), {
        paidAt: draft,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error(e);
      onAlert('Mise à jour de la date impossible.', 'error');
    }
  };

  const handleUploadProofOneOff = async (oo: ObligationOneOff, file: File) => {
    if (!oo.id) return;
    setUploadingId(oo.id);
    try {
      const safe = file.name.replace(/[^\w.-]/g, '_').slice(0, 80);
      const path = `obligation_proofs/${oo.id}/${Date.now()}_${safe}`;
      const sref = ref(storage, path);
      await uploadBytes(sref, file, { contentType: file.type || undefined });
      const url = await getDownloadURL(sref);
      await updateDoc(doc(db, 'obligation_one_offs', oo.id), {
        proofStoragePath: path,
        proofDownloadUrl: url,
        updatedAt: new Date().toISOString(),
      });
      onAlert('Preuve enregistrée.', 'success');
    } catch (e) {
      console.error(e);
      onAlert('Upload impossible.', 'error');
    } finally {
      setUploadingId(null);
    }
  };

  const handleRemoveProofOneOff = async (oo: ObligationOneOff) => {
    if (!oo.id || !oo.proofStoragePath) return;
    try {
      await deleteObject(ref(storage, oo.proofStoragePath));
    } catch {
      /* */
    }
    try {
      await updateDoc(doc(db, 'obligation_one_offs', oo.id), {
        proofStoragePath: null,
        proofDownloadUrl: null,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error(e);
      onAlert('Erreur suppression preuve.', 'error');
    }
  };

  const handleAddTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTpl.title.trim()) return;
    const now = new Date().toISOString();
    const uid = auth.currentUser?.uid || userUid;
    const unitSlug = newTpl.unitSlug.trim() || null;
    const aptRow = rentRows.find((r) => r.unitSlug === unitSlug);
    try {
      await addDoc(collection(db, 'obligation_templates'), {
        title: newTpl.title.trim(),
        category: newTpl.category,
        dueDayOfMonth: Math.min(31, Math.max(1, Number(newTpl.dueDayOfMonth) || 5)),
        expectedAmount:
          newTpl.expectedAmount.trim() === '' ? null : Math.max(0, Number(newTpl.expectedAmount) || 0),
        unitSlug,
        apartmentName: aptRow?.apartmentName || null,
        active: true,
        notes: newTpl.notes.trim() || null,
        createdAt: now,
        updatedAt: now,
        authorUid: uid,
      });
      setNewTpl(newTemplateFormEmpty);
      onAlert('Obligation récurrente ajoutée.', 'success');
    } catch (err) {
      console.error(err);
      onAlert('Création impossible.', 'error');
    }
  };

  const handleDeleteTemplate = async (t: ObligationTemplate) => {
    if (!t.id || !confirm(`Supprimer « ${t.title} » ? Les lignes déjà créées pour l’année restent.`)) return;
    try {
      await deleteDoc(doc(db, 'obligation_templates', t.id));
      onAlert('Supprimé.', 'success');
    } catch (e) {
      console.error(e);
      onAlert('Suppression refusée.', 'error');
    }
  };

  const toggleTemplateActive = async (t: ObligationTemplate) => {
    if (!t.id) return;
    try {
      await updateDoc(doc(db, 'obligation_templates', t.id), {
        active: !t.active,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error(e);
      onAlert('Mise à jour impossible.', 'error');
    }
  };

  const busy = loadingTemplates || loadingOcc || ensuringYear;

  return (
    <>
      <div className="hidden md:flex print:hidden fixed right-0 top-1/2 -translate-y-1/2 z-[55] flex-col items-end pointer-events-none">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pointer-events-auto flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white shadow-xl rounded-l-xl px-2 py-4 border border-orange-700/40 border-r-0 transition-colors"
          title="Échéances — fiche annuelle"
        >
          <CalendarClock size={22} className="shrink-0" aria-hidden />
          <span
            className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            Échéances
          </span>
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <>
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="hidden md:block fixed inset-0 z-[56] bg-black/25 print:hidden"
              onClick={() => setOpen(false)}
              aria-label="Fermer"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="hidden md:flex print:hidden fixed top-0 right-0 z-[57] h-full w-full max-w-5xl flex-col bg-[#FAFAF9] border-l border-stone-200 shadow-2xl"
            >
              <header className="shrink-0 px-5 py-4 border-b border-stone-200 bg-white flex flex-wrap items-start gap-4">
                <div className="flex-1 min-w-[14rem]">
                  <p className="text-[10px] font-black uppercase tracking-widest text-orange-600">
                    Charges récurrentes
                  </p>
                  <h2 className="text-xl font-black text-stone-900 tracking-tight">Fiche par année</h2>
                  <p className="text-[11px] text-stone-500 mt-1 leading-relaxed max-w-xl">
                    Une liste par mois : échéance, date de règlement, preuve. Les lignes récurrentes viennent des
                    modèles (modifiables ou retirables pour un mois donné) ; les lignes{' '}
                    <strong className="text-stone-700">ponctuelles</strong> sont ajoutées pour un mois précis.
                  </p>
                  <p className="text-[10px] text-stone-400 mt-1 truncate">{userProfile.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={seeding}
                    onClick={() => void handleSeedFromPark()}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-950 text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
                  >
                    {seeding ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Loyers + salaires (parc)
                  </button>
                  <div className="flex items-center gap-1 bg-stone-100 rounded-xl px-1 py-1 border border-stone-200">
                    <button
                      type="button"
                      className="p-2 rounded-lg hover:bg-white text-stone-600"
                      onClick={() => setYear((y) => y - 1)}
                      aria-label="Année précédente"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <span className="text-sm font-black tabular-nums px-3 min-w-[4rem] text-center">{year}</span>
                    <button
                      type="button"
                      className="p-2 rounded-lg hover:bg-white text-stone-600"
                      onClick={() => setYear((y) => y + 1)}
                      aria-label="Année suivante"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="p-2 rounded-xl hover:bg-stone-100 text-stone-600"
                    aria-label="Fermer"
                  >
                    <PanelRightClose size={22} />
                  </button>
                </div>
              </header>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
                <button
                  type="button"
                  onClick={() => setShowTemplatesEditor((v) => !v)}
                  className="text-[10px] font-black uppercase tracking-widest text-orange-700 hover:text-orange-900"
                >
                  {showTemplatesEditor ? '▼ Masquer obligations récurrentes (modèles)' : '▶ Gérer les obligations récurrentes'}
                </button>

                {showTemplatesEditor && (
                  <div className="rounded-xl border border-stone-200 bg-white p-4 grid md:grid-cols-2 gap-4">
                    <form onSubmit={handleAddTemplate} className="space-y-2">
                      <p className="text-[11px] font-bold text-stone-700">Ajouter une ligne récurrente</p>
                      <input
                        placeholder="Libellé (ex. Internet Orange)"
                        value={newTpl.title}
                        onChange={(e) => setNewTpl((s) => ({ ...s, title: e.target.value }))}
                        className="w-full text-xs rounded-lg border border-stone-200 px-2 py-2"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={newTpl.category}
                          onChange={(e) =>
                            setNewTpl((s) => ({ ...s, category: e.target.value as ObligationCategory }))
                          }
                          className="text-xs rounded-lg border border-stone-200 px-2 py-2"
                        >
                          {(Object.keys(CATEGORY_LABELS) as ObligationCategory[]).map((k) => (
                            <option key={k} value={k}>
                              {CATEGORY_LABELS[k]}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={1}
                          max={31}
                          placeholder="Jour échéance"
                          value={newTpl.dueDayOfMonth}
                          onChange={(e) =>
                            setNewTpl((s) => ({ ...s, dueDayOfMonth: Number(e.target.value) }))
                          }
                          className="text-xs rounded-lg border border-stone-200 px-2 py-2"
                        />
                      </div>
                      <input
                        type="number"
                        min={0}
                        placeholder="Montant XAF (optionnel)"
                        value={newTpl.expectedAmount}
                        onChange={(e) => setNewTpl((s) => ({ ...s, expectedAmount: e.target.value }))}
                        className="w-full text-xs rounded-lg border border-stone-200 px-2 py-2"
                      />
                      {newTpl.category === 'RENT' && (
                        <select
                          value={newTpl.unitSlug}
                          onChange={(e) => setNewTpl((s) => ({ ...s, unitSlug: e.target.value }))}
                          className="w-full text-xs rounded-lg border border-stone-200 px-2 py-2"
                        >
                          <option value="">— Unité —</option>
                          {rentRows.map((r) => (
                            <option key={r.unitSlug} value={r.unitSlug}>
                              {r.apartmentName} · {r.unitSlug}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="submit"
                        className="w-full flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 text-white text-[10px] font-black uppercase tracking-widest py-2.5 rounded-lg"
                      >
                        <Plus size={14} /> Ajouter
                      </button>
                    </form>
                    <div className="border-t md:border-t-0 md:border-l border-stone-100 pt-4 md:pt-0 md:pl-4 space-y-2 max-h-56 overflow-y-auto">
                      <p className="text-[11px] font-bold text-stone-700">Modèles existants</p>
                      {templates.map((t) => (
                        <div
                          key={t.id}
                          className="flex items-start justify-between gap-2 text-[11px] bg-stone-50 rounded-lg px-2 py-2"
                        >
                          <div className="min-w-0">
                            <div className="font-bold truncate">{t.title}</div>
                            <div className="text-[10px] text-stone-500">
                              {CATEGORY_LABELS[t.category]} · jour {t.dueDayOfMonth}
                              {t.expectedAmount != null && t.expectedAmount > 0 && (
                                <> · {formatCurrency(t.expectedAmount)}</>
                              )}
                              {!t.active && <span className="text-orange-700 font-black ml-1">(off)</span>}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => toggleTemplateActive(t)}
                              className="text-[9px] font-black uppercase px-2 py-1 rounded bg-white border border-stone-200"
                            >
                              {t.active ? 'Off' : 'On'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTemplate(t)}
                              className="text-[9px] text-red-600 px-2 py-1"
                            >
                              <Trash2 size={12} className="inline" />
                            </button>
                          </div>
                        </div>
                      ))}
                      {!templates.length && (
                        <p className="text-[10px] text-stone-400">Aucun modèle — importez depuis le parc ou ajoutez.</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 text-[10px] font-black uppercase text-stone-400">
                  {busy && <Loader2 size={14} className="animate-spin text-orange-600" />}
                  Année {year} —{' '}
                  {busy ? 'chargement…' : `${occurrencesYear.length + oneOffsYear.length} ligne(s)`}
                </div>

                <div className="space-y-8 pb-12">
                  {MOIS_FR.map((nom, idx) => {
                    const periodYm = `${year}-${String(idx + 1).padStart(2, '0')}`;
                    const rows = rowsByMonth.get(periodYm) || [];
                    return (
                      <section
                        key={periodYm}
                        className="rounded-2xl border border-stone-200 bg-white shadow-sm overflow-hidden"
                      >
                        <div className="px-4 py-2.5 bg-stone-100 border-b border-stone-200 flex flex-wrap justify-between items-center gap-2">
                          <h3 className="text-sm font-black text-stone-900">
                            {nom} {year}
                          </h3>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-stone-500 tabular-nums">
                              {rows.length} obligation(s)
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setOneOffFormYm((prev) => {
                                  const next = prev === periodYm ? null : periodYm;
                                  if (next) {
                                    setOneOffForm({
                                      title: '',
                                      category: 'OTHER',
                                      dueDate: `${periodYm}-15`,
                                      expectedAmount: '',
                                    });
                                  }
                                  return next;
                                });
                              }}
                              className={`text-[9px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg border transition-colors ${
                                oneOffFormYm === periodYm
                                  ? 'bg-orange-600 border-orange-700 text-white'
                                  : 'bg-white border-stone-200 text-orange-800 hover:bg-orange-50'
                              }`}
                            >
                              {oneOffFormYm === periodYm ? 'Fermer' : '+ Ponctuelle'}
                            </button>
                          </div>
                        </div>

                        {oneOffFormYm === periodYm && (
                          <form
                            onSubmit={(e) => void handleSubmitOneOff(e, periodYm)}
                            className="px-4 py-3 bg-orange-50/80 border-b border-orange-100 flex flex-wrap gap-2 items-end"
                          >
                            <div className="flex-1 min-w-[10rem]">
                              <label className="text-[9px] font-black uppercase text-stone-500 block mb-0.5">
                                Libellé
                              </label>
                              <input
                                value={oneOffForm.title}
                                onChange={(e) => setOneOffForm((s) => ({ ...s, title: e.target.value }))}
                                placeholder="Ex. Réparation compteur"
                                className="w-full text-xs rounded-lg border border-stone-200 px-2 py-2 bg-white"
                              />
                            </div>
                            <div className="w-[9rem]">
                              <label className="text-[9px] font-black uppercase text-stone-500 block mb-0.5">
                                Type
                              </label>
                              <select
                                value={oneOffForm.category}
                                onChange={(e) =>
                                  setOneOffForm((s) => ({
                                    ...s,
                                    category: e.target.value as ObligationCategory,
                                  }))
                                }
                                className="w-full text-xs rounded-lg border border-stone-200 px-2 py-2 bg-white"
                              >
                                {(Object.keys(CATEGORY_LABELS) as ObligationCategory[]).map((k) => (
                                  <option key={k} value={k}>
                                    {CATEGORY_LABELS[k]}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="w-[11rem]">
                              <label className="text-[9px] font-black uppercase text-stone-500 block mb-0.5">
                                Échéance (dans le mois)
                              </label>
                              <input
                                type="date"
                                value={oneOffForm.dueDate}
                                onChange={(e) => setOneOffForm((s) => ({ ...s, dueDate: e.target.value }))}
                                min={`${periodYm}-01`}
                                max={`${periodYm}-31`}
                                className="w-full text-xs rounded-lg border border-stone-200 px-2 py-2 bg-white"
                              />
                            </div>
                            <div className="w-[8rem]">
                              <label className="text-[9px] font-black uppercase text-stone-500 block mb-0.5">
                                Montant
                              </label>
                              <input
                                type="number"
                                min={0}
                                placeholder="XAF"
                                value={oneOffForm.expectedAmount}
                                onChange={(e) =>
                                  setOneOffForm((s) => ({ ...s, expectedAmount: e.target.value }))
                                }
                                className="w-full text-xs rounded-lg border border-stone-200 px-2 py-2 bg-white"
                              />
                            </div>
                            <button
                              type="submit"
                              className="text-[10px] font-black uppercase bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg shrink-0"
                            >
                              Ajouter la ligne
                            </button>
                          </form>
                        )}

                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-[11px] min-w-[720px]">
                            <thead>
                              <tr className="border-b border-stone-100 bg-stone-50/80 text-[9px] font-black uppercase tracking-wider text-stone-500">
                                <th className="px-3 py-2 w-[22%]">Obligation</th>
                                <th className="px-3 py-2 w-[10%]">Type</th>
                                <th className="px-3 py-2 w-[10%]">Montant</th>
                                <th className="px-3 py-2 w-[11%]">Échéance</th>
                                <th className="px-3 py-2 w-[13%]">Réglé le</th>
                                <th className="px-3 py-2 w-[14%]">Preuve</th>
                                <th className="px-3 py-2 w-[20%]">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {!rows.length && (
                                <tr>
                                  <td colSpan={7} className="px-3 py-8 text-center text-stone-400 italic">
                                    Aucune ligne ce mois-ci — utilisez « + Ponctuelle » ou activez des modèles
                                    récurrents.
                                  </td>
                                </tr>
                              )}
                              {rows.map((row) => {
                                if (row.kind === 'recurring') {
                                  const { occ, tpl } = row;
                                  const alert = urgencyLabel(occ.status, occ.dueDate);
                                  const rowBg =
                                    occ.status === 'PAID'
                                      ? 'bg-emerald-50/50'
                                      : alert === 'Dépassé'
                                        ? 'bg-red-50/60'
                                        : alert === 'À régler'
                                          ? 'bg-amber-50/70'
                                          : '';
                                  return (
                                    <tr key={occ.id} className={`border-b border-stone-100 ${rowBg}`}>
                                      <td className="px-3 py-2 align-top">
                                        <div className="font-bold text-stone-900">{recurringRowTitle(occ, tpl)}</div>
                                        {tpl.unitSlug && (
                                          <div className="text-[10px] text-stone-400 font-mono">{tpl.unitSlug}</div>
                                        )}
                                      </td>
                                      <td className="px-3 py-2 align-top text-stone-600">
                                        {CATEGORY_LABELS[tpl.category]}
                                      </td>
                                      <td className="px-3 py-2 align-top tabular-nums text-stone-700">
                                        {(() => {
                                          const a = recurringRowExpectedAmount(occ, tpl);
                                          return a != null && a > 0 ? formatCurrency(a) : '—';
                                        })()}
                                      </td>
                                      <td className="px-3 py-2 align-top tabular-nums font-medium">{occ.dueDate}</td>
                                      <td className="px-3 py-2 align-top">
                                        <input
                                          type="date"
                                          className="w-full max-w-[9.5rem] text-[11px] border border-stone-200 rounded-lg px-1 py-1 bg-white"
                                          value={paidDateDraft[occ.id!] ?? ''}
                                          onChange={(e) =>
                                            setPaidDateDraft((d) => ({ ...d, [occ.id!]: e.target.value }))
                                          }
                                          onBlur={() => {
                                            if (occ.status === 'PAID') void updatePaidDateOnly(occ);
                                          }}
                                        />
                                      </td>
                                      <td className="px-3 py-2 align-top">
                                        {occ.proofDownloadUrl ? (
                                          <div className="flex flex-col gap-1">
                                            <a
                                              href={occ.proofDownloadUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-orange-700 font-bold underline truncate max-w-[10rem]"
                                            >
                                              Voir
                                            </a>
                                            <button
                                              type="button"
                                              onClick={() => handleRemoveProof(occ)}
                                              className="text-[10px] text-red-600 hover:underline text-left"
                                            >
                                              Retirer
                                            </button>
                                          </div>
                                        ) : (
                                          <label className="inline-flex items-center gap-1 cursor-pointer text-orange-700 font-bold hover:underline">
                                            <Upload size={12} />
                                            Ajouter
                                            <input
                                              type="file"
                                              accept="image/*,application/pdf"
                                              className="hidden"
                                              disabled={uploadingId === occ.id}
                                              onChange={(e) => {
                                                const f = e.target.files?.[0];
                                                e.target.value = '';
                                                if (f) void handleUploadProof(occ, f);
                                              }}
                                            />
                                          </label>
                                        )}
                                        {uploadingId === occ.id && (
                                          <Loader2 size={14} className="animate-spin text-orange-600 mt-1" />
                                        )}
                                      </td>
                                      <td className="px-3 py-2 align-top">
                                        <div className="flex flex-wrap gap-1.5 items-center">
                                          {occ.status !== 'PAID' ? (
                                            <button
                                              type="button"
                                              onClick={() => void applyPayment(occ, tpl)}
                                              className="text-[9px] font-black uppercase bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1.5 rounded-lg"
                                            >
                                              OK payé
                                            </button>
                                          ) : (
                                            <button
                                              type="button"
                                              onClick={() => void clearPayment(occ)}
                                              className="text-[9px] font-black uppercase bg-stone-200 hover:bg-stone-300 text-stone-800 px-2 py-1.5 rounded-lg"
                                            >
                                              Effacer
                                            </button>
                                          )}
                                          {alert && occ.status !== 'PAID' && (
                                            <span
                                              className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${
                                                alert === 'Dépassé'
                                                  ? 'bg-red-200 text-red-900'
                                                  : 'bg-amber-200 text-amber-950'
                                              }`}
                                            >
                                              {alert}
                                            </span>
                                          )}
                                          {occ.status === 'PAID' && (
                                            <span className="text-[9px] font-black uppercase text-emerald-800">
                                              Réglé
                                            </span>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => openEditRecurring(occ, tpl)}
                                            className="text-[9px] font-black uppercase bg-white border border-stone-300 text-stone-800 hover:bg-stone-50 px-2 py-1.5 rounded-lg inline-flex items-center gap-1"
                                          >
                                            <Pencil size={12} /> Modifier
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => void handleDeleteRecurringOccurrence(occ)}
                                            className="text-[9px] font-black uppercase bg-red-50 border border-red-200 text-red-900 hover:bg-red-100 px-2 py-1.5 rounded-lg"
                                          >
                                            Retirer ce mois
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                }

                                const oo = row.oo;
                                const alert = urgencyLabel(oo.status, oo.dueDate);
                                const rowBg =
                                  oo.status === 'PAID'
                                    ? 'bg-emerald-50/50'
                                    : alert === 'Dépassé'
                                      ? 'bg-red-50/60'
                                      : alert === 'À régler'
                                        ? 'bg-amber-50/70'
                                        : 'bg-orange-50/30';
                                return (
                                  <tr key={oo.id} className={`border-b border-stone-100 ${rowBg}`}>
                                    <td className="px-3 py-2 align-top">
                                      <div className="font-bold text-stone-900">{oo.title}</div>
                                      <div className="text-[9px] font-black uppercase text-orange-800 tracking-wide">
                                        Ponctuelle
                                      </div>
                                    </td>
                                    <td className="px-3 py-2 align-top text-stone-600">
                                      {CATEGORY_LABELS[oo.category]}
                                    </td>
                                    <td className="px-3 py-2 align-top tabular-nums text-stone-700">
                                      {oo.expectedAmount != null && oo.expectedAmount > 0
                                        ? formatCurrency(oo.expectedAmount)
                                        : '—'}
                                    </td>
                                    <td className="px-3 py-2 align-top tabular-nums font-medium">{oo.dueDate}</td>
                                    <td className="px-3 py-2 align-top">
                                      <input
                                        type="date"
                                        className="w-full max-w-[9.5rem] text-[11px] border border-stone-200 rounded-lg px-1 py-1 bg-white"
                                        value={paidDateDraft[oo.id!] ?? ''}
                                        onChange={(e) =>
                                          setPaidDateDraft((d) => ({ ...d, [oo.id!]: e.target.value }))
                                        }
                                        onBlur={() => {
                                          if (oo.status === 'PAID') void updatePaidDateOnlyOneOff(oo);
                                        }}
                                      />
                                    </td>
                                    <td className="px-3 py-2 align-top">
                                      {oo.proofDownloadUrl ? (
                                        <div className="flex flex-col gap-1">
                                          <a
                                            href={oo.proofDownloadUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-orange-700 font-bold underline truncate max-w-[10rem]"
                                          >
                                            Voir
                                          </a>
                                          <button
                                            type="button"
                                            onClick={() => handleRemoveProofOneOff(oo)}
                                            className="text-[10px] text-red-600 hover:underline text-left"
                                          >
                                            Retirer
                                          </button>
                                        </div>
                                      ) : (
                                        <label className="inline-flex items-center gap-1 cursor-pointer text-orange-700 font-bold hover:underline">
                                          <Upload size={12} />
                                          Ajouter
                                          <input
                                            type="file"
                                            accept="image/*,application/pdf"
                                            className="hidden"
                                            disabled={uploadingId === oo.id}
                                            onChange={(e) => {
                                              const f = e.target.files?.[0];
                                              e.target.value = '';
                                              if (f) void handleUploadProofOneOff(oo, f);
                                            }}
                                          />
                                        </label>
                                      )}
                                      {uploadingId === oo.id && (
                                        <Loader2 size={14} className="animate-spin text-orange-600 mt-1" />
                                      )}
                                    </td>
                                    <td className="px-3 py-2 align-top">
                                      <div className="flex flex-wrap gap-1.5 items-center">
                                        {oo.status !== 'PAID' ? (
                                          <button
                                            type="button"
                                            onClick={() => void applyPaymentOneOff(oo)}
                                            className="text-[9px] font-black uppercase bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1.5 rounded-lg"
                                          >
                                            OK payé
                                          </button>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => void clearPaymentOneOff(oo)}
                                            className="text-[9px] font-black uppercase bg-stone-200 hover:bg-stone-300 text-stone-800 px-2 py-1.5 rounded-lg"
                                          >
                                            Effacer
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => void handleDeleteOneOff(oo)}
                                          className="text-[9px] font-black uppercase bg-red-100 hover:bg-red-200 text-red-900 px-2 py-1.5 rounded-lg border border-red-200"
                                        >
                                          Supprimer
                                        </button>
                                        {alert && oo.status !== 'PAID' && (
                                          <span
                                            className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${
                                              alert === 'Dépassé'
                                                ? 'bg-red-200 text-red-900'
                                                : 'bg-amber-200 text-amber-950'
                                            }`}
                                          >
                                            {alert}
                                          </span>
                                        )}
                                        {oo.status === 'PAID' && (
                                          <span className="text-[9px] font-black uppercase text-emerald-800">
                                            Réglé
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>

              {editRecurring && (
                <div
                  className="absolute inset-0 z-[60] flex items-center justify-center p-4 bg-black/35"
                  role="presentation"
                  onClick={() => !editRecurringSaving && setEditRecurring(null)}
                >
                  <div
                    role="dialog"
                    aria-labelledby="edit-recurring-title"
                    className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 border border-stone-200 max-h-[90vh] overflow-y-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div>
                        <p
                          id="edit-recurring-title"
                          className="text-[10px] font-black uppercase tracking-widest text-orange-600"
                        >
                          Ligne récurrente
                        </p>
                        <p className="text-sm font-bold text-stone-900 mt-1">
                          {(() => {
                            const [, mm] = editRecurring.occ.periodYm.split('-');
                            const i = Number(mm) - 1;
                            const label = i >= 0 && i < 12 ? MOIS_FR[i] : editRecurring.occ.periodYm;
                            return `${label} ${year}`;
                          })()}
                        </p>
                        <p className="text-[11px] text-stone-500 mt-0.5">
                          Modèle : {editRecurring.tpl.title}
                          {editRecurring.tpl.expectedAmount != null && editRecurring.tpl.expectedAmount > 0
                            ? ` · ${formatCurrency(editRecurring.tpl.expectedAmount)}`
                            : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={editRecurringSaving}
                        onClick={() => setEditRecurring(null)}
                        className="p-2 rounded-xl hover:bg-stone-100 text-stone-500 shrink-0"
                        aria-label="Fermer"
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <form onSubmit={handleSaveEditRecurring} className="space-y-3">
                      <label className="block">
                        <span className="text-[10px] font-black uppercase text-stone-500">
                          Libellé affiché (optionnel)
                        </span>
                        <input
                          type="text"
                          className="mt-1 w-full border border-stone-200 rounded-lg px-3 py-2 text-sm"
                          placeholder={editRecurring.tpl.title}
                          value={editForm.displayTitle}
                          onChange={(e) => setEditForm((f) => ({ ...f, displayTitle: e.target.value }))}
                          maxLength={200}
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-black uppercase text-stone-500">Échéance</span>
                        <input
                          type="date"
                          required
                          className="mt-1 w-full border border-stone-200 rounded-lg px-3 py-2 text-sm"
                          value={editForm.dueDate}
                          onChange={(e) => setEditForm((f) => ({ ...f, dueDate: e.target.value }))}
                        />
                        <span className="text-[10px] text-stone-400 mt-0.5 block">
                          Doit rester dans le mois {editRecurring.occ.periodYm}.
                        </span>
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-black uppercase text-stone-500">
                          Montant pour ce mois (optionnel)
                        </span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="mt-1 w-full border border-stone-200 rounded-lg px-3 py-2 text-sm tabular-nums"
                          placeholder={
                            editRecurring.tpl.expectedAmount != null
                              ? String(editRecurring.tpl.expectedAmount)
                              : '—'
                          }
                          value={editForm.expectedAmount}
                          onChange={(e) => setEditForm((f) => ({ ...f, expectedAmount: e.target.value }))}
                        />
                        <span className="text-[10px] text-stone-400 mt-0.5 block">
                          Vide = montant du modèle pour ce mois.
                        </span>
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-black uppercase text-stone-500">Notes</span>
                        <textarea
                          className="mt-1 w-full border border-stone-200 rounded-lg px-3 py-2 text-sm min-h-[4rem] resize-y"
                          placeholder="Optionnel"
                          value={editForm.notes}
                          onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                          maxLength={4000}
                        />
                      </label>
                      <div className="flex flex-wrap gap-2 pt-2 justify-end">
                        <button
                          type="button"
                          disabled={editRecurringSaving}
                          onClick={() => setEditRecurring(null)}
                          className="px-4 py-2 rounded-xl border border-stone-300 text-stone-800 text-[11px] font-black uppercase hover:bg-stone-50"
                        >
                          Annuler
                        </button>
                        <button
                          type="submit"
                          disabled={editRecurringSaving}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-[11px] font-black uppercase disabled:opacity-50"
                        >
                          {editRecurringSaving ? <Loader2 size={14} className="animate-spin" /> : null}
                          Enregistrer
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
