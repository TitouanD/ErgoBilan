
import React, { useState } from 'react';
import { PatientFile, TestSession, Patient, ScoreResult } from '../../types';
import { ArrowLeft, Plus, TrendingUp, ChevronRight, Zap, LineChart as ChartIcon, FileText, Calendar, ChevronDown, ChevronUp, Lock, Unlock, AlertTriangle } from 'lucide-react';
import { CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, XAxis, YAxis } from 'recharts';
import { TEST_CATALOG } from '../../data/testCatalog';
import { SubtestRowCheck } from '../assessment/Step2Tests';

interface Props {
  file: PatientFile;
  onBack: () => void;
  onNewBilan: (type: 'initial' | 'reevaluation') => void;
  onQuickEntry: () => void;
  onOpenReport: (reportId: string) => void;
  draftAvailable?: boolean;
  onResumeDraft?: () => void;
}

const findSubtestDefInCatalog = (subId: string) => {
    for (const cat of TEST_CATALOG) {
        for (const test of cat.tests) {
            const sub = test.subtests.find(s => s.id === subId);
            if (sub) return { test, sub };
        }
    }
    return null;
};

const SessionRow: React.FC<{ session: TestSession; patient: Patient }> = ({ session, patient }) => {
    const [isOpen, setIsOpen] = useState(false);
    
    const knownTestDef = TEST_CATALOG.flatMap(c => c.tests).find(t => t.id === session.testId);

    const itemsToRender = knownTestDef 
        ? knownTestDef.subtests.map(st => ({ 
            key: st.id, 
            def: { test: knownTestDef, sub: st }, 
            res: session.results[st.id] 
          }))
        : Object.entries(session.results).map(([subId, res]) => ({ 
            key: subId, 
            def: findSubtestDefInCatalog(subId), 
            res: res as ScoreResult 
          }));

    const validScores = (Object.values(session.results) as ScoreResult[]).filter(r => r.status === 'validated');
    const avgZ = validScores.reduce((acc, curr) => acc + curr.zScore, 0) / (validScores.length || 1);
    
    let statusColor = "text-stone-400";
    if(validScores.length > 0) {
        if (avgZ <= -2) statusColor = "text-[#E07A5F]";
        else if (avgZ <= -1) statusColor = "text-[#F2CC8F]";
        else statusColor = "text-[#81B29A]";
    }

    return (
        <div className={`border-b border-stone-100 transition-all duration-300 ${isOpen ? 'bg-white rounded-2xl shadow-lg border-transparent my-4' : 'hover:bg-stone-50'}`}>
            <div 
                onClick={() => setIsOpen(!isOpen)} 
                className="flex items-center justify-between p-5 cursor-pointer"
            >
                <div className="flex items-center gap-6">
                    <div className="flex flex-col items-center min-w-[60px]">
                        <span className="text-xs font-bold text-stone-400 uppercase">{new Date(session.date).toLocaleDateString('fr-FR', { month: 'short' })}</span>
                        <span className="text-xl font-serif font-bold text-[#3D405B]">{new Date(session.date).getDate()}</span>
                    </div>
                    <div className="h-8 w-px bg-stone-200"></div>
                    <div>
                        <h4 className="font-bold text-[#3D405B] text-lg">{session.testName}</h4>
                        <p className="text-xs text-stone-400 font-medium">{Object.keys(session.results).length} épreuves saisies</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-6">
                    <div className={`flex items-center gap-2 font-bold text-sm ${statusColor}`}>
                        <div className={`w-2 h-2 rounded-full bg-current`}></div>
                        {validScores.length > 0 ? "Analysé" : "Brouillon"}
                    </div>
                    {isOpen ? <ChevronUp size={20} className="text-stone-300"/> : <ChevronDown size={20} className="text-stone-300"/>}
                </div>
            </div>

            {isOpen && (
                <div className="px-6 pb-6 pt-2 animate-in slide-in-from-top-2">
                    <div className="bg-stone-50 rounded-xl p-6 border border-stone-100">
                        <div className="flex items-center gap-2 mb-6 text-emerald-600 font-bold text-xs uppercase tracking-widest">
                            <Unlock size={14} /> Consultation Gratuite Illimitée
                        </div>
                        <div className="space-y-2">
                            {itemsToRender.map((item) => {
                                if (!item.res) return null; 

                                if (item.def) {
                                    return (
                                        <div key={item.key}>
                                            <SubtestRowCheck 
                                                testId={item.def.test.id}
                                                patient={patient}
                                                subtest={item.def.sub}
                                                result={item.res}
                                                onChange={() => {}}
                                                readOnly={true}
                                            />
                                        </div>
                                    );
                                } else {
                                    return (
                                        <div key={item.key} className="p-4 bg-white rounded-lg mb-2 text-sm text-stone-600 border border-stone-200 flex justify-between items-center">
                                            <div>
                                                <span className="font-bold uppercase text-xs text-stone-400 mr-2">{item.key}</span>
                                                <span className="font-mono font-bold text-[#3D405B]">Brut: {item.res.raw}</span>
                                            </div>
                                            <span className="text-xs text-stone-400 italic bg-stone-100 px-2 py-1 rounded">Test archivé (Définition manquante)</span>
                                        </div>
                                    );
                                }
                            })}
                            
                            {itemsToRender.length === 0 && (
                                <p className="text-stone-400 italic text-sm text-center py-4">Aucune donnée affichable.</p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};


export const PatientDetail: React.FC<Props> = ({ file, onBack, onNewBilan, onQuickEntry, onOpenReport, draftAvailable, onResumeDraft }) => {
  const chartData = file.sessions ? file.sessions.map(s => ({
      date: new Date(s.date).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }),
      score: 10 + (Math.random() * 4 - 2), 
      label: s.testName
  })) : [];

  return (
    <div className="max-w-7xl mx-auto px-6 py-10 animate-in slide-in-from-right duration-500">
      
      <button onClick={onBack} className="flex items-center gap-2 text-stone-400 hover:text-[#3D405B] font-bold text-[10px] uppercase tracking-widest mb-8 transition-colors">
        <ArrowLeft size={16} /> Retour Dashboard
      </button>

      {draftAvailable && (
          <div className="mb-8 p-4 bg-amber-50 border-l-4 border-amber-400 rounded-r-xl shadow-sm flex items-center justify-between animate-in slide-in-from-top-2">
              <div className="flex items-center gap-3">
                  <div className="p-2 bg-white rounded-full text-amber-500 shadow-sm">
                      <AlertTriangle size={20} />
                  </div>
                  <div>
                      <h3 className="font-bold text-amber-900 text-sm">Brouillon de bilan non terminé</h3>
                      <p className="text-xs text-amber-700">Vous avez un travail en cours pour ce patient.</p>
                  </div>
              </div>
              <button 
                  onClick={onResumeDraft}
                  className="px-6 py-2 bg-amber-500 text-white rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-amber-600 transition-colors shadow-md"
              >
                  Reprendre
              </button>
          </div>
      )}

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
        <div className="flex items-center gap-6">
            <div className="w-20 h-20 rounded-2xl bg-[#3D405B] text-white flex items-center justify-center font-serif font-bold text-3xl shadow-xl shadow-[#3D405B]/10 transform -rotate-3">
                {file.patient.firstName.charAt(0)}{file.patient.lastName.charAt(0)}
            </div>
            <div>
                <h1 className="font-serif text-4xl font-bold text-[#3D405B] mb-1">{file.patient.firstName} {file.patient.lastName}</h1>
                <div className="flex gap-2">
                    <span className="text-[10px] font-bold uppercase bg-stone-100 px-2 py-1 rounded text-stone-500">{file.patient.age}</span>
                    <span className="text-[10px] font-bold uppercase bg-[#E07A5F]/10 px-2 py-1 rounded text-[#E07A5F]">{file.patient.classLevel}</span>
                </div>
            </div>
        </div>
        
        <div className="flex gap-3">
             <button onClick={onQuickEntry} className="flex items-center gap-2 bg-white text-[#3D405B] px-6 py-4 rounded-2xl font-bold shadow-sm border border-stone-200 hover:bg-stone-50 hover:border-[#E07A5F] transition-all text-sm group">
                <Plus size={18} className="text-[#E07A5F]" /> 
                <span className="group-hover:text-[#E07A5F]">Saisie Rapide</span>
            </button>
            <button 
                onClick={() => onNewBilan('reevaluation')}
                className="flex items-center gap-2 bg-[#3D405B] text-white px-8 py-4 rounded-2xl font-bold shadow-xl shadow-stone-300 hover:bg-[#2c2e42] transition-all hover:-translate-y-1 text-sm group relative overflow-hidden"
            >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
                <Zap size={18} className="text-[#F2CC8F]" /> 
                Générer Bilan PDF
            </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-12">
            <div className="bg-white rounded-[32px] p-8 border border-stone-100 shadow-sm relative overflow-hidden">
                <div className="flex justify-between items-start mb-8">
                    <div>
                        <h2 className="font-serif text-xl font-bold text-[#3D405B] flex items-center gap-2">
                            <ChartIcon size={24} className="text-[#E07A5F]" /> Courbe d'Évolution
                        </h2>
                        <p className="text-xs text-stone-400 font-medium mt-1">Données agrégées de toutes les sessions.</p>
                    </div>
                    <div className="bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-1">
                        <TrendingUp size={12}/> Tendance positive
                    </div>
                </div>

                <div className="h-[280px] w-full">
                     {chartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData}>
                                <defs>
                                    <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#E07A5F" stopOpacity={0.1}/>
                                        <stop offset="95%" stopColor="#E07A5F" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f5" />
                                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 700, fill: '#A8A29E'}} />
                                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 700, fill: '#A8A29E'}} domain={[0, 20]} />
                                <Tooltip 
                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', padding: '12px' }}
                                    labelStyle={{ fontWeight: 800, color: '#3D405B', marginBottom: '4px' }}
                                />
                                <Area 
                                    type="monotone" 
                                    dataKey="score" 
                                    stroke="#E07A5F" 
                                    strokeWidth={4} 
                                    fillOpacity={1} 
                                    fill="url(#colorScore)" 
                                    animationDuration={1500}
                                    dot={{ r: 6, fill: '#E07A5F', strokeWidth: 3, stroke: '#fff' }}
                                    activeDot={{ r: 8, strokeWidth: 0 }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                     ) : (
                         <div className="h-full flex flex-col items-center justify-center text-stone-300">
                             <TrendingUp size={48} className="mb-4 opacity-50"/>
                             <p>Aucune donnée. Saisissez une première séance.</p>
                         </div>
                     )}
                </div>
            </div>

            <div>
                <div className="flex items-center gap-3 mb-6 px-2">
                    <Calendar size={24} className="text-[#3D405B]" />
                    <h2 className="font-serif text-2xl font-bold text-[#3D405B]">Journal des Séances</h2>
                    <div className="ml-auto flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-stone-400 bg-stone-100 px-3 py-1 rounded-full">
                        <Unlock size={12} /> Accès Libre
                    </div>
                </div>

                <div className="bg-white rounded-[32px] border border-stone-200 shadow-sm overflow-hidden relative">
                    <div className="absolute top-0 bottom-0 left-[85px] w-px bg-stone-100 z-0"></div>

                    {(!file.sessions || file.sessions.length === 0) ? (
                        <div className="p-12 text-center">
                            <p className="text-stone-400 font-medium">L'historique est vide.</p>
                            <button onClick={onQuickEntry} className="mt-4 text-[#E07A5F] font-bold text-sm hover:underline">Ajouter une séance maintenant</button>
                        </div>
                    ) : (
                        <div className="relative z-10">
                            {file.sessions.map((session) => (
                                <SessionRow key={session.id} session={session} patient={file.patient} />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>

        <div className="space-y-6">
            <div className="space-y-4">
                <h3 className="font-serif font-bold text-lg text-[#3D405B] px-2 flex items-center gap-2">
                    <Lock size={18} className="text-[#E07A5F]" /> 
                    Documents Formels
                </h3>
                {file.reports.map((report) => (
                    <div key={report.id} onClick={() => onOpenReport(report.id)} className="bg-white p-5 rounded-2xl border border-stone-100 hover:border-[#E07A5F] hover:shadow-lg hover:shadow-orange-100/50 transition-all cursor-pointer flex justify-between items-center group">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-rose-50 rounded-xl text-rose-500 group-hover:bg-[#E07A5F] group-hover:text-white transition-colors">
                                <FileText size={20} />
                            </div>
                            <div>
                                <h4 className="font-bold text-sm text-[#3D405B]">{report.type === 'initial' ? 'Bilan Initial' : 'Réévaluation'}</h4>
                                <p className="text-[10px] font-bold text-stone-400">{new Date(report.date).toLocaleDateString('fr-FR', {day: '2-digit', month: 'long', year: 'numeric'})}</p>
                            </div>
                        </div>
                        <ChevronRight size={16} className="text-stone-300 group-hover:translate-x-1 transition-all" />
                    </div>
                ))}
            </div>

            <div className="bg-white border border-stone-100 p-6 rounded-[24px] mt-8">
                 <h4 className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-4">Fiche Administrative</h4>
                 <div className="space-y-4 text-sm">
                     <div>
                        <p className="text-[10px] font-bold text-stone-300 uppercase">Parent Référent</p>
                        <p className="font-bold text-[#3D405B]">{file.patient.parentNames}</p>
                     </div>
                     <div>
                        <p className="text-[10px] font-bold text-stone-300 uppercase">Téléphone</p>
                        <p className="font-bold text-[#3D405B]">{file.patient.parentPhone}</p>
                     </div>
                     <div>
                         <p className="text-[10px] font-bold text-stone-300 uppercase">Email</p>
                         <p className="font-bold text-[#3D405B] truncate">{file.patient.parentEmail}</p>
                     </div>
                 </div>
            </div>
        </div>
      </div>
    </div>
  );
};
