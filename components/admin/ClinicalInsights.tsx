import React, { useState, useEffect, useMemo } from 'react';
import { AreaChart, Area, Bar, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Activity, AlertTriangle, Search, TrendingUp, BarChart2 } from 'lucide-react';
import { AdminService } from '../../services/admin';
import { useCatalog } from '../../contexts/CatalogContext';
import { Logger } from '../../utils/logger';
import type { InsightQualityAlert } from '../../types';

// Génère une courbe de Gauss théorique (M=100, SD=15)
const generateGaussianPoints = (mean = 100, sd = 15) => {
    const points = [];
    for (let x = mean - 4 * sd; x <= mean + 4 * sd; x += 2) {
        const y = (1 / (sd * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * Math.pow((x - mean) / sd, 2));
        points.push({ x, theoretical: y });
    }
    return points;
};

export const ClinicalInsights: React.FC = () => {
    const { catalog, ensureCatalogLoaded } = useCatalog();
    const [selectedTestId, setSelectedTestId] = useState<string>('');
    const [selectedSubtestId, setSelectedSubtestId] = useState<string>('');
    
    const [realData, setRealData] = useState<number[]>([]);
    const [anomalies, setAnomalies] = useState<InsightQualityAlert[]>([]);
    const [isLoadingData, setIsLoadingData] = useState(false);

    // Initialisation par défaut
    useEffect(() => {
        ensureCatalogLoaded();
    }, [ensureCatalogLoaded]);

    useEffect(() => {
        if (catalog.length > 0 && catalog[0].tests.length > 0) {
            setSelectedTestId(catalog[0].tests[0].id);
            if (catalog[0].tests[0].subtests.length > 0) {
                setSelectedSubtestId(catalog[0].tests[0].subtests[0].id);
            }
        }
        loadAnomalies();
    }, [catalog]);

    useEffect(() => {
        if (selectedSubtestId) {
            loadChartData(selectedSubtestId);
        }
    }, [selectedSubtestId]);

    const loadChartData = async (subId: string) => {
        setIsLoadingData(true);
        try {
            const data = await AdminService.getInsightsForSubtest(subId);
            setRealData(data);
        } catch (e) {
            Logger.error('SYSTEM', "Error fetching insights", e);
        } finally {
            setIsLoadingData(false);
        }
    };

    const loadAnomalies = async () => {
        try {
            const alerts = await AdminService.getQualityAlerts();
            setAnomalies(alerts);
        } catch (e) {
            Logger.error('SYSTEM', 'Error fetching quality alerts', e);
        }
    };

    // Préparation des données pour le graphique
    const chartData = useMemo(() => {
        const gaussian = generateGaussianPoints(100, 15);
        
        // Création des buckets pour l'histogramme
        const buckets: Record<number, number> = {};
        realData.forEach(val => {
            // On normalise grossièrement si ce n'est pas du standard score (ex: Scaled 1-19 -> 100+/-15)
            // Pour l'instant on suppose que computed_standard est bien sur base 100
            // On bin par tranche de 5
            const bin = Math.floor(val / 5) * 5;
            buckets[bin] = (buckets[bin] || 0) + 1;
        });

        // Calcul du scaling factor pour que l'histogramme matche la hauteur de la courbe
        const maxBucketCount = Math.max(...Object.values(buckets), 1);
        const maxGaussianY = Math.max(...gaussian.map(p => p.theoretical));
        const scaleFactor = maxGaussianY / maxBucketCount; // Normalisation hauteur

        // Merge
        return gaussian.map(p => {
            const binVal = buckets[Math.floor(p.x / 5) * 5] || 0;
            return {
                x: p.x,
                theoretical: p.theoretical, // Courbe
                actual: binVal * scaleFactor // Histogramme mis à l'échelle
            };
        });
    }, [realData]);

    const activeTest = catalog.flatMap(c => c.tests).find(t => t.id === selectedTestId);

    return (
        <div className="grid grid-cols-12 gap-6 h-full p-6 animate-in fade-in duration-500">
            
            {/* COLONNE GAUCHE : SÉLECTEUR & ANOMALIES */}
            <div className="col-span-4 flex flex-col gap-6">
                
                {/* SÉLECTEUR */}
                <div className="bg-[#1A1C23] border border-white/5 p-6 rounded-2xl">
                    <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                        <Search size={18} className="text-[#E07A5F]" /> Sélection du Test
                    </h3>
                    
                    <div className="space-y-4">
                        <div>
                            <label className="text-[10px] uppercase font-bold text-stone-500 mb-1 block">Test</label>
                            <select 
                                value={selectedTestId}
                                onChange={(e) => {
                                    setSelectedTestId(e.target.value);
                                    const t = catalog.flatMap(c => c.tests).find(x => x.id === e.target.value);
                                    if(t && t.subtests.length > 0) setSelectedSubtestId(t.subtests[0].id);
                                }}
                                className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-white outline-none focus:border-[#E07A5F]"
                            >
                                {catalog.map(cat => (
                                    <optgroup key={cat.id} label={cat.name}>
                                        {cat.tests.map(t => <option key={t.id} value={t.id} className="bg-[#23252F] text-stone-200">{t.name}</option>)}
                                    </optgroup>
                                ))}
                            </select>
                        </div>

                        {activeTest && (
                            <div>
                                <label className="text-[10px] uppercase font-bold text-stone-500 mb-1 block">Sous-test</label>
                                <select 
                                    value={selectedSubtestId}
                                    onChange={(e) => setSelectedSubtestId(e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-white outline-none focus:border-[#E07A5F]"
                                >
                                    {activeTest.subtests.map(s => (
                                        <option key={s.id} value={s.id} className="bg-[#23252F] text-stone-200">{s.displayName || s.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                {/* ALERTES QUALITÉ */}
                <div className="bg-[#1A1C23] border border-white/5 p-6 rounded-2xl flex-1">
                    <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                        <AlertTriangle size={18} className="text-rose-500" /> Anomalies Détectées
                    </h3>
                    
                    {anomalies.length === 0 ? (
                        <div className="text-center py-10 text-stone-500 text-sm">
                            <CheckCircle2 size={32} className="mx-auto mb-2 text-emerald-500/50" />
                            Aucune anomalie majeure.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {anomalies.map((a, idx) => (
                                <div key={idx} className="bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="text-rose-300 font-bold text-xs truncate w-2/3">{a.testName || a.testId}</span>
                                        <span className="text-[10px] bg-rose-500 text-white px-2 rounded-full font-bold">{a.extremeRate.toFixed(1)}% Extrêmes</span>
                                    </div>
                                    <p className="text-[10px] text-stone-400">{a.extreme} extremes sur {a.total} passations.</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* COLONNE DROITE : VISUALISATION */}
            <div className="col-span-8 bg-[#1A1C23] border border-white/5 rounded-2xl p-6 flex flex-col relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                    <Activity size={120} className="text-white" />
                </div>

                <div className="flex justify-between items-center mb-8 relative z-10">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <TrendingUp size={24} className="text-[#E07A5F]" /> Comparateur de Courbes
                        </h2>
                        <p className="text-stone-500 text-xs mt-1">Overlay : Théorie (Courbe) vs Réalité Terrain (Barres).</p>
                    </div>
                    <div className="flex gap-4 text-xs font-bold">
                        <div className="flex items-center gap-2 text-[#E07A5F]">
                            <div className="w-3 h-3 bg-[#E07A5F] rounded-full"></div> Théorie (Gauss)
                        </div>
                        <div className="flex items-center gap-2 text-[#81B29A]">
                            <div className="w-3 h-3 bg-[#81B29A] rounded-sm"></div> Réalité (Data)
                        </div>
                    </div>
                </div>

                <div className="flex-1 w-full min-h-[400px]">
                    {isLoadingData ? (
                        <div className="h-full flex items-center justify-center text-stone-500 animate-pulse">Chargement des données...</div>
                    ) : realData.length < 5 ? (
                        <div className="h-full flex flex-col items-center justify-center text-stone-500">
                            <BarChart2 size={48} className="mb-4 opacity-20" />
                            <p>Pas assez de données pour ce test ({realData.length} entrées).</p>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                                <CartesianGrid stroke="#333" strokeDasharray="3 3" vertical={false} />
                                <XAxis 
                                    dataKey="x" 
                                    stroke="#666" 
                                    tick={{ fill: '#666', fontSize: 10 }} 
                                    domain={[40, 160]} 
                                    type="number"
                                    allowDataOverflow={true}
                                />
                                <YAxis hide />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#131419', border: '1px solid #333', borderRadius: '8px', color: '#fff' }}
                                    formatter={(value: any, name: string) => [name === 'actual' ? 'Volume' : 'Densité', name === 'actual' ? 'Réalité' : 'Théorie']}
                                    labelFormatter={(label) => `Note Standard : ${Math.round(label)}`}
                                />
                                <ReferenceLine x={100} stroke="#444" strokeDasharray="3 3" />
                                
                                {/* Théorie (Area) */}
                                <Area 
                                    type="monotone" 
                                    dataKey="theoretical" 
                                    fill="#E07A5F" 
                                    fillOpacity={0.1} 
                                    stroke="#E07A5F" 
                                    strokeWidth={2}
                                    activeDot={false}
                                />

                                {/* Réalité (Bar) */}
                                <Bar 
                                    dataKey="actual" 
                                    barSize={20} 
                                    fill="#81B29A" 
                                    opacity={0.6}
                                    radius={[4, 4, 0, 0]}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    )}
                </div>

                <div className="mt-4 p-4 bg-white/5 rounded-xl text-xs text-stone-400">
                    <strong className="text-white block mb-1">Interprétation :</strong>
                    Si les barres vertes sont décalées vers la gauche par rapport à la courbe rouge, cela signifie que le test est globalement "plus difficile" pour la population actuelle que ce que prévoit l'étalonnage théorique (Glissement Normatif).
                </div>
            </div>
        </div>
    );
};

// Icone manquante
const CheckCircle2 = ({ size, className }: any) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>
);
