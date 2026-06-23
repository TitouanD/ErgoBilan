import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { AdminService } from '../../services/admin';
import { useToast } from '../../contexts/ToastContext';

type Report = {
  id: string;
  subtest_id: string;
  reporter_id: string;
  current_score_type: string;
  suggested_score_type: string | null;
  entered_ns: number | null;
  entered_et: number | null;
  entered_pct: number | null;
  note: string | null;
  status: 'pending' | 'reviewed' | 'dismissed';
  created_at: string;
};

const StatusBadge: React.FC<{ status: Report['status'] }> = ({ status }) => {
  if (status === 'reviewed') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400">
      <CheckCircle2 size={10} /> Traité
    </span>
  );
  if (status === 'dismissed') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-stone-700/50 text-stone-400">
      <XCircle size={10} /> Ignoré
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-900/30 text-amber-400">
      <AlertCircle size={10} /> En attente
    </span>
  );
};

export const AdminSignalements: React.FC = () => {
  const { showToast } = useToast();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'reviewed' | 'dismissed'>('pending');

  const load = async () => {
    setLoading(true);
    try {
      const data = await AdminService.listScoreTypeReports();
      setReports(data as Report[]);
    } catch (e) {
      showToast('Erreur lors du chargement des signalements.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleStatus = async (id: string, status: 'reviewed' | 'dismissed') => {
    try {
      await AdminService.updateScoreTypeReportStatus(id, status);
      setReports(prev => prev.map(r => r.id === id ? { ...r, status } : r));
      showToast(status === 'reviewed' ? 'Signalement marqué traité.' : 'Signalement ignoré.', 'success');
    } catch {
      showToast('Erreur lors de la mise à jour.', 'error');
    }
  };

  const filtered = filter === 'all' ? reports : reports.filter(r => r.status === filter);
  const pendingCount = reports.filter(r => r.status === 'pending').length;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <AlertCircle size={20} className="text-amber-400" />
            Signalements Score Type
            {pendingCount > 0 && (
              <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-500 text-white text-xs font-bold">
                {pendingCount}
              </span>
            )}
          </h2>
          <p className="text-stone-400 text-sm mt-0.5">
            Signalements des praticiens sur des types de score potentiellement incorrects.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 text-stone-400 hover:text-white text-xs font-bold disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Actualiser
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5">
        {(['pending', 'all', 'reviewed', 'dismissed'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              filter === f
                ? 'bg-white/10 text-white'
                : 'text-stone-500 hover:text-stone-300'
            }`}
          >
            {{ pending: 'En attente', all: 'Tous', reviewed: 'Traités', dismissed: 'Ignorés' }[f]}
            {f === 'pending' && pendingCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[9px]">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-stone-500 text-sm">
          Chargement…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-stone-500 gap-2">
          <AlertCircle size={32} className="opacity-30" />
          <span className="text-sm">Aucun signalement {filter !== 'all' ? `"${filter}"` : ''}.</span>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(report => (
            <div
              key={report.id}
              className={`rounded-2xl border p-4 transition-colors ${
                report.status === 'pending'
                  ? 'border-amber-500/30 bg-amber-900/10'
                  : 'border-white/5 bg-white/3'
              }`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <StatusBadge status={report.status} />
                    <code className="text-[10px] bg-white/5 px-2 py-0.5 rounded font-mono text-stone-300">
                      {report.subtest_id}
                    </code>
                    <span className="text-[10px] text-stone-500">
                      {new Date(report.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-4 text-xs mt-2">
                    <div>
                      <span className="text-stone-500">Type actuel :</span>{' '}
                      <span className="font-bold text-stone-200">{report.current_score_type}</span>
                    </div>
                    {report.suggested_score_type && (
                      <div>
                        <span className="text-stone-500">Suggéré :</span>{' '}
                        <span className="font-bold text-amber-300">{report.suggested_score_type}</span>
                      </div>
                    )}
                    {report.entered_ns != null && (
                      <div><span className="text-stone-500">NS :</span> <span className="font-mono text-stone-300">{report.entered_ns}</span></div>
                    )}
                    {report.entered_et != null && (
                      <div><span className="text-stone-500">ET :</span> <span className="font-mono text-stone-300">{report.entered_et}</span></div>
                    )}
                    {report.entered_pct != null && (
                      <div><span className="text-stone-500">% :</span> <span className="font-mono text-stone-300">{report.entered_pct}</span></div>
                    )}
                  </div>

                  {report.note && (
                    <p className="text-xs text-stone-400 mt-2 italic">« {report.note} »</p>
                  )}
                </div>

                {report.status === 'pending' && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleStatus(report.id, 'reviewed')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700/30 text-emerald-300 hover:bg-emerald-700/60 text-xs font-bold transition-colors"
                    >
                      <CheckCircle2 size={12} />
                      Traité
                    </button>
                    <button
                      onClick={() => handleStatus(report.id, 'dismissed')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-700/30 text-stone-400 hover:bg-stone-700/60 text-xs font-bold transition-colors"
                    >
                      <XCircle size={12} />
                      Ignorer
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminSignalements;
