import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { ClientProfile, Prospect, ReceiptData } from '../types';
import { buildMergedDirectory, MergedClient } from '../utils/contactDirectory';

export function useContactDirectory(enabled = true) {
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [receipts, setReceipts] = useState<ReceiptData[]>([]);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [loadingProspects, setLoadingProspects] = useState(true);
  const [loadingReceipts, setLoadingReceipts] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    const qClients = query(collection(db, 'clients'), orderBy('lastName'));
    const unsubClients = onSnapshot(
      qClients,
      (snap) => {
        setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClientProfile)));
        setLoadingClients(false);
      },
      () => setLoadingClients(false)
    );

    const qProspects = query(collection(db, 'prospects'), orderBy('updatedAt', 'desc'));
    const unsubProspects = onSnapshot(
      qProspects,
      (snap) => {
        setProspects(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Prospect)));
        setLoadingProspects(false);
      },
      () => setLoadingProspects(false)
    );

    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'receipts'), orderBy('createdAt', 'desc'), limit(500))
        );
        if (!cancelled) {
          setReceipts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ReceiptData)));
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoadingReceipts(false);
      }
    })();

    return () => {
      cancelled = true;
      unsubClients();
      unsubProspects();
    };
  }, [enabled]);

  const mergedContacts = useMemo(
    () => buildMergedDirectory(clients, receipts, prospects),
    [clients, receipts, prospects]
  );

  return {
    clients,
    receipts,
    prospects,
    mergedContacts,
    loading: loadingClients || loadingProspects || loadingReceipts,
  };
}

export type { MergedClient };
