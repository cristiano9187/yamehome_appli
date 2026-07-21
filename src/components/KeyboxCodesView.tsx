import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  addDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import {
  KeyboxDwelling,
  KeyboxUnit,
  KeyboxContentEntry,
  KeyboxCodeHistoryEntry,
  KeyboxMovementLogEntry,
  KeyboxRemovalReason,
  KeyboxSite,
  UserProfile,
} from '../types';
import {
  isKeyboxGuardOnly,
  canOperateKeybox,
  canManageKeyboxCatalog,
  KEYBOX_REMOVAL_REASONS,
} from '../constants';
import { KEYBOX_DWELLINGS_SEED, KEYBOX_UNITS_SEED } from '../data/keyboxSeed';
import {
  Menu,
  KeyRound,
  Eye,
  EyeOff,
  Copy,
  Plus,
  Pencil,
  X,
  Search,
  Loader2,
  PackageMinus,
  LogOut,
  Lock,
  MapPin,
  History,
  Sparkles,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface KeyboxCodesViewProps {
  userProfile: UserProfile | null;
  onMenuClick?: () => void;
  onAlert: (message: string, type?: 'success' | 'error' | 'info') => void;
  /** Fournir un bouton de déconnexion (shell gardien restreint, pas de sidebar). */
  onLogout?: () => void;
  isMainAdminEmail?: (email?: string | null) => boolean;
}

const SITE_LABELS: Record<KeyboxSite, string> = {
  'MODENA YAMEHOME': 'Modena',
  'MATERA YAMEHOME': 'Matera',
  'RIETI YAMEHOME': 'Rieti',
};

const SITE_BADGE_CLASS: Record<KeyboxSite, string> = {
  'MODENA YAMEHOME': 'bg-blue-50 text-blue-700',
  'MATERA YAMEHOME': 'bg-violet-50 text-violet-700',
  'RIETI YAMEHOME': 'bg-orange-50 text-orange-700',
};

const ALL_SITES: KeyboxSite[] = ['RIETI YAMEHOME', 'MODENA YAMEHOME', 'MATERA YAMEHOME'];

function normalize(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function reasonLabel(reason?: KeyboxRemovalReason | null): string {
  return KEYBOX_REMOVAL_REASONS.find((r) => r.id === reason)?.label || 'Retrait';
}

function movementTypeClass(type: KeyboxMovementLogEntry['type']): string {
  switch (type) {
    case 'RETRAIT':
      return 'text-red-700';
    case 'DEPOT':
      return 'text-emerald-700';
    case 'CODE':
      return 'text-amber-700';
    default:
      return 'text-gray-600';
  }
}

function movementSummary(entry: KeyboxMovementLogEntry): { title: string; subtitle: string } {
  const dwelling = entry.dwellingShortLabel || '';
  switch (entry.type) {
    case 'RETRAIT': {
      const reason = reasonLabel(entry.reason);
      const note = entry.reasonNote ? ` — ${entry.reasonNote}` : '';
      return {
        title: dwelling ? `Retrait · ${dwelling}` : 'Retrait de clés',
        subtitle: `${reason}${note}`,
      };
    }
    case 'DEPOT':
      return {
        title: dwelling ? `Dépôt · ${dwelling}` : 'Dépôt de clés',
        subtitle: '',
      };
    case 'VIDE':
      return {
        title: 'Boîtier vidé',
        subtitle: dwelling || '',
      };
    case 'CODE':
      return {
        title: 'Changement de code',
        subtitle: '',
      };
    default:
      return { title: entry.type, subtitle: '' };
  }
}

function formatDateTimeFr(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Codes récemment utilisés sur ce boîtier (max 5) — affichage anti-doublon. */
function recentCodesForDisplay(box: KeyboxUnit): KeyboxCodeHistoryEntry[] {
  if (box.codeHistory.length > 0) return box.codeHistory.slice(0, 5);
  if (
    box.previousCode &&
    box.currentCode &&
    box.previousCode !== box.currentCode &&
    box.codeUpdatedAt
  ) {
    return [
      {
        code: box.previousCode,
        changedAt: box.codeUpdatedAt,
        changedByUid: box.codeUpdatedByUid || '',
        changedByName: box.codeUpdatedByName || '—',
      },
    ];
  }
  return [];
}

export default function KeyboxCodesView({
  userProfile,
  onMenuClick,
  onAlert,
  onLogout,
  isMainAdminEmail,
}: KeyboxCodesViewProps) {
  const isGuard = isKeyboxGuardOnly(userProfile);
  const canOperate = canOperateKeybox(userProfile);
  const canManage = canManageKeyboxCatalog(userProfile, isMainAdminEmail || (() => false));
  const guardAllowedSites = userProfile?.allowedSites || [];

  const [dwellings, setDwellings] = useState<KeyboxDwelling[]>([]);
  const [units, setUnits] = useState<KeyboxUnit[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<'boxes' | 'search'>('search');
  const [siteFilter, setSiteFilter] = useState<'ALL' | KeyboxSite>('ALL');
  const [search, setSearch] = useState('');
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const [seeding, setSeeding] = useState(false);

  /** Formulaire linéaire agent : code → clés oui/non → logement(s) */
  const [setupBoxId, setSetupBoxId] = useState<string | null>(null);
  const [setupCode, setSetupCode] = useState('');
  const [setupHasKeys, setSetupHasKeys] = useState<boolean>(false);
  const [setupDwellingIds, setSetupDwellingIds] = useState<string[]>([]);
  const [setupConfirmDuplicate, setSetupConfirmDuplicate] = useState(false);
  const [savingSetup, setSavingSetup] = useState(false);

  const [retrieveBoxId, setRetrieveBoxId] = useState<string | null>(null);
  const [retrieveSelection, setRetrieveSelection] = useState<string[]>([]);
  const [retrieveReason, setRetrieveReason] = useState<KeyboxRemovalReason>('REMIS_AU_CLIENT');
  const [retrieveNote, setRetrieveNote] = useState('');
  const [savingRetrieve, setSavingRetrieve] = useState(false);

  const [boxFormOpen, setBoxFormOpen] = useState(false);
  const [editingBoxId, setEditingBoxId] = useState<string | null>(null);
  const [boxForm, setBoxForm] = useState<{ letter: string; site: KeyboxSite; active: boolean }>({
    letter: '',
    site: 'MODENA YAMEHOME',
    active: true,
  });
  const [savingBox, setSavingBox] = useState(false);

  const [dwellingFormOpen, setDwellingFormOpen] = useState(false);
  const [dwellingForm, setDwellingForm] = useState({ shortLabel: '', officialLabel: '', site: 'MODENA YAMEHOME' as KeyboxSite, unitSlug: '' });
  const [savingDwelling, setSavingDwelling] = useState(false);

  useEffect(() => {
    const unsub1 = onSnapshot(
      collection(db, 'keybox_dwellings'),
      (snap) => {
        setDwellings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as KeyboxDwelling)));
      },
      (err) => {
        console.error(err);
        onAlert('Impossible de charger le catalogue des logements.', 'error');
      }
    );
    const unsub2 = onSnapshot(
      collection(db, 'keybox_units'),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as KeyboxUnit))
          .sort((a, b) => a.letter.localeCompare(b.letter));
        setUnits(list);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
        onAlert('Impossible de charger les boîtiers.', 'error');
      }
    );
    return () => {
      unsub1();
      unsub2();
    };
  }, [onAlert]);

  const dwellingMap = useMemo(() => new Map(dwellings.map((d) => [d.id!, d])), [dwellings]);

  const actor = () => ({
    actorUid: auth.currentUser?.uid || userProfile?.uid || '',
    actorName: userProfile?.displayName || userProfile?.email || 'Agent',
  });

  const visibleUnits = useMemo(() => {
    let list = units;
    if (isGuard) {
      list = list.filter((u) => guardAllowedSites.includes(u.site));
    }
    if (siteFilter !== 'ALL') {
      list = list.filter((u) => u.site === siteFilter);
    }
    const q = normalize(search);
    if (q) {
      list = list.filter((u) => {
        if (normalize(u.letter).includes(q)) return true;
        return u.contents.some((c) => normalize(c.dwellingShortLabel).includes(q));
      });
    }
    return list.filter((u) => u.active !== false || canManage);
  }, [units, isGuard, guardAllowedSites, siteFilter, search, canManage]);

  const visibleDwellings = useMemo(() => {
    let list = dwellings.filter((d) => d.active !== false);
    if (isGuard) {
      list = list.filter((d) => guardAllowedSites.includes(d.site));
    }
    if (siteFilter !== 'ALL') {
      list = list.filter((d) => d.site === siteFilter);
    }
    const q = normalize(search);
    if (q) {
      list = list.filter(
        (d) => normalize(d.shortLabel).includes(q) || normalize(d.officialLabel).includes(q)
      );
    }
    return list.sort((a, b) => a.shortLabel.localeCompare(b.shortLabel, 'fr'));
  }, [dwellings, isGuard, guardAllowedSites, siteFilter, search]);

  function locateDwelling(dwellingId: string): { box: KeyboxUnit | null; lastMovement: KeyboxMovementLogEntry | null; lastBoxLetter: string | null } {
    for (const u of units) {
      if (u.contents.some((c) => c.dwellingId === dwellingId)) {
        return { box: u, lastMovement: null, lastBoxLetter: null };
      }
    }
    let last: KeyboxMovementLogEntry | null = null;
    let lastBoxLetter: string | null = null;
    for (const u of units) {
      for (const m of u.movementLog) {
        if (m.dwellingId === dwellingId && m.type === 'RETRAIT') {
          if (!last || m.at > last.at) {
            last = m;
            lastBoxLetter = u.letter;
          }
        }
      }
    }
    return { box: null, lastMovement: last, lastBoxLetter };
  }

  function toggleReveal(key: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      onAlert('Code copié.', 'success');
    } catch {
      onAlert('Impossible de copier le code.', 'error');
    }
  }

  function openSetup(box: KeyboxUnit) {
    setSetupBoxId(box.id || null);
    setSetupCode(box.currentCode || '');
    setSetupHasKeys(box.contents.length > 0);
    setSetupDwellingIds(box.contents.map((c) => c.dwellingId));
    setSetupConfirmDuplicate(false);
  }

  function isDuplicateCode(box: KeyboxUnit, value: string): boolean {
    if (!value) return false;
    if (box.currentCode === value || box.previousCode === value) return true;
    return box.codeHistory.some((h) => h.code === value);
  }

  async function handleConfirmSetup() {
    if (!setupBoxId) return;
    const box = units.find((u) => u.id === setupBoxId);
    if (!box) return;

    const code = setupCode.trim();
    if (!code) {
      onAlert('Le code du boîtier est obligatoire.', 'error');
      return;
    }
    if (setupHasKeys && setupDwellingIds.length === 0) {
      onAlert('Indiquez au moins un logement si des clés sont dans le boîtier.', 'error');
      return;
    }
    if (isDuplicateCode(box, code) && code !== box.currentCode && !setupConfirmDuplicate) {
      setSetupConfirmDuplicate(true);
      return;
    }

    setSavingSetup(true);
    try {
      const { actorUid, actorName } = actor();
      const now = new Date().toISOString();
      const batch = writeBatch(db);
      const newMovementLog: KeyboxMovementLogEntry[] = [...box.movementLog];

      const codeChanged = code !== box.currentCode;
      let codePatch: Record<string, unknown> = {};
      if (codeChanged) {
        const history = box.currentCode
          ? [{ code: box.currentCode, changedAt: now, changedByUid: actorUid, changedByName: actorName }, ...box.codeHistory].slice(0, 5)
          : box.codeHistory;
        codePatch = {
          previousCode: box.currentCode,
          currentCode: code,
          codeHistory: history,
          codeUpdatedAt: now,
          codeUpdatedByUid: actorUid,
          codeUpdatedByName: actorName,
        };
        newMovementLog.unshift({ type: 'CODE', actorUid, actorName, at: now });
      }

      const targetDwellingIds = setupHasKeys ? setupDwellingIds : [];
      const prevIds = new Set(box.contents.map((c) => c.dwellingId));
      const nextIds = new Set(targetDwellingIds);

      const added = targetDwellingIds.filter((id) => !prevIds.has(id));
      const removed = box.contents.filter((c) => !nextIds.has(c.dwellingId)).map((c) => c.dwellingId);

      for (const id of added) {
        newMovementLog.unshift({
          type: 'DEPOT',
          dwellingId: id,
          dwellingShortLabel: dwellingMap.get(id)?.shortLabel || id,
          actorUid,
          actorName,
          at: now,
        });
      }
      for (const id of removed) {
        newMovementLog.unshift({
          type: setupHasKeys ? 'RETRAIT' : 'VIDE',
          dwellingId: id,
          dwellingShortLabel: dwellingMap.get(id)?.shortLabel || id,
          actorUid,
          actorName,
          at: now,
        });
      }

      const newContents: KeyboxContentEntry[] = targetDwellingIds.map((id) => ({
        dwellingId: id,
        dwellingShortLabel: dwellingMap.get(id)?.shortLabel || id,
        sinceAt: prevIds.has(id) ? box.contents.find((c) => c.dwellingId === id)?.sinceAt || now : now,
      }));

      batch.update(doc(db, 'keybox_units', setupBoxId), {
        ...codePatch,
        contents: newContents,
        contentsUpdatedAt: now,
        contentsUpdatedByUid: actorUid,
        contentsUpdatedByName: actorName,
        movementLog: newMovementLog.slice(0, 10),
        updatedAt: now,
      });

      for (const other of units) {
        if (other.id === setupBoxId) continue;
        const transferIds = other.contents.filter((c) => targetDwellingIds.includes(c.dwellingId)).map((c) => c.dwellingId);
        if (transferIds.length === 0) continue;
        const remaining = other.contents.filter((c) => !targetDwellingIds.includes(c.dwellingId));
        const movs: KeyboxMovementLogEntry[] = transferIds.map((id) => ({
          type: 'RETRAIT',
          dwellingId: id,
          dwellingShortLabel: dwellingMap.get(id)?.shortLabel || id,
          reason: 'TRANSFERT',
          actorUid,
          actorName,
          at: now,
        }));
        batch.update(doc(db, 'keybox_units', other.id!), {
          contents: remaining,
          contentsUpdatedAt: now,
          contentsUpdatedByUid: actorUid,
          contentsUpdatedByName: actorName,
          movementLog: [...movs, ...other.movementLog].slice(0, 10),
          updatedAt: now,
        });
      }

      await batch.commit();
      onAlert('Boîtier enregistré.', 'success');
      setSetupBoxId(null);
      setSetupConfirmDuplicate(false);
    } catch (err) {
      console.error(err);
      onAlert("Erreur lors de l'enregistrement.", 'error');
    } finally {
      setSavingSetup(false);
    }
  }

  // --- Retirer des clés ---
  function openRetrieve(boxId: string) {
    const box = units.find((u) => u.id === boxId);
    const contentIds = box?.contents.map((c) => c.dwellingId) ?? [];
    setRetrieveBoxId(boxId);
    // Une seule clé dans le boîtier → présélectionnée (cas le plus fréquent)
    setRetrieveSelection(contentIds.length === 1 ? contentIds : []);
    setRetrieveReason('REMIS_AU_CLIENT');
    setRetrieveNote('');
  }

  async function handleConfirmRetrieve() {
    if (!retrieveBoxId) return;
    if (retrieveSelection.length === 0) {
      onAlert('Sélectionnez au moins une clé à retirer.', 'error');
      return;
    }
    const box = units.find((u) => u.id === retrieveBoxId);
    if (!box) return;
    setSavingRetrieve(true);
    try {
      const { actorUid, actorName } = actor();
      const now = new Date().toISOString();
      const remaining = box.contents.filter((c) => !retrieveSelection.includes(c.dwellingId));
      const movs: KeyboxMovementLogEntry[] = retrieveSelection.map((id) => ({
        type: 'RETRAIT',
        dwellingId: id,
        dwellingShortLabel: dwellingMap.get(id)?.shortLabel || id,
        reason: retrieveReason,
        reasonNote: retrieveNote.trim() || null,
        actorUid,
        actorName,
        at: now,
      }));
      await updateDoc(doc(db, 'keybox_units', retrieveBoxId), {
        contents: remaining,
        contentsUpdatedAt: now,
        contentsUpdatedByUid: actorUid,
        contentsUpdatedByName: actorName,
        movementLog: [...movs, ...box.movementLog].slice(0, 10),
        updatedAt: now,
      });
      onAlert('Retrait des clés enregistré.', 'success');
      setRetrieveBoxId(null);
      setRetrieveSelection([]);
      setRetrieveNote('');
    } catch (err) {
      console.error(err);
      onAlert('Erreur lors du retrait des clés.', 'error');
    } finally {
      setSavingRetrieve(false);
    }
  }

  // --- Admin : CRUD boîtiers ---
  function openCreateBox() {
    setEditingBoxId(null);
    setBoxForm({ letter: '', site: 'MODENA YAMEHOME', active: true });
    setBoxFormOpen(true);
  }

  function openEditBox(box: KeyboxUnit) {
    setEditingBoxId(box.id || null);
    setBoxForm({ letter: box.letter, site: box.site, active: box.active !== false });
    setBoxFormOpen(true);
  }

  async function handleSaveBox(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const letter = boxForm.letter.trim();
    if (!letter) {
      onAlert('La lettre du boîtier est obligatoire.', 'error');
      return;
    }
    setSavingBox(true);
    try {
      const { actorUid } = actor();
      const now = new Date().toISOString();
      if (editingBoxId) {
        await updateDoc(doc(db, 'keybox_units', editingBoxId), {
          letter,
          site: boxForm.site,
          active: boxForm.active,
          updatedAt: now,
        });
        onAlert('Boîtier mis à jour.', 'success');
      } else {
        await addDoc(collection(db, 'keybox_units'), {
          letter,
          site: boxForm.site,
          active: true,
          currentCode: null,
          previousCode: null,
          codeUpdatedAt: null,
          codeUpdatedByUid: null,
          codeUpdatedByName: null,
          codeHistory: [],
          contents: [],
          contentsUpdatedAt: null,
          contentsUpdatedByUid: null,
          contentsUpdatedByName: null,
          movementLog: [],
          createdAt: now,
          updatedAt: now,
          authorUid: actorUid,
        });
        onAlert('Boîtier créé.', 'success');
      }
      setBoxFormOpen(false);
      setEditingBoxId(null);
    } catch (err) {
      console.error(err);
      onAlert("Erreur lors de l'enregistrement du boîtier.", 'error');
    } finally {
      setSavingBox(false);
    }
  }

  // --- Admin : catalogue logements ---
  function openCreateDwelling() {
    setDwellingForm({ shortLabel: '', officialLabel: '', site: 'MODENA YAMEHOME', unitSlug: '' });
    setDwellingFormOpen(true);
  }

  async function handleSaveDwelling(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const shortLabel = dwellingForm.shortLabel.trim();
    const officialLabel = dwellingForm.officialLabel.trim() || shortLabel;
    if (!shortLabel) {
      onAlert('Le nom court est obligatoire.', 'error');
      return;
    }
    setSavingDwelling(true);
    try {
      const { actorUid } = actor();
      const now = new Date().toISOString();
      await addDoc(collection(db, 'keybox_dwellings'), {
        shortLabel,
        officialLabel,
        site: dwellingForm.site,
        unitSlug: dwellingForm.unitSlug.trim() || null,
        active: true,
        createdAt: now,
        updatedAt: now,
        authorUid: actorUid,
      });
      onAlert('Logement ajouté au catalogue.', 'success');
      setDwellingFormOpen(false);
    } catch (err) {
      console.error(err);
      onAlert("Erreur lors de l'ajout du logement.", 'error');
    } finally {
      setSavingDwelling(false);
    }
  }

  async function handleToggleDwellingActive(d: KeyboxDwelling) {
    if (!canManage || !d.id) return;
    try {
      await updateDoc(doc(db, 'keybox_dwellings', d.id), {
        active: !d.active,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error(err);
      onAlert('Erreur lors de la mise à jour.', 'error');
    }
  }

  // --- Seed initial ---
  async function handleSeed() {
    if (!canManage) return;
    setSeeding(true);
    try {
      const { actorUid, actorName } = actor();
      const now = new Date().toISOString();
      const batch = writeBatch(db);
      const seedMap = new Map(KEYBOX_DWELLINGS_SEED.map((d) => [d.id, d]));
      for (const d of KEYBOX_DWELLINGS_SEED) {
        batch.set(doc(db, 'keybox_dwellings', d.id), {
          shortLabel: d.shortLabel,
          officialLabel: d.officialLabel,
          site: d.site,
          unitSlug: d.unitSlug,
          active: true,
          createdAt: now,
          updatedAt: now,
          authorUid: actorUid,
        });
      }
      for (const u of KEYBOX_UNITS_SEED) {
        const contents: KeyboxContentEntry[] = u.dwellingIds.map((id) => ({
          dwellingId: id,
          dwellingShortLabel: seedMap.get(id)?.shortLabel || id,
          sinceAt: now,
        }));
        const movementLog: KeyboxMovementLogEntry[] = u.dwellingIds.map((id) => ({
          type: 'DEPOT',
          dwellingId: id,
          dwellingShortLabel: seedMap.get(id)?.shortLabel || id,
          actorUid,
          actorName,
          at: now,
        }));
        batch.set(doc(db, 'keybox_units', u.letter), {
          letter: u.letter,
          site: u.site,
          active: true,
          currentCode: u.code,
          previousCode: u.code,
          codeUpdatedAt: now,
          codeUpdatedByUid: actorUid,
          codeUpdatedByName: actorName,
          codeHistory: [],
          contents,
          contentsUpdatedAt: now,
          contentsUpdatedByUid: actorUid,
          contentsUpdatedByName: actorName,
          movementLog,
          createdAt: now,
          updatedAt: now,
          authorUid: actorUid,
        });
      }
      await batch.commit();
      onAlert('Import initial des boîtiers et logements effectué.', 'success');
    } catch (err) {
      console.error(err);
      onAlert("Erreur lors de l'import initial.", 'error');
    } finally {
      setSeeding(false);
    }
  }

  const showSeedBanner = canManage && !loading && units.length === 0;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F5F5F4] min-h-[50vh]">
        <Loader2 className="animate-spin text-slate-900" size={32} />
      </div>
    );
  }

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
            <KeyRound className="text-amber-600 shrink-0" size={18} />
            Codes keybox
          </h2>
          <p className="text-[10px] font-mono text-gray-400 font-bold mt-0.5">
            {isGuard ? 'Gardien · consultation & retrait' : 'Boîtiers de clés — Yaoundé'}
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openCreateBox}
            className="shrink-0 flex items-center gap-2 px-3 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all touch-manipulation"
          >
            <Plus size={14} />
            Boîtier
          </button>
        )}
        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className="shrink-0 p-2.5 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all touch-manipulation"
            title="Se déconnecter"
          >
            <LogOut size={16} />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className="max-w-4xl mx-auto p-4 md:p-6 pb-24 space-y-4">
          {showSeedBanner && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <Sparkles className="text-amber-600 shrink-0" size={20} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black uppercase tracking-widest text-amber-900">Aucun boîtier pour le moment</p>
                <p className="text-[11px] text-amber-800 mt-0.5">
                  Importer les 8 boîtiers et le catalogue de logements (Yaoundé) depuis la feuille du 20/07/2026.
                </p>
              </div>
              <button
                type="button"
                onClick={handleSeed}
                disabled={seeding}
                className="shrink-0 px-4 py-2.5 bg-amber-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2 touch-manipulation"
              >
                {seeding ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
                Importer
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTab('search')}
              className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                tab === 'search' ? 'bg-slate-900 text-white' : 'bg-white text-gray-500 border border-gray-200'
              }`}
            >
              Où sont les clés ?
            </button>
            <button
              type="button"
              onClick={() => setTab('boxes')}
              className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                tab === 'boxes' ? 'bg-slate-900 text-white' : 'bg-white text-gray-500 border border-gray-200'
              }`}
            >
              Boîtiers
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSiteFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                  siteFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                Tous
              </button>
              {ALL_SITES.filter((s) => !isGuard || guardAllowedSites.includes(s)).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSiteFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                    siteFilter === s ? 'bg-slate-900 text-white' : `${SITE_BADGE_CLASS[s]} hover:opacity-80`
                  }`}
                >
                  {SITE_LABELS[s]}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tab === 'boxes' ? 'Rechercher une lettre, un logement…' : 'Rechercher un logement…'}
                className="w-full pl-9 pr-3 py-3 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:border-amber-500 transition-all"
              />
            </div>
          </div>

          {tab === 'boxes' ? (
            visibleUnits.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
                <KeyRound size={32} className="mx-auto text-gray-300 mb-3" />
                <p className="text-sm text-gray-500">Aucun boîtier pour ces filtres.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <AnimatePresence>
                  {visibleUnits.map((box) => {
                    const currentKey = `${box.id}:current`;
                    const recentCodes = recentCodesForDisplay(box);
                    const isEmpty = box.contents.length === 0;
                    return (
                      <motion.div
                        key={box.id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className={`bg-white rounded-2xl border shadow-sm p-4 ${
                          box.active === false ? 'border-dashed border-gray-300 opacity-70' : 'border-gray-100'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-4">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-black uppercase tracking-wide text-gray-400">Boîtier {box.letter}</span>
                            <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md ${SITE_BADGE_CLASS[box.site]}`}>
                              {SITE_LABELS[box.site]}
                            </span>
                            {box.active === false && (
                              <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500">
                                Inactif
                              </span>
                            )}
                          </div>
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => openEditBox(box)}
                              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-all shrink-0"
                              title="Modifier le boîtier"
                            >
                              <Pencil size={14} />
                            </button>
                          )}
                        </div>

                        {/* Code actuel — élément principal de la carte */}
                        <div className="flex items-center justify-center gap-3 py-2 mb-4">
                          <span className="text-5xl sm:text-6xl font-black tracking-[0.15em] text-gray-900 tabular-nums">
                            {box.currentCode ? (revealed.has(currentKey) ? box.currentCode : '••••') : '—'}
                          </span>
                          {box.currentCode && (
                            <div className="flex flex-col gap-1.5">
                              <button
                                type="button"
                                onClick={() => toggleReveal(currentKey)}
                                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all"
                                title={revealed.has(currentKey) ? 'Masquer' : 'Afficher'}
                              >
                                {revealed.has(currentKey) ? <EyeOff size={15} /> : <Eye size={15} />}
                              </button>
                              {revealed.has(currentKey) && (
                                <button
                                  type="button"
                                  onClick={() => copyCode(box.currentCode!)}
                                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all"
                                  title="Copier"
                                >
                                  <Copy size={15} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-center mb-4">
                          {isEmpty ? (
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                              Boîtier vide
                            </span>
                          ) : (
                            <div className="flex flex-wrap justify-center gap-1.5">
                              {box.contents.map((c) => (
                                <span
                                  key={c.dwellingId}
                                  className="inline-flex items-center gap-1 text-sm font-black px-3 py-1 rounded-lg bg-gray-100 text-gray-700"
                                >
                                  {c.dwellingShortLabel}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {(recentCodes.length > 0 || (box.movementLog?.length ?? 0) > 0) && (
                          <details className="group border-t border-gray-100 pt-3 mb-1">
                            <summary className="list-none flex items-center justify-center gap-1 text-[9px] font-black uppercase tracking-widest text-gray-400 cursor-pointer select-none hover:text-gray-600">
                              <History size={11} />
                              Historique
                            </summary>
                            <div className="mt-3 space-y-3">
                              {recentCodes.length > 0 && (
                                <div>
                                  <p className="text-[9px] font-black uppercase text-gray-400 mb-1.5">Anciens codes</p>
                                  <ul className="space-y-1">
                                    {recentCodes.map((entry, idx) => (
                                      <li
                                        key={`${entry.code}-${entry.changedAt}-${idx}`}
                                        className="flex items-center justify-between gap-2 text-xs"
                                      >
                                        <span className="font-bold tracking-widest tabular-nums text-gray-600">
                                          {entry.code}
                                        </span>
                                        <span className="text-[10px] text-gray-400 truncate text-right">
                                          {formatDateTimeFr(entry.changedAt)} · {entry.changedByName}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {(box.movementLog?.length ?? 0) > 0 && (
                                <div>
                                  <p className="text-[9px] font-black uppercase text-gray-400 mb-1.5">Derniers mouvements</p>
                                  <ul className="space-y-2">
                                    {box.movementLog.slice(0, 2).map((entry, idx) => {
                                      const { title, subtitle } = movementSummary(entry);
                                      return (
                                        <li key={`${entry.type}-${entry.at}-${idx}`}>
                                          <div className="flex items-start justify-between gap-2">
                                            <span className={`text-xs font-bold ${movementTypeClass(entry.type)}`}>{title}</span>
                                            <span className="text-[10px] text-gray-400 shrink-0 text-right">
                                              {formatDateTimeFr(entry.at)}
                                            </span>
                                          </div>
                                          <p className="text-[10px] text-gray-500 mt-0.5">
                                            {[subtitle, entry.actorName].filter(Boolean).join(' · ')}
                                          </p>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </details>
                        )}

                        <div className="flex flex-wrap gap-2 mt-4">
                          {canOperate && (
                            <button
                              type="button"
                              onClick={() => openSetup(box)}
                              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all touch-manipulation w-full sm:w-auto justify-center"
                            >
                              <Pencil size={13} />
                              Mettre à jour
                            </button>
                          )}
                          {!isEmpty && (
                            <button
                              type="button"
                              onClick={() => openRetrieve(box.id!)}
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 text-red-700 text-[10px] font-black uppercase tracking-widest hover:bg-red-100 transition-all touch-manipulation"
                            >
                              <PackageMinus size={13} />
                              Retirer
                            </button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )
          ) : visibleDwellings.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
              <MapPin size={32} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm text-gray-500">Aucun logement pour ces filtres.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleDwellings.map((d) => {
                const { box, lastMovement, lastBoxLetter } = locateDwelling(d.id!);
                const codeKey = box ? `${box.id}:current` : '';
                return (
                  <div key={d.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-lg sm:text-xl font-black text-gray-900 leading-tight break-words">
                          {d.shortLabel}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5 leading-snug break-words">
                          {d.officialLabel}
                        </p>
                      </div>
                      {box ? (
                        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 shrink-0">
                          <span className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-black text-sm shrink-0">
                            {box.letter}
                          </span>
                          <span className="text-sm font-black uppercase tracking-wide text-emerald-800 whitespace-nowrap">
                            Box {box.letter}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 shrink-0">
                          <span className="text-sm font-black uppercase tracking-wide text-gray-400 whitespace-nowrap">
                            Hors box
                          </span>
                        </div>
                      )}
                    </div>
                    {box ? (
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                        <span className="text-4xl font-black tracking-[0.12em] text-gray-900 tabular-nums">
                          {revealed.has(codeKey) ? box.currentCode : '••••'}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleReveal(codeKey)}
                          className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all"
                          title={revealed.has(codeKey) ? 'Masquer' : 'Afficher'}
                        >
                          {revealed.has(codeKey) ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                        {revealed.has(codeKey) && (
                          <button
                            type="button"
                            onClick={() => copyCode(box.currentCode!)}
                            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all"
                            title="Copier"
                          >
                            <Copy size={16} />
                          </button>
                        )}
                      </div>
                    ) : (
                      lastMovement && (
                        <p className="text-[11px] text-gray-400 leading-snug mt-2 pt-2 border-t border-gray-100">
                          {reasonLabel(lastMovement.reason)} du boîtier {lastBoxLetter}
                          {lastMovement.actorName ? ` · ${lastMovement.actorName}` : ''} · {formatDateTimeFr(lastMovement.at)}
                        </p>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {canManage && (
            <details className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <summary className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-gray-500 cursor-pointer hover:bg-gray-50 select-none">
                Catalogue des logements ({dwellings.length})
              </summary>
              <div className="px-4 pb-4 space-y-2 border-t border-gray-100">
                <div className="flex justify-end pt-3">
                  <button
                    type="button"
                    onClick={openCreateDwelling}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all"
                  >
                    <Plus size={13} />
                    Ajouter un logement
                  </button>
                </div>
                {dwellings.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-2 py-2 border-b border-gray-50 last:border-0">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-gray-800 truncate">{d.shortLabel} <span className="text-gray-400 font-normal">· {d.officialLabel}</span></p>
                      <span className={`inline-block mt-0.5 text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${SITE_BADGE_CLASS[d.site]}`}>{SITE_LABELS[d.site]}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleDwellingActive(d)}
                      className="shrink-0 px-2.5 py-1.5 rounded-lg bg-gray-100 text-[9px] font-black uppercase text-gray-600 hover:bg-gray-200"
                    >
                      {d.active ? 'Désactiver' : 'Réactiver'}
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>

      {/* Modal linéaire agent : code → clés → logement(s) */}
      <AnimatePresence>
        {setupBoxId && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              <div className="flex items-center justify-between p-5 border-b border-gray-100 shrink-0">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Étape par étape</p>
                  <h3 className="text-sm font-black uppercase tracking-widest">
                    Boîtier {units.find((u) => u.id === setupBoxId)?.letter}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSetupBoxId(null);
                    setSetupConfirmDuplicate(false);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-full"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 space-y-5 overflow-y-auto flex-1">
                {/* 1. Code */}
                <div>
                  <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                    <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[9px] flex items-center justify-center">1</span>
                    Code du boîtier
                  </label>
                  <input
                    autoFocus
                    inputMode="numeric"
                    value={setupCode}
                    onChange={(e) => {
                      setSetupCode(e.target.value);
                      setSetupConfirmDuplicate(false);
                    }}
                    placeholder="Ex. 1987"
                    className="w-full px-4 py-3.5 bg-gray-50 rounded-xl text-xl font-black tracking-widest text-center outline-none focus:ring-2 focus:ring-slate-900"
                  />
                  {(() => {
                    const setupBox = units.find((u) => u.id === setupBoxId);
                    const recent = setupBox ? recentCodesForDisplay(setupBox) : [];
                    if (recent.length === 0) return null;
                    return (
                      <div className="mt-3 bg-amber-50 border border-amber-100 rounded-xl p-3">
                        <p className="text-[9px] font-black uppercase text-amber-800/70 mb-2">
                          Codes déjà utilisés récemment sur ce boîtier
                        </p>
                        <ul className="space-y-1">
                          {recent.map((entry, idx) => (
                            <li key={`${entry.code}-${entry.changedAt}-${idx}`} className="flex justify-between gap-2 text-xs">
                              <span className="font-black tracking-widest tabular-nums text-gray-700">{entry.code}</span>
                              <span className="text-[10px] text-gray-500 shrink-0">{formatDateTimeFr(entry.changedAt)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()}
                </div>

                {/* 2. Clés à l'intérieur ? */}
                <div>
                  <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                    <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[9px] flex items-center justify-center">2</span>
                    Clés à l'intérieur ?
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setSetupHasKeys(true);
                        if (setupDwellingIds.length === 0) {
                          const box = units.find((u) => u.id === setupBoxId);
                          if (box && box.contents.length > 0) {
                            setSetupDwellingIds(box.contents.map((c) => c.dwellingId));
                          }
                        }
                      }}
                      className={`py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all touch-manipulation ${
                        setupHasKeys
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      Oui, des clés
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSetupHasKeys(false);
                        setSetupDwellingIds([]);
                      }}
                      className={`py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all touch-manipulation ${
                        !setupHasKeys
                          ? 'bg-gray-700 border-gray-700 text-white'
                          : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      Non, boîtier vide
                    </button>
                  </div>
                  {!setupHasKeys && (
                    <p className="text-[11px] text-gray-500 mt-2">
                      Seul le code sera enregistré — aucun logement attribué.
                    </p>
                  )}
                </div>

                {/* 3. Logement(s) — si clés */}
                {setupHasKeys && (
                  <div>
                    <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                      <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[9px] flex items-center justify-center">3</span>
                      Logement ou local
                    </label>
                    <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                      {dwellings
                        .filter((d) => d.active !== false && d.site === units.find((u) => u.id === setupBoxId)?.site)
                        .map((d) => {
                          const { box: currentBox } = locateDwelling(d.id!);
                          const isSelected = setupDwellingIds.includes(d.id!);
                          return (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() =>
                                setSetupDwellingIds((prev) =>
                                  prev.includes(d.id!) ? prev.filter((x) => x !== d.id) : [...prev, d.id!]
                                )
                              }
                              className={`w-full flex items-center justify-between gap-2 px-3 py-3 rounded-xl border text-left transition-all touch-manipulation ${
                                isSelected ? 'bg-emerald-50 border-emerald-300' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                              }`}
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-black text-gray-900">{d.shortLabel}</p>
                                <p className="text-[11px] text-gray-400 truncate">{d.officialLabel}</p>
                              </div>
                              {currentBox && currentBox.id !== setupBoxId && (
                                <span className="shrink-0 text-[9px] font-black uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                                  boîtier {currentBox.letter}
                                </span>
                              )}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}

                {setupConfirmDuplicate && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                    <History size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-800">
                      Ce code a déjà été utilisé récemment sur ce boîtier. Confirmer quand même ?
                    </p>
                  </div>
                )}
              </div>

              <div className="p-5 border-t border-gray-100 shrink-0">
                <button
                  type="button"
                  onClick={handleConfirmSetup}
                  disabled={savingSetup}
                  className={`w-full py-3.5 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2 transition-all touch-manipulation ${
                    setupConfirmDuplicate ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-slate-900 hover:bg-black text-white'
                  }`}
                >
                  {savingSetup ? <Loader2 className="animate-spin" size={16} /> : null}
                  {setupConfirmDuplicate ? 'Confirmer malgré tout' : 'Enregistrer'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Retirer des clés */}
      <AnimatePresence>
        {retrieveBoxId && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="text-sm font-black uppercase tracking-widest">
                  Retirer des clés — Boîtier {units.find((u) => u.id === retrieveBoxId)?.letter}
                </h3>
                <button type="button" onClick={() => setRetrieveBoxId(null)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X size={18} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                    Clés à retirer {retrieveSelection.length === 0 && '(touchez pour sélectionner)'}
                  </label>
                  <div className="space-y-2">
                  {(units.find((u) => u.id === retrieveBoxId)?.contents || []).map((c) => {
                    const isSelected = retrieveSelection.includes(c.dwellingId);
                    return (
                      <button
                        key={c.dwellingId}
                        type="button"
                        onClick={() =>
                          setRetrieveSelection((prev) =>
                            prev.includes(c.dwellingId) ? prev.filter((x) => x !== c.dwellingId) : [...prev, c.dwellingId]
                          )
                        }
                        className={`w-full flex items-center justify-between px-3 py-3 rounded-xl border text-left transition-all touch-manipulation ${
                          isSelected ? 'bg-red-50 border-red-400 ring-2 ring-red-200' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        <span className="text-sm font-black text-gray-900">{c.dwellingShortLabel}</span>
                        <span className={`text-[10px] font-black uppercase ${isSelected ? 'text-red-600' : 'text-gray-400'}`}>
                          {isSelected ? '✓ Sélectionné' : 'Toucher'}
                        </span>
                      </button>
                    );
                  })}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Raison du retrait</label>
                  <div className="flex flex-wrap gap-2">
                    {KEYBOX_REMOVAL_REASONS.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setRetrieveReason(r.id)}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                          retrieveReason === r.id ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                {retrieveReason === 'AUTRE' && (
                  <input
                    value={retrieveNote}
                    onChange={(e) => setRetrieveNote(e.target.value)}
                    placeholder="Précision courte…"
                    className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-red-500"
                  />
                )}
                <button
                  type="button"
                  onClick={handleConfirmRetrieve}
                  disabled={savingRetrieve}
                  className={`w-full py-3.5 rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 touch-manipulation transition-all ${
                    retrieveSelection.length === 0
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-red-600 text-white hover:bg-red-700'
                  } disabled:opacity-50`}
                >
                  {savingRetrieve ? <Loader2 className="animate-spin" size={16} /> : <PackageMinus size={16} />}
                  Confirmer le retrait
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Admin : créer/modifier boîtier */}
      <AnimatePresence>
        {boxFormOpen && canManage && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="text-sm font-black uppercase tracking-widest">
                  {editingBoxId ? 'Modifier le boîtier' : 'Nouveau boîtier'}
                </h3>
                <button type="button" onClick={() => setBoxFormOpen(false)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleSaveBox} className="p-5 space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Lettre</label>
                  <input
                    required
                    value={boxForm.letter}
                    onChange={(e) => setBoxForm((f) => ({ ...f, letter: e.target.value.toUpperCase() }))}
                    maxLength={4}
                    className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-900"
                    placeholder="Ex. K"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Site</label>
                  <select
                    value={boxForm.site}
                    onChange={(e) => setBoxForm((f) => ({ ...f, site: e.target.value as KeyboxSite }))}
                    className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    {ALL_SITES.map((s) => (
                      <option key={s} value={s}>{SITE_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                {editingBoxId && (
                  <label className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={boxForm.active}
                      onChange={(e) => setBoxForm((f) => ({ ...f, active: e.target.checked }))}
                      className="rounded border-gray-300"
                    />
                    Boîtier actif
                  </label>
                )}
                <button
                  type="submit"
                  disabled={savingBox}
                  className="w-full py-3.5 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {savingBox ? <Loader2 className="animate-spin" size={16} /> : null}
                  {editingBoxId ? 'Enregistrer' : 'Créer'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Admin : ajouter un logement au catalogue */}
      <AnimatePresence>
        {dwellingFormOpen && canManage && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <h3 className="text-sm font-black uppercase tracking-widest">Nouveau logement</h3>
                <button type="button" onClick={() => setDwellingFormOpen(false)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleSaveDwelling} className="p-5 space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Nom court (terrain)</label>
                  <input
                    required
                    value={dwellingForm.shortLabel}
                    onChange={(e) => setDwellingForm((f) => ({ ...f, shortLabel: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-900"
                    placeholder="Ex. B10 205"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Nom officiel</label>
                  <input
                    value={dwellingForm.officialLabel}
                    onChange={(e) => setDwellingForm((f) => ({ ...f, officialLabel: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-900"
                    placeholder="Nom affiché en petit"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Site</label>
                  <select
                    value={dwellingForm.site}
                    onChange={(e) => setDwellingForm((f) => ({ ...f, site: e.target.value as KeyboxSite }))}
                    className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    {ALL_SITES.map((s) => (
                      <option key={s} value={s}>{SITE_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Slug unité (optionnel)</label>
                  <input
                    value={dwellingForm.unitSlug}
                    onChange={(e) => setDwellingForm((f) => ({ ...f, unitSlug: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-900"
                    placeholder="Ex. matera-deluxe"
                  />
                </div>
                <button
                  type="submit"
                  disabled={savingDwelling}
                  className="w-full py-3.5 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {savingDwelling ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                  Ajouter
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {isGuard && (
        <div className="shrink-0 bg-white border-t border-gray-100 px-4 py-2.5 flex items-center justify-center gap-2 text-[10px] text-gray-400">
          <Lock size={11} />
          Accès gardien — consultation & retrait uniquement
        </div>
      )}
    </div>
  );
}
