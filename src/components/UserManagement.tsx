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

function AccessPill({
  active,
  onClick,
  label,
  activeClass,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  activeClass: string;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase border transition-colors touch-manipulation ${
        active ? activeClass : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
      }`}
    >
      {label} {active ? '✓' : '○'}
    </button>
  );
}

export default function UserManagement({ onAlert, onMenuClick }: UserManagementProps) {
  const [emails, setEmails] = useState<AuthorizedEmail[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'agent'>('agent');
  const [newAllowedSites, setNewAllowedSites] = useState<string[]>([]);
  const [newCalendarBlockAccess, setNewCalendarBlockAccess] = useState(false);
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
        ...(newCalendarBlockAccess ? { calendarBlockAccess: true } : {}),
        addedAt: new Date().toISOString()
      });
      setNewEmail('');
      setNewAllowedSites([]);
      setNewCalendarBlockAccess(false);
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

  const handleUpdateRole = async (id: string, role: 'admin' | 'agent') => {
    setIsUpdating(id);
    try {
      await setDoc(doc(db, 'authorized_emails', id), { role }, { merge: true });
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
      const next = current.includes(site) ? current.filter(s => s !== site) : [...current, site];
      await setDoc(doc(db, 'authorized_emails', id), { allowedSites: next }, { merge: true });
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

  const handleToggleObligationsAccess = async (authEmailId: string, current: boolean) => {
    setIsUpdating(authEmailId);
    try {
      await setDoc(doc(db, 'authorized_emails', authEmailId), { obligationsAccess: !current }, { merge: true });
      onAlert(!current ? 'Accès salaires Échéances activé' : 'Accès salaires Échéances retiré', 'success');
    } catch (error) {
      console.error('Error toggling obligations access:', error);
      onAlert('Erreur lors de la mise à jour', 'error');
    } finally {
      setIsUpdating(null);
    }
  };

  const handleToggleCalendarBlockAccess = async (authEmailId: string, current: boolean) => {
    setIsUpdating(authEmailId);
    try {
      await setDoc(doc(db, 'authorized_emails', authEmailId), { calendarBlockAccess: !current }, { merge: true });
      onAlert(!current ? 'Blocage calendrier activé' : 'Blocage calendrier retiré', 'success');
    } catch (error) {
      console.error('Error toggling calendar block access:', error);
      onAlert('Erreur lors de la mise à jour', 'error');
    } finally {
      setIsUpdating(null);
    }
  };

  const handleToggleKeyboxGuardOnly = async (authEmailId: string, current: boolean) => {
    setIsUpdating(authEmailId);
    try {
      await setDoc(doc(db, 'authorized_emails', authEmailId), { keyboxGuardOnly: !current }, { merge: true });
      onAlert(!current ? 'Compte gardien activé (vue Codes keybox exclusive)' : 'Compte gardien désactivé', 'success');
    } catch (error) {
      console.error('Error toggling keybox guard flag:', error);
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

  const protectedEmails = ['christian.yamepi@gmail.com', 'cyamepi@gmail.com'];

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F5F5F4] min-h-[50vh]">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 md:h-full bg-[#F5F5F4] md:overflow-hidden">
      {/* En-tête fixe */}
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
            <Shield className="text-blue-600 shrink-0" size={18} />
            Gestion des accès
          </h2>
          <p className="text-[10px] font-mono text-gray-400 font-bold mt-0.5">
            {emails.length} compte{emails.length !== 1 ? 's' : ''} autorisé{emails.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Zone scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className="max-w-5xl mx-auto p-4 md:p-6 pb-24 space-y-5">
          <details className="rounded-xl border border-gray-200 bg-white overflow-hidden group">
            <summary className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-gray-500 cursor-pointer hover:bg-gray-50 select-none">
              Aide — droits spéciaux par compte
            </summary>
            <div className="px-4 pb-4 space-y-3 text-xs text-gray-600 leading-relaxed border-t border-gray-100">
              <p>
                Le menu <strong>Échéances</strong> est visible par tous les employés (hors salaires).
                Le bouton <strong>« Salaires Échéances »</strong> ouvre le cercle privé (salaires dans Échéances).
              </p>
              <p>
                <strong>« Vue Coûts »</strong> active le menu Coûts &amp; marges.
                Les super-admins y ont toujours accès ; les autres admins aussi, sauf{' '}
                <span className="font-mono text-[10px]">yamehome.yaounde@gmail.com</span> sans activation explicite.
              </p>
              <p>
                <strong>« Gardien keybox »</strong> transforme le compte en accès restreint : à la connexion,
                l'utilisateur arrive directement sur la vue <strong>Codes keybox</strong> (pas de menu, pas de calendrier),
                filtrée par les <strong>sites autorisés</strong> cochés ci-dessus. Il peut consulter les codes et retirer
                des clés, mais pas déposer de clés ni changer un code.
              </p>
            </div>
          </details>

          {/* Formulaire ajout */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 md:p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4">Nouvel accès</p>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="exemple@gmail.com"
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Rôle</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as 'admin' | 'agent')}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 transition-all"
                  >
                    <option value="agent">Agent (Standard)</option>
                    <option value="admin">Administrateur</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Calendrier</label>
                  <button
                    type="button"
                    onClick={() => setNewCalendarBlockAccess((v) => !v)}
                    className={`w-full px-4 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all border touch-manipulation ${
                      newCalendarBlockAccess
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    Bloquer dates {newCalendarBlockAccess ? '✓' : '○'}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Sites autorisés</label>
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
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all flex items-center gap-1 touch-manipulation ${
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
              <button
                type="submit"
                disabled={isAdding}
                className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 touch-manipulation"
              >
                {isAdding ? <Loader2 className="animate-spin" size={14} /> : <UserPlus size={14} />}
                Autoriser
              </button>
            </form>
          </div>

          {/* Liste utilisateurs */}
          <div className="space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 px-1">
              Comptes autorisés
            </p>
            <AnimatePresence>
              {emails.map((item) => (
                <motion.article
                  key={item.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 md:p-5 hover:border-gray-200 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 shrink-0 mt-0.5">
                      <UserIcon size={16} />
                    </div>
                    <div className="flex-1 min-w-0 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-900 break-all">{item.email}</p>
                        {!protectedEmails.includes(item.email) && (
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(item.id!)}
                            className="p-2 -m-1 text-gray-400 hover:text-red-500 transition-all shrink-0 touch-manipulation"
                            title="Retirer l'accès"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>

                      {isUpdating === item.id ? (
                        <div className="flex items-center gap-2 py-2">
                          <Loader2 className="animate-spin text-blue-600" size={16} />
                          <span className="text-xs text-gray-400">Mise à jour…</span>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={item.role}
                              onChange={(e) => handleUpdateRole(item.id!, e.target.value as 'admin' | 'agent')}
                              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-tighter border cursor-pointer focus:ring-2 focus:ring-blue-500 ${
                                item.role === 'admin' ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-blue-100 text-blue-700 border-blue-200'
                              }`}
                            >
                              <option value="agent">Agent</option>
                              <option value="admin">Admin</option>
                            </select>
                            {SITES.map(site => {
                              const isAllowed = (item.allowedSites || []).includes(site);
                              return (
                                <button
                                  key={site}
                                  type="button"
                                  onClick={() => handleToggleSite(item.id!, item.allowedSites || [], site)}
                                  className={`px-2 py-1 rounded-md text-[8px] font-bold uppercase transition-all touch-manipulation ${
                                    isAllowed ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
                                  }`}
                                >
                                  {site}
                                </button>
                              );
                            })}
                          </div>

                          <div>
                            <label className="block text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">
                              Fiche présence
                            </label>
                            <select
                              value={item.linkedEmployeeId || ''}
                              onChange={(e) => handleUpdateLinkedEmployee(item.id!, e.target.value)}
                              className="w-full max-w-md text-xs font-medium text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="">— Non lié —</option>
                              {employees.map((emp) => (
                                <option key={emp.id} value={emp.id}>{emp.name}</option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">
                              Droits spéciaux
                            </label>
                            <div className="flex flex-wrap gap-2">
                              <AccessPill
                                active={!!item.calendarBlockAccess}
                                onClick={() => handleToggleCalendarBlockAccess(item.id!, !!item.calendarBlockAccess)}
                                label="Calendrier"
                                title="Bloquer / débloquer des dates sur le calendrier"
                                activeClass="bg-slate-900 border-slate-700 text-white"
                              />
                              <AccessPill
                                active={!!item.obligationsAccess}
                                onClick={() => handleToggleObligationsAccess(item.id!, !!item.obligationsAccess)}
                                label="Salaires Éch."
                                title="Voir les salaires dans Échéances (cercle privé)"
                                activeClass="bg-amber-100 border-amber-300 text-amber-950"
                              />
                              <AccessPill
                                active={!!item.financeAccess}
                                onClick={() => handleToggleFinanceAccess(item.id!, !!item.financeAccess)}
                                label="Coûts"
                                title="Menu Coûts & marges"
                                activeClass="bg-emerald-100 border-emerald-300 text-emerald-900"
                              />
                              <AccessPill
                                active={!!item.keyboxGuardOnly}
                                onClick={() => handleToggleKeyboxGuardOnly(item.id!, !!item.keyboxGuardOnly)}
                                label="Gardien keybox"
                                title="Compte gardien restreint : accès direct à la vue Codes keybox uniquement, filtrée par sites autorisés"
                                activeClass="bg-orange-100 border-orange-300 text-orange-950"
                              />
                            </div>
                            {item.keyboxGuardOnly && (
                              <p className="text-[10px] text-orange-600 mt-1.5">
                                Ce compte n'aura accès qu'à la vue Codes keybox (filtrée par les sites autorisés ci-dessus).
                              </p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </motion.article>
              ))}
            </AnimatePresence>

            {emails.length === 0 && (
              <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-12 text-center">
                <p className="text-gray-400 text-sm">Aucun email autorisé pour le moment.</p>
              </div>
            )}
          </div>
        </div>
      </div>

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
                L'utilisateur <strong>{emails.find(e => e.id === deleteConfirmId)?.email}</strong> ne pourra plus accéder à l'application.
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => handleDelete(deleteConfirmId)}
                  disabled={isDeleting}
                  className="w-full bg-red-600 text-white font-black py-4 rounded-2xl uppercase text-xs tracking-widest shadow-xl shadow-red-600/20 hover:bg-red-700 transition-all disabled:opacity-50 touch-manipulation"
                >
                  {isDeleting ? 'Suppression...' : 'Confirmer la suppression'}
                </button>
                <button
                  onClick={() => setDeleteConfirmId(null)}
                  className="w-full bg-gray-100 text-gray-600 font-black py-4 rounded-2xl uppercase text-xs tracking-widest hover:bg-gray-200 transition-all touch-manipulation"
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
