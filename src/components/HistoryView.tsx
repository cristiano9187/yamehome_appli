import React, { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot,
  Timestamp 
} from 'firebase/firestore';
import { db } from '../firebase';
import { ReceiptData } from '../types';
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
  Banknote
} from 'lucide-react';
import { motion } from 'motion/react';

interface HistoryViewProps {
  onEdit: (receipt: ReceiptData) => void;
  onPrint: (receipt: ReceiptData) => void;
}

export default function HistoryView({ onEdit, onPrint }: HistoryViewProps) {
  const [receipts, setReceipts] = useState<ReceiptData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'receipts'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ReceiptData[];
      setReceipts(data);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const filteredReceipts = receipts.filter(r => 
    r.receiptId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    `${r.firstName} ${r.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.apartmentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (r.agentName && r.agentName.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F5F5F4]">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#F5F5F4] overflow-hidden">
      {/* Header */}
      <div className="h-20 bg-white border-b border-gray-200 px-8 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <h2 className="text-sm font-black uppercase tracking-widest">Historique des Reçus</h2>
            <span className="text-[10px] font-mono text-gray-400 font-bold">{filteredReceipts.length} enregistrements</span>
          </div>
        </div>

        <div className="relative w-96">
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
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-6xl mx-auto">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="grid grid-cols-12 gap-4 p-4 bg-gray-50 border-b border-gray-100 text-[10px] font-black uppercase tracking-widest text-gray-400">
              <div className="col-span-2">ID Reçu</div>
              <div className="col-span-2">Client</div>
              <div className="col-span-2">Logement</div>
              <div className="col-span-2">Montant</div>
              <div className="col-span-2">Commission</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            <div className="divide-y divide-gray-50">
              {filteredReceipts.map((receipt) => {
                const deadline = new Date(receipt.startDate);
                deadline.setDate(deadline.getDate() + 1);
                const isOverdue = new Date() > deadline;

                return (
                  <motion.div 
                    key={receipt.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-blue-50/30 transition-all group"
                  >
                    <div className="col-span-2">
                      <div className="flex flex-col">
                        <span className="text-xs font-mono font-bold text-gray-900">{receipt.receiptId}</span>
                        <span className="text-[9px] text-gray-400 flex items-center gap-1">
                          <Clock size={8} />
                          {new Date(receipt.createdAt).toLocaleDateString('fr-FR')}
                        </span>
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
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-gray-700 truncate max-w-[120px]">
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

                    <div className="col-span-2 flex justify-end gap-2">
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

              {filteredReceipts.length === 0 && (
                <div className="p-12 text-center">
                  <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300">
                    <FileText size={32} />
                  </div>
                  <p className="text-sm text-gray-400 italic">Aucun reçu trouvé pour cette recherche.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
