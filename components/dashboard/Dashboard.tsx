
import React, { useState, useMemo } from 'react';
import { PendingQuestionnaire, PatientFile, UserProfile } from '../../types';
import { Plus, Clock, ArrowRight, UserPlus, Users, Calendar, Search, Inbox, Archive, UserCheck, Gift, Send, Sparkles, Crown, FileText, Trash2, CheckCircle2, Link as LinkIcon, Copy, Loader2, Edit3, RotateCcw, AlertCircle } from 'lucide-react';
import { ImportAnimation } from '../shared/ImportAnimation';

interface Props {
  userProfile: UserProfile;
  pendingQuestionnaires: PendingQuestionnaire[];
  patientFiles: PatientFile[];
  onCreateNew: () => void;
  onOpenPatient: (patientId: string) => void;
  onGenerateLink: () => void;
  onShowPricing: () => void;
  onProcessPending?: (q: PendingQuestionnaire) => void;
  processingQueueId?: string | null;
  onContribute?: () => void; 
  
  draftsIndex?: Record<string, string>; 
  onResumeDraft?: (patientId: string) => void;
  isDemoMode?: boolean; 
  onCopyLink: (q: PendingQuestionnaire) => void; 
}

type TabType = 'pending' | 'active' | 'archived';

const StatCard = ({ icon: Icon, value, label, subtext, highlight = false, onClick }: any) => (
    <div 
        onClick={onClick}
        className={`p-6 rounded-[24px] border transition-all duration-300 relative overflow-hidden group cursor-pointer ${highlight ? 'bg-[#3D405B] text-white border-[#3D405B]' : 'bg-white border-stone-100 hover:border-[#E07A5F]/30 hover:shadow-lg'}`}
    >
        <div className="flex justify-between items-start mb-4 relative">
            <div className={`p-3 rounded-2xl ${highlight ? 'bg-white/10 text-white' : 'bg-stone-50 text-[#E07A5F] group-hover:bg-[#fff5f2]'}`}>
                <Icon size={24} />
            </div>
            <Icon size={80} className={`absolute -right-4 -bottom-4 opacity-5 transform rotate-12 transition-transform group-hover:scale-110 ${highlight ? 'text-white' : 'text-[#3D405B]'}`} />
        </div>
        <div>
            <div className="text-3xl font-bold font-serif mb-1">{value}</div>
            <div className={`text-sm font-bold uppercase tracking-wider mb-2 ${highlight ? 'text-stone-300' : 'text-stone-400'}`}>{label}</div>
            <div className={`text-xs px-2 py-1 rounded-lg w-fit ${highlight ? 'bg-white/10 text-stone-200' : 'bg-stone-50 text-stone-500'}`}>
                {subtext}
            </div>
        </div>
    </div>
);

// Carte Parrainage
const ReferralCard = () => {
    return (
        <div className="p-6 rounded-[24px] border border-amber-200 bg-gradient-to-br from-amber-50 to-white hover:shadow-lg hover:shadow-amber-100/50 transition-all duration-300 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10">
                <Gift size={100} className="text-amber-500 transform rotate-12" />
            </div>
            <div className="relative z-10">
                <div className="flex items-center gap-2 mb-2">
                    <div className="p-2 bg-amber-100 text-amber-600 rounded-xl"><Gift size={20} /></div>
                    <h3 className="font-bold text-amber-800 text-lg">Mois offert</h3>
                </div>
                <p className="text-sm text-stone-600 mb-4 leading-relaxed">Invitez un collègue = <strong className="text-amber-600">+1 Crédit chacun</strong>.</p>
                <div className="flex gap-2">
                    <input placeholder="Email du collègue..." className="flex-1 bg-white border border-amber-200 rounded-xl px-3 text-sm focus:border-amber-500 outline-none text-[#3D405B]" />
                    <button onClick={() => alert("Invitation simulée !")} className="bg-amber-500 text-white p-3 rounded-xl hover:bg-amber-600 transition-colors shadow-md shadow-amber-200"><Send size={18} /></button>
                </div>
            </div>
        </div>
    );
}

export const Dashboard: React.FC<Props> = ({ userProfile, pendingQuestionnaires, patientFiles, onCreateNew, onOpenPatient, onGenerateLink, onShowPricing, onProcessPending, processingQueueId, draftsIndex = {}, onResumeDraft, isDemoMode = false, onCopyLink }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>(isDemoMode ? 'pending' : 'active');
  const [showImportAnim, setShowImportAnim] = useState(false);
  const [targetDemoQ, setTargetDemoQ] = useState<PendingQuestionnaire | null>(null);

  const hoursSaved = Math.round(userProfile.totalBilansGenerated * 1.5);

  const filteredPending = useMemo(() => 
    pendingQuestionnaires.filter(q => q.label.toLowerCase().includes(searchQuery.toLowerCase())),
    [pendingQuestionnaires, searchQuery]
  );

  const activeFiles = useMemo(() => 
    patientFiles.filter(f => 
        !f.archived && 
        (f.patient.firstName + ' ' + f.patient.lastName).toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [patientFiles, searchQuery]
  );

  const archivedFiles = useMemo(() => 
    patientFiles.filter(f => 
        f.archived && 
        (f.patient.firstName + ' ' + f.patient.lastName).toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [patientFiles, searchQuery]
  );

  const currentFilesList = activeTab === 'archived' ? archivedFiles : activeFiles;

  const handleOpenPatient = (id: string) => {
      onOpenPatient(id);
  };

  const handleProcessClick = (q: PendingQuestionnaire) => {
      if (isDemoMode) {
          setTargetDemoQ(q);
          setShowImportAnim(true);
      } else {
          if (onProcessPending) onProcessPending(q);
      }
  };

  return (
    <div className="animate-in fade-in duration-700 relative">
        
        {/* ANIMATION IMPORT (DEMO SEULEMENT) */}
        <ImportAnimation 
            isOpen={showImportAnim} 
            onComplete={() => {
                setShowImportAnim(false);
                if (targetDemoQ && onProcessPending) onProcessPending(targetDemoQ);
            }} 
        />

        {/* BANDEAU STICKY */}
        {!isDemoMode && (userProfile.isTrial || userProfile.subscriptionPlan === 'free') && (
            <div className="bg-[#3D405B] text-white py-3 px-6 sticky top-20 z-30 shadow-lg flex justify-center items-center gap-4 animate-in slide-in-from-top-2">
                <div className="flex items-center gap-2 text-sm">
                    <Clock size={16} className="text-[#E07A5F] animate-pulse" />
                    <span className="font-medium hidden md:inline">Vous êtes en mode Essai Gratuit.</span>
                    <span className="font-bold text-stone-200">{userProfile.trialDaysRemaining} jours restants</span>
                </div>
                <button onClick={onShowPricing} className="bg-[#E07A5F] hover:bg-white hover:text-[#E07A5F] text-white px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 shadow-md shadow-orange-900/20">
                    <Crown size={14} /> Passer à la vitesse supérieure
                </button>
            </div>
        )}

        <div className="max-w-7xl mx-auto px-6 py-12">
            {/* 1. KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                <StatCard icon={Clock} value={`${hoursSaved}h`} label="Temps Libéré" subtext="~ 2 dimanches récupérés" highlight={true} />
                <StatCard icon={Users} value={activeFiles.length} label="Patients Actifs" subtext="+3 cette semaine" />
                <ReferralCard />
            </div>

            {/* 2. Actions */}
            <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-10">
                <div className="relative w-full md:max-w-md">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" size={20} />
                    <input 
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Rechercher..."
                        className="w-full pl-12 pr-4 py-4 bg-white border border-stone-200 rounded-[20px] shadow-sm outline-none focus:border-[#E07A5F] transition-all font-medium text-[#3D405B]"
                    />
                </div>
                <div className="flex gap-3 w-full md:w-auto">
                    <button 
                        onClick={onGenerateLink} 
                        className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-white text-[#3D405B] px-6 py-4 rounded-2xl font-bold border border-stone-200 hover:border-[#E07A5F] transition-all text-sm group shadow-sm"
                    >
                        <LinkIcon size={18} className="text-[#E07A5F] group-hover:rotate-45 transition-transform" /> 
                        <span className="hidden lg:inline">Nouveau lien Famille</span>
                    </button>
                    
                    <button onClick={onCreateNew} className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-[#E07A5F] text-white px-6 py-4 rounded-2xl font-bold shadow-lg shadow-orange-200 hover:bg-[#d0694e] transition-all text-sm h-fit">
                        <Plus size={18} /> Nouveau Dossier
                    </button>
                </div>
            </div>

            {/* 3. Onglets */}
            <div className="flex gap-8 border-b border-stone-200 mb-8 overflow-x-auto no-scrollbar">
                {[
                    { id: 'pending', label: 'En attente', icon: Inbox, count: filteredPending.length },
                    { id: 'active', label: 'Patients Actifs', icon: UserCheck, count: activeFiles.length },
                    { id: 'archived', label: 'Archives', icon: Archive, count: archivedFiles.length }
                ].map(tab => (
                    <button 
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as TabType)}
                        className={`flex items-center gap-2 pb-4 px-2 font-bold text-sm uppercase tracking-wider transition-all relative ${activeTab === tab.id ? 'text-[#3D405B]' : 'text-stone-400 hover:text-stone-600'}`}
                    >
                        <tab.icon size={18} />
                        {tab.label}
                        {tab.count > 0 && <span className="bg-stone-100 px-2 py-0.5 rounded-full text-[10px] ml-1">{tab.count}</span>}
                        {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#E07A5F] rounded-t-full animate-in slide-in-from-bottom-1"></div>}
                    </button>
                ))}
            </div>

            {/* 4. Grille */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                
                {/* VUE PENDING */}
                {activeTab === 'pending' && filteredPending.map((q) => (
                    <div key={q.id} className={`group bg-transparent border-2 border-dashed rounded-[24px] p-6 flex flex-col justify-between h-auto min-h-[12rem] hover:bg-white transition-all ${q.status === 'completed' ? 'border-emerald-300 bg-emerald-50/50' : 'border-stone-300 hover:border-[#E07A5F]'}`}>
                        <div className="flex justify-between items-start mb-4">
                            <div className="bg-white p-2 rounded-lg border border-stone-100 shadow-sm text-stone-400">
                                <Clock size={20} />
                            </div>
                            {q.status === 'completed' ? (
                                <span className="px-3 py-1 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-md uppercase flex items-center gap-1 animate-pulse">
                                    <CheckCircle2 size={12}/> Reçu
                                </span>
                            ) : (
                                <span className="px-3 py-1 bg-stone-100 text-stone-500 text-[10px] font-bold rounded-md uppercase">Envoyé</span>
                            )}
                        </div>
                        <div className="text-center mb-4">
                            <h3 className="font-serif font-bold text-lg text-[#3D405B] mb-1 truncate px-2">{q.label}</h3>
                            <p className="text-xs text-stone-400">Créé le {new Date(q.createdAt).toLocaleDateString()}</p>
                        </div>
                        
                        {q.status === 'completed' ? (
                            <div className="mt-auto">
                                <button 
                                    onClick={() => handleProcessClick(q)} 
                                    disabled={processingQueueId === q.id}
                                    className={`w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg relative overflow-hidden group/btn ${processingQueueId === q.id ? 'bg-emerald-600 text-white cursor-wait' : 'bg-[#E07A5F] text-white hover:bg-[#d0694e] shadow-orange-200'}`}
                                >
                                    <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover/btn:translate-x-[100%] transition-transform duration-700"></div>
                                    {processingQueueId === q.id ? (
                                        <>Sécurisation... <Loader2 size={16} className="animate-spin"/></>
                                    ) : (
                                        <>Importer & Déchiffrer <FileText size={16}/></>
                                    )}
                                </button>
                                {isDemoMode && (
                                    <div className="text-[10px] text-center mt-2 text-[#E07A5F] font-bold flex items-center justify-center gap-1">
                                        <Sparkles size={10} /> Scénario Démo
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="mt-auto pt-4 border-t border-stone-100 flex items-center justify-between gap-2">
                                <span className="text-xs text-stone-400 italic">En attente famille...</span>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onCopyLink(q); }}
                                    className="flex items-center gap-2 px-3 py-2 bg-stone-50 hover:bg-[#E07A5F] hover:text-white text-stone-500 rounded-lg text-xs font-bold transition-all"
                                >
                                    <Copy size={14} /> <span className="hidden sm:inline">Lien</span>
                                </button>
                            </div>
                        )}
                    </div>
                ))}

                {/* VUE ACTIVE & ARCHIVED */}
                {(activeTab === 'active' || activeTab === 'archived') && currentFilesList.map((file) => {
                    const draftDate = draftsIndex[file.id];
                    const hasDraft = !!draftDate;
                    
                    return (
                        <div 
                            key={file.id} 
                            onClick={() => handleOpenPatient(file.id)} 
                            className={`group bg-white rounded-[24px] p-6 border border-stone-100 shadow-sm hover:shadow-xl hover:shadow-stone-200/50 hover:border-[#E07A5F]/30 transition-all cursor-pointer h-64 flex flex-col relative overflow-hidden ${file.archived ? 'opacity-70 grayscale hover:grayscale-0' : ''}`}
                        >
                            <div className="flex items-center gap-4 mb-6">
                                <div className={`w-12 h-12 rounded-full flex items-center justify-center font-serif font-bold text-xl ${file.archived ? 'bg-stone-300 text-white' : 'bg-[#3D405B] text-white'}`}>
                                    {file.patient.firstName.charAt(0)}{file.patient.lastName.charAt(0)}
                                </div>
                                <div>
                                    <h3 className="font-serif font-bold text-lg text-[#3D405B] group-hover:text-[#E07A5F] transition-colors">
                                        {file.patient.firstName} {file.patient.lastName}
                                    </h3>
                                    <p className="text-[10px] text-stone-400 font-bold uppercase tracking-tighter">{file.patient.age} • {file.patient.classLevel}</p>
                                </div>
                            </div>
                            <div className="flex-1 space-y-4">
                                <div className="flex items-center gap-3 text-xs text-stone-600">
                                    <div className={`w-2 h-2 rounded-full ${file.archived ? 'bg-stone-400' : 'bg-[#E07A5F]'}`}></div>
                                    <span>{file.reports.length} interventions archivées</span>
                                </div>
                                <div className="text-xs text-stone-400 bg-stone-50 p-2 rounded-lg flex items-center gap-2">
                                    <Calendar size={14} /> Dernier contact : {new Date(file.lastInteraction).toLocaleDateString()}
                                </div>
                            </div>
                            
                            {/* BOUTON DRAFT */}
                            {hasDraft && !file.archived ? (
                                <div className="mt-4">
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); onResumeDraft && onResumeDraft(file.id); }}
                                        className="w-full py-2 bg-amber-50 text-amber-600 border border-amber-200 rounded-xl text-xs font-bold uppercase tracking-wide hover:bg-amber-100 transition-colors flex items-center justify-center gap-2"
                                    >
                                        <Edit3 size={14} /> Reprendre brouillon
                                    </button>
                                </div>
                            ) : (
                                <div className="mt-4 flex justify-end">
                                    <div className="w-8 h-8 rounded-full bg-stone-50 flex items-center justify-center group-hover:bg-[#E07A5F] group-hover:text-white transition-all">
                                        <ArrowRight size={16} />
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* EMPTY STATE */}
                {((activeTab === 'active' && activeFiles.length === 0) || 
                  (activeTab === 'pending' && filteredPending.length === 0) ||
                  (activeTab === 'archived' && archivedFiles.length === 0)) && (
                    <div className="col-span-full py-20 flex flex-col items-center text-center">
                        <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center text-stone-200 mb-4">
                            {activeTab === 'archived' ? <Archive size={32} /> : <Search size={32} />}
                        </div>
                        <h3 className="font-bold text-stone-500">Aucun résultat</h3>
                        {activeTab === 'active' && <p className="text-xs text-stone-400 mt-2">Créez un nouveau dossier pour commencer.</p>}
                        {activeTab === 'pending' && isDemoMode && <p className="text-xs text-stone-400 mt-2">Cliquez sur "Nouveau lien Famille" pour simuler un envoi.</p>}
                    </div>
                )}
            </div>
        </div>
    </div>
  );
};
