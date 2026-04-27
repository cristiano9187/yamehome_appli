import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  setDoc,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { TARIFS, SITE_MAPPING, getPrepaidEligibleUnitRowsFromTarifs, formatCurrency } from '../constants';
import { PrepaidElectricityToken, UserProfile, UnitElectricitySettings } from '../types';
import { Zap, Menu, Loader2, Trash2, Plus } from 'lucide-react';

interface PrepaidElectricityTokensViewProps {
  userProfile: UserProfile | null;
  onMenuClick?: () => void;
  onAlert: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export default function PrepaidElectricityTokensView({ userProfile, onMenuClick, onAlert }: PrepaidElectricityTokensViewProps) {
  const isMainAdmin =
    userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' ||
    userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
  const isAdmin = userProfile?.role === 'admin' || isMainAdmin;

  const allRows = useMemo(() => getPrepaidEligibleUnitRowsFromTarifs(), []);
  const allowedUnitRows = useMemo(() => {
    if (!userProfile) return [] as { unitSlug: string; apartmentName: string }[];
    if (isAdmin) return allRows;
    const allowedApartments = (userProfile.allowedSites || []).flatMap((s) => SITE_MAPPING[s] || []);
    return allRows.filter((r) => allowedApartments.includes(r.apartmentName));
  }, [userProfile, allRows, isAdmin]);

  const [selectedUnitSlug, setSelectedUnitSlug] = useState('');
  const [tokens, setTokens] = useState<PrepaidElectricityToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [meterSettings, setMeterSettings] = useState<UnitElectricitySettings | null>(null);
  const [meterInput, setMeterInput] = useState('');
  const [summaryMonth, setSummaryMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const [newCode, setNewCode] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newKwh, setNewKwh] = useState('');

  const selectedRow = useMemo(
    () => allowedUnitRows.find((r) => r.unitSlug === selectedUnitSlug),
    [allowedUnitRows, selectedUnitSlug]
  );

  useEffect(() => {
    if (allowedUnitRows.length === 0) return;
    const stillValid = allowedUnitRows.some((r) => r.unitSlug === selectedUnitSlug);
    if (!selectedUnitSlug || !stillValid) {
      setSelectedUnitSlug(allowedUnitRows[0].unitSlug);
    }
  }, [allowedUnitRows, selectedUnitSlug]);

  useEffect(() => {
    if (!selectedUnitSlug) {
      setTokens([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(collection(db, 'prepaid_electricity_tokens'), where('unitSlug', '==', selectedUnitSlug));
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as PrepaidElectricityToken))
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setTokens(list);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
        onAlert('Impossible de charger les jetons.', 'error');
      }
    );
  }, [selectedUnitSlug, onAlert]);

  useEffect(() => {
    if (!selectedUnitSlug) {
      setMeterSettings(null);
      setMeterInput('');
      return;
    }
    const ref = doc(db, 'unit_electricity_settings', selectedUnitSlug);
    return onSnapshot(ref, (s) => {
      if (s.exists()) {
        const d = s.data() as UnitElectricitySettings;
        setMeterSettings(d);
        setMeterInput(d.meterNumber || '');
      } else {
        setMeterSettings(null);
        setMeterInput('');
      }
    });
  }, [selectedUnitSlug]);

  const monthSpent = useMemo(() => {
    const prefix = `${summaryMonth}-`;
    return tokens
      .filter((t) => t.used && t.usedAt && t.usedAt.startsWith(prefix))
      .reduce((sum, t) => sum + t.purchasePrice, 0);
  }, [tokens, summaryMonth]);

  const monthUsedCount = useMemo(() => {
    const prefix = `${summaryMonth}-`;
    return tokens.filter((t) => t.used && t.usedAt && t.usedAt.startsWith(prefix)).length;
  }, [tokens, summaryMonth]);

  const availableCount = useMemo(() => tokens.filter((t) => !t.used).length, [tokens]);

  const saveMeter = async () => {
    if (!isAdmin || !selectedRow) return;
    const now = new Date().toISOString();
    try {
      await setDoc(
        doc(db, 'unit_electricity_settings', selectedUnitSlug),
        {
          unitSlug: selectedUnitSlug,
          apartmentName: selectedRow.apartmentName,
          meterNumber: meterInput.trim(),
          updatedAt: now,
          updatedByUid: auth.currentUser?.uid || '',
        } satisfies UnitElectricitySettings,
        { merge: true }
      );
      onAlert('N° de compteur enregistré', 'success');
    } catch (e) {
      onAlert("Erreur d'enregistrement du compteur", 'error');
    }
  };

  const addToken = async () => {
    if (!isAdmin || !selectedRow) return;
    const code = newCode.trim();
    const price = parseFloat(newPrice.replace(/\s/g, '').replace(',', '.'));
    const kwh = parseFloat(newKwh.replace(/\s/g, '').replace(',', '.'));
    if (!code || code.length > 128) {
      onAlert('Code jeton requis (max. 128 caractères).', 'info');
      return;
    }
    if (Number.isNaN(price) || price < 0) {
      onAlert('Prix d’achat invalide.', 'info');
      return;
    }
    if (Number.isNaN(kwh) || kwh <= 0) {
      onAlert('kWh attendus invalides (nombre > 0).', 'info');
      return;
    }
    const now = new Date().toISOString();
    const uid = auth.currentUser?.uid || '';
    try {
      await addDoc(collection(db, 'prepaid_electricity_tokens'), {
        unitSlug: selectedUnitSlug,
        apartmentName: selectedRow.apartmentName,
        tokenCode: code,
        purchasePrice: price,
        expectedKwh: kwh,
        used: false,
        usedAt: null,
        usedByUid: null,
        usedByDisplayName: null,
        createdAt: now,
        updatedAt: now,
        createdByUid: uid,
      });
      setNewCode('');
      setNewPrice('');
      setNewKwh('');
      onAlert('Jeton ajouté', 'success');
    } catch (e) {
      onAlert("Erreur à l'ajout du jeton", 'error');
    }
  };

  const setTokenUsed = async (t: PrepaidElectricityToken, used: boolean) => {
    if (!t.id) return;
    const { id, ...row } = t;
    if (used) {
      if (!window.confirm('Confirmer que ce jeton a bien été utilisé sur ce compteur ? La date et l’heure seront enregistrées.')) return;
      const now = new Date().toISOString();
      const display = (auth.currentUser?.displayName || userProfile?.email || 'Agent').trim() || 'Agent';
      try {
        await setDoc(
          doc(db, 'prepaid_electricity_tokens', id),
          {
            ...row,
            used: true,
            usedAt: now,
            usedByUid: auth.currentUser?.uid || '',
            usedByDisplayName: display,
            updatedAt: now,
          } as Record<string, unknown>,
          { merge: true }
        );
        onAlert('Utilisation enregistrée', 'success');
      } catch (e) {
        onAlert('Erreur de mise à jour', 'error');
      }
    } else {
      if (!isAdmin) return;
      if (!window.confirm('Rouvrir ce jeton (annuler l’utilisation) ?')) return;
      const now = new Date().toISOString();
      try {
        await setDoc(
          doc(db, 'prepaid_electricity_tokens', id),
          {
            ...row,
            used: false,
            usedAt: null,
            usedByUid: null,
            usedByDisplayName: null,
            updatedAt: now,
          } as Record<string, unknown>,
          { merge: true }
        );
        onAlert('Jeton rouvert', 'success');
      } catch (e) {
        onAlert('Erreur de mise à jour', 'error');
      }
    }
  };

  const removeToken = async (t: PrepaidElectricityToken) => {
    if (!isAdmin || !t.id) return;
    if (!window.confirm('Supprimer définitivement ce jeton ?')) return;
    try {
      await deleteDoc(doc(db, 'prepaid_electricity_tokens', t.id));
      onAlert('Jeton supprimé', 'success');
    } catch (e) {
      onAlert('Erreur de suppression', 'error');
    }
  };

  if (allowedUnitRows.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#F5F5F4] p-8 text-center text-slate-500">
        <Zap className="w-10 h-10 text-amber-500 mb-2" />
        <p className="text-sm">Aucun logement autorisé pour la gestion des jetons d’électricité.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#F5F5F4] overflow-hidden">
      <header className="h-20 bg-white border-b border-gray-200 px-4 md:px-8 flex items-center gap-4 shrink-0 z-30">
        {onMenuClick && (
          <button type="button" onClick={onMenuClick} className="md:hidden p-2 hover:bg-gray-100 rounded-xl">
            <Menu size={20} />
          </button>
        )}
        <div>
          <h2 className="text-base font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            Prépayé (jetons kWh)
          </h2>
          <p className="text-[10px] text-slate-500">
            Chaque jeton est lié à un logement. Cochez après utilisation — date, heure et agent sont enregistrés.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-8 max-w-4xl w-full mx-auto space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 md:p-6 space-y-4 shadow-sm">
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">Logement (unité)</label>
          <select
            value={selectedUnitSlug}
            onChange={(e) => setSelectedUnitSlug(e.target.value)}
            className="w-full text-sm font-medium border border-slate-200 rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500"
          >
            {allowedUnitRows.map((r) => (
              <option key={r.unitSlug} value={r.unitSlug}>
                {r.apartmentName} — {r.unitSlug}
              </option>
            ))}
          </select>

          {selectedRow && TARIFS[selectedRow.apartmentName] && (
            <p className="text-xs text-slate-500">{(TARIFS[selectedRow.apartmentName] as { address: string }).address}</p>
          )}

          <div className="border-t border-slate-100 pt-4">
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">N° de compteur (affichage)</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={meterInput}
                onChange={(e) => setMeterInput(e.target.value)}
                readOnly={!isAdmin}
                className={`flex-1 text-sm border border-slate-200 rounded-xl px-3 py-2 ${
                  !isAdmin ? 'bg-slate-50 text-slate-600' : ''
                }`}
                placeholder="Ex. 12345678"
              />
              {isAdmin && (
                <button
                  type="button"
                  onClick={saveMeter}
                  className="shrink-0 px-4 py-2 bg-slate-800 text-white text-xs font-bold rounded-xl hover:bg-slate-900"
                >
                  Enregistrer
                </button>
              )}
            </div>
          </div>
        </div>

        {isAdmin && (
          <div className="bg-amber-50/80 border border-amber-200 rounded-2xl p-4 md:p-6 space-y-3">
            <h3 className="text-sm font-bold text-amber-950 flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Ajouter un jeton (stock)
            </h3>
            <p className="text-xs text-amber-900/80">Code, prix d’achat manuel, kWh attendus — rattaché au logement ci-dessus.</p>
            <input
              type="text"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              className="w-full text-sm font-mono border border-amber-200/80 rounded-xl px-3 py-2 bg-white"
              placeholder="Code du jeton"
              maxLength={128}
            />
            <div className="grid sm:grid-cols-2 gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                className="text-sm border border-amber-200/80 rounded-xl px-3 py-2 bg-white"
                placeholder="Prix d'achat (XAF)"
              />
              <input
                type="text"
                inputMode="decimal"
                value={newKwh}
                onChange={(e) => setNewKwh(e.target.value)}
                className="text-sm border border-amber-200/80 rounded-xl px-3 py-2 bg-white"
                placeholder="kWh attendus"
              />
            </div>
            <button
              type="button"
              onClick={addToken}
              className="w-full sm:w-auto px-5 py-2.5 bg-amber-600 text-white text-sm font-bold rounded-xl hover:bg-amber-700"
            >
              Enregistrer le jeton
            </button>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Synthèse mois</label>
            <input
              type="month"
              value={summaryMonth}
              onChange={(e) => setSummaryMonth(e.target.value)}
              className="text-sm border border-slate-200 rounded-xl px-2 py-1.5"
            />
          </div>
          <div className="text-sm">
            Dépensé (jetons cochés ce mois) : <strong>{formatCurrency(monthSpent)}</strong> — {monthUsedCount} jeton(s)
          </div>
          <div className="text-sm text-emerald-700">En stock (non utilisés) : {availableCount}</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
            </div>
          ) : tokens.length === 0 ? (
            <p className="p-8 text-center text-slate-500 text-sm">Aucun jeton pour ce logement.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {tokens.map((t) => (
                <li key={t.id} className="p-4 flex flex-col gap-2 hover:bg-slate-50/80">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-mono break-all text-slate-800 bg-slate-100 rounded-lg px-2 py-1.5 inline-block max-w-full">
                        {t.tokenCode}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-600">
                        <span>
                          <strong className="text-slate-900">{t.expectedKwh}</strong> kWh
                        </span>
                        <span>{formatCurrency(t.purchasePrice)}</span>
                        {t.used && t.usedAt && (
                          <span className="text-xs text-slate-500">
                            Utilisé le {new Date(t.usedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}{' '}
                            {t.usedByDisplayName && `· ${t.usedByDisplayName}`}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={t.used}
                          onChange={() => setTokenUsed(t, !t.used)}
                          disabled={t.used && !isAdmin}
                          title={t.used && !isAdmin ? 'Seul un administrateur peut rouvrir un jeton' : 'Marquer comme utilisé'}
                          className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500 disabled:opacity-50"
                        />
                        <span className="text-sm font-medium">Utilisé</span>
                      </label>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => removeToken(t)}
                          className="p-2 text-slate-400 hover:text-red-600"
                          title="Supprimer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
