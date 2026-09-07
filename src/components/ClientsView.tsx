import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, deleteField, doc, getDocs, onSnapshot, orderBy, query, setDoc, updateDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import { ClientIdDocKind, ClientIdDocument, ClientProfile, ClientProfileSeed, Prospect, ReceiptData, UserProfile } from '../types';
import { formatCurrency } from '../constants';
import { getReceiptSegments } from '../utils/receiptSegments';
import { AptBadge, PhoneLinks } from '../utils/aptDisplay';
import {
  buildMergedDirectory,
  formatDateFr,
  identityKeyOf,
  MergedClient,
  sameContact,
} from '../utils/contactDirectory';
import ContactInterestLine from './ContactInterestLine';
import {
  Menu,
  Search,
  Users,
  Mail,
  Phone,
  Save,
  ArrowLeft,
  ClipboardList,
  AlertTriangle,
  Loader2,
  ExternalLink,
  ChevronRight,
  RefreshCw,
  CalendarDays,
  History,
  StickyNote,
  Sparkles,
  Merge,
  IdCard,
  Upload,
} from 'lucide-react';

interface ClientsViewProps {
  onMenuClick?: () => void;
  userProfile: UserProfile | null;
  onAlert: (message: string, type?: 'info' | 'error' | 'success') => void;
  onOpenReceipt: (receipt: ReceiptData) => void;
  /** Identité (nom/tel/email) à sélectionner automatiquement — reçu cliqué, ligne d'historique, recherche "Client intelligent". */
  initialSeed?: ClientProfileSeed | null;
}

const ID_DOC_KIND_OPTIONS: { value: ClientIdDocKind; label: string }[] = [
  { value: 'CNI', label: 'CNI' },
  { value: 'PASSEPORT', label: 'Passeport' },
  { value: 'PERMIS', label: 'Permis' },
  { value: 'AUTRE', label: 'Autre' },
];

const normalizeString = (value: string) => (value || '').trim().toLowerCase().replace(/\s+/g, ' ');

function guessIdDocContentType(file: File): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/heic';
  return 'image/jpeg';
}

function buildIdDocumentPayload(
  kind: ClientIdDocKind,
  path: string,
  url: string,
  fileName: string,
  expiresAt: string
): ClientIdDocument {
  const docPayload: ClientIdDocument = {
    kind,
    storagePath: path,
    downloadUrl: url,
    fileName,
    uploadedAt: new Date().toISOString(),
  };
  const exp = expiresAt.trim();
  if (exp) docPayload.expiresAt = exp;
  return docPayload;
}

export default function ClientsView({ onMenuClick, userProfile, onAlert, onOpenReceipt, initialSeed }: ClientsViewProps) {
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [receipts, setReceipts] = useState<ReceiptData[]>([]);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [loadingReceipts, setLoadingReceipts] = useState(true);
  const [loadingProspects, setLoadingProspects] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIdentity, setSelectedIdentity] = useState<ClientProfileSeed | null>(null);
  const [selectedClusterKey, setSelectedClusterKey] = useState<string | null>(null);
  const [firstNameInput, setFirstNameInput] = useState('');
  const [lastNameInput, setLastNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [prefsInput, setPrefsInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [idDocKind, setIdDocKind] = useState<ClientIdDocKind>('CNI');
  const [idDocExpiresAt, setIdDocExpiresAt] = useState('');
  const [dirty, setDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [idDocUploading, setIdDocUploading] = useState(false);
  const [showMobileDetail, setShowMobileDetail] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'clients'), orderBy('lastName'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClientProfile)));
        setLoadingClients(false);
      },
      (err) => {
        console.error('Clients listener error:', err);
        setLoadingClients(false);
      }
    );
    return unsub;
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'prospects'), orderBy('updatedAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setProspects(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Prospect)));
        setLoadingProspects(false);
      },
      (err) => {
        console.error('Prospects listener error:', err);
        setLoadingProspects(false);
      }
    );
    return unsub;
  }, []);

  const loadReceipts = async () => {
    setLoadingReceipts(true);
    try {
      const snap = await getDocs(query(collection(db, 'receipts'), orderBy('createdAt', 'desc')));
      setReceipts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ReceiptData)));
    } catch (err) {
      console.error('Receipts fetch error:', err);
      onAlert("Impossible de charger l'historique des séjours.", 'error');
    } finally {
      setLoadingReceipts(false);
    }
  };

  useEffect(() => {
    loadReceipts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const directory = useMemo(
    () => buildMergedDirectory(clients, receipts, prospects),
    [clients, receipts, prospects]
  );

  // Nouvelle identité imposée par le parent (clic depuis un reçu, l'historique ou la recherche) : on
  // repart d'un pointeur non résolu, l'effet suivant le rattachera à la bonne fiche fusionnée dès que possible.
  useEffect(() => {
    if (initialSeed) {
      setSelectedIdentity({
        firstName: initialSeed.firstName || '',
        lastName: initialSeed.lastName || '',
        phone: initialSeed.phone || '',
        email: initialSeed.email || '',
      });
      setSelectedClusterKey(null);
      setShowMobileDetail(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSeed]);

  // Résout le pointeur de sélection une fois l'annuaire chargé — ne s'exécute que tant que non résolu,
  // pour ne jamais « sauter » vers une autre fiche suite à un rafraîchissement en arrière-plan.
  useEffect(() => {
    if (!selectedIdentity || selectedClusterKey) return;
    const match = directory.find((c) => c._variants.some((v) => sameContact(v, selectedIdentity)));
    if (match) setSelectedClusterKey(match._key);
  }, [directory, selectedIdentity, selectedClusterKey]);

  const selectedProfile: MergedClient | null = useMemo(() => {
    if (selectedClusterKey) {
      const found = directory.find((c) => c._key === selectedClusterKey);
      if (found) return found;
    }
    if (!selectedIdentity) return null;
    return {
      firstName: selectedIdentity.firstName,
      lastName: selectedIdentity.lastName,
      phone: selectedIdentity.phone,
      email: selectedIdentity.email,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      authorUid: userProfile?.uid || '',
      _key: identityKeyOf(selectedIdentity),
      _variants: [selectedIdentity],
      _clientDocIds: [],
      _isProspectOnly: false,
      _interestedApartment: null,
      _interestedStartDate: null,
      _interestedEndDate: null,
      _lastProspectApartment: null,
      _lastProspectStartDate: null,
      _lastProspectEndDate: null,
    };
  }, [directory, selectedClusterKey, selectedIdentity, userProfile?.uid]);

  useEffect(() => {
    setDirty(false);
  }, [selectedProfile?._key]);

  useEffect(() => {
    if (dirty) return;
    setFirstNameInput(selectedProfile?.firstName || '');
    setLastNameInput(selectedProfile?.lastName || '');
    setPhoneInput(selectedProfile?.phone || '');
    setEmailInput(selectedProfile?.email || '');
    setPrefsInput(selectedProfile?.preferences || '');
    setNotesInput(selectedProfile?.notes || '');
    setIdDocKind(selectedProfile?.idDocument?.kind || 'CNI');
    setIdDocExpiresAt(selectedProfile?.idDocument?.expiresAt || '');
  }, [selectedProfile, dirty]);

  const filteredDirectory = useMemo(() => {
    const term = normalizeString(searchTerm);
    if (!term) return directory;
    return directory.filter((c) => {
      const label = normalizeString(`${c.firstName} ${c.lastName} ${c.phone} ${c.email}`);
      return label.includes(term);
    });
  }, [directory, searchTerm]);

  const clientReceipts = useMemo(() => {
    if (!selectedProfile) return [];
    return receipts
      .filter((r) => selectedProfile._variants.some((v) => sameContact(r, v)))
      .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  }, [receipts, selectedProfile]);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const upcomingStays = clientReceipts.filter((r) => r.status !== 'ANNULE' && (r.endDate || '') >= todayIso);
  const pastStays = clientReceipts.filter((r) => r.status === 'ANNULE' || (r.endDate || '') < todayIso);

  const totalRevenue = clientReceipts
    .filter((r) => r.status !== 'ANNULE')
    .reduce((sum, r) => sum + (r.grandTotal || 0), 0);

  const clientSinceIso = clientReceipts.length
    ? clientReceipts.reduce((min, r) => (r.createdAt && r.createdAt < min ? r.createdAt : min), clientReceipts[0].createdAt)
    : selectedProfile?.createdAt || null;

  const handleSelect = (c: MergedClient) => {
    setSelectedIdentity({ firstName: c.firstName, lastName: c.lastName, phone: c.phone, email: c.email });
    setSelectedClusterKey(c._key);
    setShowMobileDetail(true);
  };

  const handleSave = async () => {
    if (!selectedProfile || !userProfile?.uid || !lastNameInput.trim()) return;
    setIsSaving(true);
    try {
      const docIds = selectedProfile._clientDocIds;
      const primaryId = docIds[0];
      const payload: Omit<ClientProfile, 'id'> = {
        firstName: firstNameInput.trim(),
        lastName: lastNameInput.trim(),
        phone: phoneInput.trim(),
        email: emailInput.trim(),
        preferences: prefsInput.trim(),
        notes: notesInput.trim(),
        updatedAt: new Date().toISOString(),
        createdAt: selectedProfile.createdAt || new Date().toISOString(),
        authorUid: selectedProfile.authorUid || userProfile.uid,
      };

      if (primaryId) {
        await setDoc(doc(db, 'clients', primaryId), payload, { merge: true });
        // Fusion : si plusieurs fiches Firestore désignaient la même personne, on les supprime après report des données.
        const duplicateIds = docIds.slice(1);
        if (duplicateIds.length > 0) {
          await Promise.all(duplicateIds.map((id) => deleteDoc(doc(db, 'clients', id))));
        }
        onAlert(
          duplicateIds.length > 0
            ? `Fiche mise à jour et ${duplicateIds.length} doublon(s) fusionné(s).`
            : 'Fiche client mise à jour.',
          'success'
        );
      } else {
        await addDoc(collection(db, 'clients'), payload);
        onAlert('Fiche client créée.', 'success');
      }
      // Reflète immédiatement les valeurs enregistrées (évite un flash avec l'ancienne identité
      // le temps que le listener Firestore renvoie la fiche à jour).
      setSelectedIdentity({ firstName: payload.firstName, lastName: payload.lastName, phone: payload.phone, email: payload.email });
      setSelectedClusterKey(identityKeyOf(payload));
      setDirty(false);
    } catch (err) {
      console.error('Client profile save failed:', err);
      onAlert('Impossible de mettre à jour la fiche client. Vérifiez les droits Firestore.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  /** Crée la fiche Firestore si le contact n'existe que via reçus/prospects. */
  const ensureClientDocId = async (): Promise<string | null> => {
    if (!selectedProfile || !userProfile?.uid || !lastNameInput.trim()) return null;
    const existing = selectedProfile._clientDocIds[0];
    if (existing) return existing;
    const now = new Date().toISOString();
    const payload: Omit<ClientProfile, 'id'> = {
      firstName: firstNameInput.trim(),
      lastName: lastNameInput.trim(),
      phone: phoneInput.trim(),
      email: emailInput.trim(),
      preferences: prefsInput.trim(),
      notes: notesInput.trim(),
      createdAt: selectedProfile.createdAt || now,
      updatedAt: now,
      authorUid: userProfile.uid,
    };
    const refDoc = await addDoc(collection(db, 'clients'), payload);
    setSelectedIdentity({
      firstName: payload.firstName,
      lastName: payload.lastName,
      phone: payload.phone,
      email: payload.email,
    });
    setSelectedClusterKey(identityKeyOf(payload));
    setDirty(false);
    return refDoc.id;
  };

  const handleUploadIdDocument = async (file: File) => {
    if (!selectedProfile || !userProfile?.uid) return;
    if (!lastNameInput.trim()) {
      onAlert('Indiquez au moins le nom avant d’ajouter une pièce.', 'error');
      return;
    }
    if (file.size >= 12 * 1024 * 1024) {
      onAlert('Fichier trop volumineux (max. 12 Mo).', 'error');
      return;
    }
    setIdDocUploading(true);
    let uploadedPath: string | null = null;
    try {
      const clientId = await ensureClientDocId();
      if (!clientId) {
        onAlert('Impossible de créer la fiche client.', 'error');
        return;
      }
      const previousPath = selectedProfile.idDocument?.storagePath;
      const safe = file.name.replace(/[^\w.-]/g, '_').slice(0, 80);
      const path = `client_id_docs/${clientId}/${Date.now()}_${safe}`;
      const sref = ref(storage, path);
      await uploadBytes(sref, file, { contentType: guessIdDocContentType(file) });
      uploadedPath = path;
      const url = await getDownloadURL(sref);
      const idDocument = buildIdDocumentPayload(
        idDocKind,
        path,
        url,
        file.name.slice(0, 120) || 'piece-identite',
        idDocExpiresAt
      );
      await updateDoc(doc(db, 'clients', clientId), {
        idDocument,
        updatedAt: new Date().toISOString(),
      });
      if (previousPath && previousPath !== path) {
        try {
          await deleteObject(ref(storage, previousPath));
        } catch {
          /* ancien fichier déjà absent */
        }
      }
      onAlert('Pièce d’identité enregistrée.', 'success');
    } catch (err) {
      console.error('ID document upload failed:', err);
      if (uploadedPath) {
        try {
          await deleteObject(ref(storage, uploadedPath));
        } catch {
          /* */
        }
      }
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
      const message = err && typeof err === 'object' && 'message' in err ? String((err as { message?: string }).message) : '';
      if (code.includes('storage/unauthorized') || code.includes('storage/unauthenticated')) {
        onAlert('Storage a refusé le fichier. Redéployez storage.rules puis reconnectez-vous.', 'error');
      } else if (code.includes('permission-denied')) {
        onAlert('Firestore a refusé l’enregistrement. Redéployez firestore.rules.', 'error');
      } else {
        onAlert(`Upload impossible${message ? ` : ${message.slice(0, 120)}` : '.'}`, 'error');
      }
    } finally {
      setIdDocUploading(false);
    }
  };

  const handleSaveIdMeta = async () => {
    const clientId = selectedProfile?._clientDocIds[0];
    if (!clientId || !selectedProfile?.idDocument?.downloadUrl) return;
    try {
      await updateDoc(doc(db, 'clients', clientId), {
        'idDocument.kind': idDocKind,
        'idDocument.expiresAt': idDocExpiresAt.trim() || null,
        updatedAt: new Date().toISOString(),
      });
      onAlert('Infos pièce mises à jour.', 'success');
    } catch (err) {
      console.error(err);
      onAlert('Impossible de mettre à jour le type / l’expiration.', 'error');
    }
  };

  const handleRemoveIdDocument = async () => {
    const clientId = selectedProfile?._clientDocIds[0];
    const path = selectedProfile?.idDocument?.storagePath;
    if (!clientId || !path) return;
    if (!window.confirm('Retirer la pièce d’identité de cette fiche ?')) return;
    try {
      try {
        await deleteObject(ref(storage, path));
      } catch {
        /* */
      }
      await updateDoc(doc(db, 'clients', clientId), {
        idDocument: deleteField(),
        updatedAt: new Date().toISOString(),
      });
      setIdDocKind('CNI');
      setIdDocExpiresAt('');
      onAlert('Pièce d’identité retirée.', 'success');
    } catch (err) {
      console.error(err);
      onAlert('Erreur lors de la suppression.', 'error');
    }
  };

  const isLoading = loadingClients || loadingReceipts || loadingProspects;
  const hasDuplicates = (selectedProfile?._clientDocIds.length || 0) > 1;
  const hasIdDocument = Boolean(selectedProfile?.idDocument?.downloadUrl);

  return (
    <div className="flex-1 flex flex-col min-h-screen md:h-full bg-[#F5F5F4] md:overflow-hidden">
      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-4 flex items-center gap-3 sticky top-0 z-40">
        {onMenuClick && (
          <button type="button" onClick={onMenuClick} className="md:hidden p-2 hover:bg-gray-100 rounded-xl">
            <Menu size={20} />
          </button>
        )}
        <div className="flex-1">
          <h2 className="text-base font-black uppercase tracking-widest flex items-center gap-2">
            <Users size={16} className="text-blue-600" />
            Clients
          </h2>
          <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest">
            Coordonnées, pièce d’identité, préférences — P = prospect jamais réservé
          </p>
        </div>
        <button
          type="button"
          onClick={loadReceipts}
          disabled={loadingReceipts}
          className="p-2 hover:bg-gray-100 rounded-xl text-gray-500 disabled:opacity-50"
          title="Actualiser l'historique des séjours"
        >
          <RefreshCw size={16} className={loadingReceipts ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 md:overflow-hidden flex flex-col md:flex-row">
        {/* Liste des clients */}
        <div className={`w-full md:w-[22rem] md:shrink-0 md:border-r border-gray-200 bg-white md:overflow-y-auto ${showMobileDetail ? 'hidden md:block' : 'block'}`}>
          <div className="p-4 border-b border-gray-100 sticky top-0 bg-white z-10">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Nom, téléphone ou email..."
                className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-xs outline-none focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          {isLoading && directory.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={22} className="animate-spin text-blue-600" />
            </div>
          ) : filteredDirectory.length === 0 ? (
            <p className="text-center text-xs text-gray-400 py-16 px-4">Aucun client trouvé.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {filteredDirectory.map((c) => {
                const isSelected = c._key === selectedProfile?._key;
                return (
                  <button
                    key={c._key}
                    type="button"
                    onClick={() => handleSelect(c)}
                    className={`w-full text-left px-4 py-3 flex items-center justify-between gap-2 transition-all ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                  >
                    <div className="min-w-0 flex items-start gap-2">
                      {c._isProspectOnly && (
                        <span
                          className="shrink-0 mt-0.5 w-5 h-5 rounded-md bg-violet-100 text-violet-700 text-[10px] font-black flex items-center justify-center"
                          title="Prospect — aucune réservation effective pour l’instant"
                        >
                          P
                        </span>
                      )}
                      {c.idDocument?.downloadUrl && (
                        <span
                          className="shrink-0 mt-0.5 w-5 h-5 rounded-md bg-sky-100 text-sky-700 flex items-center justify-center"
                          title="Pièce d’identité au dossier"
                        >
                          <IdCard size={12} />
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className={`text-xs font-black uppercase truncate ${isSelected ? 'text-blue-700' : 'text-gray-800'}`}>
                          {c.firstName} {c.lastName}
                        </p>
                        {c._isProspectOnly && (
                          <ContactInterestLine
                            apartment={c._interestedApartment}
                            startDate={c._interestedStartDate}
                            endDate={c._interestedEndDate}
                            compact
                          />
                        )}
                        <p className="text-[10px] text-gray-400 truncate">
                          {c.phone || c.email || (c._isProspectOnly ? 'Prospect sans coordonnées' : 'Pas de coordonnées')}
                        </p>
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-gray-300 shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Détail client */}
        <div className={`flex-1 md:overflow-y-auto ${showMobileDetail ? 'block' : 'hidden md:block'}`}>
          {!selectedProfile ? (
            <div className="flex flex-col items-center justify-center h-full py-24 px-6 text-center text-gray-400">
              <Users size={40} className="mb-3 text-gray-300" />
              <p className="text-xs font-bold uppercase tracking-widest">Sélectionnez un client</p>
              <p className="text-[11px] mt-1">Choisissez une fiche dans la liste pour voir son profil.</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto p-4 md:p-6 pb-24 space-y-4">
              <button
                type="button"
                onClick={() => setShowMobileDetail(false)}
                className="md:hidden flex items-center gap-1 text-[11px] font-black uppercase tracking-widest text-gray-500 mb-1"
              >
                <ArrowLeft size={14} /> Retour à la liste
              </button>

              {/* En-tête profil */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-lg font-black uppercase text-gray-900 flex items-center gap-2 flex-wrap">
                      {selectedProfile._isProspectOnly && (
                        <span
                          className="w-6 h-6 rounded-md bg-violet-100 text-violet-700 text-xs font-black flex items-center justify-center"
                          title="Prospect — aucune réservation effective"
                        >
                          P
                        </span>
                      )}
                      <span>
                        {selectedProfile.firstName} {selectedProfile.lastName}
                      </span>
                    </h3>
                    {selectedProfile._isProspectOnly ? (
                      <div className="mt-0.5 space-y-0.5">
                        <p className="text-[10px] text-violet-600 font-bold uppercase tracking-widest">
                          Prospect — pas encore de réservation effective
                        </p>
                        {(selectedProfile._interestedApartment || selectedProfile._interestedStartDate || selectedProfile._interestedEndDate) && (
                          <ContactInterestLine
                            apartment={selectedProfile._interestedApartment}
                            startDate={selectedProfile._interestedStartDate}
                            endDate={selectedProfile._interestedEndDate}
                          />
                        )}
                      </div>
                    ) : clientSinceIso ? (
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                        Client depuis le {formatDateFr(clientSinceIso)}
                      </p>
                    ) : null}
                    {hasDuplicates && (
                      <p className="flex items-center gap-1 text-[10px] text-amber-600 font-bold mt-1">
                        <Merge size={11} />
                        {selectedProfile._clientDocIds.length} fiches en double détectées — seront fusionnées à l'enregistrement
                      </p>
                    )}
                  </div>
                  <div className="flex gap-4 text-right">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Séjours</p>
                      <p className="text-sm font-black text-gray-900">{clientReceipts.length}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Total facturé</p>
                      <p className="text-sm font-black text-gray-900">{formatCurrency(totalRevenue)}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Prénom</label>
                    <input
                      type="text"
                      value={firstNameInput}
                      onChange={(e) => {
                        setFirstNameInput(e.target.value);
                        setDirty(true);
                      }}
                      placeholder="Prénom"
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Nom *</label>
                    <input
                      type="text"
                      value={lastNameInput}
                      onChange={(e) => {
                        setLastNameInput(e.target.value);
                        setDirty(true);
                      }}
                      placeholder="Nom"
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none focus:border-blue-500 transition-all font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Téléphone</label>
                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl p-3">
                      <Phone size={13} className="text-gray-400 shrink-0" />
                      <input
                        type="tel"
                        value={phoneInput}
                        onChange={(e) => {
                          setPhoneInput(e.target.value);
                          setDirty(true);
                        }}
                        className="flex-1 bg-transparent text-xs outline-none min-w-0"
                        placeholder="Téléphone"
                      />
                    </div>
                    {phoneInput && <PhoneLinks phone={phoneInput} />}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Email</label>
                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl p-3">
                      <Mail size={13} className="text-gray-400 shrink-0" />
                      <input
                        type="email"
                        value={emailInput}
                        onChange={(e) => {
                          setEmailInput(e.target.value);
                          setDirty(true);
                        }}
                        className="flex-1 bg-transparent text-xs outline-none min-w-0"
                        placeholder="Email"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-1.5">
                    <Sparkles size={12} className="text-violet-500" /> Préférences (visible équipe)
                  </label>
                  <textarea
                    value={prefsInput}
                    onChange={(e) => {
                      setPrefsInput(e.target.value);
                      setDirty(true);
                    }}
                    rows={2}
                    placeholder="Ex : préfère l'étage haut, climatisation forte, arrivée tardive..."
                    className="w-full bg-violet-50/60 border border-violet-100 rounded-xl p-3 text-xs outline-none focus:border-violet-400 transition-all resize-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-1.5">
                    <StickyNote size={12} className="text-amber-500" /> Notes internes (jamais montrées au client)
                  </label>
                  <textarea
                    value={notesInput}
                    onChange={(e) => {
                      setNotesInput(e.target.value);
                      setDirty(true);
                    }}
                    rows={2}
                    placeholder="Ex : client VIP, paiement toujours en retard, litige passé..."
                    className="w-full bg-amber-50/60 border border-amber-100 rounded-xl p-3 text-xs outline-none focus:border-amber-400 transition-all resize-none"
                  />
                </div>

                <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-3.5 space-y-3">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-sky-800 flex items-center gap-1.5">
                        <IdCard size={13} /> Pièce d’identité
                      </p>
                      <p className="text-[10px] text-sky-700/80 mt-0.5">
                        Photo ou PDF — max. 12 Mo. Utile au prochain check-in.
                      </p>
                    </div>
                    {hasIdDocument ? (
                      <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md bg-emerald-100 text-emerald-800">
                        Au dossier
                      </span>
                    ) : (
                      <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md bg-stone-200 text-stone-600">
                        Manquante
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black uppercase tracking-widest text-sky-700/70">Type</label>
                      <select
                        value={idDocKind}
                        onChange={(e) => setIdDocKind(e.target.value as ClientIdDocKind)}
                        className="w-full bg-white border border-sky-100 rounded-xl px-3 py-2.5 text-xs outline-none focus:border-sky-400"
                      >
                        {ID_DOC_KIND_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black uppercase tracking-widest text-sky-700/70">
                        Expire le (optionnel)
                      </label>
                      <input
                        type="date"
                        value={idDocExpiresAt}
                        onChange={(e) => setIdDocExpiresAt(e.target.value)}
                        className="w-full bg-white border border-sky-100 rounded-xl px-3 py-2.5 text-xs outline-none focus:border-sky-400"
                      />
                    </div>
                  </div>

                  {hasIdDocument && selectedProfile.idDocument ? (
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <a
                        href={selectedProfile.idDocument.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-700 text-white text-[10px] font-black uppercase tracking-widest hover:bg-sky-800"
                      >
                        <ExternalLink size={12} /> Voir
                      </a>
                      <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-sky-200 text-sky-800 text-[10px] font-black uppercase tracking-widest cursor-pointer hover:bg-sky-50">
                        {idDocUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                        Remplacer
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          disabled={idDocUploading}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            if (f) void handleUploadIdDocument(f);
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void handleSaveIdMeta()}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-sky-200 text-sky-800 text-[10px] font-black uppercase tracking-widest hover:bg-sky-50"
                      >
                        Sauver type / date
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRemoveIdDocument()}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-red-700 text-[10px] font-black uppercase tracking-widest hover:underline"
                      >
                        Retirer
                      </button>
                      <p className="w-full text-[10px] text-sky-800/70">
                        {selectedProfile.idDocument.kind}
                        {selectedProfile.idDocument.fileName ? ` · ${selectedProfile.idDocument.fileName}` : ''}
                        {selectedProfile.idDocument.uploadedAt
                          ? ` · ajoutée le ${formatDateFr(selectedProfile.idDocument.uploadedAt)}`
                          : ''}
                        {selectedProfile.idDocument.expiresAt
                          ? ` · expire le ${formatDateFr(selectedProfile.idDocument.expiresAt)}`
                          : ''}
                      </p>
                    </div>
                  ) : (
                    <label className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2.5 rounded-xl bg-sky-700 text-white text-[10px] font-black uppercase tracking-widest cursor-pointer hover:bg-sky-800 disabled:opacity-50">
                      {idDocUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                      {idDocUploading ? 'Envoi…' : 'Ajouter une pièce'}
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        disabled={idDocUploading || !lastNameInput.trim()}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (f) void handleUploadIdDocument(f);
                        }}
                      />
                    </label>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!dirty || isSaving || !lastNameInput.trim()}
                  className={`w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${dirty && !isSaving ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm' : 'bg-gray-100 text-gray-300 cursor-not-allowed'}`}
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {isSaving ? 'Enregistrement...' : hasDuplicates ? 'Enregistrer et fusionner les doublons' : 'Enregistrer la fiche'}
                </button>
              </div>

              {/* Séjours à venir */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600">
                  <CalendarDays size={13} className="text-white" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-white">
                    Séjours à venir ({upcomingStays.length})
                  </span>
                </div>
                <div className="divide-y divide-gray-50">
                  {upcomingStays.length === 0 ? (
                    <p className="text-center text-[11px] text-gray-400 py-6">Aucun séjour à venir.</p>
                  ) : (
                    upcomingStays.map((r) => <StayRow key={r.id || r.receiptId} receipt={r} onOpen={() => onOpenReceipt(r)} />)
                  )}
                </div>
              </div>

              {/* Séjours passés */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-700">
                  <History size={13} className="text-white" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-white">
                    Séjours passés ({pastStays.length})
                  </span>
                </div>
                <div className="divide-y divide-gray-50">
                  {loadingReceipts && pastStays.length === 0 ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 size={16} className="animate-spin text-gray-400" />
                    </div>
                  ) : pastStays.length === 0 ? (
                    <p className="text-center text-[11px] text-gray-400 py-6">Aucun séjour passé enregistré.</p>
                  ) : (
                    pastStays.map((r) => <StayRow key={r.id || r.receiptId} receipt={r} onOpen={() => onOpenReceipt(r)} />)
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StayRow({ receipt, onOpen }: { receipt: ReceiptData; onOpen: () => void }) {
  const segments = getReceiptSegments(receipt);
  const checkIns = receipt.checkInsBySegmentId || {};
  const checkOuts = receipt.checkOutsBySegmentId || {};
  const damages = segments
    .map((s) => checkOuts[s.id]?.damageNotes?.trim())
    .filter((n): n is string => !!n);
  const hasCheckInInfo = segments.some((s) => checkIns[s.id]);

  return (
    <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono font-bold text-gray-500">{receipt.receiptId}</span>
          {receipt.status === 'ANNULE' && (
            <span className="text-[8px] font-black uppercase bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Annulé</span>
          )}
        </div>
        {segments.map((s) => (
          <div key={s.id} className="flex items-center gap-2 flex-wrap">
            <AptBadge name={s.apartmentName || ''} />
            <span className="text-[11px] text-gray-600 font-bold">
              {formatDateFr(s.startDate)} → {formatDateFr(s.endDate)}
            </span>
          </div>
        ))}
        {hasCheckInInfo && (
          <div className="flex items-center gap-1.5 text-[10px] text-blue-600 font-bold">
            <ClipboardList size={11} /> Check-in enregistré
          </div>
        )}
        {damages.length > 0 && (
          <div className="flex items-start gap-1.5 text-[10px] text-orange-600 font-bold">
            <AlertTriangle size={11} className="shrink-0 mt-0.5" />
            <span>{damages.join(' · ')}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right">
          <p className="text-xs font-black text-gray-900">{formatCurrency(receipt.grandTotal || 0)}</p>
          <p className="text-[9px] font-bold uppercase text-gray-400">
            {receipt.remaining <= 0 ? 'Soldé' : `Reste ${formatCurrency(receipt.remaining)}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition-all"
          title="Ouvrir le reçu"
        >
          <ExternalLink size={15} />
        </button>
      </div>
    </div>
  );
}
