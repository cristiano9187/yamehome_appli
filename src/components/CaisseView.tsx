import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  limit,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { CashMovement, CaisseId, UserProfile } from '../types';
import {
  CAISSES,
  formatCurrency,
  getCaisseById,
  canVoidCashMovements,
} from '../constants';
import {
  Menu,
  Loader2,
  Plus,
  Minus,
  Landmark,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Receipt,
  Ban,
} from 'lucide-react';

type Props = {
  userProfile: UserProfile | null;
  onMenuClick: () => void;
  onAlert: (msg: string, type?: 'success' | 'error' | 'info') => void;
};

const DEFAULT_TRANSFER_DEST: CaisseId = 'marchant_om';
/** Destination hors caisse : Afriland First Bank (sortie définitive hors trésorerie). */
const AFRILAND_EXIT = 'afriland_exit' as const;
type TransferDest = CaisseId | typeof AFRILAND_EXIT;

type DestOption = { id: TransferDest; label: string };

function destinationOptions(from: CaisseId): DestOption[] {
  if (from === 'marchant_om') {
    return [
      {
        id: AFRILAND_EXIT,
        label: 'Afriland First Bank (hors caisse)',
      },
    ];
  }
  return CAISSES.filter((c) => c.id !== from).map((c) => ({ id: c.id, label: c.label }));
}

function defaultDestination(from: CaisseId): TransferDest {
  const opts = destinationOptions(from);
  if (from === 'marchant_om') return AFRILAND_EXIT;
  return (
    opts.find((o) => o.id === DEFAULT_TRANSFER_DEST)?.id ||
    opts[0]?.id ||
    AFRILAND_EXIT
  );
}

function movementSignedAmount(m: CashMovement): number {
  if (m.voided) return 0;
  const v = Number(m.amount) || 0;
  return m.kind === 'withdrawal' ? -v : v;
}

function computeBalances(movements: CashMovement[]): Record<CaisseId, number> {
  const balances = Object.fromEntries(CAISSES.map((c) => [c.id, 0])) as Record<CaisseId, number>;
  for (const m of movements) {
    if (m.voided) continue;
    balances[m.caisseId] = (balances[m.caisseId] || 0) + movementSignedAmount(m);
  }
  return balances;
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function CaisseView({ userProfile, onMenuClick, onAlert }: Props) {
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalCaisse, setModalCaisse] = useState<CaisseId | null>(null);
  const [modalKind, setModalKind] = useState<'deposit' | 'withdrawal'>('deposit');
  const [formAmount, setFormAmount] = useState('');
  const [formMotif, setFormMotif] = useState('');
  const [formDate, setFormDate] = useState(todayYmd);
  const [filterCaisse, setFilterCaisse] = useState<CaisseId | 'all'>('all');
  const [showVoided, setShowVoided] = useState(false);

  const [voidTarget, setVoidTarget] = useState<CashMovement | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const canVoid = canVoidCashMovements(userProfile);

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferFrom, setTransferFrom] = useState<CaisseId>('om_solange');
  const [transferTo, setTransferTo] = useState<TransferDest>(DEFAULT_TRANSFER_DEST);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferMotif, setTransferMotif] = useState('');
  const [transferDate, setTransferDate] = useState(todayYmd);

  useEffect(() => {
    const q = query(
      collection(db, 'cash_movements'),
      orderBy('createdAt', 'desc'),
      limit(500)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMovements(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CashMovement)));
        setLoading(false);
      },
      () => {
        setLoading(false);
        onAlert('Impossible de charger les mouvements de caisse.', 'error');
      }
    );
    return () => unsub();
  }, [onAlert]);

  const balances = useMemo(() => computeBalances(movements), [movements]);
  const globalTotal = useMemo(
    () => CAISSES.reduce((sum, c) => sum + (balances[c.id] || 0), 0),
    [balances]
  );

  const stackSegments = useMemo(() => {
    const positive = CAISSES.map((c) => ({
      ...c,
      balance: Math.max(0, balances[c.id] || 0),
    })).filter((c) => c.balance > 0);
    const total = positive.reduce((s, c) => s + c.balance, 0) || 1;
    return positive.map((c) => ({ ...c, pct: (c.balance / total) * 100 }));
  }, [balances]);

  const filteredMovements = useMemo(() => {
    let list = movements;
    if (!showVoided) list = list.filter((m) => !m.voided);
    if (filterCaisse === 'all') return list;
    return list.filter((m) => m.caisseId === filterCaisse);
  }, [movements, filterCaisse, showVoided]);

  const openManualModal = (caisseId: CaisseId, kind: 'deposit' | 'withdrawal') => {
    setTransferOpen(false);
    setModalCaisse(caisseId);
    setModalKind(kind);
    setFormAmount('');
    setFormMotif('');
    setFormDate(todayYmd());
  };

  const openTransferModal = (from?: CaisseId) => {
    setModalCaisse(null);
    const source = from || 'om_solange';
    setTransferFrom(source);
    setTransferTo(defaultDestination(source));
    setTransferAmount('');
    setTransferMotif('');
    setTransferDate(todayYmd());
    setTransferOpen(true);
  };

  const submitManual = async () => {
    if (!modalCaisse || !userProfile) return;
    const amount = parseFloat(formAmount.replace(/\s/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      onAlert('Montant invalide.', 'error');
      return;
    }
    if (!formMotif.trim()) {
      onAlert('Indiquez un motif.', 'error');
      return;
    }
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const displayName =
        userProfile.displayName?.trim() ||
        userProfile.email?.split('@')[0] ||
        'Admin';
      await addDoc(collection(db, 'cash_movements'), {
        caisseId: modalCaisse,
        kind: modalKind,
        amount,
        motif: formMotif.trim(),
        date: formDate,
        source: 'manual',
        authorUid: uid,
        authorName: displayName,
        createdAt: now,
        updatedAt: now,
        voided: false,
      } satisfies Omit<CashMovement, 'id'>);
      setModalCaisse(null);
      onAlert(modalKind === 'deposit' ? 'Dépôt enregistré.' : 'Retrait enregistré.', 'success');
    } catch {
      onAlert('Erreur lors de l’enregistrement.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const submitTransfer = async () => {
    if (!userProfile) return;
    const amount = parseFloat(transferAmount.replace(/\s/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      onAlert('Montant invalide.', 'error');
      return;
    }

    const destOpts = destinationOptions(transferFrom);
    if (!destOpts.some((o) => o.id === transferTo)) {
      onAlert(
        transferFrom === 'marchant_om'
          ? 'Depuis Marchand OM, seule la sortie vers Afriland First Bank est autorisée.'
          : 'Destination non autorisée pour cette caisse.',
        'error'
      );
      return;
    }

    if (transferTo !== AFRILAND_EXIT && transferFrom === transferTo) {
      onAlert('Choisissez deux caisses différentes.', 'error');
      return;
    }

    const available = balances[transferFrom] || 0;
    if (amount > available) {
      onAlert(
        `Solde insuffisant sur ${getCaisseById(transferFrom)?.label} (${formatCurrency(available)}).`,
        'error'
      );
      return;
    }

    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const fromLabel = getCaisseById(transferFrom)?.label || transferFrom;
    const isAfrilandExit = transferTo === AFRILAND_EXIT;
    const toLabel = isAfrilandExit
      ? 'Afriland First Bank (hors caisse)'
      : getCaisseById(transferTo)?.label || transferTo;
    const motif =
      transferMotif.trim() ||
      (isAfrilandExit
        ? `Sortie Afriland First Bank (depuis ${fromLabel})`
        : `Transfert ${fromLabel} → ${toLabel}`);

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const displayName =
        userProfile.displayName?.trim() ||
        userProfile.email?.split('@')[0] ||
        'Admin';

      if (isAfrilandExit) {
        await addDoc(collection(db, 'cash_movements'), {
          caisseId: transferFrom,
          kind: 'withdrawal',
          amount,
          motif,
          date: transferDate,
          source: 'external_exit',
          externalDestination: 'afriland',
          authorUid: uid,
          authorName: displayName,
          createdAt: now,
          updatedAt: now,
          voided: false,
        } satisfies Omit<CashMovement, 'id'>);
        setTransferOpen(false);
        onAlert(
          `Sortie Afriland enregistrée (−${formatCurrency(amount)} hors caisse globale).`,
          'success'
        );
        return;
      }

      const transferId = `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const batch = writeBatch(db);
      const outRef = doc(collection(db, 'cash_movements'));
      const inRef = doc(collection(db, 'cash_movements'));
      const destCaisse = transferTo as CaisseId;

      const base = {
        amount,
        motif,
        date: transferDate,
        source: 'transfer' as const,
        transferId,
        authorUid: uid,
        authorName: displayName,
        createdAt: now,
        updatedAt: now,
        voided: false,
      };

      batch.set(outRef, {
        ...base,
        caisseId: transferFrom,
        kind: 'withdrawal',
        counterpartCaisseId: destCaisse,
      } satisfies Omit<CashMovement, 'id'>);

      batch.set(inRef, {
        ...base,
        caisseId: destCaisse,
        kind: 'deposit',
        counterpartCaisseId: transferFrom,
      } satisfies Omit<CashMovement, 'id'>);

      await batch.commit();
      setTransferOpen(false);
      onAlert(`Transfert enregistré : ${fromLabel} → ${toLabel}.`, 'success');
    } catch {
      onAlert('Erreur lors du transfert.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const voidMovementPairCount = (m: CashMovement): number => {
    if (!m.transferId) return 1;
    return movements.filter((x) => x.transferId === m.transferId && !x.voided).length;
  };

  const submitVoid = async () => {
    if (!voidTarget?.id || !canVoid) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const toVoid = voidTarget.transferId
      ? movements.filter((x) => x.transferId === voidTarget.transferId && !x.voided && x.id)
      : voidTarget.voided
        ? []
        : [voidTarget];

    if (toVoid.length === 0) {
      setVoidTarget(null);
      return;
    }

    const now = new Date().toISOString();
    const displayName =
      userProfile?.displayName?.trim() ||
      userProfile?.email?.split('@')[0] ||
      'Admin';
    const reason = voidReason.trim();

    setSaving(true);
    try {
      const batch = writeBatch(db);
      for (const mov of toVoid) {
        if (!mov.id) continue;
        batch.update(doc(db, 'cash_movements', mov.id), {
          voided: true,
          voidedAt: now,
          updatedAt: now,
          voidedByUid: uid,
          voidedByName: displayName,
          ...(reason ? { voidReason: reason } : {}),
        });
      }
      await batch.commit();
      setVoidTarget(null);
      setVoidReason('');
      onAlert(
        toVoid.length > 1
          ? `Transfert annulé (${toVoid.length} lignes).`
          : 'Mouvement annulé.',
        'success'
      );
    } catch {
      onAlert('Impossible d’annuler ce mouvement.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F5F5F4]">
        <Loader2 className="animate-spin text-violet-600" size={32} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#F5F5F4] overflow-y-auto min-h-0">
      <header className="h-20 bg-white border-b border-gray-200 px-4 md:px-8 flex items-center gap-4 sticky top-0 z-40">
        <button onClick={onMenuClick} className="md:hidden p-2 hover:bg-gray-100 rounded-xl" type="button">
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
            <Landmark size={20} className="text-violet-700" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-black uppercase tracking-widest text-gray-900">Caisse</h2>
            <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest truncate">
              Trésorerie Yaoundé — départ à zéro
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => openTransferModal()}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-violet-600 text-white text-[10px] font-black uppercase tracking-wider hover:bg-violet-700 shadow-sm"
        >
          <ArrowLeftRight size={14} />
          Transférer
        </button>
      </header>

      <div className="p-4 md:p-8 max-w-6xl mx-auto w-full space-y-6">
        {/* Total global + jauge empilée */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col md:flex-row gap-8 items-center">
          <div className="flex flex-col items-center">
            <div
              className="relative w-24 h-56 rounded-full border-4 border-gray-200 overflow-hidden bg-gray-50 flex flex-col-reverse shadow-inner"
              aria-label="Répartition des caisses"
            >
              {stackSegments.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-[9px] text-gray-400 font-bold uppercase px-2 text-center">
                  Vide
                </div>
              ) : (
                stackSegments.map((seg) => (
                  <div
                    key={seg.id}
                    className={`${seg.barClass} w-full transition-all duration-500`}
                    style={{ height: `${seg.pct}%`, minHeight: seg.pct > 0 ? '4px' : 0 }}
                    title={`${seg.label} : ${formatCurrency(seg.balance)}`}
                  />
                ))
              )}
            </div>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mt-3">Jauge</p>
          </div>

          <div className="flex-1 w-full space-y-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-violet-600 mb-1">
                Caisse globale
              </p>
              <p className="text-3xl md:text-4xl font-black font-mono text-gray-900 tabular-nums">
                {formatCurrency(globalTotal)}
              </p>
              <p className="text-[10px] text-gray-400 mt-1">
                Comptes de passage → Marchand OM. Excédents Marchand OM → Afriland (hors caisse).
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {CAISSES.map((c) => (
                <span
                  key={c.id}
                  className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full border ${c.pillClass}`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                  {c.label} · {formatCurrency(balances[c.id] || 0)}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Cartes par caisse */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CAISSES.map((c) => (
            <div
              key={c.id}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-8 rounded-full ${c.barClass}`} />
                    <h3 className="text-sm font-black uppercase tracking-wide text-gray-900">{c.label}</h3>
                  </div>
                  <p className="text-2xl font-black font-mono text-gray-900 mt-2 tabular-nums">
                    {formatCurrency(balances[c.id] || 0)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => openManualModal(c.id, 'deposit')}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-black uppercase tracking-wider hover:bg-emerald-100 transition-colors"
                >
                  <Plus size={14} />
                  Dépôt
                </button>
                <button
                  type="button"
                  onClick={() => openManualModal(c.id, 'withdrawal')}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-red-50 text-red-800 border border-red-200 text-[10px] font-black uppercase tracking-wider hover:bg-red-100 transition-colors"
                >
                  <Minus size={14} />
                  Retrait
                </button>
              </div>
              <button
                type="button"
                onClick={() => openTransferModal(c.id)}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-violet-50 text-violet-800 border border-violet-200 text-[10px] font-black uppercase tracking-wider hover:bg-violet-100 transition-colors"
              >
                <ArrowLeftRight size={13} />
                Transfert
              </button>
            </div>
          ))}
        </div>

        {/* Journal */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-700">Mouvements récents</h3>
            <div className="flex flex-wrap items-center gap-2">
              {canVoid && (
                <label className="inline-flex items-center gap-2 text-[10px] font-bold text-gray-500 uppercase tracking-wide cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showVoided}
                    onChange={(e) => setShowVoided(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Annulés
                </label>
              )}
              <select
                value={filterCaisse}
                onChange={(e) => setFilterCaisse(e.target.value as CaisseId | 'all')}
                className="text-xs border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 outline-none focus:border-violet-400"
              >
                <option value="all">Toutes les caisses</option>
                {CAISSES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="divide-y divide-gray-50 max-h-[420px] overflow-y-auto">
            {filteredMovements.length === 0 ? (
              <p className="p-8 text-center text-sm text-gray-400">Aucun mouvement pour l’instant.</p>
            ) : (
              filteredMovements.slice(0, 80).map((m) => {
                const caisse = getCaisseById(m.caisseId);
                const counterpart = m.counterpartCaisseId
                  ? getCaisseById(m.counterpartCaisseId)
                  : null;
                const signed = movementSignedAmount(m);
                const isIn = signed >= 0;
                const isVoided = !!m.voided;
                const sourceLabel =
                  m.source === 'receipt'
                    ? 'auto reçu'
                    : m.source === 'transfer'
                      ? 'transfert'
                      : m.source === 'external_exit'
                        ? 'sortie Afriland'
                        : 'manuel';
                const pairCount = voidMovementPairCount(m);
                return (
                  <div
                    key={m.id}
                    className={`px-5 py-3 flex items-start gap-3 hover:bg-gray-50/80 ${
                      isVoided ? 'opacity-60 bg-gray-50/50' : ''
                    }`}
                  >
                    <div
                      className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        m.source === 'transfer'
                          ? 'bg-violet-50 text-violet-600'
                          : m.source === 'external_exit'
                            ? 'bg-slate-100 text-slate-700'
                            : isIn
                              ? 'bg-emerald-50 text-emerald-600'
                              : 'bg-red-50 text-red-600'
                      }`}
                    >
                      {m.source === 'receipt' ? (
                        <Receipt size={14} />
                      ) : m.source === 'transfer' ? (
                        <ArrowLeftRight size={14} />
                      ) : isIn ? (
                        <ArrowDownLeft size={14} />
                      ) : (
                        <ArrowUpRight size={14} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-semibold truncate ${
                          isVoided ? 'line-through text-gray-500' : 'text-gray-900'
                        }`}
                      >
                        {m.motif}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {caisse?.label}
                        {counterpart ? ` ↔ ${counterpart.label}` : ''}
                        {m.externalDestination === 'afriland' ? ' → Afriland (hors caisse)' : ''}
                        {' · '}
                        {new Date(m.date).toLocaleDateString('fr-FR')}
                        {' · '}
                        {sourceLabel}
                        {m.authorName ? ` · ${m.authorName}` : ''}
                        {isVoided && m.voidedByName ? ` · annulé par ${m.voidedByName}` : ''}
                        {isVoided && m.voidReason ? ` · ${m.voidReason}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {canVoid && !isVoided && (
                        <button
                          type="button"
                          onClick={() => {
                            setVoidReason('');
                            setVoidTarget(m);
                          }}
                          className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200"
                          title={
                            pairCount > 1
                              ? 'Annuler le transfert (2 lignes)'
                              : 'Annuler ce mouvement'
                          }
                        >
                          <Ban size={14} />
                        </button>
                      )}
                      <p
                        className={`text-sm font-black font-mono tabular-nums ${
                          isVoided
                            ? 'text-gray-400 line-through'
                            : isIn
                              ? 'text-emerald-700'
                              : 'text-red-700'
                        }`}
                      >
                        {isVoided ? '' : isIn ? '+' : '−'}
                        {formatCurrency(Math.abs(isVoided ? m.amount : signed))}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Modal dépôt / retrait */}
      {modalCaisse && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl p-6 space-y-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">
              {modalKind === 'deposit' ? 'Dépôt manuel' : 'Retrait manuel'} — {getCaisseById(modalCaisse)?.label}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-black uppercase text-gray-500">Montant (FCFA)</label>
                <input
                  type="number"
                  min={1}
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 font-mono font-bold outline-none focus:border-violet-400"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-gray-500">Date</label>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-gray-500">Motif</label>
                <input
                  type="text"
                  value={formMotif}
                  onChange={(e) => setFormMotif(e.target.value)}
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                  placeholder="Ex. Apport caisse, achat fournitures…"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalCaisse(null)}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-xs font-black uppercase text-gray-600 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={submitManual}
                className="flex-1 py-3 rounded-xl bg-violet-600 text-white text-xs font-black uppercase hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? '…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal transfert */}
      {transferOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl p-6 space-y-4">
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">
                {transferTo === AFRILAND_EXIT ? 'Sortie Afriland' : 'Transfert entre caisses'}
              </h3>
              <p className="text-[11px] text-gray-500 mt-1">
                {transferTo === AFRILAND_EXIT
                  ? 'Sortie définitive hors trésorerie opérationnelle. La caisse globale diminue. Pas de retour comptable.'
                  : 'Retrait sur la source + dépôt sur la destination. La caisse globale ne change pas.'}
              </p>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-500">De</label>
                  <select
                    value={transferFrom}
                    onChange={(e) => {
                      const next = e.target.value as CaisseId;
                      setTransferFrom(next);
                      setTransferTo(defaultDestination(next));
                    }}
                    className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400 bg-white"
                  >
                    {CAISSES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label} ({formatCurrency(balances[c.id] || 0)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-500">Vers</label>
                  <select
                    value={transferTo}
                    onChange={(e) => setTransferTo(e.target.value as TransferDest)}
                    className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400 bg-white"
                  >
                    {destinationOptions(transferFrom).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-gray-500">Montant (FCFA)</label>
                <input
                  type="number"
                  min={1}
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 font-mono font-bold outline-none focus:border-violet-400"
                  placeholder="0"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Dispo {getCaisseById(transferFrom)?.label} : {formatCurrency(balances[transferFrom] || 0)}
                </p>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-gray-500">Date</label>
                <input
                  type="date"
                  value={transferDate}
                  onChange={(e) => setTransferDate(e.target.value)}
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-gray-500">Motif (optionnel)</label>
                <input
                  type="text"
                  value={transferMotif}
                  onChange={(e) => setTransferMotif(e.target.value)}
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                  placeholder={
                    transferTo === AFRILAND_EXIT
                      ? `Sortie Afriland First Bank (depuis ${getCaisseById(transferFrom)?.label})`
                      : `Transfert ${getCaisseById(transferFrom)?.label} → ${getCaisseById(transferTo as CaisseId)?.label}`
                  }
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setTransferOpen(false)}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-xs font-black uppercase text-gray-600 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={submitTransfer}
                className="flex-1 py-3 rounded-xl bg-violet-600 text-white text-xs font-black uppercase hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? '…' : transferTo === AFRILAND_EXIT ? 'Sortir' : 'Transférer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal annulation mouvement (super-admins) */}
      {voidTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl p-6 space-y-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-red-700">
              Annuler un mouvement
            </h3>
            <p className="text-sm text-gray-700">
              {voidMovementPairCount(voidTarget) > 1
                ? 'Ce transfert comporte deux lignes (retrait + dépôt). Les deux seront annulées.'
                : voidTarget.source === 'receipt'
                  ? 'Le mouvement sera exclu du solde. Si le reçu est resauvegardé avec le même versement, la sync pourra le recréer — supprimez ou modifiez le versement sur le reçu si besoin.'
                  : 'Le mouvement sera exclu du solde de caisse mais restera visible dans le journal (filtre « Annulés »).'}
            </p>
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 text-sm">
              <p className="font-semibold text-gray-900 truncate">{voidTarget.motif}</p>
              <p className="text-[11px] text-gray-500 mt-1 font-mono">
                {formatCurrency(voidTarget.amount)} · {getCaisseById(voidTarget.caisseId)?.label}
              </p>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase text-gray-500">
                Motif d’annulation (optionnel)
              </label>
              <input
                type="text"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-red-400"
                placeholder="Ex. doublon, erreur de saisie…"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setVoidTarget(null)}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-xs font-black uppercase text-gray-600 hover:bg-gray-50"
              >
                Retour
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={submitVoid}
                className="flex-1 py-3 rounded-xl bg-red-600 text-white text-xs font-black uppercase hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? '…' : 'Confirmer l’annulation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
