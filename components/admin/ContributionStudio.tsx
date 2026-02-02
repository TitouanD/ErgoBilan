
import React, { useState } from 'react';
import { X, Upload, FileText, Check, AlertTriangle, Search, Loader2, Award, ArrowRight, ArrowLeft, ShieldAlert, ZoomIn, ZoomOut, Save, RotateCcw, ChevronLeft, ChevronRight, Eye, Layers, Camera, Database, Sparkles, Trash2, Plus, Calculator, Table as TableIcon } from 'lucide-react';
import { Contribution, ExtractedRow } from '../../types';
import { GoogleGenAI } from "@google/genai";
import { fileToGenerativePart, cleanAndParseJson } from '../../utils/aiHelpers';
import { calculateFromStandard, calculateFromZ, calculateFromPercentile, percentileToZScore, zScoreToPercentile } from '../../utils/scoring';
import { supabase } from '../../services/db';

interface Props {
  onClose: () => void;
  onSubmit: (contribution: Contribution) => void;
}

// Mapping approximatif Classe -> Âge pour l'affichage
const GRADE_TO_AGE: Record<string, string> = {
    'PS': '3 ans', 'MS': '4 ans', 'GS': '5 ans',
    'CP': '6 ans', 'CE1': '7 ans', 'CE2': '8 ans',
    'CM1': '9 ans', 'CM2': '10 ans',
    '6EME': '11 ans', '5EME': '12 ans', '4EME': '13 ans', '3EME': '14 ans',
    '6ÈME': '11 ans', '5ÈME': '12 ans', '4ÈME': '13 ans', '3ÈME': '14 ans'
};

type TableStructure = 'PARAMETRIC' | 'LOOKUP' | 'UNKNOWN';

export const ContributionStudio: React.FC<Props> = ({ onClose, onSubmit }) => {
  const [step, setStep] = useState<'intro' | 'upload' | 'processing' | 'editor' | 'success'>('intro');
  const [files, setFiles] = useState<File[]>([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  
  const [testName, setTestName] = useState('');
  const [testNameError, setTestNameError] = useState(false);
  
  const [tableStructure, setTableStructure] = useState<TableStructure>('UNKNOWN');
  const [rows, setRows] = useState<ExtractedRow[]>([]);
  const [zoom, setZoom] = useState(1);
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
          const newFiles = Array.from(e.target.files) as File[];
          setFiles(newFiles);
          setCurrentFileIndex(0);
          setStep('processing');
          processRealExtraction(newFiles);
      }
  };

  const cleanNumberStr = (val: string): string => {
      if (!val) return "";
      let cleaned = val.replace(/,/g, '.').replace(/[^\d.-]/g, '');
      const parts = cleaned.split('.');
      if (parts.length > 2) {
          cleaned = parts[0] + '.' + parts.slice(1).join('');
      }
      return cleaned;
  };

  const formatLabel = (rawLabel: string): string => {
      if (!rawLabel) return "";
      const upper = rawLabel.toUpperCase().trim();
      if (upper.includes('ANS') || upper.match(/\d+[-:]\d+/)) return rawLabel;
      const age = GRADE_TO_AGE[upper];
      if (age) return `${age} (${rawLabel})`;
      return rawLabel;
  };

  const sanitizeAndCalculate = (row: ExtractedRow, currentStructure: TableStructure, triggerField?: keyof ExtractedRow): ExtractedRow => {
      let newRow = { ...row };
      
      if (!triggerField) {
          newRow.label = formatLabel(row.label);
      }

      // Nettoyage des valeurs numériques
      newRow.standard = cleanNumberStr(newRow.standard);
      newRow.zScore = cleanNumberStr(newRow.zScore);
      newRow.percentile = cleanNumberStr(newRow.percentile);
      if (newRow.mean) newRow.mean = cleanNumberStr(newRow.mean);
      if (newRow.sd) newRow.sd = cleanNumberStr(newRow.sd);
      // Raw peut contenir des fourchettes (0-5), on ne nettoie pas trop agressivement si Lookup

      const sVal = parseFloat(newRow.standard);
      const zVal = parseFloat(newRow.zScore);
      const pVal = parseFloat(newRow.percentile);

      // Si Paramétrique : Pas de calcul auto NS/ET/% car ce sont des constantes statistiques
      if (currentStructure === 'PARAMETRIC') {
          return newRow;
      }

      // Si Lookup : Calculs automatiques de cohérence
      if ((triggerField === 'standard' && !isNaN(sVal)) || (!triggerField && !isNaN(sVal) && isNaN(zVal))) {
          const type = sVal > 20 ? 'standard' : 'scaled';
          const res = calculateFromStandard(sVal, type);
          newRow.zScore = res.zScore.toString();
          newRow.percentile = res.percentile.toString();
      }
      else if ((triggerField === 'zScore' && !isNaN(zVal)) || (!triggerField && !isNaN(zVal) && isNaN(sVal))) {
          const res = calculateFromZ(zVal, 'standard');
          newRow.percentile = res.percentile.toString();
          if (!newRow.standard) newRow.standard = res.standard;
      }
      else if ((triggerField === 'percentile' && !isNaN(pVal)) || (!triggerField && !isNaN(pVal) && isNaN(zVal))) {
          const res = calculateFromPercentile(pVal, 'standard');
          newRow.zScore = res.zScore.toString();
          if (!newRow.standard) newRow.standard = res.standard;
      }

      return newRow;
  };

  const processRealExtraction = async (inputFiles: File[]) => {
      try {
          const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
          const model = "gemini-3-flash-preview"; 
          const imagePart = await fileToGenerativePart(inputFiles[0]);
          const filename = inputFiles[0].name;

          const prompt = `
            ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
            CONTEXT: The filename is "${filename}".

            TASK: Analyze the image, CLASSIFY the table structure, then EXTRACT data.

            --- STEP 1: CLASSIFICATION (structure_type) ---
            A) "PARAMETRIC": Contains statistical constants per group (Mean/Moyenne/M AND SD/Ecart-Type/Sigma).
               The table does NOT map raw scores to percentiles directly. It gives the formula constants.
            B) "LOOKUP": Maps Raw Scores (ranges or single values) to Standard Scores (NS, Scaled) or Percentiles.
            
            --- STEP 2: EXTRACTION RULES ---
            1. PIVOT: If columns represent Ages/Grades and rows represent Stats (M, SD), YOU MUST PIVOT. Create ONE object per Age/Grade.
            2. VALUES:
               - If Parametric: Extract "mean" and "sd".
               - If Lookup: Extract "raw_range", "standard", "percentile".
            3. ACCURACY:
               - Clean units (sec, pts).
               - Keep decimals.
               - For LOOKUP, keep raw score ranges as strings (e.g. "0-5").

            --- JSON OUTPUT SCHEMA ---
            {
              "test_context": "string (Detected name of the test)",
              "structure_type": "PARAMETRIC" | "LOOKUP",
              "tables": [
                {
                  "subtest_id": "string (Subtest name)",
                  "rows": [
                    {
                      "label": "string (Row identifier: Age, Grade)",
                      "mean": "string (Only if PARAMETRIC)",
                      "sd": "string (Only if PARAMETRIC)",
                      "raw_range": "string (Only if LOOKUP: Raw Score)",
                      "standard": "string (Only if LOOKUP: Standard Score)",
                      "percentile": "string (Only if LOOKUP: Percentile)",
                      "z_score": "string (Z-Score if explicit)"
                    }
                  ]
                }
              ]
            }
          `;

          const response = await ai.models.generateContent({
              model: model,
              contents: [{ role: "user", parts: [imagePart, { text: prompt }] }]
          });

          const extractedData = cleanAndParseJson(response.text);
          const flatRows: ExtractedRow[] = [];
          let globalIdCounter = 0;
          
          const detectedStructure: TableStructure = extractedData?.structure_type || 'LOOKUP';
          setTableStructure(detectedStructure);

          if (extractedData && Array.isArray(extractedData.tables)) {
              extractedData.tables.forEach((table: any) => {
                  if (Array.isArray(table.rows)) {
                      table.rows.forEach((r: any) => {
                          
                          // Construction explicite des champs
                          const rawRow: ExtractedRow = {
                              id: (globalIdCounter++).toString(),
                              subtest: table.subtest_id || extractedData.test_context || "Global",
                              label: r.label || '',
                              
                              // Mapping Lookup
                              raw: detectedStructure === 'LOOKUP' ? (r.raw_range ? String(r.raw_range) : '') : '',
                              standard: detectedStructure === 'LOOKUP' ? (r.standard ? String(r.standard) : '') : '',
                              
                              // Mapping Parametric
                              mean: detectedStructure === 'PARAMETRIC' ? (r.mean ? String(r.mean) : '') : undefined,
                              sd: detectedStructure === 'PARAMETRIC' ? (r.sd ? String(r.sd) : '') : undefined,
                              
                              // Common
                              zScore: r.z_score ? String(r.z_score) : '',
                              percentile: r.percentile ? String(r.percentile) : '',
                              isTrap: false
                          };
                          
                          flatRows.push(sanitizeAndCalculate(rawRow, detectedStructure));
                      });
                  }
              });
          }

          if (flatRows.length === 0) {
              setRows([{ id: '1', subtest: 'Nouveau Sous-test', label: 'Exemple', raw: '', standard: '', zScore: '', percentile: '', isTrap: false }]);
          } else {
              setRows(flatRows);
          }
          if (extractedData.test_context && !testName) setTestName(extractedData.test_context);
          setStep('editor');

      } catch (error) {
          console.error("Gemini Extraction Error:", error);
          alert("Erreur lors de l'analyse du document. Vérifiez la qualité de l'image.");
          setStep('upload');
      }
  };

  const groupedRows: Record<string, ExtractedRow[]> = rows.reduce((acc, row) => {
    const key = row.subtest || "Global";
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {} as Record<string, ExtractedRow[]>);

  const handleRowChange = (id: string, field: keyof ExtractedRow, value: string) => {
      setRows(prev => prev.map(r => {
          if (r.id !== id) return r;
          const updated = { ...r, [field]: value };
          // Recalcul auto seulement pour Lookup et champs standards
          if (tableStructure === 'LOOKUP' && ['standard', 'zScore', 'percentile'].includes(field)) {
              return sanitizeAndCalculate(updated, tableStructure, field);
          }
          return updated;
      }));
  };

  const checkConsistency = (row: ExtractedRow): boolean => {
      if (tableStructure === 'PARAMETRIC') return true; 
      const zStr = cleanNumberStr(row.zScore);
      const pStr = cleanNumberStr(row.percentile);
      const z = parseFloat(zStr);
      const p = parseFloat(pStr);
      if (isNaN(z) || isNaN(p)) return true;
      const expectedP = zScoreToPercentile(z);
      return Math.abs(expectedP - p) < 5; 
  };

  const handleSubtestNameChange = (oldName: string, iName: string) => {
      setRows(prev => prev.map(r => r.subtest === oldName ? { ...r, subtest: iName } : r));
  };

  const handleAddRowToSubtest = (subtestName: string) => {
      setRows(prev => [...prev, { id: Date.now().toString(), subtest: subtestName, label: '', raw: '', standard: '', zScore: '', percentile: '', isTrap: false }]);
  };

  const handleDeleteRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id));
  const handleAddSubtest = () => handleAddRowToSubtest("Nouveau Sous-test " + (Object.keys(groupedRows).length + 1));
  
  const handleSubmit = async () => {
      if (!testName.trim()) {
          setTestNameError(true);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
      }

      // FLUX A : Sauvegarde dans la queue de contribution SQL
      const { data: { user } } = await supabase.auth.getUser();
      
      const contributionData: Contribution = {
          id: crypto.randomUUID(),
          userId: user?.id || 'anon',
          userName: 'Praticien',
          testName: testName,
          docType: 'image',
          status: 'pending',
          vigilanceScore: 'pass',
          submittedAt: new Date().toISOString(),
          structureType: tableStructure, // EXPLICITE
          rows: rows
      };

      try {
          await supabase.from('contributions_queue')
              .insert({
                  id: contributionData.id,
                  user_id: user?.id,
                  source_type: 'scan_ocr',
                  status: 'pending',
                  raw_data_json: JSON.stringify(contributionData),
                  target_test_name: testName,
                  created_at: contributionData.submittedAt,
                  // structure_type: tableStructure
              });
          
          console.log("✅ Contribution Flux A sauvegardée.");
          onSubmit(contributionData);
          setStep('success');
      } catch (e) {
          console.error("Erreur sauvegarde contribution:", e);
          alert("Erreur lors de la sauvegarde.");
      }
  };

  if (step === 'intro') { 
      return (
        <div className="fixed inset-0 z-[50] bg-[#3D405B]/95 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-500">
            <div className="bg-white max-w-4xl w-full rounded-[40px] overflow-hidden shadow-2xl flex flex-col md:flex-row relative">
                <button onClick={onClose} className="absolute top-6 right-6 text-stone-300 hover:text-stone-500 z-10"><X size={24}/></button>
                <div className="w-full md:w-2/5 bg-[#F9F9F9] p-10 flex flex-col justify-center items-center relative overflow-hidden">
                    <div className="absolute top-[-20%] left-[-20%] w-64 h-64 bg-[#E07A5F]/10 rounded-full blur-3xl"></div>
                    <div className="relative z-10 text-center">
                        <div className="w-24 h-24 bg-white rounded-3xl shadow-xl flex items-center justify-center mb-8 mx-auto transform -rotate-6">
                            <Sparkles size={48} className="text-[#E07A5F]" />
                        </div>
                        <h2 className="font-serif font-bold text-2xl text-[#3D405B] mb-2">Contribution</h2>
                        <p className="text-stone-500 text-sm font-medium">Digitalisez vos manuels cliniques.</p>
                    </div>
                </div>
                <div className="w-full md:w-3/5 p-10 md:p-12">
                    <h3 className="text-2xl font-bold text-[#3D405B] mb-8">Intelligence d'Extraction</h3>
                    <div className="space-y-8">
                        <div className="flex gap-4">
                            <div className="w-10 h-10 bg-stone-100 rounded-full flex items-center justify-center text-[#3D405B] font-bold text-lg shrink-0">1</div>
                            <div>
                                <h4 className="font-bold text-[#3D405B]">Classification Hybride</h4>
                                <p className="text-sm text-stone-500 leading-relaxed">Le moteur identifie automatiquement si le tableau est <strong>Paramétrique</strong> (Moyenne/ET) ou une <strong>Table de Conversion</strong>.</p>
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <div className="w-10 h-10 bg-stone-100 rounded-full flex items-center justify-center text-[#3D405B] font-bold text-lg shrink-0">2</div>
                            <div>
                                <h4 className="font-bold text-[#3D405B]">Gestion du Pivot</h4>
                                <p className="text-sm text-stone-500 leading-relaxed">Les tableaux listant les âges en colonnes sont automatiquement redressés en lignes.</p>
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <div className="w-10 h-10 bg-stone-100 rounded-full flex items-center justify-center text-[#3D405B] font-bold text-lg shrink-0">3</div>
                            <div>
                                <h4 className="font-bold text-[#3D405B]">Normalisation</h4>
                                <p className="text-sm text-stone-500 leading-relaxed">Les intervalles de scores bruts (ex: "19-20") sont préservés pour permettre le Lookup.</p>
                            </div>
                        </div>
                    </div>
                    <div className="mt-10 pt-6 border-t border-stone-100 flex justify-end">
                        <button onClick={() => setStep('upload')} className="bg-[#3D405B] text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-[#2c2e42] transition-all flex items-center gap-2 group">
                            Importer un document <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
      );
  }

  // ... (Code identique pour upload/processing/success) ...
  if (step === 'upload' || step === 'processing') { 
      return (
        <div className="min-h-screen bg-[#F9F9F9] flex flex-col items-center justify-center p-6 animate-in fade-in duration-500">
            <div className="w-full max-w-2xl bg-white rounded-[32px] shadow-xl p-10 text-center relative overflow-hidden">
                <button onClick={onClose} className="absolute top-6 left-6 text-stone-400 hover:text-stone-600 flex items-center gap-2 font-bold text-sm uppercase tracking-wider">
                    <ArrowLeft size={16} /> Quitter
                </button>
                <div className="mb-8 flex justify-center">
                    <div className="w-20 h-20 bg-[#E07A5F] text-white rounded-3xl flex items-center justify-center transform -rotate-3 shadow-lg shadow-orange-200">
                        <Camera size={40} />
                    </div>
                </div>
                <h1 className="font-serif text-3xl font-bold text-[#3D405B] mb-4">Scanner un barème</h1>
                <p className="text-stone-500 mb-10 max-w-md mx-auto leading-relaxed">Tableau de statistiques (Moy/ET) ou de conversion (Score Brut).</p>
                {step === 'upload' ? (
                    <div className="space-y-6 max-w-md mx-auto">
                        <div className="text-left">
                            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider ml-1">Nom du Test <span className="text-rose-500">*</span></label>
                            <input 
                                value={testName} 
                                onChange={(e) => { setTestName(e.target.value); setTestNameError(false); }} 
                                placeholder="Ex: MABC-2, NEPSY-II..." 
                                className={`w-full p-4 bg-stone-50 rounded-xl border outline-none focus:border-[#E07A5F] font-bold text-[#3D405B] ${testNameError ? 'border-rose-500 bg-rose-50' : 'border-stone-200'}`} 
                            />
                            {testNameError && <p className="text-xs text-rose-500 font-bold mt-1 ml-1">Le nom est obligatoire.</p>}
                        </div>
                        <div className="border-3 border-dashed border-stone-200 rounded-[24px] p-10 hover:border-[#E07A5F] hover:bg-[#fff5f2] transition-all cursor-pointer group relative">
                            <input type="file" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20" accept="image/*" />
                            <div className="relative z-10 pointer-events-none">
                                <Upload size={32} className="text-stone-300 group-hover:text-[#E07A5F] mx-auto mb-2 transition-colors" />
                                <p className="font-bold text-[#3D405B]">Importer le tableau</p>
                                <p className="text-xs text-stone-400 mt-1">L'IA détectera le type de données.</p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="py-12">
                        <Loader2 size={48} className="text-[#E07A5F] animate-spin mx-auto mb-4" />
                        <p className="font-bold text-[#3D405B]">Analyse Gemini 3 en cours...</p>
                        <p className="text-xs text-stone-400">Classification Paramétrique vs Lookup...</p>
                    </div>
                )}
            </div>
        </div>
      );
  }

  if (step === 'success') { 
      return (
        <div className="min-h-screen bg-[#F9F9F9] flex items-center justify-center p-6 animate-in zoom-in-95 duration-500">
            <div className="text-center">
                <div className="w-24 h-24 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce">
                    <Check size={48} strokeWidth={4} />
                </div>
                <h2 className="font-serif text-4xl font-bold text-[#3D405B] mb-4">Base de données enrichie !</h2>
                <p className="text-stone-500 text-lg mb-8 max-w-md mx-auto">Votre contribution va être validée par la modération.</p>
                <button onClick={onClose} className="bg-[#3D405B] text-white px-10 py-4 rounded-2xl font-bold shadow-xl hover:bg-[#2c2e42] transition-all">Retour au Dashboard</button>
            </div>
        </div>
      );
  }

  return (
    <div className="fixed inset-0 z-[50] bg-white flex flex-col h-screen animate-in fade-in duration-300">
        <div className="h-16 border-b border-stone-200 flex items-center justify-between px-6 bg-white shrink-0 z-20">
            <div className="flex items-center gap-4">
                <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-stone-600 transition-colors"><X size={20}/></button>
                <div>
                    <div className="flex items-center gap-2">
                        <h2 className="font-bold text-[#3D405B] max-w-[200px] truncate">{testName || "Nouveau Test"}</h2>
                        {tableStructure === 'PARAMETRIC' && (
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded flex items-center gap-1">
                                <Calculator size={10} /> Paramétrique (Moy/SD)
                            </span>
                        )}
                        {tableStructure === 'LOOKUP' && (
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded flex items-center gap-1">
                                <TableIcon size={10} /> Table de Conversion
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-stone-400 flex items-center gap-1"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span> Édition des données extraites</p>
                </div>
            </div>
            <div className="flex items-center gap-3">
                <button onClick={handleSubmit} className="bg-[#E07A5F] text-white px-6 py-2.5 rounded-xl font-bold shadow-md hover:bg-[#d0694e] transition-all flex items-center gap-2 text-sm"><Save size={16} /> Soumettre la contribution</button>
            </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
            <div className="w-1/2 bg-stone-100 border-r border-stone-200 relative flex flex-col">
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur rounded-full shadow-sm border border-stone-200 p-1 flex gap-1 z-10">
                    <button onClick={() => setZoom(Math.max(0.5, zoom - 0.1))} className="p-2 hover:bg-stone-100 rounded-full text-stone-500"><ZoomOut size={16}/></button>
                    <span className="text-xs font-mono font-bold text-stone-400 py-2 px-1 w-12 text-center">{Math.round(zoom * 100)}%</span>
                    <button onClick={() => setZoom(Math.min(2, zoom + 0.1))} className="p-2 hover:bg-stone-100 rounded-full text-stone-500"><ZoomIn size={16}/></button>
                </div>
                <div className="flex-1 overflow-auto flex items-center justify-center p-10 cursor-grab active:cursor-grabbing">
                    <div className="bg-white shadow-2xl transition-transform duration-200 ease-out origin-center relative" style={{ width: 'auto', height: 'auto', transform: `scale(${zoom})` }}>
                         {files.length > 0 ? <img src={URL.createObjectURL(files[currentFileIndex])} alt="Source" className="max-w-full max-h-[80vh] object-contain" /> : null}
                    </div>
                </div>
            </div>

            <div className="w-1/2 bg-white flex flex-col">
                <div className="flex-1 overflow-y-auto p-8">
                    <div className="max-w-3xl mx-auto space-y-12">
                        
                        <div className={`p-4 rounded-xl border flex items-center gap-3 bg-stone-50 border-stone-100`}>
                            <div className="p-2 rounded-lg bg-white text-[#E07A5F]">
                                <FileText size={20} />
                            </div>
                            <div className="flex-1">
                                <label className="text-[10px] font-bold uppercase tracking-wider mb-1 block text-stone-400">Nom Global du Test</label>
                                <input 
                                    value={testName} 
                                    onChange={(e) => { setTestName(e.target.value); setTestNameError(false); }}
                                    placeholder="Ex: WISC-V"
                                    className="bg-transparent font-bold text-[#3D405B] w-full outline-none placeholder:text-stone-300"
                                />
                            </div>
                        </div>

                        {Object.entries(groupedRows).map(([subtest, subRows]) => (
                            <div key={subtest} className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden animate-in slide-in-from-bottom-2">
                                <div className="bg-stone-50 px-4 py-3 border-b border-stone-200 flex justify-between items-center">
                                    <div className="flex items-center gap-2 flex-1">
                                        <Layers size={14} className="text-stone-400" />
                                        <input 
                                            value={subtest} 
                                            onChange={(e) => handleSubtestNameChange(subtest, e.target.value)}
                                            className="bg-transparent font-bold text-[#3D405B] text-sm w-full outline-none focus:bg-white rounded px-1 transition-all"
                                        />
                                    </div>
                                    <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">{subRows.length} entrées</span>
                                </div>

                                <div className="p-2">
                                    <div className="grid grid-cols-12 gap-2 text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-2 px-3">
                                        <div className="col-span-3">Âge / Classe</div>
                                        {tableStructure === 'PARAMETRIC' ? (
                                            <>
                                                <div className="col-span-4 text-center" title="Moyenne Statistique">Moyenne (M)</div>
                                                <div className="col-span-4 text-center" title="Ecart-Type Statistique">Ecart-Type (SD)</div>
                                                <div className="col-span-1"></div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="col-span-2 text-center" title="Intervalle Score Brut">Brut (Range)</div>
                                                <div className="col-span-2 text-center" title="Note Standard">NS</div>
                                                <div className="col-span-2 text-center" title="Z-Score Calculé">ET / Z</div>
                                                <div className="col-span-2 text-center" title="Percentile">%</div>
                                                <div className="col-span-1"></div>
                                            </>
                                        )}
                                    </div>

                                    {subRows.map((row) => {
                                        const isConsistent = checkConsistency(row);
                                        return (
                                            <div key={row.id} className="grid grid-cols-12 gap-2 items-center group mb-1">
                                                <div className="col-span-3">
                                                    <input value={row.label} onChange={(e) => handleRowChange(row.id, 'label', e.target.value)} className="w-full p-2 bg-stone-50 rounded-lg border border-transparent focus:bg-white focus:border-[#E07A5F] outline-none text-sm font-bold text-[#3D405B] transition-all" />
                                                </div>
                                                
                                                {tableStructure === 'PARAMETRIC' ? (
                                                    <>
                                                        <div className="col-span-4">
                                                            <input value={row.mean} onChange={(e) => handleRowChange(row.id, 'mean', e.target.value)} className="w-full p-2 text-center bg-indigo-50/50 rounded-lg border border-transparent focus:bg-white focus:border-indigo-500 outline-none text-sm font-bold text-indigo-900 transition-all" placeholder="Moyenne" />
                                                        </div>
                                                        <div className="col-span-4">
                                                            <input value={row.sd} onChange={(e) => handleRowChange(row.id, 'sd', e.target.value)} className="w-full p-2 text-center bg-indigo-50/50 rounded-lg border border-transparent focus:bg-white focus:border-indigo-500 outline-none text-sm font-bold text-indigo-900 transition-all" placeholder="SD" />
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="col-span-2">
                                                            <input value={row.raw} onChange={(e) => handleRowChange(row.id, 'raw', e.target.value)} className="w-full p-2 text-center bg-stone-50 rounded-lg border border-transparent focus:bg-white focus:border-[#E07A5F] outline-none text-sm font-medium text-stone-600 transition-all" />
                                                        </div>
                                                        <div className="col-span-2">
                                                            <input value={row.standard} onChange={(e) => handleRowChange(row.id, 'standard', e.target.value)} className={`w-full p-2 text-center bg-stone-50 rounded-lg border border-transparent focus:bg-white focus:border-[#E07A5F] outline-none text-sm font-bold text-[#3D405B] transition-all`} />
                                                        </div>
                                                        <div className="col-span-2">
                                                            <input value={row.zScore} onChange={(e) => handleRowChange(row.id, 'zScore', e.target.value)} className={`w-full p-2 text-center bg-stone-50 rounded-lg border border-transparent focus:bg-white focus:border-[#E07A5F] outline-none text-sm font-bold transition-all ${!isConsistent ? 'text-rose-500' : 'text-[#3D405B]'}`} />
                                                        </div>
                                                        <div className="col-span-2">
                                                            <input value={row.percentile} onChange={(e) => handleRowChange(row.id, 'percentile', e.target.value)} className={`w-full p-2 text-center bg-stone-50 rounded-lg border border-transparent focus:bg-white focus:border-[#E07A5F] outline-none text-sm font-bold transition-all ${!isConsistent ? 'text-rose-500' : 'text-[#3D405B]'}`} />
                                                        </div>
                                                    </>
                                                )}
                                                
                                                <div className="col-span-1 text-center">
                                                    <button onClick={() => handleDeleteRow(row.id)} className="text-stone-300 hover:text-rose-500 p-2 rounded hover:bg-rose-50 transition-all"><Trash2 size={14}/></button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    
                                    <button onClick={() => handleAddRowToSubtest(subtest)} className="mt-2 w-full py-2 border border-dashed border-stone-200 rounded-lg text-stone-400 text-xs font-bold hover:border-[#E07A5F] hover:text-[#E07A5F] transition-all flex items-center justify-center gap-1">
                                        <Plus size={12} /> Ajouter une ligne
                                    </button>
                                </div>
                            </div>
                        ))}

                        <button onClick={handleAddSubtest} className="w-full py-4 border-2 border-dashed border-stone-300 rounded-xl text-stone-400 font-bold hover:border-[#E07A5F] hover:text-[#E07A5F] hover:bg-[#fff5f2] transition-all flex items-center justify-center gap-2">
                            <Plus size={18} /> Créer un nouveau bloc (Sous-test)
                        </button>

                    </div>
                </div>
            </div>
        </div>
    </div>
  );
};
