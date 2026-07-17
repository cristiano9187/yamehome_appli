import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { UnitMediaSubscription, MediaSubscriptionKind, UserProfile } from '../types';
import {
  YAOUNDE_UNIT_LABELS,
  MEDIA_WARN_DAYS_BEFORE,
  type YaoundeUnitSlug,
} from '../data/yaoundeObligationsSeed';
import { Loader2, Plus, Pencil, Trash2, Tv, AlertTriangle, RefreshCw } from 'lucide-react';

interface MediaSubscriptionsPanelProps {
  userUid: string;
  userProfile: UserProfile;
  canEdit?: boolean;
  onAlert: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatModifStamp(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function expiryUrgency(
  expiresOn: string | null,
  kind: MediaSubscriptionKind
): 'expired' | 'soon' | null {
  if (!expiresOn) return null;
  const today = todayLocal();
  if (today > expiresOn) return 'expired';
  const t0 = new Date(today + 'T12:00:00').getTime();
  const t1 = new Date(expiresOn + 'T12:00:00').getTime();
  const diffDays = Math.ceil((t1 - t0) / 86400000);
  if (diffDays <= MEDIA_WARN_DAYS_BEFORE[kind]) return 'soon';
  return null;
}

const KIND_LABEL: Record<MediaSubscriptionKind, string> = {
  CANAL_PLUS: 'Canal+',
  IPTV: 'IPTV',
};

const emptyForm = {
  kind: 'CANAL_PLUS' as MediaSubscriptionKind,
  unitSlug: 'modena-haut-standing' as YaoundeUnitSlug,
  bouquet: '',
  boxNumber: '',
  expiresOn: '',
  notes: '',
};

function actorLabel(profile: UserProfile): string {
  const name = (profile.displayName || '').trim();
  if (name) return name;
  return (profile.email || '').trim() || 'Utilisateur';
}

export default function MediaSubscriptionsPanel({
  userUid,
  userProfile,
  canEdit = false,
  onAlert,
}: MediaSubscriptionsPanelProps) {
  const [rows, setRows] = useState<UnitMediaSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  /** `renew` = employés + admins ; `edit` / `create` = admins */
  const [formMode, setFormMode] = useState<'create' | 'edit' | 'renew'>('create');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [filterKind, setFilterKind] = useState<'ALL' | MediaSubscriptionKind>('ALL');

  useEffect(() => {
    return onSnapshot(
      collection(db, 'unit_media_subscriptions'),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as UnitMediaSubscription))
          .filter((r) => r.active !== false)
          .sort((a, b) => {
            const ua = a.expiresOn || '9999';
            const ub = b.expiresOn || '9999';
            if (ua !== ub) return ua.localeCompare(ub);
            return a.apartmentName.localeCompare(b.apartmentName, 'fr');
          });
        setRows(list);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
        onAlert('Impossible de charger les abonnements TV.', 'error');
      }
    );
  }, [onAlert]);

  const filtered = useMemo(() => {
    if (filterKind === 'ALL') return rows;
    return rows.filter((r) => r.kind === filterKind);
  }, [rows, filterKind]);

  const alertCount = useMemo(
    () => rows.filter((r) => expiryUrgency(r.expiresOn, r.kind) != null).length,
    [rows]
  );

  const openCreate = () => {
    if (!canEdit) return;
    setFormMode('create');
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (r: UnitMediaSubscription) => {
    if (!canEdit) return;
    setFormMode('edit');
    setEditingId(r.id || null);
    setForm({
      kind: r.kind,
      unitSlug: r.unitSlug as YaoundeUnitSlug,
      bouquet: r.bouquet || '',
      boxNumber: r.boxNumber || '',
      expiresOn: r.expiresOn || '',
      notes: r.notes || '',
    });
    setFormOpen(true);
  };

  const openRenew = (r: UnitMediaSubscription) => {
    setFormMode('renew');
    setEditingId(r.id || null);
    setForm({
      kind: r.kind,
      unitSlug: r.unitSlug as YaoundeUnitSlug,
      bouquet: r.bouquet || '',
      boxNumber: r.boxNumber || '',
      expiresOn: r.expiresOn || '',
      notes: r.notes || '',
    });
    setFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const uid = auth.currentUser?.uid || userUid;
    const now = new Date().toISOString();
    const name = actorLabel(userProfile);
    const expiresOn = form.expiresOn.trim() || null;
    if (!expiresOn) {
      onAlert('Indiquez la nouvelle date d’expiration.', 'error');
      return;
    }
    setSaving(true);
    try {
      if (formMode === 'renew') {
        if (!editingId) return;
        const prev = rows.find((r) => r.id === editingId);
        if (!prev) return;
        await updateDoc(doc(db, 'unit_media_subscriptions', editingId), {
          expiresOn,
          updatedAt: now,
          lastModifiedByUid: uid,
          lastModifiedByName: name,
        });
        onAlert('Renouvellement enregistré.', 'success');
      } else if (!canEdit) {
        return;
      } else {
        const apartmentName = YAOUNDE_UNIT_LABELS[form.unitSlug] || form.unitSlug;
        const payload = {
          kind: form.kind,
          unitSlug: form.unitSlug,
          apartmentName,
          bouquet: form.bouquet.trim() || null,
          boxNumber: form.boxNumber.trim() || null,
          expiresOn,
          notes: form.notes.trim() || '',
          active: true,
          updatedAt: now,
          lastModifiedByUid: uid,
          lastModifiedByName: name,
        };
        if (editingId) {
          const prev = rows.find((r) => r.id === editingId);
          await updateDoc(doc(db, 'unit_media_subscriptions', editingId), {
            ...payload,
            authorUid: prev?.authorUid || uid,
            createdAt: prev?.createdAt || now,
            seedKey: prev?.seedKey ?? null,
          });
          onAlert('Abonnement mis à jour.', 'success');
        } else {
          await addDoc(collection(db, 'unit_media_subscriptions'), {
            ...payload,
            seedKey: null,
            createdAt: now,
            authorUid: uid,
          });
          onAlert('Abonnement ajouté.', 'success');
        }
      }
      setFormOpen(false);
    } catch (err) {
      console.error(err);
      onAlert('Enregistrement impossible.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (r: UnitMediaSubscription) => {
    if (!canEdit || !r.id) return;
    const uid = auth.currentUser?.uid || userUid;
    try {
      await updateDoc(doc(db, 'unit_media_subscriptions', r.id), {
        active: false,
        updatedAt: new Date().toISOString(),
        lastModifiedByUid: uid,
        lastModifiedByName: actorLabel(userProfile),
      });
      onAlert('Abonnement retiré de la liste.', 'success');
    } catch (err) {
      console.error(err);
      onAlert('Suppression impossible.', 'error');
    }
  };

  const renewTarget = editingId ? rows.find((r) => r.id === editingId) : null;

  return (
    <div className="rounded-xl border border-indigo-200 bg-white overflow-hidden">
      <div className="px-3 sm:px-4 py-3 bg-indigo-50 border-b border-indigo-100 flex flex-wrap items-center gap-2">
        <Tv size={16} className="text-indigo-700 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-black uppercase tracking-widest text-indigo-900">
            Abonnements TV (Canal+ · IPTV)
          </p>
          <p className="text-[10px] text-indigo-700/80">
            Alerte : Canal+ {MEDIA_WARN_DAYS_BEFORE.CANAL_PLUS} j · IPTV {MEDIA_WARN_DAYS_BEFORE.IPTV} j
            {alertCount > 0 ? ` · ${alertCount} à surveiller` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 w-full sm:w-auto">
          {(['ALL', 'CANAL_PLUS', 'IPTV'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilterKind(k)}
              className={`px-3 py-2 rounded-lg text-[9px] font-black uppercase touch-manipulation ${
                filterKind === k ? 'bg-indigo-700 text-white' : 'bg-white text-indigo-700 border border-indigo-200'
              }`}
            >
              {k === 'ALL' ? 'Tous' : KIND_LABEL[k]}
            </button>
          ))}
        {canEdit && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-indigo-700 text-white text-[9px] font-black uppercase touch-manipulation"
          >
            <Plus size={12} />
            Ajouter
          </button>
        )}
        </div>
      </div>

      <div className="max-h-[min(50vh,22rem)] md:max-h-[28vh] overflow-y-auto divide-y divide-stone-100">
        {loading ? (
          <div className="p-6 flex justify-center">
            <Loader2 className="animate-spin text-indigo-600" size={20} />
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-xs text-stone-500 text-center">
            Aucun abonnement. Utilisez « Importer Yaoundé » ou Ajouter.
          </p>
        ) : (
          filtered.map((r) => {
            const urg = expiryUrgency(r.expiresOn, r.kind);
            return (
              <div
                key={r.id}
                className={`px-3 sm:px-4 py-3 flex flex-col md:flex-row md:flex-wrap md:items-start gap-3 ${
                  urg === 'expired'
                    ? 'bg-red-50/80'
                    : urg === 'soon'
                      ? 'bg-amber-50/80'
                      : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-1.5 mb-0.5">
                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800">
                      {KIND_LABEL[r.kind]}
                    </span>
                    {urg && (
                      <span
                        className={`inline-flex items-center gap-0.5 text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                          urg === 'expired' ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'
                        }`}
                      >
                        <AlertTriangle size={10} />
                        {urg === 'expired' ? 'Expiré' : 'Expire bientôt'}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-bold text-stone-900">{r.apartmentName}</p>
                  <p className="text-[11px] text-stone-600 mt-0.5">
                    {r.expiresOn ? `Expire le ${r.expiresOn}` : 'Date d’expiration manquante'}
                    {r.bouquet ? ` · ${r.bouquet}` : ''}
                  </p>
                  {r.boxNumber && (
                    <p className="text-[10px] font-mono text-stone-500 mt-0.5">Boîtier {r.boxNumber}</p>
                  )}
                  {(r.lastModifiedByName || r.updatedAt) && (
                    <p className="text-[10px] text-stone-400 mt-1">
                      Dernière modif
                      {r.lastModifiedByName ? ` : ${r.lastModifiedByName}` : ''}
                      {r.updatedAt ? ` · ${formatModifStamp(r.updatedAt)}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex flex-col md:flex-row flex-wrap gap-2 shrink-0 w-full md:w-auto">
                  <button
                    type="button"
                    onClick={() => openRenew(r)}
                    className="inline-flex items-center justify-center gap-1.5 w-full md:w-auto px-3 py-3 md:py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-black uppercase tracking-wide touch-manipulation"
                  >
                    <RefreshCw size={14} />
                    Renouveler
                  </button>
                  {canEdit && (
                    <div className="grid grid-cols-2 md:flex gap-2 w-full md:w-auto">
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        className="inline-flex items-center justify-center gap-1 px-2.5 py-2.5 md:py-2 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 text-[10px] font-black uppercase touch-manipulation"
                        title="Modifier tous les champs"
                      >
                        <Pencil size={12} />
                        Modifier
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeactivate(r)}
                        className="inline-flex items-center justify-center gap-1 px-2.5 py-2.5 md:py-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-[10px] font-black uppercase touch-manipulation"
                        title="Retirer"
                      >
                        <Trash2 size={12} />
                        Retirer
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleSave}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3"
          >
            <h3 className="text-sm font-black uppercase tracking-widest">
              {formMode === 'renew'
                ? 'Renouveler l’abonnement'
                : formMode === 'edit'
                  ? 'Modifier l’abonnement'
                  : 'Nouvel abonnement TV'}
            </h3>

            {formMode === 'renew' && renewTarget && (
              <p className="text-xs text-stone-600 leading-relaxed">
                <span className="font-bold text-stone-900">{KIND_LABEL[renewTarget.kind]}</span>
                {' · '}
                {renewTarget.apartmentName}
                {renewTarget.expiresOn ? (
                  <>
                    <br />
                    Expiration actuelle : <span className="font-mono">{renewTarget.expiresOn}</span>
                  </>
                ) : null}
              </p>
            )}

            {formMode !== 'renew' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] font-black uppercase text-stone-400">Type</label>
                    <select
                      value={form.kind}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, kind: e.target.value as MediaSubscriptionKind }))
                      }
                      className="w-full text-xs rounded-lg border border-stone-200 px-2 py-2"
                    >
                      <option value="CANAL_PLUS">Canal+</option>
                      <option value="IPTV">IPTV</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] font-black uppercase text-stone-400">Logement</label>
                    <select
                      value={form.unitSlug}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, unitSlug: e.target.value as YaoundeUnitSlug }))
                      }
                      className="w-full text-xs rounded-lg border border-stone-200 px-2 py-2"
                    >
                      {(Object.keys(YAOUNDE_UNIT_LABELS) as YaoundeUnitSlug[]).map((slug) => (
                        <option key={slug} value={slug}>
                          {YAOUNDE_UNIT_LABELS[slug]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase text-stone-400">
                    Bouquet / pack
                  </label>
                  <input
                    value={form.bouquet}
                    onChange={(e) => setForm((f) => ({ ...f, bouquet: e.target.value }))}
                    placeholder="Ex. Access, Évasion…"
                    className="w-full text-xs rounded-lg border border-stone-200 px-2 py-2"
                  />
                </div>
                {form.kind === 'CANAL_PLUS' && (
                  <div>
                    <label className="text-[9px] font-black uppercase text-stone-400">
                      N° boîtier Canal+
                    </label>
                    <input
                      value={form.boxNumber}
                      onChange={(e) => setForm((f) => ({ ...f, boxNumber: e.target.value }))}
                      className="w-full text-xs rounded-lg border border-stone-200 px-2 py-2 font-mono"
                    />
                  </div>
                )}
                <div>
                  <label className="text-[9px] font-black uppercase text-stone-400">Notes</label>
                  <input
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    className="w-full text-xs rounded-lg border border-stone-200 px-2 py-2"
                  />
                </div>
              </>
            )}

            <div>
              <label className="text-[9px] font-black uppercase text-stone-400">
                {formMode === 'renew' ? 'Nouvelle date d’expiration' : 'Expire le'}
              </label>
              <input
                type="date"
                required
                value={form.expiresOn}
                onChange={(e) => setForm((f) => ({ ...f, expiresOn: e.target.value }))}
                className="w-full text-xs rounded-lg border border-stone-200 px-2 py-2"
              />
            </div>

            <p className="text-[10px] text-stone-400">
              Opération enregistrée sous : <span className="font-semibold text-stone-600">{actorLabel(userProfile)}</span>
            </p>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="px-3 py-2 rounded-lg text-[10px] font-black uppercase border border-stone-200 text-stone-600"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-700 text-white text-[10px] font-black uppercase disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                {formMode === 'renew' ? 'Confirmer le renouvellement' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
