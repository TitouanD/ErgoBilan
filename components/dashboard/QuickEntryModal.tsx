import React, { useState } from 'react';
import { X, Save, Info, Zap, Plus, Trash2 } from 'lucide-react';
import { ScoreResult, TestSession, Patient } from '../../types';
import { SubtestRowCheck, TestCatalogModal } from '../assessment/Step2Tests';
import { useCatalog } from '../../contexts/CatalogContext';

interface Props {
  onClose: () => void;
  onSave: (session: TestSession) => void;
  patient?: Patient;
}

export const QuickEntryModal: React.FC<Props> = ({ onClose, onSave, patient }) => {
  const { catalog } = useCatalog();
  const [showCatalog, setShowCatalog] = useState(false);
  // On prend le premier test du premier catalogue s'il existe, sinon vide
  const initialTests = catalog.length > 0 && catalog[0].tests.length > 0 ? [catalog[0].tests[0]] : [];
  const [selectedTests, setSelectedTests] = useState(initialTests);
  
  const [allResults, setAllResults] = useState<Record<string, Record<string, ScoreResult>>>({});
  const [expandedSubtestId, setExpandedSubtestId] = useState<string | null>(null);

  const handleAddTests = (testIds: string[]) => {
      const newTests = [...selectedTests];
      testIds.forEach(id => {
          if (!newTests.find(t => t.id === id)) {
              const def = catalog.flatMap(c => c.tests).find(t => t.id === id);
              if (def) newTests.push(def);
          }
      });
      setSelectedTests(newTests);
  };

  const handleRemoveTest = (id: string) => {
      setSelectedTests(prev => prev.filter(t => t.id !== id));
  };

  const handleSubtestChange = (testId: string, subId: string, res: Partial<ScoreResult>) => {
      const currentTestResults = allResults[testId] || {};
      const currentSubResult = currentTestResults[subId] || { raw: '', standard: '', percentile: '', zScore: 0, status: 'empty' };
      
      setAllResults({
          ...allResults,
          [testId]: {
              ...currentTestResults,
              [subId]: { ...currentSubResult, ...res }
          }
      });
  };

  const handleSave = () => {
    const flatResults: Record<string, ScoreResult> = {};
    
    Object.values(allResults).forEach(testRes => {
        Object.entries(testRes).forEach(([subId, res]) => {
            flatResults[subId] = res;
        });
    });

    const sessionName = selectedTests.length === 1 ? selectedTests[0].name : "Séance Multi-tests";
    const mainTestId = selectedTests[0]?.id || 'multi';

    const session: TestSession = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        testId: mainTestId,
        testName: sessionName,
        results: flatResults
    };
    onSave(session);
  };

  const safePatient = patient || ({} as Patient);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-md animate-in fade-in duration-300">
        <div className="bg-[#F9F9F9] w-full max-w-5xl h-[90vh] rounded-[40px] shadow-2xl overflow-hidden flex flex-col relative">
            
            {/* Header */}
            <div className="p-8 border-b border-stone-200 flex justify-between items-center bg-white sticky top-0 z-10 shadow-sm">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-[#E07A5F]/10 rounded-2xl text-[#E07A5F]">
                        <Zap size={28} fill="currentColor" />
                    </div>
                    <div>
                        <h2 className="font-serif text-3xl font-bold text-[#3D405B]">Saisie Rapide</h2>
                        <p className="text-sm text-stone-500 font-medium mt-1">Mode session active : saisissez à la volée.</p>
                    </div>
                </div>
                <button onClick={onClose} className="p-3 bg-stone-50 rounded-full text-stone-400 hover:text-stone-800 hover:bg-stone-200 transition-all">
                    <X size={24} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-[#F9F9F9] p-8 custom-scrollbar">
                <div className="max-w-3xl mx-auto space-y-12">
                    
                    {selectedTests.map(test => (
                        <div key={test.id} className="bg-white rounded-[32px] p-6 border border-stone-100 shadow-sm animate-in slide-in-from-bottom-4">
                            <div className="flex justify-between items-center mb-6 pb-4 border-b border-stone-50">
                                <h3 className="font-serif font-bold text-2xl text-[#3D405B] flex items-center gap-3">
                                    <span className="w-2 h-8 bg-[#F2CC8F] rounded-full"></span>
                                    {test.name}
                                </h3>
                                <button onClick={() => handleRemoveTest(test.id)} className="text-stone-300 hover:text-rose-500 transition-colors p-2"><Trash2 size={18}/></button>
                            </div>
                            
                            <div>
                                {test.subtests.map(st => {
                                    const res = allResults[test.id]?.[st.id] || { raw: '', standard: '', percentile: '', zScore: 0, status: 'empty' };
                                    const uniqueId = `${test.id}-${st.id}`;
                                    return (
                                        <SubtestRowCheck 
                                            key={st.id}
                                            testId={test.id}
                                            patient={safePatient}
                                            subtest={st}
                                            result={res}
                                            onChange={(val) => handleSubtestChange(test.id, st.id, val)}
                                            isExpanded={expandedSubtestId === uniqueId}
                                            onToggleExpand={() => setExpandedSubtestId(expandedSubtestId === uniqueId ? null : uniqueId)}
                                            onFocus={() => setExpandedSubtestId(null)}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    ))}

                    {/* Bouton Ajouter */}
                    <button 
                        onClick={() => setShowCatalog(true)}
                        className="w-full py-6 border-2 border-dashed border-stone-300 rounded-[32px] flex flex-col items-center justify-center text-stone-400 hover:border-[#E07A5F] hover:text-[#E07A5F] hover:bg-[#fff5f2] transition-all gap-2"
                    >
                        <Plus size={32} />
                        <span className="font-bold text-lg">Ajouter un autre test à cette séance</span>
                    </button>

                    {/* Info Gratuite */}
                    <div className="bg-white p-6 rounded-2xl border border-stone-100 flex gap-4 items-center shadow-sm">
                        <div className="p-3 bg-emerald-50 rounded-full text-emerald-600">
                            <Info size={24} />
                        </div>
                        <div>
                            <h4 className="font-bold text-[#3D405B]">Sauvegarde automatique</h4>
                            <p className="text-xs text-stone-500 mt-1">
                                Les résultats sont stockés localement. Vous pourrez générer le rapport plus tard.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer Actions */}
            <div className="p-6 bg-white border-t border-stone-200 flex justify-end gap-4 z-10 shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
                <button onClick={onClose} className="px-8 py-4 font-bold text-stone-400 hover:text-stone-600 transition-all uppercase text-xs tracking-widest">
                    Abandonner
                </button>
                <button onClick={handleSave} className="flex items-center gap-3 bg-[#E07A5F] text-white px-10 py-4 rounded-2xl font-bold shadow-xl shadow-orange-200 hover:bg-[#d0694e] transition-all hover:-translate-y-1">
                    <Save size={20} /> Terminer la séance
                </button>
            </div>
        </div>

        <TestCatalogModal 
            isOpen={showCatalog} 
            onClose={() => setShowCatalog(false)} 
            existingTests={{}} 
            onAddTests={handleAddTests}
        />
    </div>
  );
};