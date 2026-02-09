
import React, { useState, useMemo, useEffect } from 'react';
import { X, Upload, FileText, Check, ArrowLeft, ShieldAlert, ZoomIn, ZoomOut, Save, Layers, Camera, Database, Sparkles, Trash2, Plus, Calculator, Table as TableIcon, Loader2, ArrowRight, Scale, BookOpen, Scan } from 'lucide-react';
import { Contribution, ExtractedRow, AIExtractionResult, AIExtractedTable, AIExtractedNormRow } from '../../types';
import { callAIProxy } from '../../services/aiProxy';
import { fileToGenerativePart, cleanAndParseJson } from '../../utils/aiHelpers';
import { calculateFromStandard, calculateFromZ, calculateFromPercentile, zScoreToPercentile } from '../../utils/scoring';
import { supabase } from '../../services/db';
import { AdminService } from '../../services/admin';
import { useToast } from '../../contexts/ToastContext';
import { Logger } from '../../utils/logger';
import { TEST_CATALOG } from '../../data/testCatalog';
import { normalizeTestName } from '../../utils';

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
type ExtractionPage = {
    id: string;
    fileIndex: number;
    rows: ExtractedRow[];
    validated: boolean;
    detectedStructure: TableStructure;
};

export const ContributionStudio: React.FC<Props> = ({ onClose, onSubmit }) => {
  const [step, setStep] = useState<'intro' | 'upload' | 'processing' | 'editor' | 'success'>('intro');
  const [files, setFiles] = useState<File[]>([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  
  const [testName, setTestName] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(TEST_CATALOG[0]?.id || 'motricite-globale');
  const [testNameError, setTestNameError] = useState(false);
  
    const [tableStructure, setTableStructure] = useState<TableStructure>('UNKNOWN');
    const [pages, setPages] = useState<ExtractionPage[]>([]);
  const [zoom, setZoom] = useState(1);
  
  // LEGAL & MODAL STATE
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [legalConsent, setLegalConsent] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // MERGE STATE
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<{ id: string; name: string; subtestCount: number } | null>(null);
  const [mergeNewAgeRanges, setMergeNewAgeRanges] = useState(0);
  const [mergeNewSubtests, setMergeNewSubtests] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const toast = useToast();

    const currentPage = pages[currentFileIndex] || null;
    const currentRows = currentPage?.rows || [];
    const allRows = useMemo(() => pages.flatMap(page => page.rows), [pages]);

  // Stable object URL for current file preview — revoke on change to prevent memory leaks
  const currentFileUrl = useMemo(() => {
      if (files.length === 0 || currentFileIndex >= files.length) return null;
      return URL.createObjectURL(files[currentFileIndex]);
  }, [files, currentFileIndex]);

  useEffect(() => {
      return () => { if (currentFileUrl) URL.revokeObjectURL(currentFileUrl); };
  }, [currentFileUrl]);

  // --- HELPER FUNCTIONS ---

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
      newRow.standard = cleanNumberStr(newRow.standard || '');
      newRow.zScore = cleanNumberStr(newRow.zScore || '');
      newRow.percentile = cleanNumberStr(newRow.percentile || '');
      if (newRow.mean) newRow.mean = cleanNumberStr(newRow.mean);
      if (newRow.sd) newRow.sd = cleanNumberStr(newRow.sd || '');

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

  const groupRowsBySubtest = (inputRows: ExtractedRow[]): Record<string, ExtractedRow[]> => (
      inputRows.reduce((acc, row) => {
          const key = row.subtest || "Global";
          if (!acc[key]) acc[key] = [];
          acc[key].push(row);
          return acc;
      }, {} as Record<string, ExtractedRow[]>)
  );

  // --- PROCESSING FUNCTION ---

  const processSingleExtraction = async (file: File) => {
      const imagePart = await fileToGenerativePart(file);
      const filename = file.name;

      const prompt = `
            ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
            CONTEXT: The filename is "${filename}".
            IMPORTANT: The filename often contains the target AGE or GRADE (e.g., "CE1.png" or "13ans.jpg"). Use this information to infer the row "label" if it's not explicitly in the table headers.

            TASK: Analyze the image, CLASSIFY the table structure, then EXTRACT and NORMALIZE data.

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

            --- STEP 3: NORMALIZATION RULES (CRITICAL FOR DATABASE) ---
            You must calculate specific numeric values for the database:
            1. AGE NORMALIZATION (age_min_months, age_max_months):
               - Convert label "4;6" or "4 ans 6 mois" -> 54 months.
               - Convert range "4;0 - 4;5" -> min: 48, max: 53.
               - If only grade is available (e.g. "CP"), estimate typical age (CP = 6 years = 72 months).
            2. RAW SCORE NORMALIZATION (raw_min, raw_max):
               - "15-16" -> min: 15, max: 16
               - "7" -> min: 7, max: 7
               - "<5" -> min: 0, max: 5
               - ">19" or "19+" -> min: 19, max: 999 (use a high number for infinity)

            --- JSON OUTPUT SCHEMA ---
            {
              "test_context": "string (Detected name of the test)",
              "structure_type": "PARAMETRIC" | "LOOKUP",
              "tables": [
                {
                  "subtest_id": "string (Subtest name)",
                  "rows": [
                    {
                      "label": "string (Display Label, e.g. '4;0 - 4;5')",
                      "mean": "string (Only if PARAMETRIC)",
                      "sd": "string (Only if PARAMETRIC)",
                      "raw_range": "string (Only if LOOKUP: Raw Score as displayed)",
                      "standard": "string (Only if LOOKUP: Standard Score)",
                      "percentile": "string (Only if LOOKUP: Percentile)",
                      "z_score": "string (Z-Score if explicit)",
                      
                      // NORMALIZED FIELDS (MANDATORY)
                      "age_min_months": number | null,
                      "age_max_months": number | null,
                      "raw_min": number | null,
                      "raw_max": number | null
                    }
                  ]
                }
              ]
            }
          `;

      const response = await callAIProxy({
          contents: [{ role: "user", parts: [imagePart, { text: prompt }] }]
      });

      const extractedData = cleanAndParseJson(response.text) as AIExtractionResult | null;
      const flatRows: ExtractedRow[] = [];
      const detectedStructure: TableStructure = extractedData?.structure_type || 'LOOKUP';

      if (extractedData && Array.isArray(extractedData.tables)) {
          extractedData.tables.forEach((table: AIExtractedTable) => {
              if (Array.isArray(table.rows)) {
                  table.rows.forEach((r: AIExtractedNormRow) => {
                      const rawRow: ExtractedRow = {
                          id: crypto.randomUUID(),
                          subtest: table.subtest_id || extractedData?.test_context || "Global",
                          label: r.label || '',
                          raw: detectedStructure === 'LOOKUP' ? (r.raw_range ? String(r.raw_range) : '') : '',
                          standard: detectedStructure === 'LOOKUP' ? (r.standard ? String(r.standard) : '') : '',
                          mean: detectedStructure === 'PARAMETRIC' ? (r.mean ? String(r.mean) : '') : undefined,
                          sd: detectedStructure === 'PARAMETRIC' ? (r.sd ? String(r.sd) : '') : undefined,
                          zScore: r.z_score ? String(r.z_score) : '',
                          percentile: r.percentile ? String(r.percentile) : '',
                          
                          // CAPTURE DES CHAMPS CACHÉS
                          hidden_age_min: r.age_min_months,
                          hidden_age_max: r.age_max_months,
                          hidden_raw_min: r.raw_min,
                          hidden_raw_max: r.raw_max
                      };
                      flatRows.push(sanitizeAndCalculate(rawRow, detectedStructure));
                  });
              }
          });
      }

      if (flatRows.length === 0) {
          flatRows.push({ id: crypto.randomUUID(), subtest: 'Nouveau Sous-test', label: 'Exemple', raw: '', standard: '', zScore: '', percentile: '' });
      }

      return {
          rows: flatRows,
          detectedStructure,
          testContext: extractedData?.test_context || ''
      };
  };

  const processFilesSequentially = async (inputFiles: File[]) => {
      try {
          const nextPages: ExtractionPage[] = [];
          let resolvedStructure: TableStructure = tableStructure;
          let resolvedTestName = testName;

          for (let i = 0; i < inputFiles.length; i += 1) {
              setCurrentFileIndex(i);
              const result = await processSingleExtraction(inputFiles[i]);

              if (resolvedStructure === 'UNKNOWN') {
                  resolvedStructure = result.detectedStructure;
              } else if (result.detectedStructure !== resolvedStructure) {
                  toast.error("Structure différente détectée entre pages. Vérifiez les documents.");
              }

              if (result.testContext && !resolvedTestName) {
                  resolvedTestName = result.testContext;
                  setTestName(result.testContext);
              }

              nextPages.push({
                  id: crypto.randomUUID(),
                  fileIndex: i,
                  rows: result.rows,
                  validated: false,
                  detectedStructure: result.detectedStructure
              });
          }

          setTableStructure(resolvedStructure);
          setPages(nextPages);
          setCurrentFileIndex(0);
          setStep('editor');
      } catch (error) {
          Logger.error('AI', "Gemini Extraction Error", error);
          toast.error("Erreur lors de l'analyse du document. Vérifiez la qualité de l'image.");
          setStep('upload');
      }
  };

  // --- HANDLERS ---

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
          const newFiles = Array.from(e.target.files) as File[];
          setFiles(newFiles);
          setCurrentFileIndex(0);
          setTableStructure('UNKNOWN');
          setPages([]);
          setStep('processing');
          processFilesSequentially(newFiles);
      }
  };

  const currentGroupedRows = useMemo(() => groupRowsBySubtest(currentRows), [currentRows]);
  const allGroupedRows = useMemo(() => groupRowsBySubtest(allRows), [allRows]);
  const currentGroupedEntries = useMemo(
      () => Object.entries(currentGroupedRows) as Array<[string, ExtractedRow[]]>,
      [currentGroupedRows]
  );
  const allGroupedEntries = useMemo(
      () => Object.entries(allGroupedRows) as Array<[string, ExtractedRow[]]>,
      [allGroupedRows]
  );

  const updateCurrentPageRows = (updater: (rows: ExtractedRow[]) => ExtractedRow[]) => {
      setPages(prev => prev.map((page, index) => {
          if (index !== currentFileIndex) return page;
          return { ...page, rows: updater(page.rows) };
      }));
  };

  const updateAllPagesRows = (updater: (rows: ExtractedRow[]) => ExtractedRow[]) => {
      setPages(prev => prev.map(page => ({ ...page, rows: updater(page.rows) })));
  };

  const handleValidateCurrentPage = () => {
      setPages(prev => prev.map((page, index) => (
          index === currentFileIndex ? { ...page, validated: true } : page
      )));
  };

  const handleRowChange = (id: string, field: keyof ExtractedRow, value: string) => {
      updateCurrentPageRows(prev => prev.map(r => {
          if (r.id !== id) return r;
          const updated = { ...r, [field]: value };
          if (tableStructure === 'LOOKUP' && ['standard', 'zScore', 'percentile'].includes(field)) {
              return sanitizeAndCalculate(updated, tableStructure, field);
          }
          return updated;
      }));
  };

  // NEW: Update label for a whole batch (group)
  const handleBatchLabelChange = (subtestName: string, oldLabel: string, newLabel: string) => {
      updateCurrentPageRows(prev => prev.map(r => 
          (r.subtest === subtestName && r.label === oldLabel) 
              ? { ...r, label: newLabel } 
              : r
      ));
  };

  // NEW: Add row to a specific batch
  const handleAddRowToBatch = (subtestName: string, label: string) => {
      updateCurrentPageRows(prev => [...prev, { 
          id: crypto.randomUUID(), 
          subtest: subtestName, 
          label: label, 
          raw: '', standard: '', zScore: '', percentile: '' 
      }]);
  };

  const checkConsistency = (row: ExtractedRow): boolean => {
      if (tableStructure === 'PARAMETRIC') return true; 
      const zStr = cleanNumberStr(row.zScore || '');
      const pStr = cleanNumberStr(row.percentile || '');
      const z = parseFloat(zStr);
      const p = parseFloat(pStr);
      if (isNaN(z) || isNaN(p)) return true;
      const expectedP = zScoreToPercentile(z);
      return Math.abs(expectedP - p) < 5; 
  };

  const handleSubtestNameChange = (oldName: string, iName: string) => {
      updateAllPagesRows(prev => prev.map(r => r.subtest === oldName ? { ...r, subtest: iName } : r));
  };

  const handleAddRowToSubtest = (subtestName: string) => {
      updateCurrentPageRows(prev => [...prev, { id: crypto.randomUUID(), subtest: subtestName, label: '', raw: '', standard: '', zScore: '', percentile: '' }]);
  };

    const handleDeleteRow = (id: string) => updateCurrentPageRows(prev => prev.filter(r => r.id !== id));
    const handleAddSubtest = () => handleAddRowToSubtest("Nouveau Sous-test " + (Object.keys(currentGroupedRows).length + 1));
  
  // --- PRE-SAVE CHECK ---
  const handlePreSave = () => {
      if (!testName.trim()) {
          setTestNameError(true);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
      }
      if (pages.length > 0 && pages.some(page => !page.validated)) {
          toast.error("Validez chaque page avant d'enregistrer le test.");
          return;
      }
      setShowSaveModal(true);
  };

  // --- HELPER: Build norm payload from an ExtractedRow ---
  const buildNormPayload = (row: ExtractedRow) => {
      const mode: TableStructure = tableStructure === 'PARAMETRIC' ? 'PARAMETRIC' : 'LOOKUP';
      // AGE: AI values first, JS fallback
      let ageMin = row.hidden_age_min;
      let ageMax = row.hidden_age_max;
      if (ageMin === undefined || ageMax === undefined) {
          const ageMatch = row.label.match(/(\d+)/);
          const ageYear = ageMatch ? parseInt(ageMatch[1]) : 0;
          ageMin = ageYear * 12;
          ageMax = (ageYear * 12) + 11;
      }

      // RAW SCORES / STATS
      let mean: number | null = null;
      let sd: number | null = null;
      let rawMin: number | null = null;
      let rawMax: number | null = null;

      if (mode === 'PARAMETRIC') {
          mean = parseFloat(row.mean || row.raw) || 0;
          sd = parseFloat(row.sd || row.zScore) || 0;
          rawMin = null;
          rawMax = null;
      } else {
          if (row.hidden_raw_min !== undefined && row.hidden_raw_max !== undefined) {
              rawMin = row.hidden_raw_min;
              rawMax = row.hidden_raw_max;
          } else {
              const cleanRaw = row.raw.replace(',', '.').replace(/[^\d.-]/g, '');
              if (cleanRaw.includes('-')) {
                  const parts = cleanRaw.split('-');
                  rawMin = parseFloat(parts[0]);
                  rawMax = parseFloat(parts[1]);
              } else {
                  const val = parseFloat(cleanRaw);
                  rawMin = val;
                  rawMax = val;
              }
              if (rawMin !== null && isNaN(rawMin)) rawMin = null;
              if (rawMax !== null && isNaN(rawMax)) rawMax = null;
          }
      }

      return {
          age_min_months: ageMin,
          age_max_months: ageMax,
          gender: 'Mixed',
          raw_min: rawMin,
          raw_max: rawMax,
          mean,
          sd,
          standard_score: mode === 'LOOKUP' ? (parseFloat(row.standard) || null) : null,
          percentile: mode === 'LOOKUP' ? (parseFloat(row.percentile) || null) : null
      };
  };

  const buildTestPayload = () => ({
      test: {
          name: testName.trim(),
          category_id: selectedCategory,
          version: '1.0',
          structure_type: tableStructure === 'PARAMETRIC' ? 'PARAMETRIC' : 'LOOKUP'
      },
      subtests: allGroupedEntries.map(([subtestName, subRows]) => ({
          name: subtestName,
          unit: 'pts',
          score_type: 'standard',
          computation_mode: tableStructure === 'PARAMETRIC' ? 'PARAMETRIC' : 'LOOKUP',
          norms: subRows.map(row => buildNormPayload(row))
      }))
  });

  // --- DETECT DUPLICATE & ASK USER ---
  const handleFinalSave = async () => {
      if (!legalConsent) return;

      setIsSaving(true);
      try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new Error("Utilisateur non connecté");
          setCurrentUserId(user.id);

          // --- DEDUP CHECK: RPC (tests privés de l'org) ---
          const matches = await AdminService.findPrivateTestByName(testName);
          const match = (matches || [])[0];

          if (match) {
              // Count existing subtests for info display
              const { data: existingSubs } = await supabase
                  .from('view_unified_subtests')
                  .select('id, name')
                  .eq('test_id', match.id);
              const existingSubNames = new Set((existingSubs || []).map(s => normalizeTestName(s.name)));
              const newSubtests = Object.keys(allGroupedRows).filter(name => !existingSubNames.has(normalizeTestName(name)));

              setMergeTarget({ id: match.id, name: match.name, subtestCount: existingSubs?.length || 0 });
              setMergeNewSubtests(newSubtests.length);
              setMergeNewAgeRanges(allRows.length); // approximate: all rows are potential new norms
              setShowSaveModal(false);
              setShowMergeModal(true);
              return;
          }

          // No duplicate → create normally
          await performCreate();

      } catch (e: unknown) {
          Logger.error('DB', "Erreur sauvegarde test:", e);
          toast.error("Erreur lors de la création : " + (e instanceof Error ? e.message : String(e)));
      } finally {
          setIsSaving(false);
      }
  };

  // --- CREATE NEW TEST (original flow) ---
  const performCreate = async () => {
      const payload = buildTestPayload();
      const testId = await AdminService.createPrivateTest(payload);

      Logger.info('DB', "Test privé créé avec succès.");
      finishSuccess(testId);
  };

  // --- MERGE INTO EXISTING TEST ---
  const performMerge = async () => {
      if (!mergeTarget) return;
      setIsSaving(true);
      try {
          const existingTestId = mergeTarget.id;
          const payload = buildTestPayload();
          const result = await AdminService.mergePrivateTest(existingTestId, payload);

          Logger.info('DB', `Merge réussi: +${result.new_subtests} sous-tests, +${result.new_norms} normes dans ${existingTestId}`);
          toast.success(`Fusion réussie ! ${result.new_norms} nouvelles entrées ajoutées.`);

          setShowMergeModal(false);
          finishSuccess(existingTestId);

      } catch (e: unknown) {
          Logger.error('DB', "Erreur merge test:", e);
          toast.error("Erreur lors de la fusion : " + (e instanceof Error ? e.message : String(e)));
      } finally {
          setIsSaving(false);
      }
  };

  // --- FORCE CREATE (user chose "Créer séparé" from merge modal) ---
  const handleForceCreate = async () => {
      setIsSaving(true);
      setShowMergeModal(false);
      try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new Error("Utilisateur non connecté");
          setCurrentUserId(user.id);
          await performCreate();
      } catch (e: unknown) {
          Logger.error('DB', "Erreur création forcée:", e);
          toast.error("Erreur : " + (e instanceof Error ? e.message : String(e)));
      } finally {
          setIsSaving(false);
      }
  };

  // --- SHARED SUCCESS CALLBACK ---
  const finishSuccess = (testId: string) => {
      const { data: { user } } = { data: { user: null as any } }; // ID already captured by caller
      const contributionData: Contribution = {
          id: testId,
          userId: currentUserId || 'unknown',
          userName: 'Moi',
          testName: testName,
          docType: 'image',
          status: 'validated',
          vigilanceScore: 'pass',
          submittedAt: new Date().toISOString(),
          structureType: tableStructure,
          rows: allRows
      };
      setShowSaveModal(false);
      onSubmit(contributionData);
      setStep('success');
  };

  // --- RENDER ---
  if (step === 'intro') { 
      return (
        <div className="fixed inset-0 z-[50] bg-[#3D405B]/95 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-500">
            <div className="bg-white max-w-4xl w-full rounded-[40px] overflow-hidden shadow-2xl flex flex-col md:flex-row relative">
                <button onClick={onClose} className="absolute top-6 right-6 text-stone-300 hover:text-stone-500 z-10"><X size={24}/></button>
                <div className="w-full md:w-2/5 bg-[#F9F9F9] p-10 flex flex-col justify-center items-center relative overflow-hidden">
                    <div className="absolute top-[-20%] left-[-20%] w-64 h-64 bg-[#E07A5F]/10 rounded-full blur-3xl"></div>
                    <div className="relative z-10 text-center">
                        <div className="w-24 h-24 bg-white rounded-3xl shadow-xl flex items-center justify-center mb-8 mx-auto transform -rotate-6">
                            <Scan size={48} className="text-[#E07A5F]" />
                        </div>
                        <h2 className="font-serif font-bold text-2xl text-[#3D405B] mb-2">Studio de Numérisation</h2>
                        <p className="text-stone-500 text-sm font-medium">Transformez vos manuels papiers en outils numériques interactifs.</p>
                    </div>
                </div>
                <div className="w-full md:w-3/5 p-10 md:p-12">
                    <h3 className="text-2xl font-bold text-[#3D405B] mb-8">Comment ça marche ?</h3>
                    <div className="space-y-8">
                        <div className="flex gap-4">
                            <div className="w-10 h-10 bg-stone-100 rounded-full flex items-center justify-center text-[#3D405B] font-bold text-lg shrink-0">1</div>
                            <div>
                                <h4 className="font-bold text-[#3D405B]">Usage Personnel & Privé</h4>
                                <p className="text-sm text-stone-500 leading-relaxed">Le test est chiffré et stocké dans le silo sécurisé de votre organisation. Il n'est <strong>jamais partagé</strong> avec d'autres utilisateurs.</p>
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <div className="w-10 h-10 bg-stone-100 rounded-full flex items-center justify-center text-[#3D405B] font-bold text-lg shrink-0">2</div>
                            <div>
                                <h4 className="font-bold text-[#3D405B]">Extraction par IA</h4>
                                <p className="text-sm text-stone-500 leading-relaxed">Prenez en photo vos tableaux d'étalonnage. Notre moteur extrait les valeurs et crée une grille de saisie interactive.</p>
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <div className="w-10 h-10 bg-stone-100 rounded-full flex items-center justify-center text-[#3D405B] font-bold text-lg shrink-0">3</div>
                            <div>
                                <h4 className="font-bold text-[#3D405B]">Respect des Droits</h4>
                                <p className="text-sm text-stone-500 leading-relaxed">Conformément à l'exception d'interopérabilité, vous devez posséder l'original du test numérisé.</p>
                            </div>
                        </div>
                    </div>
                    <div className="mt-10 pt-6 border-t border-stone-100 flex justify-end">
                        <button onClick={() => setStep('upload')} className="bg-[#3D405B] text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-[#2c2e42] transition-all flex items-center gap-2 group">
                            Numériser un test <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
      );
  }

  if (step === 'upload' || step === 'processing') { 
      return (
        <div className="min-h-screen bg-[#F9F9F9] flex flex-col items-center justify-center p-6 animate-in fade-in duration-500">
            <div className="w-full max-w-2xl bg-white rounded-[32px] shadow-xl p-10 text-center relative overflow-hidden">
                <button onClick={onClose} className="absolute top-6 left-6 text-stone-400 hover:text-stone-600 flex items-center gap-2 font-bold text-sm uppercase tracking-wider">
                    <ArrowLeft size={16} /> Annuler
                </button>
                <div className="mb-8 flex justify-center">
                    <div className="w-20 h-20 bg-[#E07A5F] text-white rounded-3xl flex items-center justify-center transform -rotate-3 shadow-lg shadow-orange-200">
                        <Camera size={40} />
                    </div>
                </div>
                <h1 className="font-serif text-3xl font-bold text-[#3D405B] mb-4">Scanner un tableau</h1>
                <p className="text-stone-500 mb-10 max-w-md mx-auto leading-relaxed">Prenez en photo une page de votre manuel (Tableau des Moyennes/ET ou Table de conversion).</p>
                {step === 'upload' ? (
                    <div className="space-y-6 max-w-md mx-auto">
                        <div className="text-left">
                            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider ml-1">Nom du Test <span className="text-rose-500">*</span></label>
                            <input 
                                value={testName} 
                                onChange={(e) => { setTestName(e.target.value); setTestNameError(false); }} 
                                placeholder="Ex: Mon Test Perso" 
                                className={`w-full p-4 bg-stone-50 rounded-xl border outline-none focus:border-[#E07A5F] font-bold text-[#3D405B] ${testNameError ? 'border-rose-500 bg-rose-50' : 'border-stone-200'}`} 
                            />
                            {testNameError && <p className="text-xs text-rose-500 font-bold mt-1 ml-1">Le nom est obligatoire.</p>}
                        </div>
                        <div className="border-3 border-dashed border-stone-200 rounded-[24px] p-10 hover:border-[#E07A5F] hover:bg-[#fff5f2] transition-all cursor-pointer group relative">
                            <input type="file" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20" accept="image/*" multiple />
                            <div className="relative z-10 pointer-events-none">
                                <Upload size={32} className="text-stone-300 group-hover:text-[#E07A5F] mx-auto mb-2 transition-colors" />
                                <p className="font-bold text-[#3D405B]">Importer la photo</p>
                                <p className="text-xs text-stone-400 mt-1">Plusieurs images possibles. L'IA détectera la structure.</p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="py-12">
                        <Loader2 size={48} className="text-[#E07A5F] animate-spin mx-auto mb-4" />
                        <p className="font-bold text-[#3D405B]">Extraction des données...</p>
                        <p className="text-xs text-stone-400">Structuration en cours...</p>
                        {files.length > 1 && (
                            <p className="text-xs text-stone-400 mt-2">Page {Math.min(currentFileIndex + 1, files.length)} / {files.length}</p>
                        )}
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
                <h2 className="font-serif text-4xl font-bold text-[#3D405B] mb-4">Test Numérisé !</h2>
                <p className="text-stone-500 text-lg mb-8 max-w-md mx-auto">Ce test est désormais disponible dans votre catalogue personnel.</p>
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
                    <p className="text-xs text-stone-400 flex items-center gap-1"><ShieldAlert size={10} className="text-[#E07A5F]"/> Test Privé (Chiffré)</p>
                </div>
            </div>
            <div className="flex items-center gap-3">
                <button onClick={handlePreSave} className="bg-[#E07A5F] text-white px-6 py-2.5 rounded-xl font-bold shadow-md hover:bg-[#d0694e] transition-all flex items-center gap-2 text-sm"><Save size={16} /> Enregistrer le test</button>
            </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
            <div className="w-1/2 bg-stone-100 border-r border-stone-200 relative flex flex-col">
                {pages.length > 1 && (
                    <div className="absolute top-4 right-4 bg-white/90 backdrop-blur rounded-full shadow-sm border border-stone-200 px-3 py-1 flex items-center gap-2 z-10">
                        <button
                            onClick={() => setCurrentFileIndex(Math.max(0, currentFileIndex - 1))}
                            disabled={currentFileIndex === 0}
                            className="p-1 rounded-full text-stone-500 hover:bg-stone-100 disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                            <ArrowLeft size={14} />
                        </button>
                        <span className="text-xs font-bold text-stone-500">
                            Page {currentFileIndex + 1} / {pages.length}
                        </span>
                        <button
                            onClick={() => setCurrentFileIndex(Math.min(pages.length - 1, currentFileIndex + 1))}
                            disabled={currentFileIndex >= pages.length - 1}
                            className="p-1 rounded-full text-stone-500 hover:bg-stone-100 disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                            <ArrowRight size={14} />
                        </button>
                    </div>
                )}
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur rounded-full shadow-sm border border-stone-200 p-1 flex gap-1 z-10">
                    <button onClick={() => setZoom(Math.max(0.5, zoom - 0.1))} className="p-2 hover:bg-stone-100 rounded-full text-stone-500"><ZoomOut size={16}/></button>
                    <span className="text-xs font-mono font-bold text-stone-400 py-2 px-1 w-12 text-center">{Math.round(zoom * 100)}%</span>
                    <button onClick={() => setZoom(Math.min(2, zoom + 0.1))} className="p-2 hover:bg-stone-100 rounded-full text-stone-500"><ZoomIn size={16}/></button>
                </div>
                <div className="flex-1 overflow-auto flex items-center justify-center p-10 cursor-grab active:cursor-grabbing">
                    <div className="bg-white shadow-2xl transition-transform duration-200 ease-out origin-center relative" style={{ width: 'auto', height: 'auto', transform: `scale(${zoom})` }}>
                         {currentFileUrl ? <img src={currentFileUrl} alt="Source" className="max-w-full max-h-[80vh] object-contain" /> : null}
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

                        {/* CATEGORY SELECTOR */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider mb-2 block text-stone-400">Catégorie du Test</label>
                            <div className="flex flex-wrap gap-2">
                                {TEST_CATALOG.map(cat => (
                                    <button
                                        key={cat.id}
                                        onClick={() => setSelectedCategory(cat.id)}
                                        className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${
                                            selectedCategory === cat.id 
                                            ? 'bg-[#3D405B] text-white border-[#3D405B] shadow-md' 
                                            : 'bg-white text-stone-500 border-stone-200 hover:border-stone-300'
                                        }`}
                                    >
                                        {cat.name}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {pages.length > 0 && (
                            <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 flex flex-col gap-3">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Pages</span>
                                    <button
                                        onClick={handleValidateCurrentPage}
                                        className={`text-xs font-bold px-3 py-1 rounded-full border transition-all ${currentPage?.validated ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-white text-stone-500 border-stone-200 hover:border-[#E07A5F] hover:text-[#E07A5F]'}`}
                                    >
                                        {currentPage?.validated ? 'Page validée' : 'Valider cette page'}
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {pages.map((page, index) => (
                                        <button
                                            key={page.id}
                                            onClick={() => setCurrentFileIndex(index)}
                                            className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all flex items-center gap-2 ${index === currentFileIndex ? 'bg-[#3D405B] text-white border-[#3D405B]' : 'bg-white text-stone-500 border-stone-200 hover:border-stone-300'}`}
                                        >
                                            {`Page ${index + 1}`}
                                            {page.validated && <Check size={12} className="text-emerald-200" />}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {currentGroupedEntries.map(([subtest, subRows]) => (
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
                                    {/* HEADERS CONDITIONNELS */}
                                    {tableStructure === 'PARAMETRIC' && (
                                        <div className="grid grid-cols-12 gap-2 text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-2 px-3">
                                            <div className="col-span-3">Âge / Classe</div>
                                            <div className="col-span-4 text-center" title="Moyenne Statistique">Moyenne (M)</div>
                                            <div className="col-span-4 text-center" title="Ecart-Type Statistique">Ecart-Type (SD)</div>
                                            <div className="col-span-1"></div>
                                        </div>
                                    )}

                                    {/* MODE 1 : LOOKUP BATCHED (REGROUPÉ PAR ÂGE) */}
                                    {tableStructure === 'LOOKUP' ? (
                                        <div className="space-y-4">
                                            {Array.from(
                                                subRows.reduce((entryMap, e) => {
                                                    const l = e.label || "N/A";
                                                    if(!entryMap.has(l)) entryMap.set(l, []);
                                                    entryMap.get(l)!.push(e);
                                                    return entryMap;
                                                }, new Map<string, ExtractedRow[]>())
                                            ).map(([label, batchRows], batchIdx) => (
                                                <div key={`${subtest}-${batchIdx}`} className="bg-stone-50/50 rounded-xl border border-stone-200 overflow-hidden shadow-sm">
                                                    
                                                    {/* BATCH HEADER (L'ÂGE EST ICI UNE SEULE FOIS) */}
                                                    <div className="bg-stone-100 px-4 py-2 border-b border-stone-200 flex items-center justify-between group/header hover:bg-stone-200/50 transition-colors">
                                                        <div className="flex items-center gap-3 flex-1">
                                                            <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider shrink-0">Groupe :</span>
                                                            <input 
                                                                value={label} 
                                                                onChange={(e) => handleBatchLabelChange(subtest, label, e.target.value)}
                                                                className="font-bold text-[#3D405B] text-sm bg-transparent outline-none focus:bg-white focus:ring-2 focus:ring-[#E07A5F]/20 rounded px-2 py-1 w-full transition-all border border-transparent focus:border-[#E07A5F]/20"
                                                                placeholder="Ex: 4;0 à 4;5 ans"
                                                            />
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[9px] font-bold text-stone-400 uppercase tracking-wider bg-white px-2 py-0.5 rounded border border-stone-200">{batchRows.length} lignes</span>
                                                        </div>
                                                    </div>

                                                    {/* BATCH ROWS (JUSTE LES SCORES) */}
                                                    <div className="p-2 bg-white">
                                                        <div className="grid grid-cols-9 gap-2 text-[9px] font-bold text-stone-400 uppercase tracking-wider mb-2 px-2 text-center bg-stone-50/50 py-1 rounded-lg mx-1">
                                                            <div className="col-span-2">Brut</div>
                                                            <div className="col-span-2">NS</div>
                                                            <div className="col-span-2">ET / Z</div>
                                                            <div className="col-span-2">%</div>
                                                            <div className="col-span-1"></div>
                                                        </div>

                                                        {batchRows.map((row) => {
                                                            const isConsistent = checkConsistency(row);
                                                            return (
                                                                <div key={row.id} className="grid grid-cols-9 gap-2 items-center mb-1 px-1 group/row hover:bg-stone-50 rounded-lg p-1 transition-colors">
                                                                    <div className="col-span-2">
                                                                        <input value={row.raw} onChange={(e) => handleRowChange(row.id, 'raw', e.target.value)} className="w-full p-1.5 text-center bg-white border border-stone-200 rounded-md focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F]/20 outline-none text-xs font-medium text-stone-600 transition-all" />
                                                                    </div>
                                                                    <div className="col-span-2">
                                                                        <input value={row.standard} onChange={(e) => handleRowChange(row.id, 'standard', e.target.value)} className="w-full p-1.5 text-center bg-white border border-stone-200 rounded-md focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F]/20 outline-none text-xs font-bold text-[#3D405B] transition-all" />
                                                                    </div>
                                                                    <div className="col-span-2">
                                                                        <input value={row.zScore} onChange={(e) => handleRowChange(row.id, 'zScore', e.target.value)} className={`w-full p-1.5 text-center bg-white border border-stone-200 rounded-md focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F]/20 outline-none text-xs font-bold transition-all ${!isConsistent ? 'text-rose-500' : 'text-[#3D405B]'}`} />
                                                                    </div>
                                                                    <div className="col-span-2">
                                                                        <input value={row.percentile} onChange={(e) => handleRowChange(row.id, 'percentile', e.target.value)} className={`w-full p-1.5 text-center bg-white border border-stone-200 rounded-md focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F]/20 outline-none text-xs font-bold transition-all ${!isConsistent ? 'text-rose-500' : 'text-[#3D405B]'}`} />
                                                                    </div>
                                                                    <div className="col-span-1 text-center">
                                                                        <button onClick={() => handleDeleteRow(row.id)} className="text-stone-300 hover:text-rose-500 p-1.5 rounded hover:bg-rose-50 transition-all"><Trash2 size={14}/></button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                        
                                                        <button onClick={() => handleAddRowToBatch(subtest, label)} className="mt-2 w-full py-2 border border-dashed border-stone-200 rounded-lg text-stone-400 text-[10px] font-bold hover:border-[#E07A5F] hover:text-[#E07A5F] hover:bg-[#fff5f2] transition-all flex items-center justify-center gap-1">
                                                            <Plus size={12} /> Ajouter une ligne à ce groupe
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        // MODE 2 : PARAMETRIC (LISTE PLATE CLASSIQUE)
                                        <>
                                            {subRows.map((row) => (
                                                <div key={row.id} className="grid grid-cols-12 gap-2 items-center group mb-1 hover:bg-stone-50 p-1 rounded-lg transition-colors">
                                                    <div className="col-span-3">
                                                        <input value={row.label} onChange={(e) => handleRowChange(row.id, 'label', e.target.value)} className="w-full p-2 bg-white rounded-lg border border-stone-200 focus:border-[#E07A5F] outline-none text-sm font-bold text-[#3D405B] transition-all" />
                                                    </div>
                                                    <div className="col-span-4">
                                                        <input value={row.mean || ''} onChange={(e) => handleRowChange(row.id, 'mean', e.target.value)} className="w-full p-2 text-center bg-indigo-50/30 rounded-lg border border-indigo-100 focus:bg-white focus:border-indigo-500 outline-none text-sm font-bold text-indigo-900 transition-all" placeholder="Moyenne" />
                                                    </div>
                                                    <div className="col-span-4">
                                                        <input value={row.sd || ''} onChange={(e) => handleRowChange(row.id, 'sd', e.target.value)} className="w-full p-2 text-center bg-indigo-50/30 rounded-lg border border-indigo-100 focus:bg-white focus:border-indigo-500 outline-none text-sm font-bold text-indigo-900 transition-all" placeholder="SD" />
                                                    </div>
                                                    <div className="col-span-1 text-center">
                                                        <button onClick={() => handleDeleteRow(row.id)} className="text-stone-300 hover:text-rose-500 p-2 rounded hover:bg-rose-50 transition-all"><Trash2 size={14}/></button>
                                                    </div>
                                                </div>
                                            ))}
                                            
                                            <button onClick={() => handleAddRowToSubtest(subtest)} className="mt-2 w-full py-2 border border dashed border-stone-200 rounded-lg text-stone-400 text-xs font-bold hover:border-[#E07A5F] hover:text-[#E07A5F] transition-all flex items-center justify-center gap-1">
                                                <Plus size={12} /> Ajouter une ligne
                                            </button>
                                        </>
                                    )}
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

        {/* --- MODAL CONFIRMATION LÉGALE --- */}
        {showSaveModal && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="bg-white w-full max-w-md rounded-[24px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 relative">
                    <div className="p-6">
                        <div className="w-16 h-16 bg-[#3D405B] rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-lg shadow-stone-300">
                            <Scale size={32} className="text-white" />
                        </div>
                        <h3 className="font-serif font-bold text-xl text-[#3D405B] text-center mb-2">Certification Légale</h3>
                        <p className="text-center text-sm text-stone-500 mb-6">Pour valider cette numérisation, votre engagement est requis.</p>
                        
                        <div className="bg-stone-50 p-4 rounded-xl border border-stone-100 mb-6">
                            <label className="flex gap-3 cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    className="mt-1 w-5 h-5 accent-[#E07A5F] shrink-0" 
                                    checked={legalConsent}
                                    onChange={(e) => setLegalConsent(e.target.checked)}
                                />
                                <span className="text-xs text-stone-600 font-medium leading-relaxed text-justify">
                                    Je certifie sur l'honneur être en possession de l'original papier de ce test (Manuel + Cahiers). Cette numérisation est effectuée au titre de l'exception d'interopérabilité (Code de la Propriété Intellectuelle) pour mon usage professionnel personnel et exclusif.
                                </span>
                            </label>
                        </div>

                        <div className="flex gap-3">
                            <button 
                                onClick={() => setShowSaveModal(false)}
                                className="flex-1 py-3 text-stone-400 font-bold hover:bg-stone-50 rounded-xl transition-colors text-sm"
                            >
                                Annuler
                            </button>
                            <button 
                                onClick={handleFinalSave}
                                disabled={!legalConsent || isSaving}
                                className={`flex-1 py-3 text-white rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 ${legalConsent ? 'bg-[#E07A5F] hover:bg-[#d0694e] hover:-translate-y-1' : 'bg-stone-300 cursor-not-allowed'}`}
                            >
                                {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                                Confirmer
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* --- MODAL MERGE CONFIRMATION --- */}
        {showMergeModal && mergeTarget && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="bg-white w-full max-w-md rounded-[24px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 relative">
                    <div className="p-6">
                        <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-lg shadow-amber-100">
                            <Database size={32} className="text-amber-600" />
                        </div>
                        <h3 className="font-serif font-bold text-xl text-[#3D405B] text-center mb-2">Test existant détecté</h3>
                        <p className="text-center text-sm text-stone-500 mb-6">
                            Le test <strong className="text-[#3D405B]">« {mergeTarget.name} »</strong> existe déjà avec {mergeTarget.subtestCount} sous-test{mergeTarget.subtestCount > 1 ? 's' : ''}.
                        </p>

                        <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl mb-6 space-y-2">
                            <div className="flex items-center gap-2 text-sm">
                                <Layers size={14} className="text-amber-600 shrink-0" />
                                <span className="text-stone-600">
                                    <strong className="text-[#3D405B]">{allRows.length}</strong> entrée{allRows.length > 1 ? 's' : ''} à fusionner
                                    {mergeNewSubtests > 0 && <> dont <strong className="text-[#3D405B]">{mergeNewSubtests}</strong> nouveau{mergeNewSubtests > 1 ? 'x' : ''} sous-test{mergeNewSubtests > 1 ? 's' : ''}</>}
                                </span>
                            </div>
                            <p className="text-xs text-amber-700 leading-relaxed">
                                Seules les lignes manquantes seront ajoutées (âge + score). Les données existantes ne seront pas modifiées.
                            </p>
                        </div>

                        <div className="flex gap-3">
                            <button 
                                onClick={handleForceCreate}
                                disabled={isSaving}
                                className="flex-1 py-3 text-stone-400 font-bold hover:bg-stone-50 rounded-xl transition-colors text-sm border border-stone-200"
                            >
                                Créer séparé
                            </button>
                            <button 
                                onClick={performMerge}
                                disabled={isSaving}
                                className="flex-1 py-3 text-white rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 hover:-translate-y-1"
                            >
                                {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                                Fusionner
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};
