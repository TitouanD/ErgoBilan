import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, Cpu, AlertOctagon, Zap, Bug, RefreshCw, Terminal } from 'lucide-react';
import { AdminService } from '../../services/admin';
import { Logger } from '../../utils/logger';

export const OpsMonitoring: React.FC = () => {
    const [stats, setStats] = useState<any>(null);
    const [failures, setFailures] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadOpsData();
    }, []);

    const loadOpsData = async () => {
        setLoading(true);
        try {
            const [health, errors] = await Promise.all([
                AdminService.getAIHealthStats(),
                AdminService.getAIFailures()
            ]);
            setStats(health);
            setFailures(errors);
        } catch (e) {
            Logger.error('SYSTEM', "Ops Data Load Failed", e);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return <div className="h-full flex items-center justify-center text-stone-500 animate-pulse">Initialisation des sondes...</div>;
    }

    return (
        <div className="grid grid-cols-12 gap-6 h-full p-6 animate-in fade-in duration-500 overflow-y-auto">
            
            {/* HEADER METRICS */}
            <div className="col-span-12 grid grid-cols-4 gap-4 mb-2">
                <div className="bg-[#1A1C23] border border-white/5 p-4 rounded-xl flex flex-col justify-between">
                    <div className="flex justify-between items-start">
                        <span className="text-xs font-bold text-stone-500 uppercase">Coût (7j)</span>
                        <div className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg"><Zap size={16}/></div>
                    </div>
                    <div>
                        <span className="text-2xl font-mono font-bold text-white">${stats?.totalCost}</span>
                        <span className="text-[10px] text-stone-500 ml-2">est.</span>
                    </div>
                </div>

                <div className="bg-[#1A1C23] border border-white/5 p-4 rounded-xl flex flex-col justify-between">
                    <div className="flex justify-between items-start">
                        <span className="text-xs font-bold text-stone-500 uppercase">Taux d'erreur</span>
                        <div className="p-1.5 bg-rose-500/10 text-rose-400 rounded-lg"><AlertOctagon size={16}/></div>
                    </div>
                    <div>
                        <span className={`text-2xl font-mono font-bold ${stats?.errorRate > 5 ? 'text-rose-500' : 'text-white'}`}>
                            {stats?.errorRate}%
                        </span>
                        <span className="text-[10px] text-stone-500 ml-2">target &lt; 1%</span>
                    </div>
                </div>

                <div className="bg-[#1A1C23] border border-white/5 p-4 rounded-xl flex flex-col justify-between">
                    <div className="flex justify-between items-start">
                        <span className="text-xs font-bold text-stone-500 uppercase">Charge Moy.</span>
                        <div className="p-1.5 bg-indigo-500/10 text-indigo-400 rounded-lg"><Cpu size={16}/></div>
                    </div>
                    <div>
                        <span className="text-2xl font-mono font-bold text-white">35k</span>
                        <span className="text-[10px] text-stone-500 ml-2">tokens/req</span>
                    </div>
                </div>

                <div className="bg-[#1A1C23] border border-white/5 p-4 rounded-xl flex flex-col justify-between">
                    <div className="flex justify-between items-start">
                        <span className="text-xs font-bold text-stone-500 uppercase">Latence Moy.</span>
                        <div className="p-1.5 bg-amber-500/10 text-amber-400 rounded-lg"><Activity size={16}/></div>
                    </div>
                    <div>
                        <span className="text-2xl font-mono font-bold text-white">4.2s</span>
                        <span className="text-[10px] text-stone-500 ml-2">p95</span>
                    </div>
                </div>
            </div>

            {/* CHART: TOKEN USAGE */}
            <div className="col-span-8 bg-[#1A1C23] border border-white/5 rounded-2xl p-6 relative">
                <h3 className="text-white font-bold mb-6 flex items-center gap-2">
                    <Activity size={18} className="text-[#E07A5F]" /> Health Check : Token Consumption
                </h3>
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={stats?.daily}>
                            <CartesianGrid stroke="#333" strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="date" stroke="#666" tick={{fill: '#666', fontSize: 10}} />
                            <YAxis stroke="#666" tick={{fill: '#666', fontSize: 10}} />
                            <Tooltip 
                                contentStyle={{ backgroundColor: '#131419', border: '1px solid #333', borderRadius: '8px', color: '#fff' }}
                            />
                            <Line 
                                type="monotone" 
                                dataKey="tokens" 
                                stroke="#E07A5F" 
                                strokeWidth={2} 
                                dot={{r: 4, fill: '#1A1C23', stroke: '#E07A5F', strokeWidth: 2}} 
                                activeDot={{r: 6, fill: '#E07A5F'}}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* DEAD LETTER QUEUE */}
            <div className="col-span-4 bg-[#1A1C23] border border-white/5 rounded-2xl p-6 flex flex-col">
                <h3 className="text-white font-bold mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Bug size={18} className="text-rose-500" /> Échecs Récents
                    </div>
                    <span className="bg-white/5 text-stone-400 text-[10px] px-2 py-1 rounded-full">{failures.length}</span>
                </h3>
                
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3">
                    {failures.length === 0 ? (
                        <div className="text-center py-10 text-stone-600 italic text-xs">
                            Aucune erreur récente.
                        </div>
                    ) : (
                        failures.map((err, idx) => (
                            <div key={idx} className="bg-white/5 border border-white/5 p-3 rounded-lg hover:border-rose-500/30 transition-all group">
                                <div className="flex justify-between items-start mb-1">
                                    <span className="text-[10px] font-mono text-rose-400 bg-rose-500/10 px-1.5 rounded">{err.type}</span>
                                    <span className="text-[10px] text-stone-600">{new Date(err.date).toLocaleTimeString()}</span>
                                </div>
                                <p className="text-xs text-stone-300 font-mono mb-2 line-clamp-2">
                                    {err.context}
                                </p>
                                <div className="flex justify-between items-center pt-2 border-t border-white/5">
                                    <span className="text-[10px] text-stone-500 truncate max-w-[100px]">{err.user}</span>
                                    <button className="text-[10px] bg-white/5 hover:bg-white/10 text-stone-300 px-2 py-1 rounded flex items-center gap-1 transition-colors">
                                        <Terminal size={10} /> Inspect
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* ACTION LOGS (Console Output Simulated) */}
            <div className="col-span-12 bg-[#0d0e11] rounded-xl p-4 font-mono text-[10px] text-emerald-500/80 h-32 overflow-hidden relative">
                <div className="absolute top-2 right-2 text-stone-600">Live Logs</div>
                <div className="space-y-1">
                    <p>[INFO] AI Service initialized. Model: gemini-3-flash-preview</p>
                    <p>[INFO] Ops Monitor: Polling stats every 60s...</p>
                    <p className="text-stone-500">[DEBUG] Token consumption within quota (85%)</p>
                    <p>[INFO] 3 pending contributions in queue.</p>
                    <p className="text-amber-500">[WARN] High latency detected on request #req_1294 (8.2s)</p>
                </div>
            </div>

        </div>
    );
};