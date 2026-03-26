import React, { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot,
  doc,
  updateDoc,
  Timestamp,
  limit 
} from 'firebase/firestore';
import { db } from '../firebase';
import { ReceiptData, UserProfile } from '../types';
import { formatCurrency } from '../constants';
import { 
  Search, 
  FileText, 
  ExternalLink, 
  Printer, 
  Calendar,
  User as UserIcon,
  CreditCard,
  ChevronRight,
  Clock,
  Banknote,
  ShieldCheck
} from 'lucide-react';
import { motion } from 'motion/react';

interface HistoryViewProps {
  onEdit: (receipt: ReceiptData) => void;
  onPrint: (receipt: ReceiptData) => void;
  userProfile: UserProfile | null;
  onAlert: (message: string, type?: 'info' | 'error' | 'success') => void;
}

export default function HistoryView({ onEdit, onPrint, userProfile, onAlert }: HistoryViewProps) {
  const [receipts, setReceipts] = useState<ReceiptData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [displayLimit, setDisplayLimit] = useState(15);
  const [firestoreLimit, setFirestoreLimit] = useState(50);
  const [expandedApartmentId, setExpandedApartmentId] = useState<string | null>(null);

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

  const filteredReceipts = receipts.filter(r => 
    r.receiptId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    `${r.firstName} ${r.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.apartmentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (r.agentName && r.agentName.toLowerCase().includes(searchTerm.toLowerCase()))
  );

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
        <div className="max-w-6xl mx-auto">
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
                              <div className={`text-[8px] font-black uppercase mt-1 px-1.5 py-0.5 rounded inline-flex w-fit ${isOverdue ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                                Délai: {deadline.toLocaleDateString('fr-FR')}
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
                                {userProfile?.role === 'admin' && (
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
                                )}
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
                  className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-4"
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
                      <span 
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setExpandedApartmentId(expandedApartmentId === receipt.id ? null : receipt.id);
                        }}
                        className={`text-xs font-bold cursor-pointer transition-all duration-300 block ${
                          expandedApartmentId === receipt.id 
                            ? 'text-blue-700 bg-blue-50 p-2 rounded-lg shadow-md z-50 relative whitespace-normal break-words ring-1 ring-blue-200' 
                            : 'text-gray-700 truncate border-b border-dotted border-gray-400'
                        }`}
                      >
                        {receipt.apartmentName}
                      </span>
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
                        
                        {!receipt.isCautionRefunded && userProfile?.role === 'admin' && (
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
