import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, deleteDoc, doc, setDoc, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { AuthorizedEmail, Employee } from '../types';
import { Trash2, UserPlus, Shield, User as UserIcon, Loader2, Menu, CheckSquare, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SITES } from '../constants';

interface UserManagementProps {
  onAlert: (message: string, type?: 'info' | 'error' | 'success') => void;
  onMenuClick?: () => void;
}

export default function UserManagement({ onAlert, onMenuClick }: UserManagementProps) {
  const [emails, setEmails] = useState<AuthorizedEmail[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'agent'>('agent');
  const [newAllowedSites, setNewAllowedSites] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'authorized_emails'));
    const unsub = onSnapshot(q, (snap) => {
      setEmails(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as AuthorizedEmail[]);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'employees'), where('active', '==', true), orderBy('name'));
    return onSnapshot(q, (snap) => {
      setEmployees(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
    });
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail) return;
    setIsAdding(true);
    try {
      const emailId = newEmail.toLowerCase().trim();
      await setDoc(doc(db, 'authorized_emails', emailId), {
        email: emailId,
        role: newRole,
        allowedSites: newAllowedSites,
        addedAt: new Date().toISOString()
      });
      setNewEmail('');
      setNewAllowedSites([]);
    } catch (error) {
      console.error("Error adding email:", error);
      onAlert("Erreur lors de l'ajout de l'email", 'error');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'authorized_emails', id));
      setDeleteConfirmId(null);
    } catch (error) {
      console.error("Error deleting email:", error);
      onAlert("Erreur lors de la suppression", 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleUpdateRole = async (id: string, newRole: 'admin' | 'agent') => {
    setIsUpdating(id);
    try {
      await setDoc(doc(db, 'authorized_emails', id), {
        role: newRole
      }, { merge: true });
      onAlert("Rôle mis à jour avec succès", 'success');
    } catch (error) {
      console.error("Error updating role:", error);
      onAlert("Erreur lors de la mise à jour du rôle", 'error');
    } finally {
      setIsUpdating(null);
    }
  };

  const handleToggleSite = async (id: string, current: string[], site: string) => {
    setIsUpdating(id);
    try {
      const next = current.includes(site)
        ? current.filter(s => s !== site)
        : [...current, site];
      
      await setDoc(doc(db, 'authorized_emails', id), {
        allowedSites: next
      }, { merge: true });
    } catch (error) {
      console.error("Error updating sites:", error);
      onAlert("Erreur lors de la mise à jour des accès", 'error');
    } finally {
      setIsUpdating(null);
    }
  };

  const handleToggleFinanceAccess = async (authEmailId: string, current: boolean) => {
    setIsUpdating(authEmailId);
    try {
      await setDoc(doc(db, 'authorized_emails', authEmailId), { financeAccess: !current }, { merge: true });
      onAlert(!current ? 'Accès à la vue Coûts activé' : 'Accès à la vue Coûts retiré', 'success');
    } catch (error) {
      console.error('Error toggling finance access:', error);
      onAlert('Erreur lors de la mise à jour', 'error');
    } finally {
      setIsUpdating(null);
    }
  };

  const handleUpdateLinkedEmployee = async (authEmailId: string, employeeId: string) => {
    setIsUpdating(authEmailId);
    try {
      await setDoc(
        doc(db, 'authorized_emails', authEmailId),
        { linkedEmployeeId: employeeId || null },
        { merge: true }
      );
      onAlert("Fiche employé (présence) mise à jour", "success");
    } catch (error) {
      console.error("Error updating linked employee:", error);
      onAlert("Erreur lors de la liaison employé", "error");
    } finally {
      setIsUpdating(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="mb-8 flex items-center gap-4">
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
        <div>
          <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tighter flex items-center gap-2">
            <Shield className="text-blue-600" /> Gestion des Accès
          </h2>
          <p className="text-gray-500 text-sm mt-1">Définissez les emails autorisés à se connecter à l'application.</p>
          <p className="text-emerald-900/85 text-xs mt-4 leading-relaxed max-w-3xl border border-emerald-100 bg-emerald-50/60 rounded-xl px-4 py-3">
            <span className="font-black uppercase tracking-wider text-[10px] text-emerald-800 block mb-1">Vue Coûts &amp; marges</span>
            Sur chaque ligne, le bouton <strong className="text-emerald-950">« Vue Coûts »</strong> active ou désactive l’accès au menu vert (saisie des lignes et lecture des marges).
            Les <strong className="text-emerald-950">super-admins</strong> ont toujours accès. Les autres <strong className="text-emerald-950">administrateurs</strong> aussi, sauf le compte générique Yaoundé (<strong className="font-mono text-[10px]">yamehome.yaounde@gmail.com</strong>) qui n’a la vue Coûts que si vous activez explicitement ce bouton.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
        <form onSubmit={handleAdd} className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Email de l'employé</label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="exemple@gmail.com"
              className="w-full px-4 py-3 bg-gray-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-blue-500 transition-all"
              required
            />
          </div>
          <div className="w-full md:w-48">
            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Rôle</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as any)}
              className="w-full px-4 py-3 bg-gray-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-blue-500 transition-all"
            >
              <option value="agent">Agent (Standard)</option>
              <option value="admin">Administrateur</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Sites Autorisés</label>
            <div className="flex flex-wrap gap-2">
              {SITES.map(site => (
                <button
                  key={site}
                  type="button"
                  onClick={() => {
                    setNewAllowedSites(prev => 
                      prev.includes(site) ? prev.filter(s => s !== site) : [...prev, site]
                    );
                  }}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all flex items-center gap-1 ${
                    newAllowedSites.includes(site) 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                  }`}
                >
                  {newAllowedSites.includes(site) ? <CheckSquare size={12} /> : <Square size={12} />}
                  {site}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={isAdding}
              className="w-full md:w-auto px-6 py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isAdding ? <Loader2 className="animate-spin" size={14} /> : <UserPlus size={14} />}
              Autoriser
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 bg-gray-50 border-b border-gray-100 grid grid-cols-12 gap-4">
          <div className="col-span-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Email</div>
          <div className="col-span-3 text-[10px] font-black uppercase tracking-widest text-gray-400">Rôle</div>
          <div className="col-span-3 text-[10px] font-black uppercase tracking-widest text-gray-400">
            Présence / Coûts
          </div>
          <div className="col-span-1 text-[10px] font-black uppercase tracking-widest text-gray-400 text-right">Action</div>
        </div>
        <div className="divide-y divide-gray-50">
          <AnimatePresence>
            {emails.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="p-4 grid grid-cols-12 gap-4 items-center hover:bg-gray-50/50 transition-all"
              >
                <div className="col-span-5 flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 shrink-0">
                    <UserIcon size={14} />
                  </div>
                  <span className="text-sm font-medium text-gray-900 truncate">{item.email}</span>
                </div>
                <div className="col-span-3">
                  {isUpdating === item.id ? (
                    <Loader2 className="animate-spin text-blue-600" size={14} />
                  ) : (
                    <div className="space-y-2">
                      <select
                        value={item.role}
                        onChange={(e) => handleUpdateRole(item.id!, e.target.value as 'admin' | 'agent')}
                        className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-tighter border-none bg-transparent cursor-pointer focus:ring-1 focus:ring-blue-500 transition-all ${
                          item.role === 'admin' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'
                        }`}
                      >
                        <option value="agent">Agent</option>
                        <option value="admin">Admin</option>
                      </select>
                      <div className="flex flex-wrap gap-1">
                        {SITES.map(site => {
                          const isAllowed = (item.allowedSites || []).includes(site);
                          return (
                            <button
                              key={site}
                              onClick={() => handleToggleSite(item.id!, item.allowedSites || [], site)}
                              className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase transition-all ${
                                isAllowed ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-300'
                              }`}
                            >
                              {site}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                <div className="col-span-3 min-w-0">
                  {isUpdating === item.id ? (
                    <Loader2 className="animate-spin text-blue-600" size={14} />
                  ) : (
                    <>
                      <select
                        value={item.linkedEmployeeId || ''}
                        onChange={(e) => handleUpdateLinkedEmployee(item.id!, e.target.value)}
                        className="w-full text-[10px] font-medium text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500"
                        title="Compte autorisé = cette fiche pour la feuille de présence"
                      >
                        <option value="">— Non lié —</option>
                        {employees.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        title="Autoriser ce compte à ouvrir « Coûts & marges » (saisie et totaux du mois)"
                        onClick={() => handleToggleFinanceAccess(item.id!, !!item.financeAccess)}
                        className={`mt-1.5 w-full text-[9px] font-black uppercase py-1.5 rounded-lg border transition-colors ${
                          item.financeAccess
                            ? 'bg-emerald-100 border-emerald-300 text-emerald-900'
                            : 'bg-gray-100 border-gray-200 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        Vue Coûts {item.financeAccess ? '✓' : '○'}
                      </button>
                    </>
                  )}
                </div>
                <div className="col-span-1 text-right">
                  {item.email !== 'christian.yamepi@gmail.com' && item.email !== 'cyamepi@gmail.com' && (
                    <button
                      onClick={() => setDeleteConfirmId(item.id!)}
                      className="p-2 text-gray-400 hover:text-red-500 transition-all"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {emails.length === 0 && (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-sm">Aucun email autorisé pour le moment.</p>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteConfirmId && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <Trash2 size={32} />
              </div>
              <h3 className="text-xl font-black uppercase tracking-tight mb-2">Supprimer l'accès ?</h3>
              <p className="text-sm text-gray-500 mb-8 leading-relaxed">
                L'utilisateur avec l'email <strong>{emails.find(e => e.id === deleteConfirmId)?.email}</strong> ne pourra plus accéder à l'application.
              </p>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={() => handleDelete(deleteConfirmId)}
                  disabled={isDeleting}
                  className="w-full bg-red-600 text-white font-black py-4 rounded-2xl uppercase text-xs tracking-widest shadow-xl shadow-red-600/20 hover:bg-red-700 transition-all disabled:opacity-50"
                >
                  {isDeleting ? 'Suppression...' : 'Confirmer la suppression'}
                </button>
                <button 
                  onClick={() => setDeleteConfirmId(null)}
                  className="w-full bg-gray-100 text-gray-600 font-black py-4 rounded-2xl uppercase text-xs tracking-widest hover:bg-gray-200 transition-all"
                >
                  Annuler
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
