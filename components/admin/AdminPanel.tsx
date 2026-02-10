
import React, { useState, useEffect } from 'react';
import { Contribution, UserProfile, CandidateRow, CandidateDetails, ExtractedRow } from '../../types';
import { AdminService } from '../../services/admin';
import { ClinicalInsights } from './ClinicalInsights'; 
import { OpsMonitoring } from './OpsMonitoring';
import { AdminLibrary } from './AdminLibrary';
import { DedupManager } from './DedupManager';
import { Check, X, FileText, LayoutGrid, ShieldAlert, Layers, Loader2, Database, Ban, Activity, Cpu, ArrowUpRight, GitMerge } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { Logger } from '../../utils/logger';

interface Props {
  userProfile: UserProfile; 
  onClose: () => void;
}

export const AdminPanel: React.FC<Props> = ({ userProfile, onClose }) => {
  const [activeTab, setActiveTab] = useState<'validation' | 'library' | 'dedup' | 'insights' | 'ops'>('validation');
  
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [selectedDetails, setSelectedDetails] = useState<CandidateDetails | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [adminVerified, setAdminVerified] = useState<boolean | null>(null);
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const toast = useToast();

  useEffect(() => {
      let mounted = true;
      const verify = async () => {
          setCheckingAdmin(true);
          try {
              const ok = await AdminService.adminCheck();
              if (mounted) setAdminVerified(ok);
          } catch (e) {
              Logger.error('AUTH', 'Admin check failed', e);
              if (mounted) setAdminVerified(false);
          } finally {
              if (mounted) setCheckingAdmin(false);
          }
      };
      verify();
      return () => { mounted = false; };
  }, []);

  useEffect(() => {
      if (adminVerified && activeTab === 'validation') loadCandidates();
  }, [activeTab, adminVerified]);

  if (checkingAdmin) {
      return (
          <div className="min-h-screen bg-[#1A1C23] flex items-center justify-center text-stone-400">
              <Loader2 size={32} className="animate-spin mr-2" /> Vérification des droits...
          </div>
      );
  }

  if (!adminVerified) {
      return (
          <div className="min-h-screen bg-rose-950 flex flex-col items-center justify-center text-white">
              <Ban size={64} className="mb-4" />
              <h1 className="text-3xl font-bold">ACCÈS INTERDIT</h1>
              <p className="mt-2 text-rose-200">Incident de sécurité signalé.</p>
              <button onClick={onClose} className="mt-8 px-6 py-2 bg-white text-rose-900 rounded-lg font-bold">Retour</button>
          </div>
      );
  }

  const loadCandidates = async () => {
      setIsLoading(true);
      try {
          const data = await AdminService.getCandidates();
          setCandidates(data);
          setSelectedDetails(null);
      } catch (e) {
          Logger.error('SYSTEM', "Erreur chargement admin:", e);
      } finally {
          setIsLoading(false);
      }
  };

  const handleSelectCandidate = async (candidate: CandidateRow) => {
      setSelectedDetails(null); // Reset UI
      try {
          const details = await AdminService.getCandidateDetails(candidate.id);
          setSelectedDetails(details);
      } catch (e) {
          toast.error("Impossible de charger les détails du test.");
      }
  };

  const handleAction = async (action: 'promote' | 'delete') => {
      if (!selectedDetails) return;
      setIsProcessing(true);
      try {
          if (action === 'delete') {
              await AdminService.deleteTest(selectedDetails.id);
              toast.success("Test supprimé (Rejeté).");
          } else {
              const result = await AdminService.promoteTest(selectedDetails.id);
              if (result.merged) {
                  toast.success(`Fusionné dans le test public « ${result.targetName} » !`);
              } else {
                  toast.success("Test promu en Public !");
              }
          }
          await loadCandidates();
      } catch (e) {
          Logger.error('DB', "Erreur action admin:", e);
          toast.error("Erreur opération.");
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
                        <Database size={18} /> Promotion Tests
                    </div>
                    {candidates.length > 0 && (
                        <span className="bg-white text-[#E07A5F] px-2 py-0.5 rounded-full text-[10px] font-extrabold">{candidates.length}</span>
                    )}
                </button>
                <button 
                    onClick={() => setActiveTab('library')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'library' ? 'bg-[#3D405B] text-white' : 'text-stone-500 hover:bg-white/5 hover:text-white'}`}
                >
                    <Layers size={18} /> Catalogue Officiel
                </button>
                <button 
                    onClick={() => setActiveTab('dedup')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'dedup' ? 'bg-violet-600 text-white' : 'text-stone-500 hover:bg-white/5 hover:text-white'}`}
                >
                    <GitMerge size={18} /> Déduplication
                </button>
                
                <div className="my-4 h-px bg-white/5"></div>

                <button 
                    onClick={() => setActiveTab('insights')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'insights' ? 'bg-indigo-600 text-white' : 'text-stone-500 hover:bg-white/5 hover:text-white'}`}
                >
                    <Activity size={18} /> Science & Insights
                </button>

                <button 
                    onClick={() => setActiveTab('ops')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'ops' ? 'bg-emerald-700 text-white' : 'text-stone-500 hover:bg-white/5 hover:text-white'}`}
                >
                    <Cpu size={18} /> Ops & Monitoring
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
            
            <header className="h-16 border-b border-white/5 flex items-center justify-between px-8 bg-[#1A1C23]">
                <h2 className="font-bold text-white text-lg">
                    {activeTab === 'validation' && "Validation & Promotion (Tests Privés -> Publics)"}
                    {activeTab === 'library' && "Visualisation Catalogue"}
                    {activeTab === 'dedup' && "Déduplication & Fusion de Tests"}
                    {activeTab === 'insights' && "Analyse Statistique & Normative"}
                    {activeTab === 'ops' && "Supervision Technique & IA"}
                </h2>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-stone-500 bg-white/5 px-3 py-1.5 rounded-full">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        Mode Super-Admin
                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-0 bg-[#1A1C23]">
                
                {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <Loader2 size={40} className="text-[#E07A5F] animate-spin" />
                    </div>
                ) : (
                    <>
                        {activeTab === 'validation' && (
                            <div className="grid grid-cols-12 gap-8 h-full p-8">
                                {/* LISTE CANDIDATS */}
                                <div className="col-span-4 space-y-4 overflow-y-auto max-h-full pr-2 custom-scrollbar">
                                    <h3 className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-4">Candidats Privés ({candidates.length})</h3>
                                    {candidates.map(c => (
                                        <div 
                                            key={c.id} 
                                            onClick={() => handleSelectCandidate(c)}
                                            className={`p-4 rounded-xl border cursor-pointer transition-all ${selectedDetails?.id === c.id ? 'bg-white/10 border-[#E07A5F] ring-1 ring-[#E07A5F]' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}
                                        >
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="p-1.5 bg-[#3D405B] rounded text-white"><FileText size={14}/></div>
                                                    <span className="font-bold text-sm text-white truncate max-w-[150px]">
                                                        {c.name || `ID: ${c.id.substring(0,8)}...`}
                                                    </span>
                                                </div>
                                                <span className="text-[10px] bg-white/10 text-stone-300 px-2 py-0.5 rounded font-bold uppercase">
                                                    {c.subtest_count || '?'} subs
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center text-xs text-stone-500">
                                                <span>Auteur: {c.author || 'Inconnu'}</span>
                                                <span>{new Date(c.created_at).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                    ))}
                                    {candidates.length === 0 && (
                                        <div className="text-center py-20 text-stone-600 bg-white/5 rounded-xl border border-dashed border-white/10 p-4">
                                            <Check size={40} className="mx-auto mb-4 opacity-20" />
                                            <p className="mb-2">Aucun test privé à promouvoir.</p>
                                        </div>
                                    )}
                                </div>

                                {/* DETAIL DROITE */}
                                <div className="col-span-8 bg-[#131419] rounded-2xl border border-white/5 p-6 flex flex-col h-full">
                                    {selectedDetails ? (
                                        <>
                                            <div className="flex justify-between items-start mb-6">
                                                <div>
                                                    <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                                                        {selectedDetails.testName}
                                                        <span className="text-xs bg-[#E07A5F]/20 text-[#E07A5F] px-2 py-1 rounded border border-[#E07A5F]/50">Privé</span>
                                                    </h3>
                                                    <p className="text-xs text-stone-500 uppercase tracking-widest flex items-center gap-2">
                                                        <ArrowUpRight size={12}/> Prêt pour promotion Publique
                                                    </p>
                                                </div>
                                                <div className="flex gap-2">
                                                    <button 
                                                        onClick={() => handleAction('delete')}
                                                        disabled={isProcessing}
                                                        className="px-4 py-2 rounded-lg border border-white/10 text-stone-400 hover:text-white hover:bg-white/5 text-xs font-bold uppercase transition-all disabled:opacity-50"
                                                    >
                                                        Rejeter
                                                    </button>
                                                    <button 
                                                        onClick={() => handleAction('promote')}
                                                        disabled={isProcessing}
                                                        className="px-6 py-2 rounded-lg bg-[#E07A5F] text-white hover:bg-[#d0694e] text-xs font-bold uppercase shadow-lg shadow-orange-900/30 transition-all flex items-center gap-2 disabled:opacity-50"
                                                    >
                                                        {isProcessing ? <Loader2 size={16} className="animate-spin"/> : <Check size={16} />} 
                                                        Promouvoir (Public)
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Table de prévisualisation */}
                                            <div className="flex-1 bg-white/5 rounded-xl border border-white/5 overflow-y-auto custom-scrollbar">
                                                <table className="w-full text-sm text-left text-stone-300">
                                                    <thead className="bg-[#1A1C23] font-bold text-xs uppercase text-stone-500 sticky top-0 z-10">
                                                        <tr>
                                                            <th className="p-3 pl-4">Sous-test</th>
                                                            <th className="p-3">Norme (Âge/Classe)</th>
                                                            <th className="p-3 text-center">Moyenne / Min</th>
                                                            <th className="p-3 text-center">SD / Max</th>
                                                            <th className="p-3 text-center">Score (Si Lookup)</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-white/5">
                                                        {selectedDetails.rows?.map((row: ExtractedRow, idx: number) => (
                                                            <tr key={idx} className="hover:bg-white/5">
                                                                <td className="p-2 pl-4 text-emerald-400 font-medium">{row.subtest}</td>
                                                                <td className="p-2">{row.label}</td>
                                                                {/* Affichage hybride selon type (Parametrique ou Lookup) */}
                                                                <td className="p-2 text-center text-stone-400 font-mono">
                                                                    {row.mean !== null ? `M=${row.mean}` : row.raw}
                                                                </td>
                                                                <td className="p-2 text-center font-mono text-stone-400">
                                                                    {row.sd !== null ? `SD=${row.sd}` : ''}
                                                                </td>
                                                                <td className="p-2 text-center font-mono font-bold text-white">
                                                                    {row.standard ? `NS=${row.standard}` : '-'}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center text-stone-600">
                                            <LayoutGrid size={48} className="mb-4 opacity-20" />
                                            <p>Sélectionnez un candidat à gauche pour voir le détail.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'library' && <AdminLibrary />}

                        {activeTab === 'dedup' && <DedupManager />}

                        {activeTab === 'insights' && <ClinicalInsights />}
                        {activeTab === 'ops' && <OpsMonitoring />}
                    </>
                )}

            </main>
        </div>
    </div>
  );
};
