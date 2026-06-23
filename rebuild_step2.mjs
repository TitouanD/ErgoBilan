import fs from 'fs';

let c = fs.readFileSync('components/assessment/Step2Tests.tsx', 'utf8');
const orig = c;
let changes = 0;

function apply(label, fn) {
  const before = c;
  fn();
  if (c !== before) { changes++; console.log('OK:', label); }
  else console.log('SKIP (not found):', label);
}

// ─── 1. Replace entire NumericRow block (corrupted) + add missing components ───
apply('rewrite NumericRow + add missing components', () => {
  // Find the start of NumericRow
  const start = c.indexOf('\nconst NumericRow: React.FC<{');
  // Find the end: the "});" that closes FlexibleSubtestRow, then the next "return ("
  // We need to find the closing }); of FlexibleSubtestRow
  // Strategy: find FlexibleSubtestRow and then find its closing
  const flexStart = c.indexOf('\nconst FlexibleSubtestRow = React.memo((props: {');
  if (start === -1 || flexStart === -1) return;
  // Find the closing of FlexibleSubtestRow - it's "});" at top-level indentation
  let depth = 0;
  let pos = flexStart + 1;
  let flexEnd = -1;
  while (pos < c.length) {
    if (c[pos] === '(') depth++;
    else if (c[pos] === ')') {
      depth--;
      if (depth === 0) {
        // Check if followed by ;
        if (c[pos+1] === ';' || (c[pos+1] === '\n' && c[pos+2] === ';') || c.substring(pos, pos+4).includes(');')) {
          flexEnd = pos + 2;
          break;
        }
      }
    }
    pos++;
  }

  // Better: find next "const CompactSubtestRow" and use everything before it
  const compactStart = c.indexOf('\nconst CompactSubtestRow:');
  if (compactStart === -1) return;

  const toReplace = c.substring(start, compactStart);

  const replacement = `
// ─── Aggregate computation for computed_items subtests ───
const computeAggregate = (
  items: SubtestItem[],
  values: Record<string, number | undefined>,
  agg: ItemsAggregation,
): number | null => {
  const vals = items
    .filter((it) => !it.isMaster)
    .map((it) => values[it.id])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (vals.length === 0) return null;
  if (agg === 'sum') return vals.reduce((a, b) => a + b, 0);
  if (agg === 'best_of') return Math.max(...vals);
  if (agg === 'mean') return vals.reduce((a, b) => a + b, 0) / vals.length;
  return null; // 'custom' — manual entry
};

// ─── Shared row header + collapse button ───
const RowHeader: React.FC<{
  subtest: SubtestDef;
  badge?: React.ReactNode;
  onToggleExpand?: () => void;
}> = ({ subtest, badge, onToggleExpand }) => (
  <div className="flex items-start gap-1.5 mb-4">
    <button
      type="button"
      onClick={() => onToggleExpand?.()}
      className="mt-0.5 rounded p-0.5 text-[var(--text-secondary)] hover:text-[var(--primary)] hover:bg-[var(--hover-bg)] shrink-0"
      aria-label="Refermer le sous-test"
    >
      <ChevronDown size={12} />
    </button>
    <div className="min-w-0 flex-1">
      <h4 className="font-semibold text-[var(--text-heading)] text-sm md:text-base leading-tight break-words">
        {getSubtestDisplayName(subtest)}
      </h4>
      <div className="flex items-center flex-wrap gap-1.5 mt-1">
        {subtest.unit && <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">{subtest.unit}</span>}
        {getScaleLabel(subtest.scoreType) && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-300">
            {getScaleLabel(subtest.scoreType)}
          </span>
        )}
        {badge}
      </div>
    </div>
  </div>
);

// ─── NumericRow: full 4-metric entry (handles simple + computed_items) ───
const NumericRow: React.FC<{
  subtest: SubtestDef;
  result: ScoreResult;
  onChange: (patch: Partial<ScoreResult>) => void;
  readOnly?: boolean;
  onFocus?: () => void;
  onToggleExpand?: () => void;
  preferredMetric?: Metric;
  onPreferredMetricChange?: (m: Metric) => void;
  onAdvance?: () => void;
}> = ({
  subtest, result, onChange, readOnly, onFocus, onToggleExpand,
  preferredMetric, onPreferredMetricChange, onAdvance,
}) => {
  const scoreType = subtest.scoreType || 'standard';
  const conversionLocked = isManualOnlyScoreType(scoreType);
  const cfg = subtest.inputConfig || {};
  const items: SubtestItem[] = cfg.items || [];
  const aggregation: ItemsAggregation = (cfg.itemsAggregation || 'sum') as ItemsAggregation;
  const isCustomAgg = aggregation === 'custom';
  const hasItems = items.length > 0 && subtest.inputModel === 'computed_items';

  const [localItemValues, setLocalItemValues] = useState<Record<string, number | undefined>>(
    () => {
      const saved = result.rawItems as Record<string, number | undefined> | undefined;
      return saved || {};
    },
  );
  const [itemsExpanded, setItemsExpanded] = useState(true);
  const [directMode, setDirectMode] = useState(false);

  // Sync localItemValues from persisted result.rawItems on first render
  React.useEffect(() => {
    if (result.rawItems && Object.keys(result.rawItems).length > 0) {
      setLocalItemValues(result.rawItems as Record<string, number | undefined>);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Active metric: prefer stored entryMetric, fall back to test-level preferred, then 'raw'
  const activeMetric: Metric = (() => {
    if (result.entryMetric && result.entryMetric !== 'raw') return result.entryMetric as Metric;
    if (!hasValue(result) && preferredMetric) return preferredMetric;
    return (result.entryMetric as Metric) || preferredMetric || 'raw';
  })();

  const setPatch = (patch: Partial<ScoreResult>) => onChange(mergePatch(result, patch));

  const handleSetMetric = (m: Metric) => {
    setPatch({ entryMetric: m });
    onPreferredMetricChange?.(m);
  };

  const handleItemChange = (itemId: string, text: string) => {
    if (readOnly) return;
    const n = parseNum(text);
    const newVals = { ...localItemValues, [itemId]: n ?? undefined };
    setLocalItemValues(newVals);
    const agg = computeAggregate(items, newVals, aggregation);
    const decimals = subtest.rawDisplayDecimals ?? 0;
    const rawStr = agg !== null
      ? (decimals > 0 ? agg.toFixed(decimals) : String(Math.round(agg)))
      : result.raw || '';
    setPatch({ rawItems: newVals, raw: rawStr, scoreSource: 'manual_raw' });
  };

  const handleDirectRaw = (text: string) => {
    if (readOnly) return;
    setPatch({ entryMetric: 'raw', raw: text, scoreSource: 'manual_raw' });
  };

  const handleInput = (text: string) => {
    if (readOnly) return;
    const n = parseNum(text);
    if (activeMetric === 'raw') {
      setPatch({ entryMetric: 'raw', raw: text, scoreSource: 'manual_raw' });
    } else if (activeMetric === 'standard') {
      setPatch({ entryMetric: 'standard', standard: text, scoreSource: 'manual_ns' });
    } else if (activeMetric === 'z') {
      setPatch({ entryMetric: 'z', zScore: n ?? undefined, scoreSource: 'manual_et' });
    } else if (activeMetric === 'percentile') {
      setPatch({ entryMetric: 'percentile', percentile: text, scoreSource: 'manual_pct' });
    }
  };

  const handleBlur = () => {
    if (hasValue(result) && !reviewed(result)) {
      setPatch({ reviewState: 'reviewed', reviewedAt: new Date().toISOString(), status: 'validated' });
      setTimeout(() => onAdvance?.(), 200);
    }
  };

  const getStandardizedValue = (): string => {
    if (activeMetric === 'standard') return result.standard || '';
    if (activeMetric === 'z') {
      const z = result.zScore;
      return typeof z === 'number' && Number.isFinite(z) ? String(z) : '';
    }
    if (activeMetric === 'percentile') return result.percentile || '';
    return '';
  };

  // Compute aggregated raw for display
  const agg = hasItems && !directMode && !isCustomAgg
    ? computeAggregate(items, localItemValues, aggregation)
    : null;
  const decimals = subtest.rawDisplayDecimals ?? 0;
  const aggDisplay = agg !== null
    ? (decimals > 0 ? agg.toFixed(decimals) : String(Math.round(agg)))
    : null;
  const displayedRaw = aggDisplay ?? (result.raw || null);
  const filledCount = items.filter((it) => !it.isMaster && localItemValues[it.id] !== undefined).length;

  const displayGroup = cfg.displayGroup ?? 'column';
  const gridClass =
    displayGroup === 'grid_2' ? 'grid grid-cols-2 gap-2' :
    displayGroup === 'grid_3' ? 'grid grid-cols-3 gap-2' :
    displayGroup === 'table' ? 'divide-y divide-[var(--border-color)]' :
    'space-y-2';

  const stdMetrics: Metric[] = conversionLocked ? [] : ['standard', 'z', 'percentile'];
  const metricLabel = (m: Metric): string => {
    if (m === 'standard') return getScaleLabel(scoreType) || 'NS';
    return METRIC_LABEL[m] || m.toUpperCase();
  };

  const hasZ = typeof result.zScore === 'number' && Number.isFinite(result.zScore);
  const otherValues: string[] = [];
  if (!conversionLocked) {
    if (activeMetric !== 'standard' && result.standard) otherValues.push(\`NS\\u00a0\${result.standard}\`);
    if (activeMetric !== 'z' && hasZ) otherValues.push(\`ET\\u00a0\${result.zScore! > 0 ? '+' : ''}\${result.zScore!.toFixed(2)}\`);
    if (activeMetric !== 'percentile' && result.percentile) otherValues.push(\`\${result.percentile}\\u202f%\`);
  }

  const rawValueLabel = cfg.rawValueLabel || 'Brut';
  const showFraction = cfg.showRawFraction && cfg.maxRawScore != null;

  return (
    <div className="bg-[var(--card-bg)]">
      <div className="p-4 md:p-5">
        <RowHeader
          subtest={subtest}
          onToggleExpand={onToggleExpand}
          badge={hasItems ? (
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-500 dark:bg-violet-900/30 dark:text-violet-300">
              <Layers size={9} className="inline mr-0.5" />Items
            </span>
          ) : undefined}
        />

        {/* ── Items section (computed_items only) ── */}
        {hasItems && !directMode && (
          <div className="mb-4 rounded-xl border border-[var(--border-color)] overflow-hidden">
            <button
              type="button"
              onClick={() => setItemsExpanded((e) => !e)}
              className="w-full flex items-center justify-between px-3 py-2 bg-[var(--hover-bg)] text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:bg-[var(--border-color)] transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Layers size={11} />
                Items
                <span className="rounded-full bg-[var(--border-color)] px-1.5 py-0.5 text-[9px] font-medium">
                  {filledCount}/{items.filter((it) => !it.isMaster).length}
                </span>
              </span>
              {itemsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            {itemsExpanded && (
              <div className={\`p-3 \${gridClass}\`}>
                {items.map((item) => {
                  const val = localItemValues[item.id];
                  const strVal = val !== undefined ? String(val) : '';
                  if (item.type === 'boolean') {
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="text-xs text-[var(--text-main)] font-medium">{item.label}</span>
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => handleItemChange(item.id, String(val === 1 ? 0 : 1))}
                          className={\`px-3 py-1 rounded-lg text-xs font-bold border transition-colors \${val === 1 ? 'bg-emerald-500 text-white border-emerald-500' : 'border-[var(--border-color)] text-[var(--text-secondary)]'}\`}
                        >
                          {val === 1 ? 'Oui' : 'Non'}
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div key={item.id} className={\`flex items-center gap-2 \${item.wide ? 'col-span-full' : ''}\`}>
                      <label className="text-xs text-[var(--text-main)] font-medium flex-1 min-w-0 truncate">{item.label}</label>
                      <div className="flex items-center gap-1 shrink-0">
                        <input
                          type="number"
                          value={strVal}
                          min={item.min}
                          max={item.max}
                          step={item.decimals !== undefined ? Math.pow(10, -item.decimals) : 1}
                          disabled={readOnly || item.isMaster}
                          onFocus={() => onFocus?.()}
                          onChange={(e) => handleItemChange(item.id, e.target.value)}
                          placeholder="—"
                          className="w-20 text-center text-sm font-bold bg-[var(--input-bg)] border border-[var(--border-color)] rounded-lg px-2 py-1.5 outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary-opacity-20)] text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          aria-label={item.label}
                        />
                        {item.unit && <span className="text-[10px] text-[var(--text-secondary)] font-medium w-8">{item.unit}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Brut ── */}
        <div className="mb-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
              {hasItems && !directMode && !isCustomAgg ? 'Brut calculé' : rawValueLabel}
              {cfg.aggregationHint && hasItems && !directMode && (
                <span className="ml-1.5 text-[9px] font-normal text-[var(--text-disabled)] normal-case">({cfg.aggregationHint})</span>
              )}
            </span>
            {hasItems && !isCustomAgg && (
              <button
                type="button"
                onClick={() => { setDirectMode((d) => !d); if (!directMode) { setLocalItemValues({}); setPatch({ rawItems: {} }); } }}
                className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors"
              >
                {directMode ? '← Saisir par items' : 'Saisie directe →'}
              </button>
            )}
          </div>
          {hasItems && !directMode && !isCustomAgg ? (
            <div className={\`inline-flex items-center gap-2 rounded-xl px-4 py-2 \${displayedRaw !== null ? 'bg-[var(--secondary-opacity-10)] border border-[var(--secondary)]/15' : 'border border-dashed border-[var(--border-color)]'}\`}>
              <span className={\`text-3xl font-bold tabular-nums \${displayedRaw !== null ? 'text-[var(--text-heading)]' : 'text-[var(--text-disabled)]'}\`}>
                {showFraction && displayedRaw !== null ? \`\${displayedRaw} / \${cfg.maxRawScore}\` : (displayedRaw ?? '—')}
              </span>
              {subtest.unit && displayedRaw !== null && !showFraction && (
                <span className="text-xs text-[var(--text-secondary)] font-medium">{subtest.unit}</span>
              )}
            </div>
          ) : (
            <input
              value={result.raw || ''}
              disabled={readOnly}
              inputMode="decimal"
              onFocus={() => onFocus?.()}
              onBlur={handleBlur}
              onChange={(e) => handleDirectRaw(e.target.value)}
              placeholder="—"
              className="w-32 text-center text-3xl font-bold bg-transparent border-b-2 border-[var(--primary)] outline-none py-2 text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] transition-colors"
            />
          )}
        </div>

        {/* ── Standardized scores ── */}
        {!conversionLocked && stdMetrics.length > 0 && (
          <div className="mb-3">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {stdMetrics.map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={readOnly}
                  onClick={() => handleSetMetric(m)}
                  className={\`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-colors \${
                    activeMetric === m
                      ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                      : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary)]'
                  } \${readOnly ? 'cursor-not-allowed opacity-60' : ''}\`}
                >
                  {metricLabel(m)}
                </button>
              ))}
            </div>
            <input
              value={getStandardizedValue()}
              disabled={readOnly}
              inputMode="decimal"
              onFocus={() => onFocus?.()}
              onBlur={handleBlur}
              onChange={(e) => handleInput(e.target.value)}
              placeholder="—"
              className={\`w-32 text-center text-2xl font-bold bg-transparent border-b-2 border-[var(--primary)] outline-none py-1.5 text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] transition-colors \${readOnly ? 'cursor-not-allowed opacity-70' : ''}\`}
              aria-label={\`\${metricLabel(activeMetric)} pour \${getSubtestDisplayName(subtest)}\`}
            />
            {otherValues.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-[var(--text-secondary)] font-medium">
                {otherValues.map((p) => <span key={p}>{p}</span>)}
              </div>
            )}
          </div>
        )}

        <VoiceObservation value={result.observation || ''} onChange={(v) => setPatch({ observation: v })} readOnly={readOnly} onFocus={onFocus} />
        <div className="mt-3"><ReviewButton result={result} onChange={onChange} /></div>
      </div>
    </div>
  );
};

// ─── CustomTextRow: free text / observation entry ───
const CustomTextRow: React.FC<{
  subtest: SubtestDef;
  result: ScoreResult;
  onChange: (patch: Partial<ScoreResult>) => void;
  readOnly?: boolean;
  onFocus?: () => void;
  onToggleExpand?: () => void;
  onAdvance?: () => void;
}> = ({ subtest, result, onChange, readOnly, onFocus, onToggleExpand, onAdvance }) => {
  const setPatch = (patch: Partial<ScoreResult>) => onChange(mergePatch(result, patch));
  return (
    <div className="bg-[var(--card-bg)] p-4 md:p-5">
      <RowHeader subtest={subtest} onToggleExpand={onToggleExpand} />
      <div className="mb-3">
        <input
          type="text"
          value={result.customLabel || ''}
          disabled={readOnly}
          onFocus={onFocus}
          onChange={(e) => setPatch({ customLabel: e.target.value })}
          placeholder="Intitulé personnalisé..."
          className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--input-bg)] px-4 py-2.5 text-sm font-medium text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-opacity-10)] transition-colors"
        />
      </div>
      <VoiceObservation
        value={result.observation || ''}
        onChange={(v) => { setPatch({ observation: v }); }}
        readOnly={readOnly}
        onFocus={onFocus}
      />
      <div className="mt-3">
        <ReviewButton
          result={result}
          onChange={(patch) => {
            onChange(patch);
            if (patch.reviewState === 'reviewed') setTimeout(() => onAdvance?.(), 200);
          }}
        />
      </div>
    </div>
  );
};

// ─── QualitativeRow: qualitative category selection ───
const QualitativeRow: React.FC<{
  subtest: SubtestDef;
  result: ScoreResult;
  onChange: (patch: Partial<ScoreResult>) => void;
  readOnly?: boolean;
  onFocus?: () => void;
  onToggleExpand?: () => void;
  onAdvance?: () => void;
}> = ({ subtest, result, onChange, readOnly, onFocus, onToggleExpand, onAdvance }) => {
  const setPatch = (patch: Partial<ScoreResult>) => onChange(mergePatch(result, patch));
  const options = [...(subtest.inputConfig?.options || [])].sort((a, b) => a.order - b.order);
  const layout = subtest.inputConfig?.qualitativeLayout || 'toggle';
  const selected = result.qualitativeCode || result.raw || '';

  const selectOption = (code: string) => {
    if (readOnly) return;
    const opt = options.find((o) => o.code === code);
    onChange(mergePatch(result, {
      raw: code, qualitativeCode: code,
      qualitativeLabel: opt?.label || '', standard: '', percentile: '',
      zScore: undefined, scoreSource: 'manual_ns',
    }));
    setTimeout(() => onAdvance?.(), 250);
  };

  return (
    <div className="bg-[var(--card-bg)] p-4 md:p-5">
      <RowHeader subtest={subtest} onToggleExpand={onToggleExpand} />
      {layout === 'toggle' ? (
        <div className="flex flex-wrap gap-2 mb-3">
          {options.map((opt) => (
            <button
              key={opt.code}
              type="button"
              disabled={readOnly}
              onFocus={onFocus}
              onClick={() => selectOption(opt.code)}
              className={\`px-3 py-2 rounded-xl border text-xs font-bold transition-all \${selected === opt.code ? 'bg-[var(--primary)] text-white border-[var(--primary)] shadow-sm' : 'border-[var(--border-color)] text-[var(--text-main)] hover:border-[var(--primary)]'}\`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : (
        <select
          value={selected}
          disabled={readOnly}
          onFocus={onFocus}
          onChange={(e) => selectOption(e.target.value)}
          className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--input-bg)] px-4 py-2.5 text-sm text-[var(--text-heading)] outline-none focus:border-[var(--primary)] mb-3"
        >
          <option value="">— Sélectionner —</option>
          {options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      )}
      <VoiceObservation value={result.observation || ''} onChange={(v) => setPatch({ observation: v })} readOnly={readOnly} onFocus={onFocus} />
      <div className="mt-3"><ReviewButton result={result} onChange={onChange} /></div>
    </div>
  );
};

// ─── RawOnlyRow: single raw score, no conversion ───
const RawOnlyRow: React.FC<{
  subtest: SubtestDef;
  result: ScoreResult;
  onChange: (patch: Partial<ScoreResult>) => void;
  readOnly?: boolean;
  onFocus?: () => void;
  onToggleExpand?: () => void;
  onAdvance?: () => void;
}> = ({ subtest, result, onChange, readOnly, onFocus, onToggleExpand, onAdvance }) => {
  const setPatch = (patch: Partial<ScoreResult>) => onChange(mergePatch(result, patch));
  const cfg = subtest.inputConfig || {};
  const rawLabel = cfg.rawValueLabel || 'Brut';
  const showFraction = cfg.showRawFraction && cfg.maxRawScore != null;

  const handleBlur = () => {
    if (hasValue(result) && !reviewed(result)) {
      setPatch({ reviewState: 'reviewed', reviewedAt: new Date().toISOString(), status: 'validated' });
      setTimeout(() => onAdvance?.(), 200);
    }
  };

  return (
    <div className="bg-[var(--card-bg)] p-4 md:p-5">
      <RowHeader subtest={subtest} onToggleExpand={onToggleExpand} />
      <div className="mb-4">
        <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">{rawLabel}</span>
        <div className="flex items-baseline gap-2">
          <input
            value={result.raw || ''}
            disabled={readOnly}
            inputMode="decimal"
            onFocus={onFocus}
            onBlur={handleBlur}
            onChange={(e) => setPatch({ raw: e.target.value, entryMetric: 'raw', scoreSource: 'manual_raw' })}
            placeholder="—"
            className="w-32 text-center text-3xl font-bold bg-transparent border-b-2 border-[var(--primary)] outline-none py-2 text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] transition-colors"
          />
          {showFraction && <span className="text-xl font-semibold text-[var(--text-secondary)]">/ {cfg.maxRawScore}</span>}
          {subtest.unit && !showFraction && <span className="text-sm text-[var(--text-secondary)] font-medium">{subtest.unit}</span>}
        </div>
      </div>
      <VoiceObservation value={result.observation || ''} onChange={(v) => setPatch({ observation: v })} readOnly={readOnly} onFocus={onFocus} />
      <div className="mt-3"><ReviewButton result={result} onChange={onChange} /></div>
    </div>
  );
};

// CompositeItemsRow = NumericRow (handles computed_items via hasItems check)
const CompositeItemsRow = NumericRow;

const FlexibleSubtestRow = React.memo((props: {
  subtest: SubtestDef;
  result: ScoreResult;
  onChange: (patch: Partial<ScoreResult>) => void;
  readOnly?: boolean;
  onFocus?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  preferredMetric?: Metric;
  onPreferredMetricChange?: (m: Metric) => void;
  onAdvance?: () => void;
}) => {
  const { subtest, result, onChange, readOnly, onFocus, onToggleExpand, preferredMetric, onPreferredMetricChange, onAdvance } = props;
  const model = subtest.inputModel || 'numeric_4mode';
  if (model === 'custom_text') return <CustomTextRow subtest={subtest} result={result} onChange={onChange} readOnly={readOnly} onFocus={onFocus} onToggleExpand={onToggleExpand} onAdvance={onAdvance} />;
  if (model === 'qualitative_category') return <QualitativeRow subtest={subtest} result={result} onChange={onChange} readOnly={readOnly} onFocus={onFocus} onToggleExpand={onToggleExpand} onAdvance={onAdvance} />;
  if (model === 'raw_only') return <RawOnlyRow subtest={subtest} result={result} onChange={onChange} readOnly={readOnly} onFocus={onFocus} onToggleExpand={onToggleExpand} onAdvance={onAdvance} />;
  return (
    <NumericRow
      subtest={subtest}
      result={result}
      onChange={onChange}
      readOnly={readOnly}
      onFocus={onFocus}
      onToggleExpand={onToggleExpand}
      preferredMetric={preferredMetric}
      onPreferredMetricChange={onPreferredMetricChange}
      onAdvance={onAdvance}
    />
  );
});
`;

  c = c.substring(0, start) + replacement + c.substring(compactStart);
});

// ─── 2. Update CompactSubtestRow to add inline editing ───
apply('add inline editing to CompactSubtestRow', () => {
  const oldProps = `const CompactSubtestRow: React.FC<{
  subtest: SubtestDef;
  result: ScoreResult;
  onClick: () => void;
  onDelete?: () => void;
}> = ({ subtest, result, onClick, onDelete }) => {`;
  const newProps = `const CompactSubtestRow: React.FC<{
  subtest: SubtestDef;
  result: ScoreResult;
  onClick: () => void;
  onDelete?: () => void;
  onInlineChange?: (patch: Partial<ScoreResult>) => void;
}> = ({ subtest, result, onClick, onDelete, onInlineChange }) => {`;
  if (!c.includes(oldProps)) { console.log('  WARN: CompactSubtestRow props not found'); return; }
  c = c.replace(oldProps, newProps);

  // Add inline input before the onDelete button
  const oldDelete = `      {onDelete && (
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
};`;
  const newDelete = `      {onInlineChange && subtest.inputModel !== 'custom_text' && subtest.inputModel !== 'qualitative_category' && (
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
            placeholder="—"
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
};`;
  if (!c.includes(oldDelete)) { console.log('  WARN: CompactSubtestRow delete button not found'); return; }
  c = c.replace(oldDelete, newDelete);
});

// ─── 3. Add clipboard paste to TableView ───
apply('add clipboard paste to TableView', () => {
  const oldTableViewFn = `  const cellInput = 'w-full text-center text-xs font-semibold bg-transparent outline-none py-1.5 border-b border-transparent focus:border-[var(--primary)] text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] transition-colors tabular-nums';
  const cellDisplay = 'text-center text-xs font-medium text-[var(--text-secondary)] py-1.5 tabular-nums';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--border-color)]">
            <th className="text-left py-2 px-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] w-[22%]">Épreuve</th>`;

  const newTableViewFn = `  const toast = useToast();

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
        if (raw && raw !== '-' && raw !== '—' && parseFloat(raw) === parseFloat(raw)) {
          updateSubtest(testId, st.id, mergePatch(current, { raw, entryMetric: 'raw', scoreSource: 'manual_raw' }));
          applied++;
        }
        if (ns && ns !== '-' && ns !== '—' && parseFloat(ns) === parseFloat(ns)) {
          updateSubtest(testId, st.id, mergePatch(current, { standard: ns, entryMetric: 'standard', scoreSource: 'manual_ns' }));
        }
      });
      toast.success(\`\${applied} valeur(s) collée(s)\`);
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
          title="Coller depuis tableur (une valeur brut par ligne)"
        >
          <FilePlus size={12} /> Coller
        </button>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--border-color)]">
            <th className="text-left py-2 px-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] w-[22%]">Épreuve</th>`;

  if (!c.includes(oldTableViewFn)) { console.log('  WARN: TableView cellInput block not found'); return; }
  c = c.replace(oldTableViewFn, newTableViewFn);
});

// ─── 4. Add QuickEntryOverlay before export const Step2Tests ───
apply('add QuickEntryOverlay component', () => {
  const marker = '\nexport const Step2Tests: React.FC<Props> = (';
  if (!c.includes(marker)) { console.log('  WARN: Step2Tests export not found'); return; }

  const overlay = `
// ─── Quick-entry fullscreen overlay ───
const QuickEntryOverlay: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  orderedSubKeys: string[];
  currentIndex: number;
  onIndexChange: (i: number) => void;
  tests: TestData;
  updateSubtest: (testId: string, subId: string, patch: Partial<ScoreResult>) => void;
  testDefMap: Record<string, { cat: { id: string; name: string; iconKey?: string } | undefined; def: TestDef }>;
  preferredMetricByTest: Record<string, Metric>;
  onPreferredMetricChange: (testId: string, m: Metric) => void;
}> = ({
  isOpen, onClose, orderedSubKeys, currentIndex, onIndexChange,
  tests, updateSubtest, testDefMap, preferredMetricByTest, onPreferredMetricChange,
}) => {
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [isOpen, currentIndex]);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if ((e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) && e.target === inputRef.current) {
        e.preventDefault();
        if (currentIndex < orderedSubKeys.length - 1) onIndexChange(currentIndex + 1);
        else onClose();
        return;
      }
      if (e.key === 'Tab' && e.shiftKey && e.target === inputRef.current) {
        e.preventDefault();
        if (currentIndex > 0) onIndexChange(currentIndex - 1);
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [isOpen, currentIndex, orderedSubKeys.length, onClose, onIndexChange]);

  if (!isOpen || orderedSubKeys.length === 0) return null;

  const key = orderedSubKeys[currentIndex] || '';
  const sep = key.indexOf('__');
  const testId = key.substring(0, sep);
  const subtestId = key.substring(sep + 2);
  const entry = testDefMap[testId];
  if (!entry) return null;
  const { def: test } = entry;
  const subtest = test.subtests.find((st) => st.id === subtestId);
  if (!subtest) return null;

  const result = tests[testId]?.[subtestId] || emptyScore();
  const scoreType = subtest.scoreType || 'standard';
  const conversionLocked = isManualOnlyScoreType(scoreType);
  const preferredMetric = preferredMetricByTest[testId] || 'raw';
  const activeMetric: Metric = (() => {
    if (result.entryMetric && result.entryMetric !== 'raw') return result.entryMetric as Metric;
    if (!hasValue(result)) return preferredMetric;
    return (result.entryMetric as Metric) || preferredMetric || 'raw';
  })();
  const stdMetrics: Metric[] = conversionLocked ? [] : ['standard', 'z', 'percentile'];
  const isRev = reviewed(result);

  const setMetric = (m: Metric) => {
    updateSubtest(testId, subtestId, mergePatch(result, { entryMetric: m }));
    onPreferredMetricChange(testId, m);
  };

  const getValue = (): string => {
    if (activeMetric === 'raw') return result.raw || '';
    if (activeMetric === 'standard') return result.standard || '';
    if (activeMetric === 'z') {
      const z = result.zScore;
      return typeof z === 'number' && Number.isFinite(z) ? String(z) : '';
    }
    return result.percentile || '';
  };

  const setValue = (text: string) => {
    const n = parseNum(text);
    let patch: Partial<ScoreResult>;
    if (activeMetric === 'raw') patch = { entryMetric: 'raw', raw: text, scoreSource: 'manual_raw' };
    else if (activeMetric === 'standard') patch = { entryMetric: 'standard', standard: text, scoreSource: 'manual_ns' };
    else if (activeMetric === 'z') patch = { entryMetric: 'z', zScore: n ?? undefined, scoreSource: 'manual_et' };
    else patch = { entryMetric: 'percentile', percentile: text, scoreSource: 'manual_pct' };
    updateSubtest(testId, subtestId, mergePatch(result, patch));
  };

  const advance = () => {
    if (hasValue(result) && !isRev) {
      updateSubtest(testId, subtestId, { ...result, reviewState: 'reviewed', reviewedAt: new Date().toISOString(), status: 'validated' });
    }
    if (currentIndex < orderedSubKeys.length - 1) onIndexChange(currentIndex + 1);
    else onClose();
  };

  const progress = Math.round(((currentIndex + 1) / orderedSubKeys.length) * 100);

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-[var(--secondary)]/90 backdrop-blur-lg"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg">
        {/* Progress bar + counter */}
        <div className="mb-3 flex items-center justify-between text-white/60 text-xs font-semibold">
          <span className="truncate max-w-[200px]">{test.name}</span>
          <span className="tabular-nums shrink-0">{currentIndex + 1} / {orderedSubKeys.length}</span>
        </div>
        <div className="mb-5 h-1.5 rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: \`\${progress}%\`, background: 'linear-gradient(90deg, var(--primary), var(--secondary))' }}
          />
        </div>

        {/* Card */}
        <div className="bg-[var(--card-bg)] rounded-[28px] p-7 shadow-2xl border border-[var(--border-color)]">
          <div className="flex items-start justify-between gap-3 mb-5">
            <h3 className="font-serif font-bold text-xl text-[var(--text-heading)] leading-snug">
              {getSubtestDisplayName(subtest)}
            </h3>
            {isRev && (
              <span className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">
                <CircleCheck size={11} /> Revu
              </span>
            )}
          </div>

          {/* Metric selector */}
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setMetric('raw')}
              className={\`px-3 py-1.5 rounded-full text-xs font-bold border transition-all \${activeMetric === 'raw' ? 'bg-[var(--primary)] text-white border-[var(--primary)] shadow-sm' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--primary)]'}\`}
            >BRUT</button>
            {stdMetrics.map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={\`px-3 py-1.5 rounded-full text-xs font-bold border transition-all \${activeMetric === m ? 'bg-[var(--primary)] text-white border-[var(--primary)] shadow-sm' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--primary)]'}\`}
              >{METRIC_LABEL[m]}</button>
            ))}
          </div>

          {/* Large input */}
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={getValue()}
            onChange={(e) => setValue(e.target.value)}
            className="w-full text-center text-5xl font-bold bg-transparent border-b-2 border-[var(--primary)] outline-none py-3 text-[var(--text-heading)] placeholder:text-[var(--text-disabled)]"
            placeholder="—"
          />
          {subtest.unit && (
            <p className="text-center text-xs text-[var(--text-secondary)] mt-1.5 font-medium">{subtest.unit}</p>
          )}

          {/* Observation */}
          <textarea
            value={result.observation || ''}
            onChange={(e) => updateSubtest(testId, subtestId, mergePatch(result, { observation: e.target.value }))}
            placeholder="Observation clinique (optionnel)..."
            className="mt-4 w-full p-3 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-xl text-xs text-[var(--text-main)] placeholder:text-[var(--text-disabled)] outline-none focus:border-[var(--primary)] resize-none"
            rows={2}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); advance(); } }}
          />
        </div>

        {/* Navigation */}
        <div className="mt-5 flex items-center justify-between">
          <button
            onClick={() => { if (currentIndex > 0) onIndexChange(currentIndex - 1); }}
            disabled={currentIndex === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white/60 hover:text-white disabled:opacity-25 transition-colors"
          >
            <ChevronLeft size={16} /> Précédent
          </button>
          <div className="text-white/30 text-[11px] hidden sm:block">
            Entrée ou Tab pour avancer · Échap pour fermer
          </div>
          <button
            onClick={advance}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-[var(--primary)] text-white hover:brightness-105 transition-all shadow-lg"
          >
            {currentIndex < orderedSubKeys.length - 1 ? (<>Suivant <ChevronRight size={16} /></>) : (<>Terminer <CheckCheck size={16} /></>)}
          </button>
        </div>
      </div>
    </div>
  );
};

`;

  c = c.replace(marker, overlay + marker);
});

// ─── 5. Update Step2Tests component: add new state + handlers + pass new props ───
apply('update Step2Tests state and handlers', () => {
  // Fix: remove onContribute from destructuring if still present
  c = c.replace(
    'export const Step2Tests: React.FC<Props> = ({ patient, tests, updateTests, observations, updateObservations, onNext, onBack, onContribute }) => {',
    'export const Step2Tests: React.FC<Props> = ({ patient, tests, updateTests, observations, updateObservations, onNext, onBack }) => {'
  );
  c = c.replace(
    'export const Step2Tests: React.FC<Props> = ({ patient, tests, updateTests, observations, updateObservations, onNext, onBack, userProfile }) => {',
    'export const Step2Tests: React.FC<Props> = ({ patient, tests, updateTests, observations, updateObservations, onNext, onBack }) => {'
  );
});

apply('add preferredMetricByTest + quickEntry state', () => {
  const oldState = `  const [expandedSubKey, setExpandedSubKey] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<Record<string, 'accordion' | 'table'>>({});
  const [testOrder, setTestOrder] = useState<string[]>(() => Object.keys(tests));
  const prevExpandedTestIdRef = useRef<string | null>(null);`;
  const newState = `  const [expandedSubKey, setExpandedSubKey] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<Record<string, 'accordion' | 'table'>>({});
  const [testOrder, setTestOrder] = useState<string[]>(() => Object.keys(tests));
  const [preferredMetricByTest, setPreferredMetricByTest] = useState<Record<string, Metric>>({});
  const [showQuickEntry, setShowQuickEntry] = useState(false);
  const [quickEntryIndex, setQuickEntryIndex] = useState(0);
  const prevExpandedTestIdRef = useRef<string | null>(null);`;
  if (!c.includes(oldState)) { console.log('  WARN: state block not found'); return; }
  c = c.replace(oldState, newState);
});

apply('add orderedSubKeys + handleAdvance memos', () => {
  const oldMemo = `  const testDefMap = useMemo(() => {
    type CatDef = (typeof catalog)[number];
    const map: Record<string, { cat: CatDef | undefined; def: TestDef }> = {};
    (Object.entries(grouped) as [string, TestDef[]][]).forEach(([catId, defs]) => {
      const cat = catalog.find((c) => c.id === catId);
      defs.forEach((def) => { map[def.id] = { cat, def }; });
    });
    return map;
  }, [grouped, catalog]);`;
  const newMemo = `  const testDefMap = useMemo(() => {
    type CatDef = (typeof catalog)[number];
    const map: Record<string, { cat: CatDef | undefined; def: TestDef }> = {};
    (Object.entries(grouped) as [string, TestDef[]][]).forEach(([catId, defs]) => {
      const cat = catalog.find((c) => c.id === catId);
      defs.forEach((def) => { map[def.id] = { cat, def }; });
    });
    return map;
  }, [grouped, catalog]);

  const orderedSubKeys = useMemo(() => {
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
  }, [expandedSubKey, orderedSubKeys]);`;
  if (!c.includes(oldMemo)) { console.log('  WARN: testDefMap memo not found'); return; }
  c = c.replace(oldMemo, newMemo);
});

// ─── 6. Add quick-entry button to header ───
apply('add quick-entry button to header', () => {
  const oldBtn = `          <button
            onClick={() => { setCatalogTargetTestId(null); setShowCatalog(true); }}
            className="flex items-center gap-2 bg-[var(--secondary)] text-white px-5 py-2.5 rounded-xl font-bold hover:brightness-90 transition-all text-sm"
          >
            <Plus size={16} />
            Ajouter
          </button>`;
  const newBtn = `          {orderedSubKeys.length > 0 && (
            <button
              type="button"
              onClick={() => { setQuickEntryIndex(0); setShowQuickEntry(true); }}
              className="flex items-center gap-2 border border-[var(--border-color)] text-[var(--text-secondary)] px-4 py-2.5 rounded-xl font-bold hover:border-[var(--primary)] hover:text-[var(--primary)] transition-all text-sm"
              title="Mode saisie rapide (clavier uniquement)"
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
  if (!c.includes(oldBtn)) { console.log('  WARN: Add button not found'); return; }
  c = c.replace(oldBtn, newBtn);
});

// ─── 7. Pass new props in accordion render ───
apply('pass onInlineChange + preferredMetric + onAdvance to accordion', () => {
  const oldCompact = `                      ) : (
                        <CompactSubtestRow
                          subtest={st}
                          result={res}
                          onClick={() => setExpandedSubKey(subKey)}
                          onDelete={editing ? () => removeSubtest(test.id, st.id) : undefined}
                        />`;
  const newCompact = `                      ) : (
                        <CompactSubtestRow
                          subtest={st}
                          result={res}
                          onClick={() => setExpandedSubKey(subKey)}
                          onDelete={editing ? () => removeSubtest(test.id, st.id) : undefined}
                          onInlineChange={(patch) => updateSubtest(test.id, st.id, patch)}
                        />`;
  if (!c.includes(oldCompact)) { console.log('  WARN: CompactSubtestRow usage not found'); return; }
  c = c.replace(oldCompact, newCompact);

  const oldFlexible = `                      <FlexibleSubtestRow
                          subtest={st}
                          result={res}
                          onChange={(patch) => updateSubtest(test.id, st.id, patch)}
                          isExpanded={isSubExpanded}
                          onToggleExpand={() => setExpandedSubKey((prev) => (prev === subKey ? null : subKey))}
                          onFocus={() => setExpandedSubKey(subKey)}
                        />`;
  const newFlexible = `                      <FlexibleSubtestRow
                          subtest={st}
                          result={res}
                          onChange={(patch) => updateSubtest(test.id, st.id, patch)}
                          isExpanded={isSubExpanded}
                          onToggleExpand={() => setExpandedSubKey((prev) => (prev === subKey ? null : subKey))}
                          onFocus={() => setExpandedSubKey(subKey)}
                          preferredMetric={preferredMetricByTest[test.id]}
                          onPreferredMetricChange={(m) => setPreferredMetricByTest((p) => ({ ...p, [test.id]: m }))}
                          onAdvance={handleAdvance}
                        />`;
  if (!c.includes(oldFlexible)) { console.log('  WARN: FlexibleSubtestRow usage not found'); return; }
  c = c.replace(oldFlexible, newFlexible);
});

// ─── 8. Add QuickEntryOverlay render after TestCatalogModal ───
apply('add QuickEntryOverlay render', () => {
  const oldCatalog = `      <TestCatalogModal isOpen={showCatalog} onClose={() => setShowCatalog(false)} existingTests={tests} onAddTests={addTests} initialExpandedTestId={catalogTargetTestId} />`;
  const newCatalog = `      <TestCatalogModal isOpen={showCatalog} onClose={() => setShowCatalog(false)} existingTests={tests} onAddTests={addTests} initialExpandedTestId={catalogTargetTestId} />

      <QuickEntryOverlay
        isOpen={showQuickEntry}
        onClose={() => setShowQuickEntry(false)}
        orderedSubKeys={orderedSubKeys}
        currentIndex={quickEntryIndex}
        onIndexChange={setQuickEntryIndex}
        tests={tests}
        updateSubtest={updateSubtest}
        testDefMap={testDefMap}
        preferredMetricByTest={preferredMetricByTest}
        onPreferredMetricChange={(testId, m) => setPreferredMetricByTest((p) => ({ ...p, [testId]: m }))}
      />`;
  if (!c.includes(oldCatalog)) { console.log('  WARN: TestCatalogModal render not found'); return; }
  c = c.replace(oldCatalog, newCatalog);
});

if (c !== orig) {
  fs.writeFileSync('components/assessment/Step2Tests.tsx', c, 'utf8');
  console.log(`\nDone. ${changes} sections changed.`);
} else {
  console.log('\nNo changes made.');
}
