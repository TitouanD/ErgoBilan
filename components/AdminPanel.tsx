
import React, { useState, useEffect } from 'react';
import { Contribution } from '../types';
import { UserProfile } from '../types';
import { AdminService } from '../services/admin';
import { Check, X, AlertTriangle, FileText, LayoutGrid, ShieldAlert, Layers, Loader2, Database, Ban } from 'lucide-react';

interface Props {
  userProfile: UserProfile; // Requis pour la sécurité
  onClose: () => void;
}

export const AdminPanel: React.FC<Props> = ({ userProfile, onClose }) => {
  const [activeTab, setActiveTab] = useState<'validation' | 'library'>('validation');
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [selectedContribution, setSelectedContribution] = useState<Contribution | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // SÉCURITÉ CRITIQUE : Bloquer le rendu si non-admin
  if (!userProfile.isAdmin) {
      return (
          <div className="min-h-screen bg-rose-950 flex flex-col items-center justify-center text-white">
              <Ban size={64} className="mb-4" />
              <h1 className="text-3xl font-bold">ACCÈS INTERDIT</h1>
              <p className="mt-2 text-rose-200">Incident de sécurité signalé.</p>
              <button onClick={onClose} className="mt-8 px-6 py-2 bg-white text-rose-900 rounded-lg font-bold">Retour</button>
          </div>
      );
  }

  // Chargement des données réelles
  useEffect(() => {
      loadData();
  }, []);

  const loadData = async () => {
      setIsLoading(true);
      try {
          const data = await AdminService.getPendingContributions();
          setContributions(data);
      } catch (e) {
          console.error("Erreur chargement admin:", e);
      } finally {
          setIsLoading(false);
      }
  };

  const handleAction = async (status: 'validated' | 'rejected') => {
      if (!selectedContribution) return;
      setIsProcessing(true);
      try {
          if (status === 'rejected') {
              await AdminService.rejectContribution(selectedContribution.id);
          } else {
              await AdminService.integrateContribution(selectedContribution);
          }
          // Rafraîchir la liste
          await loadData();
          setSelectedContribution(null);
      } catch (e) {
          console.error("Erreur action admin:", e);
          alert("Erreur lors de l'opération. Vérifiez la console (Conflit de nom ou RLS).");
      } finally {
          setIsProcessing(false);
      }
  };

  return (
    <div className="min-h-screen bg-[#1A1C23] text-stone-200 font-sans flex">
        
        {/* SIDEBAR */}
        <div className="w-64 bg-[#131419] border-r border-white/5 flex flex-col">
            <div className="p-6 border-b border-white/5 bg-rose-900/10">
                <div className="flex items-center gap-2 mb-1">
                    <ShieldAlert size={16} className="text-rose-500" />
                    <span className="text-[10px] font-bold text-rose-500 uppercase tracking-widest">Zone Restreinte</span>
                </div>
                <h1 className="font-serif font-bold text-xl text-white tracking-wide">Panel <span className="text-[#E07A5F]">Admin</span></h1>
            </div>
            
            <nav className="flex-1 p-4 space-y-2">
                <button 
                    onClick={() => setActiveTab('validation')}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'validation' ? 'bg-[#E07A5F] text-white shadow-lg shadow-orange-900/20' : 'text-stone-500 hover:bg-white/5 hover:text-white'}`}
                >
                    <div className="flex items-center gap-3">
                        <Database size={18} /> Intégration Tests
                    </div>
                    {contributions.length > 0 && (
                        <span className="bg-white text-[#E07A5F] px-2 py-0.5 rounded-full text-[10px] font-extrabold">{contributions.length}</span>
                    )}
                </button>
                <button 
                    onClick={() => setActiveTab('library')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'library' ? 'bg-[#3D405B] text-white' : 'text-stone-500 hover:bg-white/5 hover:text-white'}`}
                >
                    <Layers size={18} /> Catalogue Officiel
                </button>
            </nav>

            <div className="p-4 border-t border-white/5">
                <button onClick={onClose} className="w-full py-2 text-stone-500 hover:text-white text-xs font-bold uppercase tracking-wider text-center flex items-center justify-center gap-2">
                    <X size={14}/> Fermer Session
                </button>
            </div>
        </div>

        {/* MAIN CONTENT */}
        <div className="flex-1 flex flex-col h-screen overflow-hidden">
            
            {/* HEADER */}
            <header className="h-16 border-b border-white/5 flex items-center justify-between px-8 bg-[#1A1C23]">
                <h2 className="font-bold text-white text-lg">
                    {activeTab === 'validation' && "Validation & Intégration Base de Données"}
                    {activeTab === 'library' && "Visualisation Catalogue"}
                </h2>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-stone-500 bg-white/5 px-3 py-1.5 rounded-full">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        Connecté en tant qu'Admin
                    </div>
                </div>
            </header>

            {/* CONTENT AREA */}
            <main className="flex-1 overflow-y-auto p-8">
                
                {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <Loader2 size={40} className="text-[#E07A5F] animate-spin" />
                    </div>
                ) : activeTab === 'validation' && (
                    <div className="grid grid-cols-12 gap-8 h-full">
                        
                        {/* LISTE GAUCHE */}
                        <div className="col-span-4 space-y-4 overflow-y-auto max-h-full pr-2 custom-scrollbar">
                            <h3 className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-4">File d'attente ({contributions.length})</h3>
                            {contributions.map(c => (
                                <div 
                                    key={c.id} 
                                    onClick={() => setSelectedContribution(c)}
                                    className={`p-4 rounded-xl border cursor-pointer transition-all ${selectedContribution?.id === c.id ? 'bg-white/10 border-[#E07A5F] ring-1 ring-[#E07A5F]' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2">
                                            <div className="p-1.5 bg-[#3D405B] rounded text-white"><FileText size={14}/></div>
                                            <span className="font-bold text-sm text-white truncate max-w-[150px]">
                                                {c.testName || `ID: ${c.id.substring(0,8)}...`}
                                            </span>
                                        </div>
                                        {/* Indicateur Vigilance */}
                                        {c.vigilanceScore === 'pass' && <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-bold uppercase">Sûr</span>}
                                        {c.vigilanceScore !== 'pass' && <span className="text-[10px] bg-rose-500/20 text-rose-400 px-2 py-0.5 rounded font-bold uppercase">Suspect</span>}
                                    </div>
                                    <div className="flex justify-between items-center text-xs text-stone-500">
                                        <span>User: {c.userName || 'Anon'}</span>
                                        <span>{new Date(c.submittedAt).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            ))}
                            {contributions.length === 0 && (
                                <div className="text-center py-20 text-stone-600 bg-white/5 rounded-xl border border-dashed border-white/10 p-4">
                                    <Check size={40} className="mx-auto mb-4 opacity-20" />
                                    <p className="mb-2">Toutes les contributions sont traitées.</p>
                                    <p className="text-xs text-stone-700 mt-4 border-t border-white/5 pt-4">
                                        Note: Si vous avez inséré des données manuellement et qu'elles n'apparaissent pas ici, vérifiez vos politiques RLS Supabase sur `contributions_queue`.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* DETAIL DROITE */}
                        <div className="col-span-8 bg-[#131419] rounded-2xl border border-white/5 p-6 flex flex-col h-full">
                            {selectedContribution ? (
                                <>
                                    <div className="flex justify-between items-start mb-6">
                                        <div>
                                            <h3 className="text-xl font-bold text-white mb-1">{selectedContribution.testName}</h3>
                                            <p className="text-xs text-stone-500 uppercase tracking-widest flex items-center gap-2">
                                                <Database size={12}/> Prêt à intégrer 'official_tests'
                                            </p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button 
                                                onClick={() => handleAction('rejected')}
                                                disabled={isProcessing}
                                                className="px-4 py-2 rounded-lg border border-white/10 text-stone-400 hover:text-white hover:bg-white/5 text-xs font-bold uppercase transition-all disabled:opacity-50"
                                            >
                                                Supprimer
                                            </button>
                                            <button 
                                                onClick={() => handleAction('validated')}
                                                disabled={isProcessing}
                                                className="px-6 py-2 rounded-lg bg-[#E07A5F] text-white hover:bg-[#d0694e] text-xs font-bold uppercase shadow-lg shadow-orange-900/30 transition-all flex items-center gap-2 disabled:opacity-50"
                                            >
                                                {isProcessing ? <Loader2 size={16} className="animate-spin"/> : <Check size={16} />} 
                                                Intégrer au Catalogue
                                            </button>
                                        </div>
                                    </div>

                                    {/* Table de prévisualisation */}
                                    <div className="flex-1 bg-white/5 rounded-xl border border-white/5 overflow-y-auto custom-scrollbar">
                                        <table className="w-full text-sm text-left text-stone-300">
                                            <thead className="bg-[#1A1C23] font-bold text-xs uppercase text-stone-500 sticky top-0 z-10">
                                                <tr>
                                                    <th className="p-3 pl-4">Sous-test (Groupement)</th>
                                                    <th className="p-3">Label (Âge/Classe)</th>
                                                    <th className="p-3 text-center">Brut</th>
                                                    <th className="p-3 text-center">Standard</th>
                                                    <th className="p-3 text-center">%</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {selectedContribution.rows?.map((row, idx) => (
                                                    <tr key={idx} className="hover:bg-white/5">
                                                        <td className="p-2 pl-4 text-emerald-400 font-medium">{row.subtest}</td>
                                                        <td className="p-2">{row.label}</td>
                                                        <td className="p-2 text-center text-stone-400 font-mono">{row.raw}</td>
                                                        <td className="p-2 text-center font-mono font-bold text-white">{row.standard}</td>
                                                        <td className="p-2 text-center font-mono text-[#E07A5F]">{row.percentile}</td>
                                                    </tr>
                                                ))}
                                                {(!selectedContribution.rows || selectedContribution.rows.length === 0) && (
                                                    <tr>
                                                        <td colSpan={5} className="p-4 text-center text-stone-500 italic">Aucune ligne de données détectée dans le JSON.</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                    
                                    <div className="mt-4 text-xs text-stone-500 flex items-center gap-2">
                                        <AlertTriangle size={12} className="text-amber-500"/>
                                        Cette action créera ou mettra à jour les entrées correspondantes dans les tables SQL.
                                    </div>
                                </>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-stone-600">
                                    <LayoutGrid size={48} className="mb-4 opacity-20" />
                                    <p>Sélectionnez une contribution à gauche pour voir le détail.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'library' && (
                    <div className="text-center py-20">
                        <Layers size={64} className="text-stone-700 mx-auto mb-6" />
                        <h3 className="text-2xl font-bold text-stone-500">Bibliothèque Globale</h3>
                        <p className="text-stone-600 mt-2">Ici, vous pourrez modifier ou supprimer les tests déjà validés.</p>
                        <p className="text-stone-700 text-xs mt-4">(Fonctionnalité en cours de développement)</p>
                    </div>
                )}

            </main>
        </div>
    </div>
  );
};
