
import React from 'react';
import { Observations, TestData } from '../types';
import { Sparkles, Mic, History, Palette, Move, Zap, Activity, ArrowRight, Lightbulb } from 'lucide-react';

interface Props {
  obs: Observations;
  updateObs: (data: Partial<Observations>) => void;
  tests: TestData;
  onNext: () => void;
  onBack: () => void;
  isGenerating: boolean;
}

// Liste de tags suggérés pour aller vite
const SUGGESTED_TAGS: Record<string, string[]> = {
    anamnese: ["Coopérant", "Fatigabilité", "Impulsivité", "Anxiété de performance", "Bonne humeur"],
    graphique: ["Crispation", "Lenteur", "Douleurs", "Illisible", "Refus d'écrire", "Tenue de crayon immature"],
    motricite: ["Maladresses", "Chutes fréquentes", "Tonus faible", "Agile"],
    coordination: ["Lenteur", "Précision", "Tremblements", "Bimanuel difficile"],
    spatial: ["Perdu dans la page", "Sauts de lignes", "Confusion gauche/droite"]
};

const ObsSection = ({ title, icon: Icon, name, value, onChange, tags }: any) => {
    const addTag = (tag: string) => {
        const newValue = value ? `${value} ${tag}.` : `${tag}.`;
        onChange({ target: { name, value: newValue } });
    };

    return (
        <div className="bg-white p-8 rounded-[32px] border border-stone-100 shadow-sm mb-6 hover:shadow-md transition-all duration-300">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-[#F9F9F9] rounded-xl text-[#E07A5F]">
                        <Icon size={24} />
                    </div>
                    <h3 className="font-serif font-bold text-xl text-[#3D405B]">{title}</h3>
                </div>
                <button className="text-stone-300 hover:text-[#E07A5F] transition-colors"><Mic size={20}/></button>
            </div>

            {/* Tags Rapides */}
            <div className="flex flex-wrap gap-2 mb-4">
                {tags.map((tag: string) => (
                    <button 
                        key={tag} 
                        onClick={() => addTag(tag)}
                        className="px-3 py-1 bg-stone-50 border border-stone-100 rounded-full text-xs font-bold text-stone-500 hover:bg-[#E07A5F] hover:text-white hover:border-[#E07A5F] transition-all"
                    >
                        {tag}
                    </button>
                ))}
            </div>

            <textarea 
                name={name} 
                value={value} 
                onChange={onChange}
                className="w-full p-4 bg-[#F9F9F9] rounded-2xl border-2 border-transparent outline-none h-32 resize-none font-medium text-[#3D405B] placeholder:text-stone-300 focus:bg-white focus:border-[#E07A5F] transition-all leading-relaxed"
                placeholder="Décrivez vos observations..."
            />
        </div>
    );
};

// Sidebar Assistant (Affiche les points d'alerte des tests)
const AssistantSidebar = ({ tests }: { tests: TestData }) => {
    const alerts = [];
    Object.entries(tests).forEach(([testId, subtests]) => {
        Object.entries(subtests).forEach(([subId, res]) => {
            // On remonte tout ce qui est validé et significatif (<= -1)
            if (res.status === 'validated' && res.zScore <= -1) {
                alerts.push({ 
                    testId, 
                    subId, 
                    score: res.standard, 
                    z: res.zScore,
                    obs: res.observation // L'observation saisie à l'étape d'avant
                });
            }
        });
    });

    return (
        <div className="sticky top-24 space-y-6">
            <div className="bg-[#fffdf5] border border-[#F2CC8F]/30 p-6 rounded-[24px]">
                <h4 className="font-serif font-bold text-[#3D405B] mb-4 flex items-center gap-2">
                    <Activity size={18} className="text-[#F2CC8F]" /> 
                    Mémo Résultats
                </h4>
                {alerts.length === 0 ? (
                    <p className="text-sm text-stone-400 italic">Aucun score critique relevé.</p>
                ) : (
                    <div className="space-y-4">
                        {alerts.map((a, idx) => {
                            // Code couleur identique à Step2
                            let badgeColor = "bg-[#F2CC8F]"; // Fragile (Ocre)
                            if (a.z <= -2) badgeColor = "bg-[#E07A5F]"; // Pathologique (Terracotta)

                            return (
                                <div key={idx} className="bg-white p-3 rounded-xl border border-stone-100 shadow-sm">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="text-xs font-bold text-stone-500 uppercase">{a.subId}</span>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold text-white ${badgeColor}`}>
                                            {a.score}
                                        </span>
                                    </div>
                                    {a.obs && (
                                        <p className="text-xs text-[#3D405B] italic mt-1 border-l-2 border-stone-200 pl-2">
                                            "{a.obs}"
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="bg-[#f0fdf4] border border-[#81B29A]/30 p-6 rounded-[24px]">
                <h4 className="font-serif font-bold text-[#3D405B] mb-2 flex items-center gap-2">
                    <Lightbulb size={18} className="text-[#81B29A]" /> 
                    Conseil Rédaction
                </h4>
                <p className="text-sm text-stone-600 leading-relaxed">
                    Utilisez les tags pour noter les faits observables. L'IA se chargera de formuler les phrases complètes et de lier les observations aux résultats chiffrés.
                </p>
            </div>
        </div>
    );
};

export const Step3Observations: React.FC<Props> = ({ obs, updateObs, tests, onNext, onBack, isGenerating }) => {
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateObs({ [e.target.name]: e.target.value });
  };

  return (
    <div className="max-w-6xl mx-auto pb-32 animate-in fade-in duration-500">
        
        <div className="flex justify-between items-end mb-10">
            <div>
                <h2 className="text-3xl font-serif font-bold text-[#3D405B]">Observations Cliniques</h2>
                <p className="text-stone-500 font-medium">Décrivez le comportement et la qualité d'exécution.</p>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Colonne Principale (Saisie) 2/3 */}
            <div className="lg:col-span-2">
                <ObsSection icon={History} title="Comportement & Anamnèse" name="anamnese" value={obs.anamnese} onChange={handleChange} tags={SUGGESTED_TAGS.anamnese} />
                <ObsSection icon={Palette} title="Graphisme & Écriture" name="graphique" value={obs.graphique} onChange={handleChange} tags={SUGGESTED_TAGS.graphique} />
                <ObsSection icon={Move} title="Motricité Globale" name="motricite" value={obs.motricite} onChange={handleChange} tags={SUGGESTED_TAGS.motricite} />
                <ObsSection icon={Zap} title="Coordination Fine" name="coordination" value={obs.coordination} onChange={handleChange} tags={SUGGESTED_TAGS.coordination} />
                <ObsSection icon={Activity} title="Visuo-Spatial" name="spatial" value={obs.spatial} onChange={handleChange} tags={SUGGESTED_TAGS.spatial} />
            </div>

            {/* Colonne Latérale (Assistant) 1/3 */}
            <div className="hidden lg:block">
                <AssistantSidebar tests={tests} />
            </div>

        </div>

        {/* Footer Navigation */}
        <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/90 backdrop-blur-md border-t border-stone-100 flex justify-center z-50">
            <div className="max-w-4xl w-full flex justify-between items-center">
                <button onClick={onBack} className="text-stone-400 hover:text-[#3D405B] font-bold text-sm uppercase tracking-widest px-4 transition-colors">
                    Retour
                </button>
                
                <button 
                    onClick={onNext}
                    disabled={isGenerating}
                    className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-white shadow-xl transition-all ${
                        isGenerating ? 'bg-stone-300 cursor-not-allowed' : 'bg-[#3D405B] hover:bg-[#E07A5F] hover:-translate-y-1'
                    }`}
                >
                    {isGenerating ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>Rédaction en cours...</span>
                        </>
                    ) : (
                        <>
                            <Sparkles size={20} className="text-[#F2CC8F]" />
                            <span>Continuer vers Génération</span>
                        </>
                    )}
                </button>
            </div>
        </div>
    </div>
  );
};
