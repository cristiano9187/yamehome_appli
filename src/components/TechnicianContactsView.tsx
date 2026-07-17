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
import {
  TECHNICIAN_DOMAINS,
  TECHNICIAN_CITIES,
  digitsOnlyPhone,
} from '../constants';
import {
  TechnicianContact,
  TechnicianDomain,
  TechnicianCity,
  UserProfile,
} from '../types';
import {
  Menu,
  Loader2,
  Wrench,
  Phone,
  MessageCircle,
  Plus,
  Pencil,
  Trash2,
  Search,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface TechnicianContactsViewProps {
  userProfile: UserProfile | null;
  onMenuClick?: () => void;
  onAlert: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const emptyForm = {
  name: '',
  domain: 'PLOMBERIE' as TechnicianDomain,
  city: 'YAOUNDE' as TechnicianCity,
  phone: '',
  availability: '',
  notes: '',
};

function domainLabel(id: TechnicianDomain): string {
  return TECHNICIAN_DOMAINS.find((d) => d.id === id)?.label || id;
}

function cityLabel(id: TechnicianCity): string {
  return TECHNICIAN_CITIES.find((c) => c.id === id)?.label || id;
}

function whatsappUrl(phone: string): string | null {
  let digits = digitsOnlyPhone(phone);
  if (!digits) return null;
  if (digits.length === 9 && digits.startsWith('6')) digits = `237${digits}`;
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}`;
}

export default function TechnicianContactsView({
  userProfile,
  onMenuClick,
  onAlert,
}: TechnicianContactsViewProps) {
  const isMainAdmin =
    userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' ||
    userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
  const isAdmin = userProfile?.role === 'admin' || isMainAdmin;

  const [contacts, setContacts] = useState<TechnicianContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [cityFilter, setCityFilter] = useState<'ALL' | TechnicianCity>('ALL');
  const [domainFilter, setDomainFilter] = useState<'ALL' | TechnicianDomain>('ALL');
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
      collection(db, 'technician_contacts'),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as TechnicianContact))
          .sort((a, b) => {
            if (a.city !== b.city) return a.city.localeCompare(b.city);
            if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
            return a.name.localeCompare(b.name, 'fr');
          });
        setContacts(list);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
        onAlert('Impossible de charger les techniciens.', 'error');
      }
    );
    return () => unsub();
  }, [onAlert]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (!showInactive && !c.active) return false;
      if (cityFilter !== 'ALL' && c.city !== cityFilter) return false;
      if (domainFilter !== 'ALL' && c.domain !== domainFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.notes || '').toLowerCase().includes(q) ||
        domainLabel(c.domain).toLowerCase().includes(q)
      );
    });
  }, [contacts, cityFilter, domainFilter, search, showInactive]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (c: TechnicianContact) => {
    setEditingId(c.id || null);
    setForm({
      name: c.name,
      domain: c.domain,
      city: c.city,
      phone: c.phone,
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
    try {
      if (editingId) {
        const prev = contacts.find((c) => c.id === editingId);
        await updateDoc(doc(db, 'technician_contacts', editingId), {
          name,
          domain: form.domain,
          city: form.city,
          phone,
          availability: form.availability.trim() || null,
          notes: form.notes.trim() || null,
          active: prev?.active ?? true,
          updatedAt: now,
          authorUid: prev?.authorUid || uid,
          createdAt: prev?.createdAt || now,
        });
        onAlert('Contact mis à jour.', 'success');
      } else {
        await addDoc(collection(db, 'technician_contacts'), {
          name,
          domain: form.domain,
          city: form.city,
          phone,
          availability: form.availability.trim() || null,
          notes: form.notes.trim() || null,
          active: true,
          createdAt: now,
          updatedAt: now,
          authorUid: uid,
        });
        onAlert('Technicien ajouté.', 'success');
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

  const handleToggleActive = async (c: TechnicianContact) => {
    if (!isAdmin || !c.id) return;
    try {
      await updateDoc(doc(db, 'technician_contacts', c.id), {
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
      await deleteDoc(doc(db, 'technician_contacts', deleteId));
      onAlert('Contact supprimé.', 'success');
      setDeleteId(null);
    } catch (err) {
      console.error(err);
      onAlert('Erreur lors de la suppression.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 pb-24">
      <div className="mb-6 flex items-center gap-3">
        {onMenuClick && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMenuClick();
            }}
            className="md:hidden p-2 hover:bg-gray-100 rounded-xl transition-all"
          >
            <Menu size={20} />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-slate-800">
            <Wrench size={20} className="text-orange-600 shrink-0" />
            <h1 className="text-lg font-black uppercase tracking-tight truncate">Techniciens</h1>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Annuaire urgences — Yaoundé & Bangangté
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

      <div className="space-y-3 mb-6">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCityFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
              cityFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            Toutes villes
          </button>
          {TECHNICIAN_CITIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCityFilter(c.id)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                cityFilter === c.id ? 'bg-orange-600 text-white' : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDomainFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
              domainFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            Tous métiers
          </button>
          {TECHNICIAN_DOMAINS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDomainFilter(d.id)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                domainFilter === d.id ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
              }`}
            >
              {d.label}
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
            className="w-full pl-9 pr-3 py-3 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:border-orange-500 transition-all"
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
          <Loader2 className="animate-spin text-orange-600" size={28} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <Wrench size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">
            {contacts.length === 0
              ? isAdmin
                ? 'Aucun technicien pour le moment. Ajoutez le premier contact.'
                : 'Aucun technicien enregistré pour le moment.'
              : 'Aucun résultat pour ces filtres.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {filtered.map((c) => {
              const wa = whatsappUrl(c.phone);
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
                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-blue-50 text-blue-700">
                          {domainLabel(c.domain)}
                        </span>
                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-orange-50 text-orange-700">
                          {cityLabel(c.city)}
                        </span>
                        {!c.active && (
                          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-gray-100 text-gray-500">
                            Inactif
                          </span>
                        )}
                      </div>
                      <h2 className="text-sm font-black text-slate-900 truncate">{c.name}</h2>
                      <p className="text-sm text-slate-700 font-medium mt-0.5">{c.phone}</p>
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
                  {editingId ? 'Modifier le contact' : 'Nouveau technicien'}
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
                    className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Nom ou entreprise"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">
                      Métier
                    </label>
                    <select
                      value={form.domain}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, domain: e.target.value as TechnicianDomain }))
                      }
                      className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      {TECHNICIAN_DOMAINS.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">
                      Ville
                    </label>
                    <select
                      value={form.city}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, city: e.target.value as TechnicianCity }))
                      }
                      className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      {TECHNICIAN_CITIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">
                    Téléphone
                  </label>
                  <input
                    required
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="+237 6XX XXX XXX"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">
                    Disponibilité
                  </label>
                  <input
                    value={form.availability}
                    onChange={(e) => setForm((f) => ({ ...f, availability: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Ex. 7j/7 · jour uniquement"
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
                    className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                    placeholder="Préfère WhatsApp, tarifs…"
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-3.5 bg-orange-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-orange-700 disabled:opacity-50 flex items-center justify-center gap-2"
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
