import React, { useState, useEffect } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, AlertOctagon, CheckCircle, RefreshCw, TrendingUp } from 'lucide-react';
import { AdminService } from '../../services/admin';
import { Logger } from '../../utils/logger';

type AIHealthStats = {
    daily: Array<{ date: string; requests: number; errors: number }>;
    total_requests: number;
    total_errors: number;
    error_rate_pct: number;
};

export const OpsMonitoring: React.FC = () => {
    const [stats, setStats] = useState<AIHealthStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        loadOpsData();
    }, []);

    const loadOpsData = async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const health = await AdminService.getAIHealthStats();
            setStats(health);
        } catch (e: any) {
            Logger.error('SYSTEM', 'Ops Data Load Failed', e);
            setLoadError(e?.message || 'Erreur de chargement');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return <div className="h-full flex items-center justify-center text-stone-500 animate-pulse">Chargement des données...</div>;
    }

    if (loadError || !stats) {
        return (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-stone-500">
                <AlertOctagon size={32} className="text-rose-500/60" />
                <p className="text-sm">{loadError || 'Aucune donnée disponible'}</p>
                <button
                    onClick={loadOpsData}
                    className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
                >
                    <RefreshCw size={12} /> Réessayer
                </button>
            </div>
        );
    }

    const successCount = stats.total_requests - stats.total_errors;
    const successRate = stats.total_requests === 0
        ? 100
        : parseFloat(((successCount / stats.total_requests) * 100).toFixed(1));

    return (
        <div className="grid grid-cols-12 gap-6 h-full p-6 animate-in fade-in duration-500 overflow-y-auto">

            {/* HEADER METRICS */}
            <div className="col-span-12 grid grid-cols-4 gap-4 mb-2">
                <div className="bg-[#1A1C23] border border-white/5 p-4 rounded-xl flex flex-col justify-between">
                    <div className="flex justify-between items-start">
                        <span className="text-xs font-bold text-stone-500 uppercase">Générations (30j)</span>
                        <div className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg"><TrendingUp size={16} /></div>
                    </div>
                    <div>
                        <span className="text-2xl font-mono font-bold text-white">{stats.total_requests}</span>
                        <span className="text-[10px] text-stone-500 ml-2">total</span>
                    </div>
                </div>

                <div className="bg-[#1A1C23] border border-white/5 p-4 rounded-xl flex flex-col justify-between">
                    <div className="flex justify-between items-start">
                        <span className="text-xs font-bold text-stone-500 uppercase">Taux d'erreur</span>
                        <div className="p-1.5 bg-rose-500/10 text-rose-400 rounded-lg"><AlertOctagon size={16} /></div>
                    </div>
                    <div>
                        <span className={`text-2xl font-mono font-bold ${stats.error_rate_pct > 5 ? 'text-rose-500' : 'text-white'}`}>
                            {stats.error_rate_pct}%
                        </span>
                        <span className="text-[10px] text-stone-500 ml-2">cible &lt; 1%</span>
                    </div>
                </div>

                <div className="bg-[#1A1C23] border border-white/5 p-4 rounded-xl flex flex-col justify-between">
                    <div className="flex justify-between items-start">
                        <span className="text-xs font-bold text-stone-500 uppercase">Erreurs (30j)</span>
                        <div className="p-1.5 bg-amber-500/10 text-amber-400 rounded-lg"><AlertOctagon size={16} /></div>
                    </div>
                    <div>
                        <span className="text-2xl font-mono font-bold text-white">{stats.total_errors}</span>
                        <span className="text-[10px] text-stone-500 ml-2">échecs</span>
                    </div>
                </div>

                <div className="bg-[#1A1C23] border border-white/5 p-4 rounded-xl flex flex-col justify-between">
                    <div className="flex justify-between items-start">
                        <span className="text-xs font-bold text-stone-500 uppercase">Taux de succès</span>
                        <div className="p-1.5 bg-indigo-500/10 text-indigo-400 rounded-lg"><CheckCircle size={16} /></div>
                    </div>
                    <div>
                        <span className={`text-2xl font-mono font-bold ${successRate >= 99 ? 'text-emerald-400' : successRate >= 95 ? 'text-white' : 'text-amber-400'}`}>
                            {successRate}%
                        </span>
                        <span className="text-[10px] text-stone-500 ml-2">cible ≥ 99%</span>
                    </div>
                </div>
            </div>

            {/* CHART: DAILY REQUESTS */}
            <div className="col-span-8 bg-[#1A1C23] border border-white/5 rounded-2xl p-6 relative">
                <h3 className="text-white font-bold mb-6 flex items-center gap-2">
                    <Activity size={18} className="text-[#E07A5F]" /> Générations IA — 30 derniers jours
                </h3>
                <div className="h-[300px] w-full">
                    {stats.daily.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-stone-600 text-sm">Aucune donnée sur la période</div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={stats.daily}>
                                <CartesianGrid stroke="#333" strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="date" stroke="#666" tick={{ fill: '#666', fontSize: 10 }} />
                                <YAxis stroke="#666" tick={{ fill: '#666', fontSize: 10 }} allowDecimals={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#131419', border: '1px solid #333', borderRadius: '8px', color: '#fff' }}
                                    formatter={(value: number, name: string) => [
                                        value,
                                        name === 'requests' ? 'Générations' : 'Erreurs'
                                    ]}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="requests"
                                    stroke="#E07A5F"
                                    strokeWidth={2}
                                    dot={{ r: 4, fill: '#1A1C23', stroke: '#E07A5F', strokeWidth: 2 }}
                                    activeDot={{ r: 6, fill: '#E07A5F' }}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="errors"
                                    stroke="#ef4444"
                                    strokeWidth={1.5}
                                    strokeDasharray="4 4"
                                    dot={false}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            {/* CHART: ERRORS BY DAY */}
            <div className="col-span-4 bg-[#1A1C23] border border-white/5 rounded-2xl p-6">
                <h3 className="text-white font-bold mb-6 flex items-center gap-2">
                    <AlertOctagon size={18} className="text-rose-400" /> Erreurs / jour
                </h3>
                <div className="h-[300px] w-full">
                    {stats.daily.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-stone-600 text-sm">Aucun échec</div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stats.daily}>
                                <CartesianGrid stroke="#333" strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="date" stroke="#666" tick={{ fill: '#666', fontSize: 9 }} />
                                <YAxis stroke="#666" tick={{ fill: '#666', fontSize: 10 }} allowDecimals={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#131419', border: '1px solid #333', borderRadius: '8px', color: '#fff' }}
                                    formatter={(value: number) => [value, 'Erreurs']}
                                />
                                <Bar dataKey="errors" fill="#ef4444" radius={[3, 3, 0, 0]} opacity={0.8} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            {/* REFRESH BUTTON */}
            <div className="col-span-12 flex justify-end">
                <button
                    onClick={loadOpsData}
                    className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg border border-white/10 hover:bg-white/5 text-stone-400 hover:text-white transition-colors"
                >
                    <RefreshCw size={12} /> Actualiser
                </button>
            </div>

        </div>
    );
};