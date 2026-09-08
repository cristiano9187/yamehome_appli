import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  limit,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { CashMovement, CaisseId, UserProfile } from '../types';
import {
  CAISSES,
  formatCurrency,
  getCaisseById,
} from '../constants';
import {
  Menu,
  Loader2,
  Plus,
  Minus,
  Landmark,
  ArrowDownLeft,
  ArrowUpRight,
  Receipt,
} from 'lucide-react';

type Props = {
  userProfile: UserProfile | null;
  onMenuClick: () => void;
  onAlert: (msg: string, type?: 'success' | 'error' | 'info') => void;
};

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

export default function CaisseView({ userProfile, onMenuClick, onAlert }: Props) {
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalCaisse, setModalCaisse] = useState<CaisseId | null>(null);
  const [modalKind, setModalKind] = useState<'deposit' | 'withdrawal'>('deposit');
  const [formAmount, setFormAmount] = useState('');
  const [formMotif, setFormMotif] = useState('');
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterCaisse, setFilterCaisse] = useState<CaisseId | 'all'>('all');

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
    const list = movements.filter((m) => !m.voided);
    if (filterCaisse === 'all') return list;
    return list.filter((m) => m.caisseId === filterCaisse);
  }, [movements, filterCaisse]);

  const openManualModal = (caisseId: CaisseId, kind: 'deposit' | 'withdrawal') => {
    setModalCaisse(caisseId);
    setModalKind(kind);
    setFormAmount('');
    setFormMotif('');
    setFormDate(new Date().toISOString().slice(0, 10));
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
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
            <Landmark size={20} className="text-violet-700" />
          </div>
          <div>
            <h2 className="text-base font-black uppercase tracking-widest text-gray-900">Caisse</h2>
            <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest">
              Trésorerie Yaoundé — départ à zéro
            </p>
          </div>
        </div>
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
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4"
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
            </div>
          ))}
        </div>

        {/* Journal */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-700">Mouvements récents</h3>
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
          <div className="divide-y divide-gray-50 max-h-[420px] overflow-y-auto">
            {filteredMovements.length === 0 ? (
              <p className="p-8 text-center text-sm text-gray-400">Aucun mouvement pour l’instant.</p>
            ) : (
              filteredMovements.slice(0, 80).map((m) => {
                const caisse = getCaisseById(m.caisseId);
                const signed = movementSignedAmount(m);
                const isIn = signed >= 0;
                return (
                  <div key={m.id} className="px-5 py-3 flex items-start gap-3 hover:bg-gray-50/80">
                    <div
                      className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isIn ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                      }`}
                    >
                      {m.source === 'receipt' ? (
                        <Receipt size={14} />
                      ) : isIn ? (
                        <ArrowDownLeft size={14} />
                      ) : (
                        <ArrowUpRight size={14} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{m.motif}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {caisse?.label} · {new Date(m.date).toLocaleDateString('fr-FR')}
                        {m.source === 'receipt' ? ' · auto reçu' : ' · manuel'}
                        {m.authorName ? ` · ${m.authorName}` : ''}
                      </p>
                    </div>
                    <p
                      className={`text-sm font-black font-mono tabular-nums shrink-0 ${
                        isIn ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {isIn ? '+' : '−'}
                      {formatCurrency(Math.abs(signed))}
                    </p>
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
    </div>
  );
}
