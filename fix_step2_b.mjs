import fs from 'fs';
// Read and normalize CRLF → LF
let c = fs.readFileSync('components/assessment/Step2Tests.tsx', 'utf8').replace(/\r\n/g, '\n');
const orig = c;
let n = 0;

function rep(label, from, to) {
  if (!c.includes(from)) { console.log('MISS:', label); return; }
  c = c.replace(from, to);
  n++;
  console.log('OK:', label);
}

// 1. CompactSubtestRow: add onInlineChange prop
rep('CompactSubtestRow props',
`const CompactSubtestRow: React.FC<{
  subtest: SubtestDef;
  result: ScoreResult;
  onClick: () => void;
  onDelete?: () => void;
}> = ({ subtest, result, onClick, onDelete }) => {`,
`const CompactSubtestRow: React.FC<{
  subtest: SubtestDef;
  result: ScoreResult;
  onClick: () => void;
  onDelete?: () => void;
  onInlineChange?: (patch: Partial<ScoreResult>) => void;
}> = ({ subtest, result, onClick, onDelete, onInlineChange }) => {`
);

// 2. CompactSubtestRow: add inline input before onDelete
rep('CompactSubtestRow inline input',
`      {onDelete && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="shrink-0 mr-2 p-1.5 rounded-lg bg-rose-50 text-rose-400 hover:bg-rose-100 hover:text-rose-600 transition-colors"
          title="Supprimer ce sous-test"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
};`,
`      {onInlineChange && subtest.inputModel !== 'custom_text' && subtest.inputModel !== 'qualitative_category' && (
        <div className="shrink-0 flex items-center mr-1" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            inputMode="decimal"
            value={result.raw || ''}
            onChange={(e) => onInlineChange(mergePatch(result, { raw: e.target.value, entryMetric: 'raw', scoreSource: 'manual_raw' }))}
            onBlur={() => {
              if (hasValue(result) && !reviewed(result)) {
                onInlineChange({ reviewState: 'reviewed', reviewedAt: new Date().toISOString(), status: 'validated' });
              }
            }}
            onClick={(e) => e.stopPropagation()}
            placeholder="\u2014"
            className="w-16 text-center text-sm font-bold bg-[var(--input-bg)] border border-[var(--border-color)] rounded-lg px-2 py-1.5 outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary-opacity-20)] text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] transition-colors"
            title="Saisie rapide brut"
          />
        </div>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="shrink-0 mr-2 p-1.5 rounded-lg bg-rose-50 text-rose-400 hover:bg-rose-100 hover:text-rose-600 transition-colors"
          title="Supprimer ce sous-test"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
};`
);

// 3. TableView: add clipboard paste. First let's find the exact text around cellInput
const cellIdx = c.indexOf("  const cellInput = 'w-full text-center text-xs font-semibold");
if (cellIdx === -1) {
  console.log('MISS: TableView - cellInput not found, searching differently...');
  const idx2 = c.indexOf('const cellInput');
  console.log('  cellInput found at:', idx2, 'context:', JSON.stringify(c.substring(idx2, idx2+80)));
} else {
  // Find the surrounding context
  const beforeCellInput = c.lastIndexOf('\n', cellIdx);
  const seg = c.substring(beforeCellInput - 200, beforeCellInput + 300);
  // console.log('context:', JSON.stringify(seg));
  rep('TableView clipboard paste',
`  const cellInput = 'w-full text-center text-xs font-semibold bg-transparent outline-none py-1.5 border-b border-transparent focus:border-[var(--primary)] text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] transition-colors tabular-nums';
  const cellDisplay = 'text-center text-xs font-medium text-[var(--text-secondary)] py-1.5 tabular-nums';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--border-color)]">`,
`  const toast = useToast();

  const handleClipboardPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const lines = text.trim().split(/\\r?\\n/).filter(Boolean);
      const sortedSts = [...subtests].sort(compareSubtestsForDisplay);
      let applied = 0;
      lines.forEach((line, i) => {
        if (i >= sortedSts.length) return;
        const st = sortedSts[i];
        const parts = line.split('\\t');
        const raw = parts[0]?.trim().replace(',', '.');
        const ns = parts[1]?.trim().replace(',', '.');
        const current = getResult(st.id);
        if (raw && raw !== '-' && raw !== '\u2014' && !isNaN(parseFloat(raw))) {
          updateSubtest(testId, st.id, mergePatch(current, { raw, entryMetric: 'raw', scoreSource: 'manual_raw' }));
          applied++;
        } else if (ns && ns !== '-' && ns !== '\u2014' && !isNaN(parseFloat(ns))) {
          updateSubtest(testId, st.id, mergePatch(current, { standard: ns, entryMetric: 'standard', scoreSource: 'manual_ns' }));
          applied++;
        }
      });
      toast.success(\`\${applied} valeur(s) coll\u00e9e(s)\`);
    } catch {
      toast.error('Impossible de lire le presse-papier');
    }
  };

  const cellInput = 'w-full text-center text-xs font-semibold bg-transparent outline-none py-1.5 border-b border-transparent focus:border-[var(--primary)] text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] transition-colors tabular-nums';
  const cellDisplay = 'text-center text-xs font-medium text-[var(--text-secondary)] py-1.5 tabular-nums';

  return (
    <div className="overflow-x-auto">
      <div className="flex justify-end mb-2">
        <button
          type="button"
          onClick={handleClipboardPaste}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] text-xs font-bold hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
          title="Coller depuis un tableur (une valeur par ligne)"
        >
          <FilePlus size={12} /> Coller
        </button>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--border-color)]">`
  );
}

// 4. Add new state to Step2Tests
rep('add preferredMetricByTest + quickEntry state',
`  const [expandedSubKey, setExpandedSubKey] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<Record<string, 'accordion' | 'table'>>({});
  const [testOrder, setTestOrder] = useState<string[]>(() => Object.keys(tests));
  const prevExpandedTestIdRef = useRef<string | null>(null);`,
`  const [expandedSubKey, setExpandedSubKey] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<Record<string, 'accordion' | 'table'>>({});
  const [testOrder, setTestOrder] = useState<string[]>(() => Object.keys(tests));
  const [preferredMetricByTest, setPreferredMetricByTest] = useState<Record<string, Metric>>({});
  const [showQuickEntry, setShowQuickEntry] = useState(false);
  const [quickEntryIndex, setQuickEntryIndex] = useState(0);
  const prevExpandedTestIdRef = useRef<string | null>(null);`
);

// 5. Add orderedSubKeys + handleAdvance before the main return statement
rep('add orderedSubKeys + handleAdvance',
`  return (
    <div className="max-w-7xl mx-auto animate-in fade-in duration-500 pb-10">`,
`  const orderedSubKeys = useMemo(() => {
    const keys: string[] = [];
    testOrder.forEach((testId) => {
      const entry = testDefMap[testId];
      if (!entry) return;
      const { def: test } = entry;
      const selectedIds = Object.keys(tests[testId] || {});
      const visible = test.subtests.filter((st) => selectedIds.includes(st.id));
      [...visible].sort(compareSubtestsForDisplay).forEach((st) => keys.push(\`\${testId}__\${st.id}\`));
    });
    return keys;
  }, [testOrder, testDefMap, tests]);

  const handleAdvance = useCallback(() => {
    if (!expandedSubKey) return;
    const idx = orderedSubKeys.indexOf(expandedSubKey);
    if (idx >= 0 && idx < orderedSubKeys.length - 1) {
      setExpandedSubKey(orderedSubKeys[idx + 1]);
    } else {
      setExpandedSubKey(null);
    }
  }, [expandedSubKey, orderedSubKeys]);

  return (
    <div className="max-w-7xl mx-auto animate-in fade-in duration-500 pb-10">`
);

// 6. Add Saisie Rapide button - find the "Ajouter" button in the header
// We need to find the right instance (there are 2 "Ajouter" buttons - header and empty state)
// The header one is preceded by the stat.pending block
const addBtn = `          <button
            onClick={() => { setCatalogTargetTestId(null); setShowCatalog(true); }}
            className="flex items-center gap-2 bg-[var(--secondary)] text-white px-5 py-2.5 rounded-xl font-bold hover:brightness-90 transition-all text-sm"
          >
            <Plus size={16} />
            Ajouter
          </button>`;
const addBtnNew = `          {orderedSubKeys.length > 0 && (
            <button
              type="button"
              onClick={() => { setQuickEntryIndex(0); setShowQuickEntry(true); }}
              className="flex items-center gap-2 border border-[var(--border-color)] text-[var(--text-secondary)] px-4 py-2.5 rounded-xl font-bold hover:border-[var(--primary)] hover:text-[var(--primary)] transition-all text-sm"
              title="Mode saisie rapide clavier"
            >
              <Zap size={15} />
              Saisie rapide
            </button>
          )}
          <button
            onClick={() => { setCatalogTargetTestId(null); setShowCatalog(true); }}
            className="flex items-center gap-2 bg-[var(--secondary)] text-white px-5 py-2.5 rounded-xl font-bold hover:brightness-90 transition-all text-sm"
          >
            <Plus size={16} />
            Ajouter
          </button>`;
const count = (c.match(new RegExp(addBtn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
console.log('Ajouter button count:', count);
if (count === 1) {
  rep('add Saisie Rapide button', addBtn, addBtnNew);
} else if (count > 1) {
  // Replace only first occurrence
  const idx = c.indexOf(addBtn);
  c = c.substring(0, idx) + addBtnNew + c.substring(idx + addBtn.length);
  n++; console.log('OK: add Saisie Rapide button (first occurrence)');
} else {
  console.log('MISS: Ajouter button');
}

// 7. Pass new props to FlexibleSubtestRow in accordion
rep('pass new props to FlexibleSubtestRow',
`                                        <FlexibleSubtestRow
                                          subtest={st}
                                          result={res}
                                          onChange={(patch) => updateSubtest(test.id, st.id, patch)}
                                          isExpanded={isSubExpanded}
                                          onToggleExpand={() => setExpandedSubKey((prev) => (prev === subKey ? null : subKey))}
                                          onFocus={() => setExpandedSubKey(subKey)}
                                        />`,
`                                        <FlexibleSubtestRow
                                          subtest={st}
                                          result={res}
                                          onChange={(patch) => updateSubtest(test.id, st.id, patch)}
                                          isExpanded={isSubExpanded}
                                          onToggleExpand={() => setExpandedSubKey((prev) => (prev === subKey ? null : subKey))}
                                          onFocus={() => setExpandedSubKey(subKey)}
                                          preferredMetric={preferredMetricByTest[test.id]}
                                          onPreferredMetricChange={(m) => setPreferredMetricByTest((p) => ({ ...p, [test.id]: m }))}
                                          onAdvance={handleAdvance}
                                        />`
);

// 8. Pass onInlineChange to CompactSubtestRow in accordion
rep('pass onInlineChange to CompactSubtestRow',
`                                        <CompactSubtestRow
                                          subtest={st}
                                          result={res}
                                          onClick={() => setExpandedSubKey(subKey)}
                                          onDelete={editing ? () => removeSubtest(test.id, st.id) : undefined}
                                        />`,
`                                        <CompactSubtestRow
                                          subtest={st}
                                          result={res}
                                          onClick={() => setExpandedSubKey(subKey)}
                                          onDelete={editing ? () => removeSubtest(test.id, st.id) : undefined}
                                          onInlineChange={(patch) => updateSubtest(test.id, st.id, patch)}
                                        />`
);

if (c !== orig) {
  // Write back with LF line endings (no CRLF)
  fs.writeFileSync('components/assessment/Step2Tests.tsx', c, 'utf8');
  console.log(`\nDone. ${n} changes applied.`);
} else {
  console.log('\nNo changes.');
}
