import React, { useState, useEffect } from 'react';
import type { UserProfile, FittingScoreType } from '../../types';
import { AdminService } from '../../services/admin';
import { ClinicalInsights } from './ClinicalInsights';
import { OpsMonitoring } from './OpsMonitoring';
import { AdminLibrary } from './AdminLibrary';
import { AdminIssuesBoard } from './AdminIssuesBoard';
import { AdminNormQualityBoard } from './AdminNormQualityBoard';
import { AdminUsers } from './AdminUsers';
import { X, ShieldAlert, Layers, Loader2, Ban, Activity, Cpu, ClipboardList, Users2, FlaskConical } from 'lucide-react';
import { Logger } from '../../utils/logger';

interface Props {
  userProfile: UserProfile;
  onClose: () => void;
}

export const AdminPanel: React.FC<Props> = ({ userProfile, onClose }) => {
  const [activeTab, setActiveTab] = useState<'catalogue' | 'issues' | 'norm_quality' | 'users' | 'insights' | 'ops'>('catalogue');
  const [catalogFocus, setCatalogFocus] = useState<{
    testId: string;
    subtestId?: string | null;
    suggestedScoreType?: FittingScoreType | null;
    valueFixes?: Array<{
      normId: string;
      field: 'standard_score' | 'percentile' | 'mean' | 'sd';
      value: number;
      confidence: number;
      reason: string;
    }>;
    nonce: number;
  } | null>(null);
  const [adminVerified, setAdminVerified] = useState<boolean | null>(null);
  const [checkingAdmin, setCheckingAdmin] = useState(true);

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
            onClick={() => setActiveTab('catalogue')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'catalogue' ? 'bg-[#3D405B] text-white' : 'text-stone-500 hover:bg-white/5 hover:text-white'} `}
          >
            <Layers size={18} /> Catalogue Officiel
          </button>
          <button
            onClick={() => setActiveTab('issues')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'issues' ? 'bg-amber-700 text-white' : 'text-stone-500 hover:bg-white/5 hover:text-white'} `}
          >
            <ClipboardList size={18} /> Issues Globales
          </button>
          <button
            onClick={() => setActiveTab('norm_quality')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'norm_quality' ? 'bg-fuchsia-700 text-white' : 'text-stone-500 hover:bg-white/5 hover:text-white'} `}
          >
            <FlaskConical size={18} /> Qualité Normes
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'users' ? 'bg-cyan-700 text-white' : 'text-stone-500 hover:bg-white/5 hover:text-white'} `}
          >
            <Users2 size={18} /> Utilisateurs
          </button>

          <div className="my-4 h-px bg-white/5"></div>

          <button
            onClick={() => setActiveTab('insights')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'insights' ? 'bg-indigo-600 text-white' : 'text-stone-500 hover:bg-white/5 hover:text-white'} `}
          >
            <Activity size={18} /> Science & Insights
          </button>
          <button
            onClick={() => setActiveTab('ops')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'ops' ? 'bg-emerald-700 text-white' : 'text-stone-500 hover:bg-white/5 hover:text-white'} `}
          >
            <Cpu size={18} /> Ops & Monitoring
          </button>
        </nav>

        <div className="p-4 border-t border-white/5">
          <button onClick={onClose} className="w-full py-2 text-stone-500 hover:text-white text-xs font-bold uppercase tracking-wider text-center flex items-center justify-center gap-2">
            <X size={14} /> Fermer Session
          </button>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-16 border-b border-white/5 flex items-center justify-between px-8 bg-[#1A1C23]">
          <h2 className="font-bold text-white text-lg">
            {activeTab === 'catalogue' && "Catalogue Officiel"}
            {activeTab === 'issues' && "Backlog Global des Issues"}
            {activeTab === 'norm_quality' && "Audit Fitting Global des Normes"}
            {activeTab === 'users' && "Gestion Utilisateurs & Abonnements"}
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
          {activeTab === 'catalogue' && (
            <AdminLibrary
              focusTestId={catalogFocus?.testId || null}
              focusSubtestId={catalogFocus?.subtestId || null}
              focusSuggestedScoreType={catalogFocus?.suggestedScoreType || null}
              focusValueFixes={catalogFocus?.valueFixes || []}
              focusNonce={catalogFocus?.nonce || 0}
            />
          )}
          {activeTab === 'issues' && (
            <AdminIssuesBoard
              onOpenTest={(testId) => {
                setCatalogFocus({ testId, nonce: Date.now() });
                setActiveTab('catalogue');
              }}
            />
          )}
          {activeTab === 'norm_quality' && (
            <AdminNormQualityBoard
              onOpenInCatalog={(payload) => {
                setCatalogFocus({
                  testId: payload.testId,
                  subtestId: payload.subtestId || null,
                  suggestedScoreType: payload.suggestedScoreType || null,
                  valueFixes: payload.valueFixes || [],
                  nonce: Date.now(),
                });
                setActiveTab('catalogue');
              }}
            />
          )}
          {activeTab === 'users' && <AdminUsers />}
          {activeTab === 'insights' && <ClinicalInsights />}
          {activeTab === 'ops' && <OpsMonitoring />}
        </main>
      </div>
    </div>
  );
};
