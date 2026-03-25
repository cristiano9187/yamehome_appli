import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { AuthorizedEmail } from '../types';
import { Trash2, UserPlus, Shield, User as UserIcon, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface UserManagementProps {
  onAlert: (message: string, type?: 'info' | 'error' | 'success') => void;
}

export default function UserManagement({ onAlert }: UserManagementProps) {
  const [emails, setEmails] = useState<AuthorizedEmail[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'agent'>('agent');
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdating, setIsUpdating] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'authorized_emails'));
    const unsub = onSnapshot(q, (snap) => {
      setEmails(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as AuthorizedEmail[]);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail) return;
    setIsAdding(true);
    try {
      await addDoc(collection(db, 'authorized_emails'), {
        email: newEmail.toLowerCase().trim(),
        role: newRole,
        addedAt: new Date().toISOString()
      });
      setNewEmail('');
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-8">
        <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tighter flex items-center gap-2">
          <Shield className="text-blue-600" /> Gestion des Accès
        </h2>
        <p className="text-gray-500 text-sm mt-1">Définissez les emails autorisés à se connecter à l'application.</p>
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
          <div className="col-span-6 text-[10px] font-black uppercase tracking-widest text-gray-400">Email</div>
          <div className="col-span-4 text-[10px] font-black uppercase tracking-widest text-gray-400">Rôle</div>
          <div className="col-span-2 text-[10px] font-black uppercase tracking-widest text-gray-400 text-right">Action</div>
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
                <div className="col-span-6 flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-50 rounded-full flex items-center justify-center text-blue-600">
                    <UserIcon size={14} />
                  </div>
                  <span className="text-sm font-medium text-gray-900">{item.email}</span>
                </div>
                <div className="col-span-4">
                  {isUpdating === item.id ? (
                    <Loader2 className="animate-spin text-blue-600" size={14} />
                  ) : (
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
                  )}
                </div>
                <div className="col-span-2 text-right">
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
