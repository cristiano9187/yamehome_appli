import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import {
  AuthorizedEmail,
  Employee,
  Ticket,
  TicketComment,
  TicketCommentKind,
  TicketStatus,
  UserProfile,
} from '../types';
import { SITES, canCreateTickets, isMainAdminEmail } from '../constants';
import {
  CheckCircle2,
  Circle,
  ClipboardList,
  ImagePlus,
  Loader2,
  Menu,
  MessageSquare,
  Play,
  Pencil,
  Plus,
  RotateCcw,
  Send,
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

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
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

function TicketCard({
  ticket: t,
  email,
  userUid,
  userProfile,
  isAdmin,
  saving,
  onAlert,
  onEdit,
  onLightbox,
  setSaving,
}: {
  ticket: Ticket;
  email: string;
  userUid: string;
  userProfile: UserProfile | null;
  isAdmin: boolean;
  saving: boolean;
  onAlert: TicketsViewProps['onAlert'];
  onEdit: (t: Ticket) => void;
  onLightbox: (url: string) => void;
  setSaving: (v: boolean) => void;
}) {
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [draft, setDraft] = useState('');
  const [draftFile, setDraftFile] = useState<File | null>(null);
  const [draftPreview, setDraftPreview] = useState<string | null>(null);
  const [closeMode, setCloseMode] = useState(false);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isMine = t.assigneeEmail === email;
  const canEditContent = t.createdByUid === userUid || isAdmin;
  const canComment = isMine || t.createdByUid === userUid || isAdmin;

  useEffect(() => {
    if (!t.id) return;
    const q = query(
      collection(db, 'tickets', t.id, 'comments'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setComments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TicketComment)));
      },
      (err) => console.error('ticket comments listen:', err)
    );
    return () => unsub();
  }, [t.id]);

  useEffect(() => {
    return () => {
      if (draftPreview?.startsWith('blob:')) URL.revokeObjectURL(draftPreview);
    };
  }, [draftPreview]);

  const clearDraftImage = () => {
    if (draftPreview?.startsWith('blob:')) URL.revokeObjectURL(draftPreview);
    setDraftFile(null);
    setDraftPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const onPickDraftImage = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onAlert('Choisissez une image (jpg, png…)', 'error');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      onAlert('Image trop lourde (max 12 Mo)', 'error');
      return;
    }
    if (draftPreview?.startsWith('blob:')) URL.revokeObjectURL(draftPreview);
    setDraftFile(file);
    setDraftPreview(URL.createObjectURL(file));
  };

  const postComment = async (kind: TicketCommentKind) => {
    if (!t.id || !canComment) return;
    const body = draft.trim();
    if (!body) {
      onAlert(kind === 'close' ? 'Ajoutez un commentaire pour clôturer' : 'Écrivez un commentaire', 'error');
      return;
    }
    setPosting(true);
    setSaving(true);
    try {
      let attachmentUrl: string | null = null;
      let attachmentStoragePath: string | null = null;
      if (draftFile) {
        const uploaded = await uploadTicketImage(t.id, draftFile);
        attachmentUrl = uploaded.url;
        attachmentStoragePath = uploaded.path;
      }

      const now = new Date().toISOString();
      const payload: Omit<TicketComment, 'id'> = {
        body,
        kind,
        authorUid: userUid,
        authorEmail: email,
        authorName: userProfile?.displayName || email.split('@')[0] || email,
        createdAt: now,
        attachmentUrl,
        attachmentStoragePath,
      };
      await addDoc(collection(db, 'tickets', t.id, 'comments'), payload);

      if (kind === 'close') {
        await updateDoc(doc(db, 'tickets', t.id), {
          status: 'done',
          doneAt: now,
          updatedAt: now,
          proofUrl: null,
        });
        onAlert('Ticket clos', 'success');
        setCloseMode(false);
      } else {
        await updateDoc(doc(db, 'tickets', t.id), { updatedAt: now });
        onAlert('Commentaire ajouté', 'success');
      }

      setDraft('');
      clearDraftImage();
    } catch (err) {
      console.error(err);
      onAlert(kind === 'close' ? 'Clôture impossible' : 'Commentaire refusé', 'error');
    } finally {
      setPosting(false);
      setSaving(false);
    }
  };

  const setStatus = async (status: TicketStatus) => {
    if (!t.id) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'tickets', t.id), {
        status,
        updatedAt: now,
        ...(status === 'open' || status === 'doing' ? { doneAt: null } : {}),
      });
      onAlert(
        status === 'doing' ? 'Ticket en cours' : status === 'open' ? 'Ticket rouvert' : 'Statut mis à jour',
        'success'
      );
      if (status !== 'done') setCloseMode(false);
    } catch (err) {
      console.error(err);
      onAlert('Mise à jour refusée (droits ou connexion)', 'error');
    } finally {
      setSaving(false);
    }
  };

  const creatorName = t.createdByName || t.createdByEmail || '—';
  const assigneeName = t.assigneeDisplayName || t.assigneeEmail || '—';

  return (
    <article className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 md:p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-gray-900 leading-snug">{t.title}</h3>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                Créé par
              </p>
              <p className="text-xs font-bold text-slate-800 truncate">{creatorName}</p>
            </div>
            <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-indigo-400">
                Assigné à
              </p>
              <p className="text-xs font-bold text-indigo-900 truncate">{assigneeName}</p>
            </div>
          </div>
          {(t.dueDate || t.site) && (
            <p className="text-[10px] text-gray-400 font-mono mt-2">
              {t.dueDate ? `échéance ${t.dueDate}` : ''}
              {t.dueDate && t.site ? ' · ' : ''}
              {t.site || ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canEditContent && (
            <button
              type="button"
              title="Modifier"
              onClick={() => onEdit(t)}
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
          onClick={() => onLightbox(t.attachmentUrl!)}
          className="block w-full max-w-sm overflow-hidden rounded-xl border border-gray-100 bg-gray-50 touch-manipulation"
        >
          <img
            src={t.attachmentUrl}
            alt="Pièce jointe du ticket"
            className="w-full max-h-56 object-cover"
          />
        </button>
      ) : null}

      {/* Fil commentaires */}
      <div className="rounded-xl border border-gray-100 bg-gray-50/80 overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-1.5">
          <MessageSquare size={12} className="text-gray-400" />
          <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">
            Updates ({comments.length})
          </span>
        </div>
        <div className="max-h-56 overflow-y-auto px-3 py-2 space-y-2">
          {comments.length === 0 ? (
            <p className="text-[11px] text-gray-400 py-1">Aucun commentaire pour l’instant.</p>
          ) : (
            comments.map((c) => (
              <div
                key={c.id}
                className={`rounded-lg px-2.5 py-2 border ${
                  c.kind === 'close'
                    ? 'bg-emerald-50 border-emerald-100'
                    : 'bg-white border-gray-100'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[11px] font-bold text-gray-800 truncate">
                    {c.authorName}
                    {c.kind === 'close' ? (
                      <span className="ml-1.5 text-[9px] font-black uppercase tracking-widest text-emerald-700">
                        clôture
                      </span>
                    ) : null}
                  </p>
                  <span className="text-[9px] text-gray-400 shrink-0">{formatWhen(c.createdAt)}</span>
                </div>
                <p className="text-xs text-gray-700 whitespace-pre-wrap mt-0.5">{c.body}</p>
                {c.attachmentUrl ? (
                  <button
                    type="button"
                    onClick={() => onLightbox(c.attachmentUrl!)}
                    className="mt-1.5 block overflow-hidden rounded-lg border border-gray-100 max-w-[200px]"
                  >
                    <img
                      src={c.attachmentUrl}
                      alt="PJ commentaire"
                      className="w-full max-h-28 object-cover"
                    />
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>

        {canComment && t.status !== 'done' && !closeMode && (
          <div className="border-t border-gray-100 px-3 py-2 space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              placeholder="Update : avancement, blocage…"
              className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white"
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => onPickDraftImage(e.target.files?.[0] || null)}
            />
            {draftPreview ? (
              <div className="relative inline-block">
                <img src={draftPreview} alt="Aperçu" className="h-16 rounded-lg object-cover" />
                <button
                  type="button"
                  onClick={clearDraftImage}
                  className="absolute -top-1 -right-1 p-0.5 rounded-full bg-black/70 text-white"
                >
                  <X size={10} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 flex items-center gap-1"
              >
                <ImagePlus size={12} /> Image
              </button>
            )}
            <button
              type="button"
              disabled={posting || saving || !draft.trim()}
              onClick={() => postComment('update')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest touch-manipulation disabled:opacity-50"
            >
              <Send size={12} /> Publier
            </button>
          </div>
        )}

        {canComment && closeMode && (
          <div className="border-t border-emerald-100 bg-emerald-50/50 px-3 py-3 space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700">
              Clôturer — commentaire + photo (optionnelle)
            </p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              required
              placeholder="Ex. étiquettes posées, photo jointe…"
              className="w-full text-xs border border-emerald-200 rounded-xl px-3 py-2 bg-white"
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => onPickDraftImage(e.target.files?.[0] || null)}
            />
            {draftPreview ? (
              <div className="relative inline-block">
                <img src={draftPreview} alt="Aperçu" className="h-16 rounded-lg object-cover" />
                <button
                  type="button"
                  onClick={clearDraftImage}
                  className="absolute -top-1 -right-1 p-0.5 rounded-full bg-black/70 text-white"
                >
                  <X size={10} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 flex items-center gap-1"
              >
                <ImagePlus size={12} /> Joindre une preuve photo
              </button>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={posting || saving || !draft.trim()}
                onClick={() => postComment('close')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest touch-manipulation disabled:opacity-50"
              >
                <CheckCircle2 size={12} /> Confirmer clôture
              </button>
              <button
                type="button"
                disabled={posting}
                onClick={() => {
                  setCloseMode(false);
                  clearDraftImage();
                }}
                className="px-3 py-2 rounded-xl bg-white border border-gray-200 text-gray-600 text-[10px] font-black uppercase tracking-widest"
              >
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>

      {canComment && (
        <div className="flex flex-wrap gap-2 pt-1">
          {t.status === 'open' && isMine && (
            <button
              type="button"
              disabled={saving}
              onClick={() => setStatus('doing')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest touch-manipulation disabled:opacity-50"
            >
              <Play size={12} /> En cours
            </button>
          )}
          {(t.status === 'open' || t.status === 'doing') && isMine && !closeMode && (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setCloseMode(true);
                setDraft('');
                clearDraftImage();
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest touch-manipulation disabled:opacity-50"
            >
              <CheckCircle2 size={12} /> Clôturer
            </button>
          )}
          {t.status === 'done' && (isMine || isAdmin || t.createdByUid === userUid) && (
            <button
              type="button"
              disabled={saving}
              onClick={() => setStatus('open')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-[10px] font-black uppercase tracking-widest touch-manipulation disabled:opacity-50"
            >
              <RotateCcw size={12} /> Rouvrir
            </button>
          )}
          {!isMine && t.status !== 'done' && (
            <span className="text-[10px] text-gray-400 flex items-center gap-1">
              <Circle size={10} /> En attente de l’assigné
            </span>
          )}
        </div>
      )}
    </article>
  );
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
    const qMine = query(collection(db, 'tickets'), where('assigneeEmail', '==', email));
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
    const qCreated = query(collection(db, 'tickets'), where('createdByUid', '==', userUid));
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
      setAssignees(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuthorizedEmail)));
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
              <TicketCard
                key={t.id}
                ticket={t}
                email={email}
                userUid={userUid}
                userProfile={userProfile}
                isAdmin={isAdmin}
                saving={saving}
                onAlert={onAlert}
                onEdit={openEdit}
                onLightbox={setLightboxUrl}
                setSaving={setSaving}
              />
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
                    placeholder="Décrivez le besoin…"
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
