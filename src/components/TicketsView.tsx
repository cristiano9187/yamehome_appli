import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { AuthorizedEmail, Ticket, TicketStatus, UserProfile } from '../types';
import { SITES, canCreateTickets, isMainAdminEmail } from '../constants';
import {
  CheckCircle2,
  Circle,
  ClipboardList,
  Loader2,
  Menu,
  Play,
  Pencil,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type FilterTab = 'mine_open' | 'mine_done' | 'created' | 'all';

interface TicketsViewProps {
  userProfile: UserProfile | null;
  userUid: string;
  onMenuClick?: () => void;
  onAlert: (message: string, type?: 'success' | 'error' | 'info') => void;
}

function statusLabel(s: TicketStatus): string {
  if (s === 'open') return 'Ouvert';
  if (s === 'doing') return 'En cours';
  return 'Clos';
}

function statusClass(s: TicketStatus): string {
  if (s === 'open') return 'bg-amber-100 text-amber-900 border-amber-200';
  if (s === 'doing') return 'bg-blue-100 text-blue-900 border-blue-200';
  return 'bg-emerald-100 text-emerald-900 border-emerald-200';
}

export default function TicketsView({
  userProfile,
  userUid,
  onMenuClick,
  onAlert,
}: TicketsViewProps) {
  const email = (userProfile?.email || '').toLowerCase().trim();
  const canCreate = canCreateTickets(userProfile, isMainAdminEmail);
  const isAdmin =
    userProfile?.role === 'admin' || isMainAdminEmail(userProfile?.email);

  // Créateurs / admins : par défaut « Créés par moi » (leurs tickets sont souvent assignés à d’autres)
  const [tab, setTab] = useState<FilterTab>(() =>
    canCreateTickets(userProfile, isMainAdminEmail) ||
    userProfile?.role === 'admin' ||
    isMainAdminEmail(userProfile?.email)
      ? 'created'
      : 'mine_open'
  );
  const [mine, setMine] = useState<Ticket[]>([]);
  const [created, setCreated] = useState<Ticket[]>([]);
  const [allTickets, setAllTickets] = useState<Ticket[]>([]);
  const [assignees, setAssignees] = useState<AuthorizedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);
  const [proofDraft, setProofDraft] = useState<Record<string, string>>({});

  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formAcceptance, setFormAcceptance] = useState('');
  const [formAssignee, setFormAssignee] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formSite, setFormSite] = useState('');

  const formOpen = showCreate || !!editingTicket;

  useEffect(() => {
    if (!email) return;
    const qMine = query(
      collection(db, 'tickets'),
      where('assigneeEmail', '==', email)
    );
    const unsub = onSnapshot(
      qMine,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Ticket));
        rows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        setMine(rows);
        setLoading(false);
      },
      (err) => {
        console.error('tickets mine listen:', err);
        onAlert('Impossible de charger vos tickets', 'error');
        setLoading(false);
      }
    );
    return () => unsub();
  }, [email, onAlert]);

  useEffect(() => {
    if (!canCreate || !userUid) return;
    const qCreated = query(
      collection(db, 'tickets'),
      where('createdByUid', '==', userUid)
    );
    const unsub = onSnapshot(
      qCreated,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Ticket));
        rows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        setCreated(rows);
      },
      (err) => console.error('tickets created listen:', err)
    );
    return () => unsub();
  }, [canCreate, userUid]);

  useEffect(() => {
    if (!isAdmin) return;
    const unsub = onSnapshot(
      collection(db, 'tickets'),
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Ticket));
        rows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        setAllTickets(rows);
      },
      (err) => console.error('tickets all listen:', err)
    );
    return () => unsub();
  }, [isAdmin]);

  useEffect(() => {
    if (!canCreate && !isAdmin) return;
    const unsub = onSnapshot(collection(db, 'authorized_emails'), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuthorizedEmail));
      rows.sort((a, b) => a.email.localeCompare(b.email));
      setAssignees(rows);
    });
    return () => unsub();
  }, [canCreate, isAdmin]);

  useEffect(() => {
    if (!formAssignee && assignees.length) {
      setFormAssignee(assignees[0].email);
    }
  }, [assignees, formAssignee]);

  const list = useMemo(() => {
    if (tab === 'mine_open') {
      return mine.filter((t) => t.status === 'open' || t.status === 'doing');
    }
    if (tab === 'mine_done') return mine.filter((t) => t.status === 'done');
    if (tab === 'created') return created;
    return allTickets;
  }, [tab, mine, created, allTickets]);

  const openCount = mine.filter((t) => t.status === 'open' || t.status === 'doing').length;

  const resetForm = () => {
    setFormTitle('');
    setFormDescription('');
    setFormAcceptance('');
    setFormDueDate('');
    setFormSite('');
  };

  const closeForm = () => {
    setShowCreate(false);
    setEditingTicket(null);
    resetForm();
  };

  const openCreate = () => {
    resetForm();
    setEditingTicket(null);
    if (assignees.length) setFormAssignee(assignees[0].email);
    setShowCreate(true);
  };

  const openEdit = (t: Ticket) => {
    setShowCreate(false);
    setEditingTicket(t);
    setFormTitle(t.title || '');
    setFormDescription(t.description || '');
    setFormAcceptance(t.acceptance || '');
    setFormAssignee(t.assigneeEmail || '');
    setFormDueDate(t.dueDate || '');
    setFormSite(t.site || '');
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formAssignee.trim()) return;
    const assigneeEmail = formAssignee.toLowerCase().trim();
    const now = new Date().toISOString();

    if (editingTicket?.id) {
      if (!(editingTicket.createdByUid === userUid || isAdmin)) return;
      setSaving(true);
      try {
        await updateDoc(doc(db, 'tickets', editingTicket.id), {
          title: formTitle.trim(),
          description: formDescription.trim() || '',
          acceptance: formAcceptance.trim() || '',
          assigneeEmail,
          assigneeDisplayName: assigneeEmail.split('@')[0],
          dueDate: formDueDate || null,
          site: formSite || null,
          updatedAt: now,
        });
        onAlert('Ticket mis à jour', 'success');
        closeForm();
      } catch (err) {
        console.error(err);
        onAlert('Erreur lors de la modification', 'error');
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!canCreate) return;
    setSaving(true);
    try {
      const payload: Omit<Ticket, 'id'> = {
        title: formTitle.trim(),
        description: formDescription.trim() || '',
        acceptance: formAcceptance.trim() || '',
        status: 'open',
        assigneeEmail,
        assigneeDisplayName: assigneeEmail.split('@')[0],
        createdByUid: userUid,
        createdByEmail: email,
        createdByName: userProfile?.displayName || email,
        dueDate: formDueDate || null,
        site: formSite || null,
        proofUrl: null,
        createdAt: now,
        updatedAt: now,
        doneAt: null,
      };
      await addDoc(collection(db, 'tickets'), payload);
      onAlert('Ticket créé', 'success');
      closeForm();
      setTab('created');
    } catch (err) {
      console.error(err);
      onAlert('Erreur lors de la création du ticket', 'error');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (ticket: Ticket, status: TicketStatus, proofUrl?: string | null) => {
    if (!ticket.id) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const patch: Partial<Ticket> = {
        status,
        updatedAt: now,
        ...(status === 'done'
          ? { doneAt: now, proofUrl: proofUrl ?? ticket.proofUrl ?? null }
          : { doneAt: null }),
      };
      await updateDoc(doc(db, 'tickets', ticket.id), patch);
      onAlert(
        status === 'done' ? 'Ticket clos' : status === 'doing' ? 'Ticket en cours' : 'Ticket rouvert',
        'success'
      );
    } catch (err) {
      console.error(err);
      onAlert('Mise à jour refusée (droits ou connexion)', 'error');
    } finally {
      setSaving(false);
    }
  };

  const isMine = (t: Ticket) => t.assigneeEmail === email;
  const canEditContent = (t: Ticket) => t.createdByUid === userUid || isAdmin;
  const canManage = (t: Ticket) =>
    isMine(t) || t.createdByUid === userUid || isAdmin;

  return (
    <div className="flex-1 flex flex-col min-h-0 md:h-full bg-[#F5F5F4] md:overflow-hidden">
      <div className="shrink-0 bg-white border-b border-gray-200 px-4 md:px-8 py-4 flex items-center gap-3 sticky top-0 z-40">
        {onMenuClick && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMenuClick();
            }}
            className="md:hidden p-2 hover:bg-gray-100 rounded-xl transition-all touch-manipulation"
            aria-label="Ouvrir le menu"
          >
            <Menu size={20} />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-900 flex items-center gap-2">
            <ClipboardList className="text-indigo-600 shrink-0" size={18} />
            Tickets
            {openCount > 0 && (
              <span className="ml-1 px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-black">
                {openCount}
              </span>
            )}
          </h2>
          <p className="text-[10px] font-mono text-gray-400 font-bold mt-0.5">
            Suivi des tâches assignées
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={openCreate}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 touch-manipulation"
          >
            <Plus size={14} />
            Nouveau
          </button>
        )}
      </div>

      <div className="shrink-0 px-4 md:px-8 pt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab('mine_open')}
          className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
            tab === 'mine_open'
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white text-gray-500 border-gray-200'
          }`}
        >
          À faire ({openCount})
        </button>
        <button
          type="button"
          onClick={() => setTab('mine_done')}
          className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
            tab === 'mine_done'
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white text-gray-500 border-gray-200'
          }`}
        >
          Clos
        </button>
        {canCreate && (
          <button
            type="button"
            onClick={() => setTab('created')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
              tab === 'created'
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-500 border-gray-200'
            }`}
          >
            Créés par moi
          </button>
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setTab('all')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
              tab === 'all'
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-500 border-gray-200'
            }`}
          >
            Tous
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 md:p-6 pb-24">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-indigo-600" size={28} />
          </div>
        ) : list.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-12 text-center">
            <p className="text-gray-400 text-sm">Aucun ticket dans cet onglet.</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-3">
            {list.map((t) => (
              <article
                key={t.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 md:p-5 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-gray-900 leading-snug">{t.title}</h3>
                    <p className="text-[10px] text-gray-400 font-mono mt-1">
                      → {t.assigneeEmail}
                      {t.dueDate ? ` · échéance ${t.dueDate}` : ''}
                      {t.site ? ` · ${t.site}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canEditContent(t) && (
                      <button
                        type="button"
                        title="Modifier"
                        onClick={() => openEdit(t)}
                        className="p-2 rounded-xl bg-gray-50 text-gray-600 hover:bg-indigo-50 hover:text-indigo-700 border border-gray-100 touch-manipulation"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    <span
                      className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${statusClass(
                        t.status
                      )}`}
                    >
                      {statusLabel(t.status)}
                    </span>
                  </div>
                </div>

                {t.description ? (
                  <p className="text-xs text-gray-600 whitespace-pre-wrap">{t.description}</p>
                ) : null}

                {t.acceptance ? (
                  <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">
                      Acceptance
                    </p>
                    <p className="text-xs text-gray-700 whitespace-pre-wrap">{t.acceptance}</p>
                  </div>
                ) : null}

                {t.proofUrl ? (
                  <p className="text-[11px] text-emerald-700 break-all">
                    Preuve : {t.proofUrl}
                  </p>
                ) : null}

                {canManage(t) && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {t.status === 'open' && isMine(t) && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => setStatus(t, 'doing')}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest touch-manipulation disabled:opacity-50"
                      >
                        <Play size={12} /> En cours
                      </button>
                    )}
                    {(t.status === 'open' || t.status === 'doing') && isMine(t) && (
                      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                        <input
                          type="text"
                          placeholder="Preuve (lien WhatsApp…)"
                          value={proofDraft[t.id!] || ''}
                          onChange={(e) =>
                            setProofDraft((prev) => ({ ...prev, [t.id!]: e.target.value }))
                          }
                          className="flex-1 min-w-[160px] text-xs border border-gray-200 rounded-xl px-3 py-2 bg-gray-50"
                        />
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => setStatus(t, 'done', proofDraft[t.id!] || null)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest touch-manipulation disabled:opacity-50"
                        >
                          <CheckCircle2 size={12} /> Clôturer
                        </button>
                      </div>
                    )}
                    {t.status === 'done' && (isMine(t) || isAdmin || t.createdByUid === userUid) && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => setStatus(t, 'open')}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-[10px] font-black uppercase tracking-widest touch-manipulation disabled:opacity-50"
                      >
                        <RotateCcw size={12} /> Rouvrir
                      </button>
                    )}
                    {!isMine(t) && t.status !== 'done' && (
                      <span className="text-[10px] text-gray-400 flex items-center gap-1">
                        <Circle size={10} /> En attente de l’assigné
                      </span>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {formOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl"
            >
              <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
                <h3 className="text-sm font-black uppercase tracking-widest">
                  {editingTicket ? 'Modifier le ticket' : 'Nouveau ticket'}
                </h3>
                <button
                  type="button"
                  onClick={closeForm}
                  className="p-2 hover:bg-gray-100 rounded-xl"
                >
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleSaveForm} className="p-5 space-y-4">
                <div>
                  <label className="block text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">
                    Titre *
                  </label>
                  <input
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-gray-50"
                    placeholder="Ex. Vidéo parcours Axe → Rieti"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">
                    Description
                  </label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    rows={3}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-gray-50"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">
                    Acceptance
                  </label>
                  <textarea
                    value={formAcceptance}
                    onChange={(e) => setFormAcceptance(e.target.value)}
                    rows={3}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-gray-50"
                    placeholder="Ex. moins de 30 s, texte overlay, publié dans le groupe WhatsApp…"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">
                    Assigné à *
                  </label>
                  <select
                    required
                    value={formAssignee}
                    onChange={(e) => setFormAssignee(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-gray-50"
                  >
                    {formAssignee &&
                      !assignees.some(
                        (a) => a.email.toLowerCase() === formAssignee.toLowerCase()
                      ) && (
                        <option value={formAssignee}>{formAssignee}</option>
                      )}
                    {assignees.map((a) => (
                      <option key={a.email} value={a.email}>
                        {a.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">
                      Échéance
                    </label>
                    <input
                      type="date"
                      value={formDueDate}
                      onChange={(e) => setFormDueDate(e.target.value)}
                      className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-gray-50"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">
                      Site
                    </label>
                    <select
                      value={formSite}
                      onChange={(e) => setFormSite(e.target.value)}
                      className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-gray-50"
                    >
                      <option value="">—</option>
                      {SITES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-3.5 bg-indigo-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest disabled:opacity-50 touch-manipulation"
                >
                  {saving
                    ? editingTicket
                      ? 'Enregistrement…'
                      : 'Création…'
                    : editingTicket
                      ? 'Enregistrer'
                      : 'Créer le ticket'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
