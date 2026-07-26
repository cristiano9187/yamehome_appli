import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ClientProfile, ClientProfileSeed, Prospect, ReceiptData, UserProfile } from '../types';
import { formatCurrency } from '../constants';
import { getReceiptSegments } from '../utils/receiptSegments';
import { AptBadge, PhoneLinks, parseApartment } from '../utils/aptDisplay';
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
} from 'lucide-react';

interface ClientsViewProps {
  onMenuClick?: () => void;
  userProfile: UserProfile | null;
  onAlert: (message: string, type?: 'info' | 'error' | 'success') => void;
  onOpenReceipt: (receipt: ReceiptData) => void;
  /** Identité (nom/tel/email) à sélectionner automatiquement — reçu cliqué, ligne d'historique, recherche "Client intelligent". */
  initialSeed?: ClientProfileSeed | null;
}

type ContactLike = { firstName?: string; lastName?: string; phone?: string; email?: string };

/** Fiche client fusionnée : regroupe fiches + reçus + prospects désignant la même personne. */
interface MergedClient extends ClientProfile {
  _key: string;
  /** Toutes les combinaisons nom/tél/email vues (fiches + reçus + prospects) pour retrouver tout l'historique. */
  _variants: ClientProfileSeed[];
  /** Documents Firestore `clients/{id}` fusionnés dans cette fiche (0, 1 ou plusieurs si doublons détectés). */
  _clientDocIds: string[];
  /**
   * True si la personne est connue via un prospect et n'a jamais eu de vrai séjour (aucun reçu).
   * Badge « P » — indépendant du statut prospect (ouvert, perdu, annulé, converti sans reçu).
   */
  _isProspectOnly: boolean;
  /** Dernier logement demandé en tant que prospect (nom TARIFS complet), si connu. */
  _interestedApartment: string | null;
  /** Dates demandées sur ce dernier prospect (YYYY-MM-DD), si connues. */
  _interestedStartDate: string | null;
  _interestedEndDate: string | null;
}

const normalizeString = (value: string) => (value || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Compare sur les 9 derniers chiffres : tolère les variantes +237 / 00237 / espaces / tirets. */
function normalizePhoneDigits(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length < 8) return '';
  return digits.slice(-9);
}

function normalizeFullName(firstName?: string, lastName?: string): string {
  return normalizeString(`${firstName || ''} ${lastName || ''}`);
}

/** Deux identités désignent la même personne si email, téléphone (chiffres) ou nom complet coïncident. */
function sameContact(a: ContactLike, b: ContactLike): boolean {
  const emailA = normalizeString(a.email || '');
  const emailB = normalizeString(b.email || '');
  if (emailA && emailA.includes('@') && emailA === emailB) return true;
  const phoneA = normalizePhoneDigits(a.phone || '');
  const phoneB = normalizePhoneDigits(b.phone || '');
  if (phoneA && phoneA === phoneB) return true;
  const nameA = normalizeFullName(a.firstName, a.lastName);
  const nameB = normalizeFullName(b.firstName, b.lastName);
  if (nameA && nameA.includes(' ') && nameA === nameB) return true;
  return false;
}

function identityKeyOf(c: ContactLike): string {
  return normalizeString(`${c.firstName || ''}|${c.lastName || ''}|${c.phone || ''}|${c.email || ''}`);
}

function formatDateFr(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return iso;
  return d.toLocaleDateString('fr-FR');
}

/** Libellé court « RIETI — Emeraude studio » à partir du nom TARIFS. */
function formatInterestedByLabel(apartmentName: string): string {
  let cleaned = (apartmentName || '')
    .replace(/\bYAMEHOME\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Si des dates ont été collées dans le nom du logement, on les retire du libellé.
  cleaned = cleaned
    .replace(/[\s\-–—]*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}([\s\-–—]+\d{1,2}[./-]\d{1,2}[./-]\d{2,4})?\s*$/g, '')
    .trim();
  const apt = parseApartment(cleaned || apartmentName);
  let unit = (apt.unit || '')
    .replace(/\bAPPARTEMENT\b/gi, '')
    .replace(/\bMODE\b/gi, '')
    .replace(/\s*[-–—]\s*/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
  if (unit) {
    unit = unit
      .toLowerCase()
      .replace(/(^|[ ·])(\S)/g, (_, sep, ch) => sep + ch.toUpperCase());
  }
  if (unit && unit !== apt.site) return `${apt.site} — ${unit}`;
  return apt.site || cleaned || apartmentName;
}

/** Plage compacte : « 11–12/07/2026 » si même mois, sinon « 11/07 → 15/08 ». */
function formatInterestedDatesCompact(startDate?: string | null, endDate?: string | null): string | null {
  if (!startDate && !endDate) return null;
  if (!startDate || !endDate) return formatDateFr(startDate || endDate || '');
  const [ys, ms, ds] = startDate.split('-').map(Number);
  const [ye, me, de] = endDate.split('-').map(Number);
  if (ys && ms && ds && ye && me && de && ys === ye && ms === me) {
    return `${String(ds).padStart(2, '0')}–${String(de).padStart(2, '0')}/${String(ms).padStart(2, '0')}/${ys}`;
  }
  return `${formatDateFr(startDate)} → ${formatDateFr(endDate)}`;
}

function ProspectInterestLine({
  apartment,
  startDate,
  endDate,
  compact = false,
}: {
  apartment: string | null;
  startDate: string | null;
  endDate: string | null;
  compact?: boolean;
}) {
  const aptLabel = apartment ? formatInterestedByLabel(apartment) : null;
  const datesLabel = formatInterestedDatesCompact(startDate, endDate);
  if (!aptLabel && !datesLabel) return null;
  return (
    <p className={`truncate ${compact ? 'text-[10px] mt-0.5' : 'text-[11px] mt-0.5'}`}>
      {aptLabel ? (
        <span className="text-violet-700 font-semibold">Intéressé par : {aptLabel}</span>
      ) : (
        <span className="text-violet-700 font-semibold">Dates demandées</span>
      )}
      {datesLabel && (
        <>
          <span className="text-gray-300 mx-1">·</span>
          <span className="text-gray-500 font-medium tabular-nums">{datesLabel}</span>
        </>
      )}
    </p>
  );
}

/**
 * Regroupe fiches `clients` + reçus + tous les prospects (ouverts, perdus, annulés, convertis)
 * par personne réelle. Badge « P » seulement si aucun reçu n'est rattaché (jamais réservé).
 */
function buildMergedDirectory(
  clients: ClientProfile[],
  receipts: ReceiptData[],
  prospects: Prospect[]
): MergedClient[] {
  type Candidate = ContactLike & {
    createdAt: string;
    updatedAt: string;
    authorUid: string;
    preferences?: string;
    notes?: string;
    docId?: string;
    /** Provenance : reçu (séjour effectif, même annulé). */
    fromRealStay?: boolean;
    /** Provenance : prospect (quel que soit le statut — données précieuses). */
    fromProspect?: boolean;
    apartmentName?: string;
    startDate?: string;
    endDate?: string;
  };

  const candidates: Candidate[] = [];
  clients.forEach((c) => {
    candidates.push({
      firstName: c.firstName || '',
      lastName: c.lastName || '',
      phone: c.phone || '',
      email: c.email || '',
      createdAt: c.createdAt || new Date().toISOString(),
      updatedAt: c.updatedAt || c.createdAt || new Date().toISOString(),
      authorUid: c.authorUid || '',
      preferences: c.preferences,
      notes: c.notes,
      docId: c.id,
    });
  });
  receipts.forEach((r) => {
    if (!r.lastName?.trim()) return;
    candidates.push({
      firstName: r.firstName || '',
      lastName: r.lastName || '',
      phone: r.phone || '',
      email: r.email || '',
      createdAt: r.createdAt || new Date().toISOString(),
      updatedAt: r.createdAt || new Date().toISOString(),
      authorUid: r.authorUid || '',
      fromRealStay: true,
    });
  });
  prospects.forEach((p) => {
    if (!p.lastName?.trim()) return;
    candidates.push({
      firstName: p.firstName || '',
      lastName: p.lastName || '',
      phone: p.phone || '',
      email: p.email || '',
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
      authorUid: p.authorUid || '',
      notes: p.notes,
      fromProspect: true,
      apartmentName: (p.apartmentName || '').trim() || undefined,
      startDate: (p.startDate || '').trim() || undefined,
      endDate: (p.endDate || '').trim() || undefined,
    });
  });

  const parent = candidates.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (i: number, j: number) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  };

  const phoneBuckets = new Map<string, number[]>();
  const emailBuckets = new Map<string, number[]>();
  const nameBuckets = new Map<string, number[]>();
  candidates.forEach((c, i) => {
    const p = normalizePhoneDigits(c.phone || '');
    if (p) {
      if (!phoneBuckets.has(p)) phoneBuckets.set(p, []);
      phoneBuckets.get(p)!.push(i);
    }
    const e = normalizeString(c.email || '');
    if (e && e.includes('@')) {
      if (!emailBuckets.has(e)) emailBuckets.set(e, []);
      emailBuckets.get(e)!.push(i);
    }
    const n = normalizeFullName(c.firstName, c.lastName);
    if (n && n.includes(' ')) {
      if (!nameBuckets.has(n)) nameBuckets.set(n, []);
      nameBuckets.get(n)!.push(i);
    }
  });
  [phoneBuckets, emailBuckets, nameBuckets].forEach((buckets) => {
    buckets.forEach((idxs) => {
      for (let k = 1; k < idxs.length; k++) union(idxs[0], idxs[k]);
    });
  });

  const clusters = new Map<number, Candidate[]>();
  candidates.forEach((c, i) => {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(c);
  });

  const merged: MergedClient[] = [];
  clusters.forEach((group) => {
    const registered = group.filter((g) => g.docId).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const byRecency = group.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    // Préférer une fiche client / un reçu à un prospect pour le libellé affiché.
    const base =
      registered[0] ||
      byRecency.find((g) => g.fromRealStay) ||
      byRecency.find((g) => !g.fromProspect) ||
      byRecency[0];
    const phone = base.phone || group.find((g) => g.phone)?.phone || '';
    const email = base.email || group.find((g) => g.email)?.email || '';
    const preferences = registered.find((g) => g.preferences?.trim())?.preferences;
    const notes =
      registered.find((g) => g.notes?.trim())?.notes ||
      group.find((g) => g.notes?.trim())?.notes;
    const createdAt = group.reduce((min, g) => (g.createdAt && g.createdAt < min ? g.createdAt : min), base.createdAt);
    const hasRealStay = group.some((g) => g.fromRealStay);
    const hasProspect = group.some((g) => g.fromProspect);
    const isProspectOnly = hasProspect && !hasRealStay;
    // Dernier prospect avec au moins un logement ou des dates (le plus récemment mis à jour).
    const latestProspectContext = group
      .filter((g) => g.fromProspect && (g.apartmentName || g.startDate || g.endDate))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
    const interestedApartment = isProspectOnly ? (latestProspectContext?.apartmentName || null) : null;
    const interestedStartDate = isProspectOnly ? (latestProspectContext?.startDate || null) : null;
    const interestedEndDate = isProspectOnly ? (latestProspectContext?.endDate || null) : null;
    const variants: ClientProfileSeed[] = group.map((g) => ({
      firstName: g.firstName || '',
      lastName: g.lastName || '',
      phone: g.phone || '',
      email: g.email || '',
    }));
    const entry: MergedClient = {
      id: base.docId,
      firstName: base.firstName || '',
      lastName: base.lastName || '',
      phone,
      email,
      preferences,
      notes,
      createdAt,
      updatedAt: base.updatedAt,
      authorUid: base.authorUid || '',
      _key: identityKeyOf(base),
      _variants: variants,
      _clientDocIds: registered.map((g) => g.docId!).filter(Boolean),
      // P = arrivé via prospect et jamais réservé (aucun reçu).
      _isProspectOnly: isProspectOnly,
      _interestedApartment: interestedApartment,
      _interestedStartDate: interestedStartDate,
      _interestedEndDate: interestedEndDate,
    };
    merged.push(entry);
  });

  return merged.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
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
  const [dirty, setDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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

  const isLoading = loadingClients || loadingReceipts || loadingProspects;
  const hasDuplicates = (selectedProfile?._clientDocIds.length || 0) > 1;

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
            Coordonnées, préférences, historique — P = prospect jamais réservé
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
                      <div className="min-w-0">
                        <p className={`text-xs font-black uppercase truncate ${isSelected ? 'text-blue-700' : 'text-gray-800'}`}>
                          {c.firstName} {c.lastName}
                        </p>
                        {c._isProspectOnly && (
                          <ProspectInterestLine
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
                          <ProspectInterestLine
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
