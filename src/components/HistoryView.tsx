import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot,
  doc,
  updateDoc,
  getDocs,
  where,
  limit 
} from 'firebase/firestore';
import { db } from '../firebase';
import { ReceiptData, UserProfile, AgentProfile } from '../types';
import { formatCurrency, SITE_MAPPING } from '../constants';
import { 
  Search, 
  FileText, 
  ExternalLink, 
  Printer, 
  Calendar,
  Menu,
  User as UserIcon,
  CreditCard,
  ChevronRight,
  Clock,
  Banknote,
  ShieldCheck,
  Copy
} from 'lucide-react';
import { motion } from 'motion/react';

interface HistoryViewProps {
  onEdit: (receipt: ReceiptData) => void;
  onPrint: (receipt: ReceiptData) => void;
  onMenuClick?: () => void;
  userProfile: UserProfile | null;
  onAlert: (message: string, type?: 'info' | 'error' | 'success') => void;
}

export default function HistoryView({ onEdit, onPrint, onMenuClick, userProfile, onAlert }: HistoryViewProps) {
  const [receipts, setReceipts] = useState<ReceiptData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [displayLimit, setDisplayLimit] = useState(15);
  const [firestoreLimit, setFirestoreLimit] = useState(50);
  const [expandedApartmentId, setExpandedApartmentId] = useState<string | null>(null);
  const [commissionAgentKey, setCommissionAgentKey] = useState('');
  const [agentPayInfo, setAgentPayInfo] = useState<AgentProfile | null>(null);

  // Close expanded apartment on click outside
  useEffect(() => {
    const handleClickOutside = () => setExpandedApartmentId(null);
    window.addEventListener('pointerdown', handleClickOutside);
    return () => window.removeEventListener('pointerdown', handleClickOutside);
  }, []);

  const handleRefundCaution = async (receipt: ReceiptData, method: string) => {
    if (!receipt.id) return;
    try {
      const docRef = doc(db, 'receipts', receipt.id);
      await updateDoc(docRef, {
        isCautionRefunded: true,
        cautionRefundDate: new Date().toISOString(),
        cautionRefundMethod: method
      });
      onAlert("Caution remboursée avec succès !", "success");
    } catch (error) {
      console.error("Error updating refund status:", error);
      onAlert("Erreur lors du remboursement de la caution", "error");
    }
  };

  const handleMarkCommissionPaid = async (receipt: ReceiptData) => {
    if (!receipt.id) return;
    try {
      const docRef = doc(db, 'receipts', receipt.id);
      await updateDoc(docRef, {
        isCommissionPaid: true
      });
      onAlert("Commission marquée comme payée.", "success");
    } catch (error) {
      console.error("Error updating commission status:", error);
      onAlert("Erreur lors de la mise à jour de la commission", "error");
    }
  };

  useEffect(() => {
    const q = query(collection(db, 'receipts'), orderBy('createdAt', 'desc'), limit(firestoreLimit));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ReceiptData[];
      setReceipts(data);
      setLoading(false);
    });
    return unsubscribe;
  }, [firestoreLimit]);

  const permissionFilteredReceipts = useMemo(() => {
    const isMainAdmin = userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' || userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
    const isAdmin = userProfile?.role === 'admin' || isMainAdmin;
    const allowedSites = userProfile?.allowedSites || [];
    const allowedApartments = isAdmin ? [] : allowedSites.flatMap(site => SITE_MAPPING[site] || []);
    return receipts.filter(r => isAdmin || allowedApartments.includes(r.apartmentName));
  }, [receipts, userProfile]);

  const unpaidCommissionsByAgent = useMemo(() => {
    const map = new Map<string, ReceiptData[]>();
    for (const r of permissionFilteredReceipts) {
      if (r.status === 'ANNULE') continue;
      const name = (r.agentName || '').trim();
      if (!name) continue;
      if (r.isCommissionPaid) continue;
      const amt = r.commissionAmount ?? 0;
      if (amt <= 0) continue;
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(r);
    }
    for (const [, list] of map) {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return map;
  }, [permissionFilteredReceipts]);

  const commissionAgentNames = useMemo(() => {
    const names: string[] = [...unpaidCommissionsByAgent.keys()];
    return names.sort((a, b) => a.localeCompare(b, 'fr'));
  }, [unpaidCommissionsByAgent]);

  useEffect(() => {
    if (!commissionAgentKey.trim()) {
      setAgentPayInfo(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const q = query(
          collection(db, 'agents'),
          where('name', '==', commissionAgentKey.trim()),
          limit(1)
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        if (!snap.empty) {
          setAgentPayInfo({ id: snap.docs[0].id, ...snap.docs[0].data() } as AgentProfile);
        } else {
          setAgentPayInfo(null);
        }
      } catch {
        if (!cancelled) setAgentPayInfo(null);
      }
    })();
    return () => { cancelled = true; };
  }, [commissionAgentKey]);

  const selectedUnpaidReceipts = commissionAgentKey
    ? (unpaidCommissionsByAgent.get(commissionAgentKey) || [])
    : [];

  const selectedUnpaidTotal = selectedUnpaidReceipts.reduce(
    (s, r) => s + (r.commissionAmount || 0),
    0
  );

  const copyCommissionPaymentSheet = async () => {
    if (!commissionAgentKey || selectedUnpaidReceipts.length === 0) {
      onAlert('Choisissez un agent avec des commissions impayées.', 'info');
      return;
    }
    const lines = selectedUnpaidReceipts.map(
      r => `- ${r.receiptId} : ${formatCurrency(r.commissionAmount || 0)} (${r.firstName} ${r.lastName})`
    );
    let text = `Commissions à payer — ${commissionAgentKey}\n`;
    text += `Total: ${formatCurrency(selectedUnpaidTotal)}\n`;
    text += `Nombre de reçus: ${selectedUnpaidReceipts.length}\n\n`;
    text += `Détail:\n${lines.join('\n')}\n`;
    if (agentPayInfo?.preferredPaymentMethod || agentPayInfo?.paymentReference) {
      text += `\nPaiement préféré: ${agentPayInfo.preferredPaymentMethod || '-'}`;
      if (agentPayInfo.paymentReference) text += ` | ${agentPayInfo.paymentReference}`;
      text += '\n';
    }
    try {
      await navigator.clipboard.writeText(text);
      onAlert('Récap copié dans le presse-papiers.', 'success');
    } catch {
      onAlert('Impossible de copier (navigateur).', 'error');
    }
  };

  const filteredReceipts = receipts.filter(r => {
    const matchesSearch = r.receiptId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      `${r.firstName} ${r.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.apartmentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.agentName && r.agentName.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const isMainAdmin = userProfile?.email?.toLowerCase() === 'christian.yamepi@gmail.com' || userProfile?.email?.toLowerCase() === 'cyamepi@gmail.com';
    const isAdmin = userProfile?.role === 'admin' || isMainAdmin;

    const allowedSites = userProfile?.allowedSites || [];
    const allowedApartments = isAdmin ? [] : allowedSites.flatMap(site => SITE_MAPPING[site] || []);

    const isAllowed = isAdmin || allowedApartments.includes(r.apartmentName);
    
    return matchesSearch && isAllowed;
  });

  const displayedReceipts = filteredReceipts.slice(0, displayLimit);

  const handleLoadMore = () => {
    setDisplayLimit(prev => prev + 15);
    if (displayLimit + 15 >= firestoreLimit) {
      setFirestoreLimit(prev => prev + 50);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F5F5F4]">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div 
      className="flex-1 flex flex-col md:h-full bg-[#F5F5F4] md:overflow-hidden"
      onClick={() => setExpandedApartmentId(null)}
    >
      {/* Header */}
      <div className="h-auto md:h-20 bg-white border-b border-gray-200 px-4 md:px-8 py-4 md:py-0 flex flex-col md:flex-row items-start md:items-center justify-between sticky top-0 z-40 gap-4">
        <div className="flex items-center gap-4">
          {onMenuClick && (
            <button 
              onClick={(e) => {
                e.stopPropagation();
                onMenuClick();
              }} 
              className="md:hidden p-2 hover:bg-gray-100 rounded-xl transition-all"
            >
              <Menu size={20} />
            </button>
          )}
          <div className="flex flex-col">
            <h2 className="text-sm font-black uppercase tracking-widest">Historique des Reçus</h2>
            <span className="text-[10px] font-mono text-gray-400 font-bold">{filteredReceipts.length} enregistrements</span>
          </div>
        </div>

        <div className="relative w-full md:w-96">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input 
            type="text" 
            placeholder="Rechercher par ID, Nom ou Logement..." 
            className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-12 pr-4 text-xs outline-none focus:border-blue-500 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 md:overflow-y-auto p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-4">
          {commissionAgentNames.length > 0 && (
            <div
              className="bg-white rounded-2xl border border-orange-200 shadow-sm p-4 md:p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-orange-700">
                    <Banknote size={14} />
                    Paiement des commissions (aperçu rapide)
                  </div>
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    Choisissez un agent pour voir le total impayé, le détail par reçu et copier un texte prêt à coller (avec mode de paiement si la fiche agent est renseignée).
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <select
                      className="flex-1 bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-3 text-xs font-bold outline-none focus:border-orange-400"
                      value={commissionAgentKey}
                      onChange={(e) => setCommissionAgentKey(e.target.value)}
                    >
                      <option value="">— Agent avec commissions impayées —</option>
                      {commissionAgentNames.map((name) => {
                        const list = unpaidCommissionsByAgent.get(name) || [];
                        const total = list.reduce((s, r) => s + (r.commissionAmount || 0), 0);
                        return (
                          <option key={name} value={name}>
                            {name} — {formatCurrency(total)} ({list.length} reçu{list.length > 1 ? 's' : ''})
                          </option>
                        );
                      })}
                    </select>
                    <button
                      type="button"
                      onClick={() => commissionAgentKey && setSearchTerm(commissionAgentKey)}
                      className="shrink-0 px-4 py-2.5 rounded-xl bg-gray-100 border border-gray-200 text-[10px] font-black uppercase tracking-widest text-gray-700 hover:bg-gray-200 transition-all"
                    >
                      Filtrer l&apos;historique
                    </button>
                  </div>
                  {commissionAgentKey && (
                    <div className="rounded-xl bg-orange-50/80 border border-orange-100 p-3 space-y-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-lg font-black text-orange-900">{formatCurrency(selectedUnpaidTotal)}</span>
                        <span className="text-[10px] font-bold text-orange-700 uppercase">
                          {selectedUnpaidReceipts.length} ligne{selectedUnpaidReceipts.length > 1 ? 's' : ''}
                        </span>
                      </div>
                      {agentPayInfo && (agentPayInfo.preferredPaymentMethod || agentPayInfo.paymentReference) && (
                        <p className="text-[11px] text-gray-700">
                          <span className="font-black text-gray-500 uppercase text-[9px]">Paiement</span>{' '}
                          {agentPayInfo.preferredPaymentMethod || '—'}
                          {agentPayInfo.paymentReference ? ` · ${agentPayInfo.paymentReference}` : ''}
                        </p>
                      )}
                      {!agentPayInfo && (
                        <p className="text-[10px] text-gray-500 italic">
                          Aucune fiche agent en base pour ce nom — renseignez OM/MTN dans le formulaire reçu puis enregistrez la fiche agent.
                        </p>
                      )}
                      <ul className="max-h-28 overflow-y-auto text-[10px] text-gray-600 space-y-1 font-mono">
                        {selectedUnpaidReceipts.map((r) => (
                          <li key={r.id}>
                            {r.receiptId} · {formatCurrency(r.commissionAmount || 0)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={copyCommissionPaymentSheet}
                  disabled={!commissionAgentKey || selectedUnpaidReceipts.length === 0}
                  className="shrink-0 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-orange-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-orange-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Copy size={14} />
                  Copier le récap
                </button>
              </div>
            </div>
          )}

          {/* Desktop Table View */}
          <div className="hidden md:block bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto">
            <div className="min-w-[700px]">
              <div className="grid grid-cols-12 gap-4 p-4 bg-gray-50 border-b border-gray-100 text-[10px] font-black uppercase tracking-widest text-gray-400">
                <div className="col-span-1">ID Reçu</div>
                <div className="col-span-2">Client</div>
                <div className="col-span-2">Logement</div>
                <div className="col-span-2">Montant</div>
                <div className="col-span-2">Commission</div>
                <div className="col-span-2">Caution</div>
                <div className="col-span-1 text-right">Actions</div>
              </div>

              <div className="divide-y divide-gray-50">
                {displayedReceipts.map((receipt) => {
                  const deadline = new Date(receipt.startDate);
                  deadline.setDate(deadline.getDate() + 1);
                  const isOverdue = new Date() > deadline;

                  const refundDeadline = receipt.endDate ? new Date(receipt.endDate) : null;
                  if (refundDeadline) refundDeadline.setHours(refundDeadline.getHours() + 24);
                  const isRefundOverdue = refundDeadline && new Date() > refundDeadline;
                  const hasCaution = receipt.totalPaid >= receipt.grandTotal && receipt.cautionAmount && receipt.cautionAmount > 0;

                  return (
                    <motion.div 
                      key={receipt.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-blue-50/30 transition-all group"
                    >
                      <div className="col-span-1">
                        <div className="flex flex-col">
                          <span className="text-xs font-mono font-bold text-gray-900">{receipt.receiptId}</span>
                          <div className="flex items-center gap-1">
                            <span className="text-[9px] text-gray-400 flex items-center gap-1">
                              <Clock size={8} />
                              {new Date(receipt.createdAt).toLocaleDateString('fr-FR')}
                            </span>
                            {receipt.status === 'ANNULE' && (
                              <span className="text-[8px] font-black bg-red-100 text-red-600 px-1 rounded uppercase">Annulé</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="col-span-2">
                        <div className="flex items-center gap-2">
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-gray-900 uppercase tracking-tight truncate max-w-[100px]">
                              {receipt.firstName} {receipt.lastName}
                            </span>
                            <span className="text-[10px] text-gray-400">{receipt.phone || 'Pas de tél'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="col-span-2">
                        <div className="flex flex-col relative">
                          <span 
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              setExpandedApartmentId(expandedApartmentId === receipt.id ? null : receipt.id);
                            }}
                            className={`text-xs font-medium cursor-pointer transition-all duration-300 block ${
                              expandedApartmentId === receipt.id 
                                ? 'text-blue-700 bg-blue-50 p-2 rounded-lg shadow-md z-50 relative whitespace-normal break-words ring-1 ring-blue-200' 
                                : 'text-gray-700 truncate max-w-[120px] border-b border-dotted border-gray-400'
                            }`}
                          >
                            {receipt.apartmentName}
                          </span>
                          <span className="text-[9px] text-blue-600 font-bold uppercase tracking-widest">
                            {receipt.calendarSlug || 'Standard'}
                          </span>
                        </div>
                      </div>

                      <div className="col-span-2">
                        <div className="flex flex-col">
                          <span className="text-xs font-black text-gray-900">
                            {formatCurrency(receipt.grandTotal)}
                          </span>
                          <div className="flex items-center gap-1">
                            <div className={`w-1.5 h-1.5 rounded-full ${receipt.remaining <= 0 ? 'bg-green-500' : 'bg-orange-500'}`} />
                            <span className="text-[9px] font-bold uppercase tracking-tighter">
                              {receipt.remaining <= 0 ? 'Soldé' : `Reste: ${formatCurrency(receipt.remaining)}`}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="col-span-2">
                        {receipt.agentName ? (
                          <div className="flex flex-col">
                            <div className={`flex items-center gap-1 ${receipt.isCommissionPaid ? 'text-green-600' : 'text-orange-600'}`}>
                              <Banknote size={10} />
                              <span className="text-xs font-black">{formatCurrency(receipt.commissionAmount || 0)}</span>
                            </div>
                            <span className="text-[9px] font-bold text-gray-500 uppercase truncate max-w-[100px]">{receipt.agentName}</span>
                            {receipt.isCommissionPaid ? (
                              <div className="text-[8px] font-black uppercase mt-1 px-1.5 py-0.5 rounded inline-flex w-fit bg-green-100 text-green-600">
                                Payée
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1 mt-1">
                                <div className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded inline-flex w-fit ${isOverdue ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                                  Délai: {deadline.toLocaleDateString('fr-FR')}
                                </div>
                                <button
                                  onClick={() => handleMarkCommissionPaid(receipt)}
                                  className="text-[7px] font-black uppercase bg-orange-50 border border-orange-200 text-orange-700 px-1 py-0.5 rounded transition-all w-fit"
                                >
                                  Marquer payée
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-300 italic">Aucun agent</span>
                        )}
                      </div>

                      <div className="col-span-2">
                        {hasCaution ? (
                          <div className="flex flex-col">
                            <div className={`flex items-center gap-1 ${receipt.isCautionRefunded ? 'text-green-600' : 'text-blue-600'}`}>
                              <ShieldCheck size={10} />
                              <span className="text-xs font-black">{formatCurrency(receipt.cautionAmount || 0)}</span>
                            </div>
                            {receipt.isCautionRefunded ? (
                              <div className="flex flex-col mt-1">
                                <span className="text-[8px] font-black uppercase bg-green-100 text-green-600 px-1.5 py-0.5 rounded w-fit">Remboursée</span>
                                <span className="text-[7px] text-gray-400 font-bold mt-0.5">
                                  {new Date(receipt.cautionRefundDate!).toLocaleDateString('fr-FR')} via {receipt.cautionRefundMethod}
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col mt-1 gap-1">
                                <div className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded w-fit ${isRefundOverdue ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                                  Délai: {refundDeadline?.toLocaleDateString('fr-FR')}
                                </div>
                                <div className="flex gap-1">
                                  <button 
                                    onClick={() => handleRefundCaution(receipt, 'Espèces')}
                                    className="text-[7px] font-black uppercase bg-gray-100 hover:bg-gray-200 px-1 py-0.5 rounded transition-all"
                                  >
                                    Espèces
                                  </button>
                                  <button 
                                    onClick={() => handleRefundCaution(receipt, 'Mobile')}
                                    className="text-[7px] font-black uppercase bg-gray-100 hover:bg-gray-200 px-1 py-0.5 rounded transition-all"
                                  >
                                    Mobile
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-300 italic">Aucune caution</span>
                        )}
                      </div>

                      <div className="col-span-1 flex justify-end gap-2">
                        <button 
                          onClick={() => onEdit(receipt)}
                          className="p-2 hover:bg-blue-100 text-blue-600 rounded-lg transition-all"
                          title="Editer"
                        >
                          <ExternalLink size={16} />
                        </button>
                        <button 
                          onClick={() => onPrint(receipt)}
                          className="p-2 hover:bg-gray-100 text-gray-900 rounded-lg transition-all"
                          title="Imprimer PDF"
                        >
                          <Printer size={16} />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-4">
            {displayedReceipts.map((receipt) => {
              const hasCaution = receipt.totalPaid >= receipt.grandTotal && receipt.cautionAmount && receipt.cautionAmount > 0;
              const refundDeadline = receipt.endDate ? new Date(receipt.endDate) : null;
              if (refundDeadline) refundDeadline.setHours(refundDeadline.getHours() + 24);
              const isRefundOverdue = refundDeadline && new Date() > refundDeadline;

              return (
                <motion.div 
                  key={receipt.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-4 relative ${expandedApartmentId === receipt.id ? 'z-50' : 'z-0'}`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black uppercase tracking-widest text-blue-600">{receipt.receiptId}</span>
                      <span className="text-sm font-black uppercase text-gray-900">{receipt.firstName} {receipt.lastName}</span>
                      <span className="text-[10px] text-gray-400 font-bold">{new Date(receipt.createdAt).toLocaleDateString('fr-FR')}</span>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => onEdit(receipt)}
                        className="p-2 bg-blue-50 text-blue-600 rounded-xl"
                        title="Editer"
                      >
                        <ExternalLink size={16} />
                      </button>
                      <button 
                        onClick={() => onPrint(receipt)}
                        className="p-2 bg-gray-50 text-gray-900 rounded-xl"
                        title="Imprimer"
                      >
                        <Printer size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 py-3 border-y border-gray-50">
                    <div className="flex flex-col flex-1 min-w-0 relative">
                      <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">Logement</span>
                      <div 
                        className="relative"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setExpandedApartmentId(expandedApartmentId === receipt.id ? null : receipt.id);
                        }}
                      >
                        <span className="text-xs font-bold text-gray-700 truncate border-b border-dotted border-gray-400 block cursor-pointer">
                          {receipt.apartmentName}
                        </span>
                        
                        {expandedApartmentId === receipt.id && (
                          <div className="absolute left-0 top-full mt-1 w-full min-w-[200px] bg-white shadow-2xl rounded-xl p-3 z-[100] border-2 border-blue-500 animate-in fade-in zoom-in duration-200 pointer-events-none">
                            <div className="flex flex-col gap-1">
                              <span className="text-[8px] font-black uppercase text-blue-600 tracking-widest">Logement Complet</span>
                              <span className="text-xs font-black text-gray-900 uppercase leading-tight whitespace-normal break-words">
                                {receipt.apartmentName}
                              </span>
                              <span className="text-[9px] text-blue-600 font-bold uppercase tracking-widest mt-1">
                                {receipt.calendarSlug || 'Standard'}
                              </span>
                            </div>
                            {/* Arrow */}
                            <div className="absolute left-4 bottom-full border-8 border-transparent border-b-blue-500" />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">Total</span>
                      <span className="text-xs font-black text-gray-900">{formatCurrency(receipt.grandTotal)}</span>
                    </div>
                  </div>

                  {/* Commission & Caution Details */}
                  <div className="space-y-3">
                    {receipt.agentName && (
                      <div className="flex items-center justify-between bg-gray-50 p-2 rounded-lg">
                        <div className="flex flex-col">
                          <span className="text-[8px] font-black uppercase text-gray-400">Commission</span>
                          <span className="text-[10px] font-bold text-gray-700">{receipt.agentName}</span>
                        </div>
                        <div className={`flex items-center gap-1 ${receipt.isCommissionPaid ? 'text-green-600' : 'text-orange-600'}`}>
                          <Banknote size={12} />
                          <span className="text-xs font-black">{formatCurrency(receipt.commissionAmount || 0)}</span>
                        </div>
                      </div>
                    )}
                    {receipt.agentName && !receipt.isCommissionPaid && (
                      <button
                        onClick={() => handleMarkCommissionPaid(receipt)}
                        className="w-full bg-orange-50 border border-orange-200 text-orange-700 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest"
                      >
                        Marquer commission payée
                      </button>
                    )}

                    {hasCaution && (
                      <div className={`p-2 rounded-lg border ${receipt.isCautionRefunded ? 'bg-green-50 border-green-100' : 'bg-blue-50 border-blue-100'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1">
                            <ShieldCheck size={12} className={receipt.isCautionRefunded ? 'text-green-600' : 'text-blue-600'} />
                            <span className="text-[10px] font-black uppercase tracking-widest">Caution: {formatCurrency(receipt.cautionAmount || 0)}</span>
                          </div>
                          {receipt.isCautionRefunded ? (
                            <span className="text-[8px] font-black uppercase bg-green-200 text-green-700 px-1.5 py-0.5 rounded">Remboursée</span>
                          ) : (
                            <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${isRefundOverdue ? 'bg-red-200 text-red-700' : 'bg-blue-200 text-blue-700'}`}>
                              Délai: {refundDeadline?.toLocaleDateString('fr-FR')}
                            </span>
                          )}
                        </div>
                        
                        {!receipt.isCautionRefunded && (
                          <div className="flex gap-2">
                            <button 
                              onClick={() => handleRefundCaution(receipt, 'Espèces')}
                              className="flex-1 bg-white border border-blue-200 text-blue-600 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest shadow-sm"
                            >
                              Remb. Espèces
                            </button>
                            <button 
                              onClick={() => handleRefundCaution(receipt, 'Mobile')}
                              className="flex-1 bg-white border border-blue-200 text-blue-600 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest shadow-sm"
                            >
                              Remb. Mobile
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${receipt.remaining <= 0 ? 'bg-green-500' : 'bg-orange-500'}`} />
                      <span className="text-[10px] font-black uppercase tracking-widest">
                        {receipt.remaining <= 0 ? 'Soldé' : `Reste: ${formatCurrency(receipt.remaining)}`}
                      </span>
                    </div>
                    {receipt.status === 'ANNULE' && (
                      <span className="text-[8px] font-black bg-red-100 text-red-600 px-2 py-1 rounded uppercase">Annulé</span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Load More Button */}
          {filteredReceipts.length > displayLimit && (
            <div className="mt-8 flex justify-center">
              <button 
                onClick={handleLoadMore}
                className="px-8 py-4 bg-white border border-gray-200 text-gray-900 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-gray-50 transition-all shadow-sm"
              >
                Charger plus de reçus
              </button>
            </div>
          )}

          {filteredReceipts.length === 0 && (
            <div className="p-12 text-center bg-white rounded-2xl border border-gray-200">
              <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300">
                <FileText size={32} />
              </div>
              <p className="text-sm text-gray-400 italic">Aucun reçu trouvé pour cette recherche.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
