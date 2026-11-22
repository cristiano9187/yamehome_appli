import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import { AuthorizedEmail, Employee, Ticket, TicketStatus, UserProfile } from '../types';
import { SITES, canCreateTickets, isMainAdminEmail } from '../constants';
import {
  CheckCircle2,
  Circle,
  ClipboardList,
  ImagePlus,
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

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

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

function assigneeLabel(a: AuthorizedEmail, employeesById: Map<string, string>): string {
  const linked = a.linkedEmployeeId ? employeesById.get(a.linkedEmployeeId) : null;
  if (linked) return linked;
  return a.email.split('@')[0] || a.email;
}

async function uploadTicketImage(ticketId: string, file: File): Promise<{ url: string; path: string }> {
  const safe = file.name.replace(/[^\w.-]/g, '_').slice(0, 80) || 'photo.jpg';
  const path = `ticket_attachments/${ticketId}/${Date.now()}_${safe}`;
  const sref = ref(storage, path);
  await uploadBytes(sref, file, { contentType: file.type || 'image/jpeg' });
  const url = await getDownloadURL(sref);
  return { url, path };
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
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);
  const [proofDraft, setProofDraft] = useState<Record<string, string>>({});
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formAssignee, setFormAssignee] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formSite, setFormSite] = useState('');
  const [formImageFile, setFormImageFile] = useState<File | null>(null);
  const [formImagePreview, setFormImagePreview] = useState<string | null>(null);
  const [formExistingImageUrl, setFormExistingImageUrl] = useState<string | null>(null);
  const [formRemoveExistingImage, setFormRemoveExistingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formOpen = showCreate || !!editingTicket;

  const employeesById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees) {
      if (e.id) m.set(e.id, e.name);
    }
    return m;
  }, [employees]);

  const assigneesSorted = useMemo(() => {
    return [...assignees].sort((a, b) =>
      assigneeLabel(a, employeesById).localeCompare(assigneeLabel(b, employeesById), 'fr', {
        sensitivity: 'base',
      })
    );
  }, [assignees, employeesById]);

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
      setAssignees(rows);
    });
    return () => unsub();
  }, [canCreate, isAdmin]);

  useEffect(() => {
    if (!canCreate && !isAdmin) return;
    const unsub = onSnapshot(collection(db, 'employees'), (snap) => {
      setEmployees(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
    });
    return () => unsub();
  }, [canCreate, isAdmin]);

  useEffect(() => {
    if (!formAssignee && assigneesSorted.length) {
      setFormAssignee(assigneesSorted[0].email);
    }
  }, [assigneesSorted, formAssignee]);

  useEffect(() => {
    return () => {
      if (formImagePreview?.startsWith('blob:')) URL.revokeObjectURL(formImagePreview);
    };
  }, [formImagePreview]);

  const list = useMemo(() => {
    if (tab === 'mine_open') {
      return mine.filter((t) => t.status === 'open' || t.status === 'doing');
    }
    if (tab === 'mine_done') return mine.filter((t) => t.status === 'done');
    if (tab === 'created') return created;
    return allTickets;
  }, [tab, mine, created, allTickets]);

  const openCount = mine.filter((t) => t.status === 'open' || t.status === 'doing').length;

  const clearImageForm = () => {
    if (formImagePreview?.startsWith('blob:')) URL.revokeObjectURL(formImagePreview);
    setFormImageFile(null);
    setFormImagePreview(null);
    setFormExistingImageUrl(null);
    setFormRemoveExistingImage(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const resetForm = () => {
    setFormTitle('');
    setFormDescription('');
    setFormDueDate('');
    setFormSite('');
    clearImageForm();
  };

  const closeForm = () => {
    setShowCreate(false);
    setEditingTicket(null);
    resetForm();
  };

  const openCreate = () => {
    resetForm();
    setEditingTicket(null);
    if (assigneesSorted.length) setFormAssignee(assigneesSorted[0].email);
    setShowCreate(true);
  };

  const openEdit = (t: Ticket) => {
    setShowCreate(false);
    setEditingTicket(t);
    setFormTitle(t.title || '');
    setFormDescription(t.description || '');
    setFormAssignee(t.assigneeEmail || '');
    setFormDueDate(t.dueDate || '');
    setFormSite(t.site || '');
    if (formImagePreview?.startsWith('blob:')) URL.revokeObjectURL(formImagePreview);
    setFormImageFile(null);
    setFormImagePreview(null);
    setFormExistingImageUrl(t.attachmentUrl || null);
    setFormRemoveExistingImage(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const resolveAssigneeName = (assigneeEmail: string): string => {
    const row = assignees.find((a) => a.email.toLowerCase() === assigneeEmail.toLowerCase());
    if (row) return assigneeLabel(row, employeesById);
    return assigneeEmail.split('@')[0] || assigneeEmail;
  };

  const onPickImage = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onAlert('Choisissez une image (jpg, png, heic…)', 'error');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      onAlert('Image trop lourde (max 12 Mo)', 'error');
      return;
    }
    if (formImagePreview?.startsWith('blob:')) URL.revokeObjectURL(formImagePreview);
    setFormImageFile(file);
    setFormImagePreview(URL.createObjectURL(file));
    setFormRemoveExistingImage(false);
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formAssignee.trim()) return;
    const assigneeEmail = formAssignee.toLowerCase().trim();
    const assigneeDisplayName = resolveAssigneeName(assigneeEmail);
    const now = new Date().toISOString();

    if (editingTicket?.id) {
      if (!(editingTicket.createdByUid === userUid || isAdmin)) return;
      setSaving(true);
      try {
        let attachmentUrl = editingTicket.attachmentUrl ?? null;
        let attachmentStoragePath = editingTicket.attachmentStoragePath ?? null;

        if (formRemoveExistingImage && !formImageFile) {
          if (attachmentStoragePath) {
            try {
              await deleteObject(ref(storage, attachmentStoragePath));
            } catch {
              /* absent */
            }
          }
          attachmentUrl = null;
          attachmentStoragePath = null;
        }

        if (formImageFile) {
          const uploaded = await uploadTicketImage(editingTicket.id, formImageFile);
          if (attachmentStoragePath && attachmentStoragePath !== uploaded.path) {
            try {
              await deleteObject(ref(storage, attachmentStoragePath));
            } catch {
              /* absent */
            }
          }
          attachmentUrl = uploaded.url;
          attachmentStoragePath = uploaded.path;
        }

        await updateDoc(doc(db, 'tickets', editingTicket.id), {
          title: formTitle.trim(),
          description: formDescription.trim() || '',
          assigneeEmail,
          assigneeDisplayName,
          dueDate: formDueDate || null,
          site: formSite || null,
          attachmentUrl,
          attachmentStoragePath,
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
      const ticketRef = doc(collection(db, 'tickets'));
      let attachmentUrl: string | null = null;
      let attachmentStoragePath: string | null = null;

      if (formImageFile) {
        const uploaded = await uploadTicketImage(ticketRef.id, formImageFile);
        attachmentUrl = uploaded.url;
        attachmentStoragePath = uploaded.path;
      }

      const payload: Omit<Ticket, 'id'> = {
        title: formTitle.trim(),
        description: formDescription.trim() || '',
        status: 'open',
        assigneeEmail,
        assigneeDisplayName,
        createdByUid: userUid,
        createdByEmail: email,
        createdByName: userProfile?.displayName || email,
        dueDate: formDueDate || null,
        site: formSite || null,
        attachmentUrl,
        attachmentStoragePath,
        proofUrl: null,
        createdAt: now,
        updatedAt: now,
        doneAt: null,
      };
      await setDoc(ticketRef, payload);
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

  const showPreviewUrl =
    formImagePreview || (!formRemoveExistingImage ? formExistingImageUrl : null);

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
                      → {t.assigneeDisplayName || t.assigneeEmail}
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

                {t.attachmentUrl ? (
                  <button
                    type="button"
                    onClick={() => setLightboxUrl(t.attachmentUrl!)}
                    className="block w-full max-w-sm overflow-hidden rounded-xl border border-gray-100 bg-gray-50 touch-manipulation"
                  >
                    <img
                      src={t.attachmentUrl}
                      alt="Pièce jointe du ticket"
                      className="w-full max-h-56 object-cover"
                    />
                  </button>
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
                    placeholder="Ex. Étiquettes frigo Rieti"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">
                    Description
                  </label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    rows={4}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-gray-50"
                    placeholder="Décrivez le besoin (y compris critères de fin si utile)…"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">
                    Image (optionnel)
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => onPickImage(e.target.files?.[0] || null)}
                  />
                  {showPreviewUrl ? (
                    <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                      <img
                        src={showPreviewUrl}
                        alt="Aperçu"
                        className="w-full max-h-48 object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (formImagePreview?.startsWith('blob:')) {
                            URL.revokeObjectURL(formImagePreview);
                          }
                          setFormImageFile(null);
                          setFormImagePreview(null);
                          if (formExistingImageUrl) setFormRemoveExistingImage(true);
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white"
                        aria-label="Retirer l’image"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 text-gray-500 text-xs font-bold touch-manipulation"
                    >
                      <ImagePlus size={16} />
                      Photo / image (ex. frigo, étiquettes…)
                    </button>
                  )}
                  {showPreviewUrl && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-2 text-[10px] font-bold uppercase tracking-widest text-indigo-600"
                    >
                      Remplacer l’image
                    </button>
                  )}
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
                      !assigneesSorted.some(
                        (a) => a.email.toLowerCase() === formAssignee.toLowerCase()
                      ) && (
                        <option value={formAssignee}>
                          {resolveAssigneeName(formAssignee)}
                        </option>
                      )}
                    {assigneesSorted.map((a) => (
                      <option key={a.email} value={a.email}>
                        {assigneeLabel(a, employeesById)}
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

      <AnimatePresence>
        {lightboxUrl && (
          <div
            className="fixed inset-0 z-[110] bg-black/85 flex items-center justify-center p-4"
            onClick={() => setLightboxUrl(null)}
          >
            <button
              type="button"
              className="absolute top-4 right-4 p-2 rounded-xl bg-white/10 text-white"
              onClick={() => setLightboxUrl(null)}
              aria-label="Fermer"
            >
              <X size={20} />
            </button>
            <img
              src={lightboxUrl}
              alt="Pièce jointe"
              className="max-w-full max-h-[90vh] rounded-xl object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
