import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { SITES, SITE_CONTACT_ROLES, digitsOnlyPhone } from '../constants';
import {
  SiteContact,
  SiteContactRole,
  SiteName,
  UserProfile,
} from '../types';
import {
  Loader2,
  Shield,
  Phone,
  MessageCircle,
  Plus,
  Pencil,
  Trash2,
  Search,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface SiteContactsViewProps {
  userProfile: UserProfile | null;
  onAlert: (message: string, type?: 'success' | 'error' | 'info') => void;
  embedded?: boolean;
}

const emptyForm = {
  name: '',
  role: 'GUARD' as SiteContactRole,
  site: SITES[0] as SiteName,
  phone: '',
  phoneSecondary: '',
  availability: '',
  notes: '',
};

function roleLabel(id: SiteContactRole): string {
  return SITE_CONTACT_ROLES.find((r) => r.id === id)?.label || id;
}

function siteShortLabel(site: SiteName): string {
  if (site === 'GALLAGHERS CITY') return 'Gallaghers';
  return site.replace(' YAMEHOME', '');
}

function whatsappUrl(phone: string): string | null {
  let digits = digitsOnlyPhone(phone);
  if (!digits) return null;
  if (digits.length === 9 && digits.startsWith('6')) digits = `237${digits}`;
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}`;
}

export default function SiteContactsView({
  userProfile,
  onAlert,
  embedded = false,
}: SiteContactsViewProps) {
  const isMainAdmin =
    userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' ||
    userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
  const isAdmin = userProfile?.role === 'admin' || isMainAdmin;

  const [contacts, setContacts] = useState<SiteContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [siteFilter, setSiteFilter] = useState<'ALL' | SiteName>('ALL');
  const [roleFilter, setRoleFilter] = useState<'ALL' | SiteContactRole>('ALL');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'site_contacts'),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as SiteContact))
          .sort((a, b) => {
            if (a.site !== b.site) return a.site.localeCompare(b.site);
            if (a.role !== b.role) return a.role.localeCompare(b.role);
            return a.name.localeCompare(b.name, 'fr');
          });
        setContacts(list);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
        onAlert('Impossible de charger les contacts sur site.', 'error');
      }
    );
    return () => unsub();
  }, [onAlert]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (!showInactive && !c.active) return false;
      if (siteFilter !== 'ALL' && c.site !== siteFilter) return false;
      if (roleFilter !== 'ALL' && c.role !== roleFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.phoneSecondary || '').toLowerCase().includes(q) ||
        (c.notes || '').toLowerCase().includes(q) ||
        roleLabel(c.role).toLowerCase().includes(q) ||
        siteShortLabel(c.site).toLowerCase().includes(q)
      );
    });
  }, [contacts, siteFilter, roleFilter, search, showInactive]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (c: SiteContact) => {
    setEditingId(c.id || null);
    setForm({
      name: c.name,
      role: c.role,
      site: c.site,
      phone: c.phone,
      phoneSecondary: c.phoneSecondary || '',
      availability: c.availability || '',
      notes: c.notes || '',
    });
    setFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    const name = form.name.trim();
    const phone = form.phone.trim();
    if (!name || !phone) {
      onAlert('Nom et téléphone sont obligatoires.', 'error');
      return;
    }
    setSaving(true);
    const now = new Date().toISOString();
    const uid = auth.currentUser?.uid || userProfile?.uid || '';
    const phoneSecondary = form.phoneSecondary.trim() || null;
    try {
      if (editingId) {
        const prev = contacts.find((c) => c.id === editingId);
        await updateDoc(doc(db, 'site_contacts', editingId), {
          name,
          role: form.role,
          site: form.site,
          phone,
          phoneSecondary,
          availability: form.availability.trim() || null,
          notes: form.notes.trim() || null,
          active: prev?.active ?? true,
          updatedAt: now,
          authorUid: prev?.authorUid || uid,
          createdAt: prev?.createdAt || now,
        });
        onAlert('Contact mis à jour.', 'success');
      } else {
        await addDoc(collection(db, 'site_contacts'), {
          name,
          role: form.role,
          site: form.site,
          phone,
          phoneSecondary,
          availability: form.availability.trim() || null,
          notes: form.notes.trim() || null,
          active: true,
          createdAt: now,
          updatedAt: now,
          authorUid: uid,
        });
        onAlert('Contact ajouté.', 'success');
      }
      setFormOpen(false);
      setEditingId(null);
      setForm(emptyForm);
    } catch (err) {
      console.error(err);
      onAlert('Erreur lors de l’enregistrement.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (c: SiteContact) => {
    if (!isAdmin || !c.id) return;
    try {
      await updateDoc(doc(db, 'site_contacts', c.id), {
        active: !c.active,
        updatedAt: new Date().toISOString(),
      });
      onAlert(c.active ? 'Contact désactivé.' : 'Contact réactivé.', 'success');
    } catch (err) {
      console.error(err);
      onAlert('Erreur lors de la mise à jour.', 'error');
    }
  };

  const handleDelete = async () => {
    if (!isAdmin || !deleteId) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'site_contacts', deleteId));
      onAlert('Contact supprimé.', 'success');
      setDeleteId(null);
    } catch (err) {
      console.error(err);
      onAlert('Erreur lors de la suppression.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const wrapperClass = embedded ? '' : 'max-w-4xl mx-auto p-4 md:p-6 pb-24';

  return (
    <div className={wrapperClass}>
      {!embedded && (
        <div className="mb-6 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-slate-800">
              <Shield size={20} className="text-emerald-600 shrink-0" />
              <h1 className="text-lg font-black uppercase tracking-tight truncate">Sur site</h1>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Gardiens et réception par résidence
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={openCreate}
              className="shrink-0 flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all"
            >
              <Plus size={14} />
              Ajouter
            </button>
          )}
        </div>
      )}

      <div className="space-y-3 mb-6">
        {embedded && isAdmin && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={openCreate}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all"
            >
              <Plus size={14} />
              Ajouter
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSiteFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
              siteFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            Tous sites
          </button>
          {SITES.map((site) => (
            <button
              key={site}
              type="button"
              onClick={() => setSiteFilter(site as SiteName)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                siteFilter === site ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              {siteShortLabel(site as SiteName)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setRoleFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
              roleFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            Tous rôles
          </button>
          {SITE_CONTACT_ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRoleFilter(r.id)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                roleFilter === r.id ? 'bg-teal-600 text-white' : 'bg-teal-50 text-teal-700 hover:bg-teal-100'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher nom, téléphone…"
            className="w-full pl-9 pr-3 py-3 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:border-emerald-500 transition-all"
          />
        </div>

        {isAdmin && (
          <label className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-gray-300"
            />
            Afficher les contacts désactivés
          </label>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-emerald-600" size={28} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <Shield size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">
            {contacts.length === 0
              ? isAdmin
                ? 'Aucun contact sur site. Ajoutez le premier gardien ou réception.'
                : 'Aucun contact sur site enregistré pour le moment.'
              : 'Aucun résultat pour ces filtres.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {filtered.map((c) => {
              const wa = whatsappUrl(c.phone);
              const waSecondary = c.phoneSecondary ? whatsappUrl(c.phoneSecondary) : null;
              return (
                <motion.div
                  key={c.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={`bg-white rounded-2xl border shadow-sm p-4 ${
                    c.active ? 'border-gray-100' : 'border-dashed border-gray-300 opacity-70'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-teal-50 text-teal-700">
                          {roleLabel(c.role)}
                        </span>
                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700">
                          {siteShortLabel(c.site)}
                        </span>
                        {!c.active && (
                          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-gray-100 text-gray-500">
                            Inactif
                          </span>
                        )}
                      </div>
                      <h2 className="text-sm font-black text-slate-900 truncate">{c.name}</h2>
                      <p className="text-sm text-slate-700 font-medium mt-0.5">{c.phone}</p>
                      {c.phoneSecondary && (
                        <p className="text-sm text-slate-600 mt-0.5">Sec. {c.phoneSecondary}</p>
                      )}
                      {c.availability && (
                        <p className="text-[11px] text-gray-500 mt-1">{c.availability}</p>
                      )}
                      {c.notes && (
                        <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{c.notes}</p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 shrink-0">
                      <a
                        href={`tel:${digitsOnlyPhone(c.phone)}`}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all"
                      >
                        <Phone size={13} />
                        Appeler
                      </a>
                      {wa && (
                        <a
                          href={wa}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all"
                        >
                          <MessageCircle size={13} />
                          WhatsApp
                        </a>
                      )}
                      {c.phoneSecondary && (
                        <a
                          href={`tel:${digitsOnlyPhone(c.phoneSecondary)}`}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-[10px] font-black uppercase tracking-widest hover:bg-gray-200 transition-all"
                        >
                          <Phone size={13} />
                          Sec.
                        </a>
                      )}
                      {waSecondary && (
                        <a
                          href={waSecondary}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase tracking-widest hover:bg-emerald-100 transition-all"
                        >
                          <MessageCircle size={13} />
                          WA sec.
                        </a>
                      )}
                      {isAdmin && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEdit(c)}
                            className="p-2 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all"
                            title="Modifier"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(c)}
                            className="px-2.5 py-2 rounded-xl bg-gray-100 text-[9px] font-black uppercase text-gray-600 hover:bg-gray-200 transition-all"
                          >
                            {c.active ? 'Désactiver' : 'Réactiver'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteId(c.id || null)}
                            className="p-2 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 transition-all"
                            title="Supprimer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {formOpen && isAdmin && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="text-sm font-black uppercase tracking-widest">
                  {editingId ? 'Modifier le contact' : 'Nouveau contact sur site'}
                </h3>
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-full"
                >
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleSave} className="p-5 space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">
                    Nom
                  </label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="Nom du gardien ou poste"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">
                      Rôle
                    </label>
                    <select
                      value={form.role}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, role: e.target.value as SiteContactRole }))
                      }
                      className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      {SITE_CONTACT_ROLES.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">
                      Site
                    </label>
                    <select
                      value={form.site}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, site: e.target.value as SiteName }))
                      }
                      className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      {SITES.map((site) => (
                        <option key={site} value={site}>
                          {siteShortLabel(site as SiteName)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">
                    Téléphone principal
                  </label>
                  <input
                    required
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="+237 6XX XXX XXX"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">
                    Téléphone secondaire
                  </label>
                  <input
                    value={form.phoneSecondary}
                    onChange={(e) => setForm((f) => ({ ...f, phoneSecondary: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="Optionnel"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">
                    Disponibilité
                  </label>
                  <input
                    value={form.availability}
                    onChange={(e) => setForm((f) => ({ ...f, availability: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="Ex. 19h–7h · remplaçant week-end"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">
                    Note
                  </label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                    placeholder="Consignes, langue parlée…"
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-3.5 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 className="animate-spin" size={16} /> : null}
                  {editingId ? 'Enregistrer' : 'Ajouter'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteId && isAdmin && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl"
            >
              <div className="w-14 h-14 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 size={24} />
              </div>
              <h3 className="text-lg font-black uppercase tracking-tight mb-2">Supprimer ?</h3>
              <p className="text-sm text-gray-500 mb-6">
                Cette action est définitive. Préférez « Désactiver » si le contact peut servir plus tard.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setDeleteId(null)}
                  className="flex-1 py-3 rounded-xl bg-gray-100 text-xs font-black uppercase"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleDelete}
                  className="flex-1 py-3 rounded-xl bg-red-600 text-white text-xs font-black uppercase disabled:opacity-50"
                >
                  {deleting ? '…' : 'Supprimer'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
