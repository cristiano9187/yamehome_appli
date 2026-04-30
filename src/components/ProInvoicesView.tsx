import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  limit,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { ProInvoice, ReceiptData, UserProfile } from '../types';
import { formatCurrency, SITE_MAPPING } from '../constants';
import {
  Menu,
  FileText,
  Plus,
  Loader2,
  Save,
  Trash2,
  Printer,
  ArrowLeft,
  Search,
} from 'lucide-react';
import ProInvoicePrintPreview from './ProInvoicePrintPreview';

interface ProInvoicesViewProps {
  userProfile: UserProfile | null;
  onMenuClick?: () => void;
  onAlert: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function nightsBetween(startDate: string, endDate: string): number {
  const n = Math.ceil(
    (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000
  );
  return Math.max(1, n || 1);
}

function defaultInvoiceNumber(r: ReceiptData): string {
  const tail = `${r.receiptId}`.slice(-24);
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `FAC-YH-${d}-${tail}`;
}

/** Suggested PDF filename — Chrome utilise souvent document.title lors de « Enregistrer au format PDF ». */
function buildProInvoicePdfSuggestedFilename(inv: ProInvoice): string {
  const clean = (str: string, maxLen: number) => {
    const s = String(str ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '')
      .slice(0, maxLen);
    return s || 'x';
  };

  const client = clean(inv.billedToDisplayName, 48);
  const site = clean(inv.calendarSlug || inv.apartmentName || 'site', 28);

  const idate = inv.invoiceDate ?? '';
  const moisFacture =
    /^\d{4}-\d{2}-\d{2}$/.test(idate)
      ? `${idate.slice(0, 4)}_${idate.slice(5, 7)}`
      : clean(idate.slice(0, 7), 9);

  const d = new Date();
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const jourImpression = `${y}_${m}_${day}`;

  return `facture_${client}_${site}_${moisFacture}_${jourImpression}`;
}

export function proInvoiceDraftFromReceipt(r: ReceiptData, authorUid: string): Omit<ProInvoice, 'id'> {
  const nights = nightsBetween(r.startDate, r.endDate);
  const amountFrom = Math.round(r.grandTotal);
  const amountInv = Math.max(1, amountFrom);
  const unitPu = Math.round(amountInv / nights);
  const now = new Date().toISOString();
  return {
    sourceReceiptFirestoreId: r.id || r.receiptId,
    receiptBusinessId: r.receiptId,
    apartmentName: r.apartmentName,
    calendarSlug: r.calendarSlug,
    guestFirstName: r.firstName,
    guestLastName: r.lastName,
    startDate: r.startDate,
    endDate: r.endDate,
    amountFromReceipt: amountFrom,
    amountInvoice: amountInv,
    adjustmentNote: null,
    paidStamp: 'none',
    invoiceNumber: defaultInvoiceNumber(r),
    invoiceDate: new Date().toISOString().split('T')[0]!,
    issuePlace: 'Yaoundé',
    billedToDisplayName: `${r.lastName.toUpperCase()} ${r.firstName}`.trim(),
    sectionTitle: 'HEBERGEMENT',
    lineLabel: 'Hébergement meublé',
    roomsCount: 1,
    nightsCount: nights,
    unitPriceDisplay: unitPu,
    currency: 'XAF',
    authorUid,
    createdAt: now,
    updatedAt: now,
  };
}

export default function ProInvoicesView({ userProfile, onMenuClick, onAlert }: ProInvoicesViewProps) {
  const [invoices, setInvoices] = useState<ProInvoice[]>([]);
  const [receipts, setReceipts] = useState<ReceiptData[]>([]);
  const [loadingInv, setLoadingInv] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'list' | 'edit'>('list');
  const [editing, setEditing] = useState<Omit<ProInvoice, 'id'> | ProInvoice | null>(null);
  const [receiptSearch, setReceiptSearch] = useState('');

  const isMainAdmin =
    userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' ||
    userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
  const isAdmin = userProfile?.role === 'admin' || isMainAdmin;

  const permissionReceipts = useMemo(() => {
    const allowedSites = userProfile?.allowedSites || [];
    const allowedApartments = isAdmin ? null : allowedSites.flatMap((site) => SITE_MAPPING[site] || []);
    return (r: ReceiptData) => {
      if (r.status !== 'VALIDE') return false;
      if (isAdmin) return true;
      return allowedApartments!.includes(r.apartmentName);
    };
  }, [userProfile, isAdmin]);

  const filteredReceiptsPick = useMemo(() => {
    const q = receiptSearch.trim().toLowerCase();
    return receipts.filter(permissionReceipts).filter((r) => {
      if (!q) return true;
      return (
        r.receiptId.toLowerCase().includes(q) ||
        r.lastName.toLowerCase().includes(q) ||
        r.apartmentName.toLowerCase().includes(q)
      );
    });
  }, [receipts, permissionReceipts, receiptSearch]);

  /** Titre navigateur → nom de fichier conseillé à l’enregistrement PDF (voir App.tsx pour les reçus). */
  useEffect(() => {
    if (mode !== 'edit' || editing === null) return;
    const originalTitle = document.title;
    const inv = editing as ProInvoice;
    document.title = buildProInvoicePdfSuggestedFilename(inv);

    const onBeforePrint = () => {
      document.title = buildProInvoicePdfSuggestedFilename(inv);
    };
    window.addEventListener('beforeprint', onBeforePrint);

    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      document.title = originalTitle;
    };
  }, [mode, editing]);

  useEffect(() => {
    const q = query(collection(db, 'pro_invoices'), orderBy('createdAt', 'desc'), limit(200));
    const unsub: Unsubscribe = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProInvoice));
        setInvoices(rows);
        setLoadingInv(false);
      },
      () => {
        setLoadingInv(false);
        onAlert('Erreur de lecture des factures (index Firestore ou règles).', 'error');
      }
    );
    return () => unsub();
  }, [onAlert]);

  useEffect(() => {
    const q = query(collection(db, 'receipts'), orderBy('createdAt', 'desc'), limit(400));
    return onSnapshot(q, (snap) => {
      setReceipts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ReceiptData)));
    });
  }, []);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (!q) return true;
      return (
        (inv.invoiceNumber || '').toLowerCase().includes(q) ||
        inv.billedToDisplayName.toLowerCase().includes(q) ||
        inv.receiptBusinessId.toLowerCase().includes(q)
      );
    });
  }, [invoices, search]);

  const beginNew = useCallback(() => {
    setMode('edit');
    setEditing(null);
    setReceiptSearch('');
    onAlert('Sélectionnez un reçu VALIDE comme base — montants tirés du reçu interne.', 'info');
  }, [onAlert]);

  const pickReceipt = useCallback(
    (r: ReceiptData) => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      setEditing(proInvoiceDraftFromReceipt(r, uid));
      onAlert(`Pré-rempli depuis le reçu ${r.receiptId}. Ajustez puis enregistrez.`, 'success');
    },
    [onAlert]
  );

  const openEdit = useCallback((row: ProInvoice) => {
    setEditing(row);
    setMode('edit');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setMode('list');
  }, []);

  const handleSave = async () => {
    if (!editing) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const invNum = editing.invoiceNumber?.trim();
    const billed = editing.billedToDisplayName?.trim();
    if (!invNum || !billed || !editing.sourceReceiptFirestoreId) {
      onAlert('Numéro de facture et destinataire (« Doit ») sont obligatoires.', 'error');
      return;
    }
    setSaving(true);
    const now = new Date().toISOString();
    const adjustmentNote =
      editing.adjustmentNote && editing.adjustmentNote.trim() !== ''
        ? editing.adjustmentNote.trim()
        : null;

    try {
      const payload = stripUndefined({
        sourceReceiptFirestoreId: editing.sourceReceiptFirestoreId,
        receiptBusinessId: editing.receiptBusinessId.trim(),
        apartmentName: editing.apartmentName,
        calendarSlug: editing.calendarSlug,
        guestFirstName: editing.guestFirstName,
        guestLastName: editing.guestLastName.trim(),
        startDate: editing.startDate,
        endDate: editing.endDate,
        amountFromReceipt: Math.round(editing.amountFromReceipt),
        amountInvoice: Math.max(1, Math.round(editing.amountInvoice)),
        adjustmentNote,
        invoiceNumber: invNum,
        invoiceDate: editing.invoiceDate,
        issuePlace: (editing.issuePlace || '').trim() || 'Yaoundé',
        billedToDisplayName: billed,
        sectionTitle: (editing.sectionTitle || 'HEBERGEMENT').trim(),
        lineLabel: (editing.lineLabel || 'Hébergement').trim(),
        roomsCount: Math.min(99, Math.max(1, Math.round(Number(editing.roomsCount)) || 1)),
        nightsCount: Math.min(999, Math.max(1, Math.round(Number(editing.nightsCount)) || 1)),
        unitPriceDisplay: Math.max(0, Math.round(Number(editing.unitPriceDisplay))),
        currency: 'XAF' as const,
        paidStamp: editing.paidStamp ?? 'none',
        updatedAt: now,
        authorUid: editing.authorUid,
      }) as Omit<ProInvoice, 'createdAt'> & { updatedAt: string };

      const pid = 'id' in editing && editing.id ? editing.id : null;
      if (pid) {
        await updateDoc(doc(db, 'pro_invoices', pid), payload);
        onAlert('Facture mise à jour.', 'success');
      } else {
        await addDoc(collection(db, 'pro_invoices'), {
          ...(payload as object),
          authorUid: uid,
          createdAt: now,
        });
        onAlert('Facture enregistrée.', 'success');
      }
      setMode('list');
      setEditing(null);
    } catch (e) {
      console.error(e);
      onAlert('Enregistrement impossible — réseau, droits ou champs.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: ProInvoice) => {
    if (!row.id || !isAdmin) return;
    if (!window.confirm('Supprimer cette facture définitivement ?')) return;
    try {
      await deleteDoc(doc(db, 'pro_invoices', row.id));
      onAlert('Facture supprimée.', 'success');
    } catch {
      onAlert('Suppression impossible.', 'error');
    }
  };

  const handlePrint = () => {
    if (editing) {
      document.title = buildProInvoicePdfSuggestedFilename(editing as ProInvoice);
    }
    window.print();
  };

  const syncUnitPrice = () => {
    if (!editing) return;
    const n = Math.max(1, Math.round(Number(editing.nightsCount)) || 1);
    const tot = Math.max(1, Math.round(Number(editing.amountInvoice)) || 1);
    setEditing({ ...editing, unitPriceDisplay: Math.round(tot / n), nightsCount: n });
  };

  if (mode === 'edit' && !editing) {
    return (
      <div className="flex-1 flex flex-col bg-[#F5F5F4] overflow-y-auto">
        <header className="h-auto min-h-[4rem] bg-white border-b border-gray-200 px-4 md:px-8 py-4 flex flex-wrap items-center gap-4 sticky top-0 z-40">
          {onMenuClick && (
            <button type="button" onClick={onMenuClick} className="md:hidden p-2 hover:bg-gray-100 rounded-xl">
              <Menu size={22} />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setMode('list');
            }}
            className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-500 hover:text-gray-900"
          >
            <ArrowLeft size={16} /> Retour
          </button>
          <h2 className="text-base font-black uppercase tracking-widest flex items-center gap-2 ml-auto md:ml-0">
            <FileText className="text-[#2B4B8C]" size={22} />
            Nouvelle facture — choisir le reçu
          </h2>
        </header>

        <div className="p-4 md:p-8 max-w-2xl mx-auto w-full">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                value={receiptSearch}
                onChange={(e) => setReceiptSearch(e.target.value)}
                placeholder="Filtrer par n° reçu, nom, logement…"
                className="w-full pl-10 pr-3 py-3 rounded-xl border border-gray-200 text-sm"
              />
            </div>
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-gray-50 border border-gray-100 rounded-xl">
              {filteredReceiptsPick.slice(0, 50).map((r) => (
                <button
                  key={r.id || r.receiptId}
                  type="button"
                  onClick={() => pickReceipt(r)}
                  className="w-full text-left px-3 py-3 text-xs hover:bg-blue-50/80 flex justify-between gap-2 items-center"
                >
                  <span className="font-mono font-bold text-[#2B4B8C]">{r.receiptId}</span>
                  <span className="text-gray-700 truncate flex-1 text-right">
                    {r.lastName} {r.firstName} — {formatCurrency(r.grandTotal)}
                  </span>
                </button>
              ))}
              {filteredReceiptsPick.length === 0 && (
                <p className="px-3 py-8 text-center text-xs text-gray-400">Aucun reçu VALIDE disponible.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'edit' && editing) {
    const ed = editing;
    const printData: ProInvoice = {
      ...(ed as ProInvoice),
      id: 'id' in ed && ed.id ? ed.id : undefined,
      createdAt: ed.createdAt || new Date().toISOString(),
      updatedAt: ed.updatedAt || new Date().toISOString(),
    };

    return (
      <div className="flex-1 flex flex-col bg-[#F5F5F4] overflow-y-auto">
        <header className="h-auto min-h-[4rem] bg-white border-b border-gray-200 px-4 md:px-8 py-4 flex flex-wrap items-center gap-4 sticky top-0 z-40 print:hidden">
          {onMenuClick && (
            <button type="button" onClick={onMenuClick} className="md:hidden p-2 hover:bg-gray-100 rounded-xl">
              <Menu size={22} />
            </button>
          )}
          <button
            type="button"
            onClick={cancelEdit}
            className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-500 hover:text-gray-900"
          >
            <ArrowLeft size={16} /> Retour liste
          </button>
          <h2 className="text-base font-black uppercase tracking-widest flex items-center gap-2 ml-auto md:ml-0">
            <FileText className="text-[#2B4B8C]" size={22} />
            Facture société {!('id' in ed && ed.id) ? '(nouvelle)' : ''}
          </h2>
          <button
            type="button"
            onClick={handlePrint}
            className="ml-auto md:ml-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 bg-white text-xs font-black uppercase tracking-widest hover:bg-gray-50"
          >
            <Printer size={16} /> PDF / Imprimer
          </button>
        </header>

        <div className="p-4 md:p-8 max-w-6xl mx-auto w-full space-y-6 pb-24">
          <div className="grid lg:grid-cols-2 gap-8 items-start">
            <div className="space-y-4 print:hidden">
              <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
                <label className="text-[10px] font-black uppercase text-gray-400">N° facture</label>
                <input
                  value={ed.invoiceNumber}
                  onChange={(e) => setEditing({ ...ed, invoiceNumber: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono"
                />
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black uppercase text-gray-400">Date facture</label>
                    <input
                      type="date"
                      value={ed.invoiceDate}
                      onChange={(e) => setEditing({ ...ed, invoiceDate: e.target.value })}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-gray-400">Lieu</label>
                    <input
                      value={ed.issuePlace}
                      onChange={(e) => setEditing({ ...ed, issuePlace: e.target.value })}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400">Doit (nom affiché employeur)</label>
                  <input
                    value={ed.billedToDisplayName}
                    onChange={(e) => setEditing({ ...ed, billedToDisplayName: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-semibold"
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black uppercase text-gray-400">Bloc (titre)</label>
                    <input
                      value={ed.sectionTitle}
                      onChange={(e) => setEditing({ ...ed, sectionTitle: e.target.value })}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm uppercase"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-gray-400">Libellé ligne</label>
                    <input
                      value={ed.lineLabel}
                      onChange={(e) => setEditing({ ...ed, lineLabel: e.target.value })}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] font-black uppercase text-gray-400">Montant reçu (interne)</label>
                    <input
                      type="number"
                      readOnly
                      value={ed.amountFromReceipt}
                      className="w-full border border-dashed border-gray-300 rounded-xl px-2 py-2 text-sm bg-gray-50 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-gray-400">Montant facture</label>
                    <input
                      type="number"
                      value={ed.amountInvoice}
                      onChange={(e) =>
                        setEditing({ ...ed, amountInvoice: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-full border border-gray-200 rounded-xl px-2 py-2 text-sm font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-gray-400">Prix unit. (FCFA)</label>
                    <input
                      type="number"
                      value={ed.unitPriceDisplay}
                      onChange={(e) =>
                        setEditing({ ...ed, unitPriceDisplay: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-full border border-gray-200 rounded-xl px-2 py-2 text-sm font-mono"
                    />
                  </div>
                </div>
                <button type="button" onClick={syncUnitPrice} className="text-[10px] font-black uppercase text-blue-600 hover:underline">
                  Recalculer PU = montant facture ÷ nuitées
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-black uppercase text-gray-400">Chambres / pers.</label>
                    <input
                      type="number"
                      min={1}
                      value={ed.roomsCount}
                      onChange={(e) =>
                        setEditing({
                          ...ed,
                          roomsCount: Math.max(1, parseInt(e.target.value, 10) || 1),
                        })
                      }
                      className="w-full border border-gray-200 rounded-xl px-2 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-gray-400">Nuitées</label>
                    <input
                      type="number"
                      min={1}
                      value={ed.nightsCount}
                      onChange={(e) =>
                        setEditing({
                          ...ed,
                          nightsCount: Math.max(1, parseInt(e.target.value, 10) || 1),
                        })
                      }
                      className="w-full border border-gray-200 rounded-xl px-2 py-2 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400">Note écart (optionnel)</label>
                  <input
                    value={ed.adjustmentNote ?? ''}
                    onChange={(e) => setEditing({ ...ed, adjustmentNote: e.target.value })}
                    placeholder="Ex. demande RH, alignement seuil…"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400">
                    Tampon sur le PDF (optionnel)
                  </label>
                  <select
                    value={ed.paidStamp ?? 'none'}
                    onChange={(e) =>
                      setEditing({
                        ...ed,
                        paidStamp: e.target.value as ProInvoice['paidStamp'],
                      })
                    }
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm mt-1 bg-white"
                  >
                    <option value="none">Aucun tampon</option>
                    <option value="paid">« Payé » (rouge, centré)</option>
                    <option value="paid_cash">« Payé comptant » (rouge)</option>
                  </select>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave()}
                  className="w-full py-4 bg-[#2B4B8C] text-white font-black uppercase text-xs tracking-widest rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                  Enregistrer la facture
                </button>
              </div>
            </div>

            <div className="print:block">
              <ProInvoicePrintPreview data={printData} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#F5F5F4] overflow-y-auto">
      <header className="h-auto min-h-[4rem] bg-white border-b border-gray-200 px-4 md:px-8 py-4 flex flex-wrap items-center gap-4 sticky top-0 z-40">
        {onMenuClick && (
          <button type="button" onClick={onMenuClick} className="md:hidden p-2 hover:bg-gray-100 rounded-xl">
            <Menu size={22} />
          </button>
        )}
        <div>
          <h2 className="text-base font-black uppercase tracking-widest flex items-center gap-2">
            <FileText className="text-[#2B4B8C]" size={22} />
            Factures société
          </h2>
          <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest">
            Documents employeurs — liées aux reçus internes
          </p>
        </div>
        <button
          type="button"
          onClick={beginNew}
          className="ml-auto md:ml-0 inline-flex items-center gap-2 px-5 py-3 bg-[#2B4B8C] text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg"
        >
          <Plus size={18} /> Nouvelle facture
        </button>
      </header>

      <div className="p-4 md:p-8 max-w-6xl mx-auto w-full space-y-6 pb-16">
        <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap gap-4 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher n° facture, client…"
              className="w-full pl-10 pr-3 py-3 rounded-xl border border-gray-200 text-sm"
            />
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-400">
                <tr>
                  <th className="px-4 py-3">Créée</th>
                  <th className="px-4 py-3">N° facture</th>
                  <th className="px-4 py-3">Doit</th>
                  <th className="px-4 py-3">Reçu</th>
                  <th className="px-4 py-3 text-right">Montant facture</th>
                  <th className="px-4 py-3 text-right">Montant interne</th>
                  <th className="px-4 py-3 w-36">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredInvoices.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      {row.createdAt ? new Date(row.createdAt).toLocaleDateString('fr-FR') : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{row.invoiceNumber}</td>
                    <td className="px-4 py-3 text-xs max-w-[180px] truncate" title={row.billedToDisplayName}>
                      {row.billedToDisplayName}
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-gray-600">{row.receiptBusinessId}</td>
                    <td className="px-4 py-3 text-right font-bold">{formatCurrency(row.amountInvoice)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{formatCurrency(row.amountFromReceipt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          className="p-2 text-xs font-black uppercase text-blue-600 hover:bg-blue-50 rounded-lg"
                        >
                          Éditer
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => void handleDelete(row)}
                            className="p-2 text-red-400 hover:bg-red-50 rounded-lg"
                            title="Supprimer"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredInvoices.length === 0 && !loadingInv && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                      Aucune facture. Créez-en une depuis un reçu validé.
                    </td>
                  </tr>
                )}
                {loadingInv && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center">
                      <Loader2 className="animate-spin inline text-gray-400" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
