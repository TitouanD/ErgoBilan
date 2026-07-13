/**
 * PdfDocument.tsx — @react-pdf/renderer document for professional PDF export.
 *
 * This is a SEPARATE renderer from the interactive HTML ReportView.
 * It receives the same data (patient, sections, tests, branding) and produces
 * a native vector PDF with proper pagination, searchable text, and SVG charts.
 */
import React from 'react';
import {
    Document,
    Page,
    View,
    Text,
    Image,
    Svg,
    Polygon,
    Line as SvgLine,
    Circle,
    G,
    Text as SvgText,
    Rect,
    StyleSheet,
    Font,
} from '@react-pdf/renderer';
import type { Patient, ReportSection, TestData, BrandingConfig, ReportAttachment, ScoreResult } from '../../types';
import type { CategoryDef, TestDef } from '../../data/testCatalog';
import {
    baseStyles,
    COLORS,
    DEFAULT_PRIMARY,
    DEFAULT_SECONDARY,
    A4_WIDTH,
    PAGE_PADDING,
    FOOTER_HEIGHT,
    getCornerRadius,
    getLogoHeight,
} from '../../utils/pdfStyles';
import { sanitizeReportText } from '../../utils/textSanitizer';
import { htmlToPdfNodes } from '../../utils/pdfRenderer';

// ─── Props ───────────────────────────────────────────────────────────────
interface PdfDocumentProps {
    patient: Patient;
    sections: ReportSection[];
    tests: TestData;
    branding: BrandingConfig;
    catalog: CategoryDef[];
    scoreDisplayModes?: Record<string, 'Brut' | 'NS' | 'ET' | '%'>;
    chartType?: 'radar' | 'bar' | 'percentile';
    /** Pre-converted attachment URLs (blob: → base64 data URLs) */
    attachmentUrls?: Record<string, string>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Format an ISO date string (YYYY-MM-DD or similar) to French format DD/MM/YYYY */
const formatDobFr = (dob?: string): string | null => {
    if (!dob) return null;
    // Avoid UTC timezone offset by splitting ISO YYYY-MM-DD directly
    const isoMatch = dob.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
    const d = new Date(dob);
    if (isNaN(d.getTime())) return dob;
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/** Scale parameters — mirrors SCALE_PARAMS in ScorePage.tsx */
const PDF_SCALE_PARAMS: Record<string, { mean: number; sd: number } | null> = {
    scaled:     { mean: 10,  sd: 3  },
    standard:   { mean: 100, sd: 15 },
    't-score':  { mean: 50,  sd: 10 },
    sten:       { mean: 5.5, sd: 2  },
    stanine:    { mean: 5,   sd: 2  },
    percentile: null,
    none:       null,
};

/**
 * Recompute z-score from the stored standard score and the subtest's scoreType.
 * Falls back to result.zScore if recomputation is not possible.
 */
const getZ = (result: ScoreResult, scoreType?: string): number | null => {
    const st = scoreType || '';
    const params = PDF_SCALE_PARAMS[st];
    if (params && result.standard) {
        const n = parseFloat(String(result.standard).replace(',', '.'));
        if (Number.isFinite(n)) return parseFloat(((n - params.mean) / params.sd).toFixed(2));
    }
    return typeof result.zScore === 'number' && Number.isFinite(result.zScore) ? result.zScore : null;
};

const hasValidZ = (r?: ScoreResult): boolean =>
    typeof r?.zScore === 'number' && Number.isFinite(r.zScore);

const hasAnyScoreValue = (result?: ScoreResult): boolean => {
    if (!result) return false;
    return Boolean(
        (result.raw && String(result.raw).trim()) ||
        (result.standard && String(result.standard).trim()) ||
        (result.percentile && String(result.percentile).trim()) ||
        (typeof result.zScore === 'number' && Number.isFinite(result.zScore)) ||
        (result.qualitativeCode && String(result.qualitativeCode).trim()) ||
        (result.qualitativeLabel && String(result.qualitativeLabel).trim())
    );
};

/** Get branding-aware font family */
const getFontFamily = (branding?: BrandingConfig): string => {
    if (!branding?.isEnabled) return 'Quicksand';
    return branding.fontFamily || 'Quicksand';
};

/** Get primary/secondary colors with branding */
const getColors = (branding?: BrandingConfig) => {
    const isCustom = branding?.isEnabled;
    return {
        primary: isCustom ? branding.primaryColor || DEFAULT_PRIMARY : DEFAULT_PRIMARY,
        secondary: isCustom ? branding.secondaryColor || DEFAULT_SECONDARY : DEFAULT_SECONDARY,
    };
};

/** Parse **bold** in text, returning array of Text nodes */
const parseBold = (text: string, fontFamily: string): React.ReactNode[] => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return (
                <Text key={i} style={{ fontWeight: 700, fontFamily }}>
                    {part.slice(2, -2)}
                </Text>
            );
        }
        return <Text key={i}>{part}</Text>;
    });
};

// ─── SECTION TITLE ──────────────────────────────────────────────────────

const PdfSectionTitle: React.FC<{
    title: string;
    branding: BrandingConfig;
}> = ({ title, branding }) => {
    const { primary, secondary } = getColors(branding);
    const fontFamily = getFontFamily(branding);
    const isCustom = branding?.isEnabled;
    const titleStyle = isCustom ? branding.titleStyle : 'simple';
    const radius = getCornerRadius(branding?.cornerStyle);

    const titleTextStyle = {
        fontSize: 13,
        fontWeight: 700 as const,
        textTransform: 'uppercase' as const,
        letterSpacing: 1,
        fontFamily,
        color: primary,
    };

    if (titleStyle === 'underline') {
        return (
            <View style={{ marginBottom: 16, marginTop: 12, alignItems: 'flex-start' }}>
                <Text style={{ ...titleTextStyle, borderBottomWidth: 3, borderBottomColor: secondary, paddingBottom: 6 }}>
                    {title}
                </Text>
            </View>
        );
    }

    if (titleStyle === 'filled-shape') {
        return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16, marginTop: 12 }}>
                <View style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.white }} />
                </View>
                <Text style={{ ...titleTextStyle, color: secondary }}>{title}</Text>
            </View>
        );
    }

    if (titleStyle === 'filled') {
        return (
            <View style={{ marginBottom: 16, marginTop: 12, backgroundColor: primary, borderRadius: radius, paddingHorizontal: 12, paddingVertical: 7 }}>
                <Text style={{ ...titleTextStyle, color: COLORS.white, fontSize: 11 }}>{title}</Text>
            </View>
        );
    }

    if (titleStyle === 'icon-star' || titleStyle === 'icon-sparkle' || titleStyle === 'icon-house') {
        return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16, marginTop: 12 }}>
                <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: secondary + '20', alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: secondary }} />
                </View>
                <Text style={titleTextStyle}>{title}</Text>
            </View>
        );
    }

    // 'simple' (default)
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16, marginTop: 12 }}>
            <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: branding?.boxBgColor || primary + '15', alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 10, height: 2, backgroundColor: primary, borderRadius: 1 }} />
            </View>
            <View>
                <Text style={titleTextStyle}>{title}</Text>
                <View style={{ height: 2, backgroundColor: primary + '20', marginTop: 4 }} />
            </View>
        </View>
    );
};

// ─── HEADER ──────────────────────────────────────────────────────────────

const PdfHeader: React.FC<{
    patient: Patient;
    branding: BrandingConfig;
}> = ({ patient, branding }) => {
    const { primary, secondary } = getColors(branding);
    const fontFamily = getFontFamily(branding);
    const isCustom = branding?.isEnabled;
    const radius = getCornerRadius(branding?.cornerStyle);
    const template = isCustom ? branding.headerTemplate : 'classic';
    const boxBg = isCustom ? (branding.boxBgColor || primary + '15') : COLORS.stone50;

    const LogoBlock = () => {
        if (!branding?.logoUrl) return null;
        const h = getLogoHeight(branding.logoSize);
        return (
            <View style={{ marginBottom: 8 }}>
                <Image src={branding.logoUrl} style={{ height: h, objectFit: 'contain' as const }} />
            </View>
        );
    };

    const CabinetTitle = () => (
        <View style={{ marginBottom: 4 }}>
            {branding?.cabinetName ? (
                <Text style={{ fontSize: 16, fontWeight: 700, color: primary, fontFamily }}>
                    {branding.cabinetName}
                </Text>
            ) : null}
            {branding?.brandSubtitle ? (
                <Text style={{ fontSize: 10, color: secondary, fontWeight: 600, marginTop: 2, fontFamily }}>
                    {branding.brandSubtitle}
                </Text>
            ) : null}
        </View>
    );

    const PractitionerDetails = () => (
        <View style={{ marginTop: 6 }}>
            {branding?.practitionerName ? (
                <Text style={{ fontSize: 9, fontWeight: 700, color: COLORS.stone700, marginBottom: 2 }}>{branding.practitionerName}</Text>
            ) : null}
            {branding?.phone ? (
                <Text style={{ fontSize: 8, color: COLORS.stone500, marginBottom: 1 }}>{branding.phone}</Text>
            ) : null}
            {branding?.email ? (
                <Text style={{ fontSize: 8, color: COLORS.stone500, marginBottom: 1 }}>{branding.email}</Text>
            ) : null}
            {branding?.siret ? (
                <Text style={{ fontSize: 7, color: COLORS.stone400, marginBottom: 1 }}>SIRET : {branding.siret}</Text>
            ) : null}
            {branding?.address ? (
                <Text style={{ fontSize: 8, color: COLORS.stone500, marginBottom: 1 }}>{branding.address}</Text>
            ) : null}
        </View>
    );

    const PatientBlock = ({ align }: { align: 'left' | 'right' | 'center' }) => {
        const patientStyle = isCustom ? branding.patientBlockStyle : 'modern';
        const textAlign = align === 'right' ? ('right' as const) : align === 'center' ? ('center' as const) : ('left' as const);

        if (patientStyle === 'minimal') {
            return (
                <View style={{ alignItems: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start' }}>
                    <Text style={{ fontSize: 16, fontWeight: 700, color: COLORS.stone800, textAlign }}>{patient.firstName} {patient.lastName}</Text>
                    {patient.dob ? <Text style={{ fontSize: 9, color: COLORS.stone500, marginTop: 2, textAlign }}>Né(e) le {formatDobFr(patient.dob)}</Text> : null}
                    {patient.age ? <Text style={{ fontSize: 9, color: COLORS.stone500, marginTop: 1, textAlign }}>{patient.age}</Text> : null}
                    {patient.address ? <Text style={{ fontSize: 8, color: COLORS.stone400, marginTop: 2, textAlign }}>{patient.address}</Text> : null}
                </View>
            );
        }

        // 'modern' (default) — boxed
        return (
            <View style={{ padding: 10, backgroundColor: boxBg, border: `0.5pt solid ${COLORS.stone100}`, borderRadius: radius }}>
                <Text style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.stone400, marginBottom: 4, textAlign }}>Patient</Text>
                <Text style={{ fontSize: 13, fontWeight: 700, color: COLORS.stone800, textAlign }}>{patient.firstName} {patient.lastName}</Text>
                {patient.dob ? <Text style={{ fontSize: 9, color: COLORS.stone600, marginTop: 2, textAlign }}>Né(e) le {formatDobFr(patient.dob)}</Text> : null}
                {patient.age ? <Text style={{ fontSize: 9, color: COLORS.stone600, marginTop: 1, textAlign }}>{patient.age}</Text> : null}
            </View>
        );
    };

    // ── Template rendering
    if (template === 'corporate') {
        return (
            <View style={{ marginBottom: 32, borderBottomWidth: 1.5, borderBottomColor: COLORS.stone100, paddingBottom: 20 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ width: '33%', paddingTop: 4 }}>
                        <PatientBlock align="left" />
                    </View>
                    <View style={{ width: '50%', alignItems: 'flex-end' }}>
                        <LogoBlock />
                        <CabinetTitle />
                        <PractitionerDetails />
                    </View>
                </View>
            </View>
        );
    }

    if (template === 'centered') {
        return (
            <View style={{ alignItems: 'center', marginBottom: 32, borderBottomWidth: 1.5, borderBottomColor: COLORS.stone100, paddingBottom: 20 }}>
                <LogoBlock />
                <CabinetTitle />
                <PractitionerDetails />
                <View style={{ width: '66%', borderTopWidth: 1, borderTopColor: COLORS.stone100, paddingTop: 12, marginTop: 12 }}>
                    <PatientBlock align="center" />
                </View>
            </View>
        );
    }

    if (template === 'boxed') {
        return (
            <View style={{ marginBottom: 32, borderWidth: 0.5, borderColor: COLORS.stone200, borderRadius: radius, padding: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, borderBottomWidth: 0.5, borderBottomColor: COLORS.stone200, paddingBottom: 12 }}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                        <LogoBlock />
                        <CabinetTitle />
                    </View>
                    <View style={{ borderWidth: 0.5, borderColor: primary + '80', borderRadius: 4, padding: 8, width: '42%' }}>
                        <PractitionerDetails />
                    </View>
                </View>
                <View style={{ alignItems: 'center' }}>
                    <PatientBlock align="center" />
                </View>
            </View>
        );
    }

    // 'classic' (default)
    return (
        <View style={{ marginBottom: 32, borderBottomWidth: 1.5, borderBottomColor: COLORS.stone100, paddingBottom: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flexGrow: 1 }}>
                    <LogoBlock />
                    <CabinetTitle />
                    <PractitionerDetails />
                </View>
                <View style={{ width: '33%', paddingTop: 4 }}>
                    <PatientBlock align="right" />
                </View>
            </View>
        </View>
    );
};

// ─── TEXT SECTION ────────────────────────────────────────────────────────

const PdfTextSection: React.FC<{
    section: ReportSection;
    branding: BrandingConfig;
    attachmentUrls?: Record<string, string>;
}> = ({ section, branding, attachmentUrls }) => {
    const fontFamily = getFontFamily(branding);
    const { primary } = getColors(branding);
    const radius = getCornerRadius(branding?.cornerStyle);

    if (!section) return null;

    // HTML content (from TipTap rich-text editor)
    if (section.contentFormat === 'html') {
        return (
            <View style={{ marginBottom: 16 }} wrap={false}>
                <PdfSectionTitle title={section.title} branding={branding} />
                <View>{htmlToPdfNodes(section.content, branding, fontFamily)}</View>
            </View>
        );
    }

    // Parse content into paragraphs
    const lines = sanitizeReportText(section.content).split('\n').filter(l => l.trim() !== '');
    const attachments = section.attachments || [];

    // Build rendered elements, intercalating attachments at their positionIndex
    const elements: React.ReactNode[] = [];

    lines.forEach((line, idx) => {
        // Check for headings
        if (line.startsWith('## ')) {
            elements.push(
                <Text key={`h2-${idx}`} style={{
                    fontSize: 13, fontWeight: 700, color: primary,
                    marginTop: idx > 0 ? 12 : 0, marginBottom: 6,
                    paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: primary + '20',
                    fontFamily,
                }}>
                    {line.slice(3)}
                </Text>
            );
        } else if (line.startsWith('### ')) {
            elements.push(
                <Text key={`h3-${idx}`} style={{
                    fontSize: 11, fontWeight: 700, color: primary,
                    marginTop: idx > 0 ? 8 : 0, marginBottom: 4,
                    fontFamily,
                }}>
                    {line.slice(4)}
                </Text>
            );
        } else if (line.match(/^[-*]\s/)) {
            // Bullet point
            elements.push(
                <View key={`bullet-${idx}`} style={{ flexDirection: 'row', marginBottom: 3, paddingLeft: 8 }}>
                    <Text style={{ fontSize: 10, color: COLORS.stone400, marginRight: 6 }}>•</Text>
                    <Text style={{ fontSize: 10, lineHeight: 1.6, color: COLORS.stone700, flex: 1 }}>
                        {parseBold(line.replace(/^[-*]\s/, ''), fontFamily)}
                    </Text>
                </View>
            );
        } else {
            // Normal paragraph
            elements.push(
                <Text key={`p-${idx}`} style={baseStyles.paragraph}>
                    {parseBold(line, fontFamily)}
                </Text>
            );
        }

        // Insert attachments after this paragraph index
        attachments
            .filter(a => a.positionIndex === idx)
            .sort((a, b) => a.positionIndex - b.positionIndex)
            .forEach((att) => {
                const resolvedUrl = attachmentUrls?.[att.id] || att.url;
                // Skip blob: URLs that haven't been converted
                if (resolvedUrl.startsWith('blob:')) return;

                if (att.type === 'image-full') {
                    elements.push(
                        <View key={`att-${att.id}`} style={{ marginVertical: 8 }} wrap={false}>
                            <Image src={resolvedUrl} style={{ width: '100%', borderRadius: radius }} />
                            {att.caption ? (
                                <Text style={{ fontSize: 8, color: COLORS.stone500, fontStyle: 'italic', marginTop: 4, textAlign: 'center' }}>
                                    {att.caption}
                                </Text>
                            ) : null}
                        </View>
                    );
                } else if (att.type === 'image-text') {
                    elements.push(
                        <View key={`att-${att.id}`} style={{ flexDirection: 'row', gap: 12, marginVertical: 8 }} wrap={false}>
                            <Image src={resolvedUrl} style={{ width: '48%', borderRadius: radius }} />
                            <View style={{ width: '48%', justifyContent: 'center' }}>
                                <Text style={{ fontSize: 9, color: COLORS.stone700, fontStyle: 'italic', lineHeight: 1.5 }}>
                                    {att.caption || ''}
                                </Text>
                            </View>
                        </View>
                    );
                }
            });
    });

    return (
        <View style={{ marginBottom: 16 }} wrap={false}>
            <PdfSectionTitle title={section.title} branding={branding} />
            <View>{elements}</View>
        </View>
    );
};

// ─── RADAR CHART (SVG) ──────────────────────────────────────────────────

const PdfRadarChart: React.FC<{
    tests: TestData;
    catalog: CategoryDef[];
    branding: BrandingConfig;
}> = ({ tests, catalog, branding }) => {
    const { primary, secondary } = getColors(branding);

    // Compute data: average z-score per catalog category
    const stats: Record<string, { sum: number; count: number; name: string }> = {};
    catalog.forEach(cat => { stats[cat.id] = { sum: 0, count: 0, name: cat.name }; });

    Object.entries(tests).forEach(([testId, subtests]) => {
        const catDef = catalog.find(c => c.tests.some(t => t.id === testId));
        // For tests not in catalog, group them under an "Autres" pseudo-category
        const categoryId = catDef?.id || '__uncategorized__';
        if (!stats[categoryId]) {
            stats[categoryId] = { sum: 0, count: 0, name: catDef?.name || 'Autres' };
        }
        Object.entries(subtests).forEach(([subId, res]) => {
            const def = catalog.flatMap(c => c.tests).find(t => t.id === testId);
            const subDef = def?.subtests.find(s => s.id === subId);
            const zVal = getZ(res, subDef?.scoreType);
            if (zVal === null) return;
            let z = zVal;
            if (z < -3) z = -3;
            if (z > 3) z = 3;
            stats[categoryId].sum += z;
            stats[categoryId].count += 1;
        });
    });

    const data = Object.values(stats)
        .filter(s => s.count > 0)
        .map(s => ({
            label: s.name,
            value: parseFloat((s.sum / s.count).toFixed(2)),
        }));

    if (data.length < 3) return null;

    // Radar geometry
    const cx = 150, cy = 120, outerR = 85;
    const svgW = 300, svgH = 260;
    const minVal = -3, maxVal = 3;
    const range = maxVal - minVal; // 6
    const n = data.length;
    const angleStep = (2 * Math.PI) / n;

    const toXY = (value: number, index: number) => {
        const r = ((value - minVal) / range) * outerR;
        const angle = index * angleStep - Math.PI / 2;
        return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    };

    // Grid circles (3 levels)
    const gridLevels = [0.33, 0.66, 1.0];

    // Data polygon
    const polyPoints = data.map((d, i) => {
        const p = toXY(d.value, i);
        return `${p.x},${p.y}`;
    }).join(' ');

    // Axis lines & labels
    const axes = data.map((d, i) => {
        const end = toXY(maxVal, i);
        const labelPt = toXY(maxVal + 0.6, i);
        return { end, labelPt, label: d.label };
    });

    return (
        <View style={{ marginBottom: 20, backgroundColor: COLORS.stone50, borderRadius: 16, border: `0.5pt solid ${COLORS.stone200}`, padding: 12 }} wrap={false}>
            <Text style={{ fontSize: 8, fontWeight: 700, color: COLORS.stone400, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 }}>
                Profil Psychomoteur
            </Text>
            <View style={{ alignItems: 'center' }}>
                <Svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`}>
                    {/* Grid circles */}
                    {gridLevels.map((level, i) => (
                        <Circle
                            key={`grid-${i}`}
                            cx={cx}
                            cy={cy}
                            r={outerR * level}
                            fill="none"
                            stroke="#e5e7eb"
                            strokeWidth={0.5}
                        />
                    ))}

                    {/* Axis lines */}
                    {axes.map((axis, i) => (
                        <SvgLine
                            key={`axis-${i}`}
                            x1={cx}
                            y1={cy}
                            x2={axis.end.x}
                            y2={axis.end.y}
                            stroke="#e5e7eb"
                            strokeWidth={0.5}
                        />
                    ))}

                    {/* Data polygon fill */}
                    <Polygon
                        points={polyPoints}
                        fill={secondary}
                        fillOpacity={0.35}
                        stroke={secondary}
                        strokeWidth={2}
                    />

                    {/* Data points */}
                    {data.map((d, i) => {
                        const p = toXY(d.value, i);
                        return (
                            <Circle key={`pt-${i}`} cx={p.x} cy={p.y} r={3} fill={secondary} />
                        );
                    })}

                    {/* Axis labels */}
                    {axes.map((axis, i) => (
                        <SvgText
                            key={`label-${i}`}
                            x={axis.labelPt.x}
                            y={axis.labelPt.y}
                            textAnchor="middle"
                            style={{ fontSize: 7, fontWeight: 700, fill: DEFAULT_PRIMARY }}
                        >
                            {axis.label}
                        </SvgText>
                    ))}
                </Svg>
            </View>
            <Text style={{ fontSize: 7, color: COLORS.stone400, fontStyle: 'italic', textAlign: 'right', marginTop: 4 }}>
                0 = Moyenne  •  -2 = Seuil Pathologique
            </Text>
        </View>
    );
};

// ─── HORIZONTAL BAR CHART ───────────────────────────────────────────────

interface BarDataItem {
    label: string;
    z: number;
    color: string;
}

const PdfBarChart: React.FC<{
    tests: TestData;
    catalog: CategoryDef[];
    branding: BrandingConfig;
}> = ({ tests, catalog, branding }) => {
    const { primary } = getColors(branding);
    const isCustom = branding?.isEnabled;
    const radius = getCornerRadius(branding?.cornerStyle);

    // Collect all subtests with valid z-scores
    const items: BarDataItem[] = [];
    Object.entries(tests).forEach(([testId, subtests]) => {
        const def = catalog.flatMap(c => c.tests).find(t => t.id === testId);
        // Include tests not in catalog — use subId as label fallback
        Object.entries(subtests)
            .forEach(([subId, result]) => {
                const subDef = def?.subtests.find(s => s.id === subId);
                const z = getZ(result, subDef?.scoreType);
                if (z === null) return;
                let color = COLORS.green;
                if (z <= -2) color = COLORS.red;
                else if (z <= -1) color = COLORS.orange;
                items.push({ label: subDef?.displayName || subDef?.name || subId, z, color });
            });
    });

    if (items.length === 0) return null;

    // SVG dimensions
    const labelW = 130;
    const barAreaW = 250;
    const valueW = 40;
    const totalW = labelW + barAreaW + valueW;
    const rowH = 14;
    const totalH = items.length * rowH + 30; // + legend height

    const zToX = (z: number) => {
        const clamped = Math.max(-3.5, Math.min(3.5, z));
        return labelW + ((clamped + 3.5) / 7) * barAreaW;
    };

    // Zone boundaries
    const zoneRedEnd = labelW + (1.5 / 7) * barAreaW; // -2 ET
    const zoneOrangeEnd = labelW + (2.5 / 7) * barAreaW; // -1 ET
    const centerX = labelW + (3.5 / 7) * barAreaW; // 0

    return (
        <View style={{ marginBottom: 20, backgroundColor: COLORS.white, border: `0.5pt solid ${COLORS.stone200}`, borderRadius: radius, overflow: 'hidden' }} wrap={false}>
            <View style={{ backgroundColor: isCustom ? primary + '08' : COLORS.stone100, padding: 10, borderBottomWidth: 0.5, borderBottomColor: COLORS.stone200 }}>
                <Text style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: isCustom ? primary : COLORS.stone700 }}>
                    Profil des scores (Écarts-types)
                </Text>
            </View>
            <View style={{ padding: 10 }}>
                <Svg width={totalW} height={totalH} viewBox={`0 0 ${totalW} ${totalH}`}>
                    {/* Background zones */}
                    <Rect x={labelW} y={0} width={zoneRedEnd - labelW} height={items.length * rowH} fill={COLORS.rose100} />
                    <Rect x={zoneRedEnd} y={0} width={zoneOrangeEnd - zoneRedEnd} height={items.length * rowH} fill={COLORS.amber100} />
                    <Rect x={zoneOrangeEnd} y={0} width={labelW + barAreaW - zoneOrangeEnd} height={items.length * rowH} fill={COLORS.emerald100} />

                    {/* Center line */}
                    <SvgLine x1={centerX} y1={0} x2={centerX} y2={items.length * rowH} stroke={COLORS.stone300} strokeWidth={0.5} />

                    {/* Data rows */}
                    {items.map((item, i) => {
                        const y = i * rowH + rowH / 2;
                        const dotX = zToX(item.z);
                        return (
                            <G key={i}>
                                {/* Label */}
                                <SvgText x={labelW - 6} y={y + 3} textAnchor="end" style={{ fontSize: 7, fill: COLORS.stone600, fontWeight: 600 }}>
                                    {item.label}
                                </SvgText>
                                {/* Dot */}
                                <Circle cx={dotX} cy={y} r={4} fill={item.color} />
                                {/* Value */}
                                <SvgText x={labelW + barAreaW + 6} y={y + 3} style={{ fontSize: 7, fontWeight: 700, fill: item.color }}>
                                    {item.z > 0 ? '+' : ''}{item.z.toFixed(1)}
                                </SvgText>
                            </G>
                        );
                    })}

                    {/* Axis legend */}
                    {[-3.5, -2, -1, 0, 1, 2, 3.5].map((v, i) => (
                        <SvgText
                            key={`leg-${i}`}
                            x={zToX(v)}
                            y={items.length * rowH + 16}
                            textAnchor="middle"
                            style={{ fontSize: 6, fill: COLORS.stone400, fontWeight: v === 0 ? 700 : 400 }}
                        >
                            {v === 0 ? '0' : `${v > 0 ? '+' : ''}${v} ET`}
                        </SvgText>
                    ))}
                </Svg>
            </View>
        </View>
    );
};

// ─── READING GUIDE ──────────────────────────────────────────────────────

const PdfReadingGuide: React.FC<{ branding: BrandingConfig }> = ({ branding }) => {
    const radius = getCornerRadius(branding?.cornerStyle);
    const items = [
        { color: COLORS.green, label: 'Vert :', desc: 'Dans la moyenne (-1 à +1 ET).' },
        { color: COLORS.orange, label: 'Orange :', desc: 'Zone de fragilité (-1 à -2 ET).' },
        { color: COLORS.red, label: 'Rouge :', desc: 'Zone de difficulté (Inférieur à -2 ET).' },
    ];

    return (
        <View style={{ marginBottom: 20, padding: 10, backgroundColor: COLORS.stone50, border: `0.5pt solid ${COLORS.stone200}`, borderRadius: radius }}>
            <Text style={{ fontSize: 9, fontWeight: 700, marginBottom: 6 }}>Guide de lecture :</Text>
            {items.map((item, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 4, marginBottom: 2 }}>
                    <Text style={{ fontSize: 8, fontWeight: 700, color: item.color }}>{item.label}</Text>
                    <Text style={{ fontSize: 8, color: COLORS.stone600 }}>{item.desc}</Text>
                </View>
            ))}
        </View>
    );
};

// ─── PERCENTILE CHART ────────────────────────────────────────────────────

const PdfPercentileChart: React.FC<{
    tests: TestData;
    catalog: CategoryDef[];
    branding: BrandingConfig;
}> = ({ tests, catalog, branding }) => {
    const radius = getCornerRadius(branding?.cornerStyle);
    const { primary } = getColors(branding);
    const fontFamily = getFontFamily(branding);

    // Collect items with valid percentile
    const items: Array<{ label: string; pct: number; color: string }> = [];
    Object.entries(tests).forEach(([testId, subtests]) => {
        const def = catalog.flatMap(c => c.tests).find(t => t.id === testId);
        Object.entries(subtests)
            .filter(([, val]) => val.percentile !== undefined && val.percentile !== null && !isNaN(Number(val.percentile)))
            .forEach(([subId, result]) => {
                const subDef = def?.subtests.find(s => s.id === subId);
                const pct = Number(result.percentile);
                let color = COLORS.green;
                if (pct < 2) color = COLORS.red;
                else if (pct < 9) color = COLORS.orange;
                items.push({ label: subDef?.displayName || subDef?.name || subId, pct, color });
            });
    });

    if (items.length === 0) return null;

    const labelW = 130;
    const barAreaW = 250;
    const valueW = 40;
    const rowH = 14;
    const svgH = items.length * rowH + 22;
    const svgW = labelW + barAreaW + valueW;

    const pctToX = (pct: number) => labelW + (Math.max(0, Math.min(100, pct)) / 100) * barAreaW;

    // Zone boundaries
    const zone2X = pctToX(2);
    const zone9X = pctToX(9);
    const zone25X = pctToX(25);
    const center50X = pctToX(50);

    return (
        <View style={{ marginBottom: 20 }} wrap={false}>
            <View style={{ backgroundColor: COLORS.stone50, border: `0.5pt solid ${COLORS.stone200}`, borderRadius: radius, overflow: 'hidden' }}>
                <View style={{ padding: 8, borderBottomWidth: 0.5, borderBottomColor: COLORS.stone200 }}>
                    <Text style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: primary, fontFamily }}>
                        Profil des scores (Percentiles)
                    </Text>
                </View>
                <View style={{ padding: 8 }}>
                    <Svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`}>
                        {/* Background zones */}
                        <Rect x={labelW} y={0} width={zone2X - labelW} height={items.length * rowH} fill={COLORS.rose100} />
                        <Rect x={zone2X} y={0} width={zone9X - zone2X} height={items.length * rowH} fill={COLORS.amber100} />
                        <Rect x={zone9X} y={0} width={zone25X - zone9X} height={items.length * rowH} fill="#FEFCE8" />
                        <Rect x={zone25X} y={0} width={barAreaW - (zone25X - labelW)} height={items.length * rowH} fill={COLORS.emerald100} />
                        {/* Center line */}
                        <SvgLine x1={center50X} y1={0} x2={center50X} y2={items.length * rowH} stroke={COLORS.stone400} strokeWidth={0.5} strokeDasharray="2,2" />

                        {/* Items */}
                        {items.map((item, idx) => {
                            const y = idx * rowH + rowH / 2;
                            const dotX = pctToX(item.pct);
                            return (
                                <G key={idx}>
                                    <SvgText x={labelW - 6} y={y + 3} textAnchor="end" style={{ fontSize: 7, fill: COLORS.stone600, fontWeight: 600 }}>
                                        {item.label}
                                    </SvgText>
                                    <Circle cx={dotX} cy={y} r={4} fill={item.color} />
                                    <SvgText x={labelW + barAreaW + 6} y={y + 3} style={{ fontSize: 7, fontWeight: 700, fill: item.color }}>
                                        {item.pct}%ile
                                    </SvgText>
                                </G>
                            );
                        })}

                        {/* Axis legend */}
                        {[0, 2, 9, 25, 50, 75, 91, 98, 100].map((v, i) => (
                            <SvgText
                                key={`leg-${i}`}
                                x={pctToX(v)}
                                y={items.length * rowH + 14}
                                textAnchor="middle"
                                style={{ fontSize: 6, fill: COLORS.stone400, fontWeight: v === 50 ? 700 : 400 }}
                            >
                                {v === 50 ? '50e' : `${v}`}
                            </SvgText>
                        ))}
                    </Svg>
                </View>
            </View>
            {/* Reading guide */}
            <View style={{ marginTop: 8, padding: 8, backgroundColor: COLORS.stone50, border: `0.5pt solid ${COLORS.stone200}`, borderRadius: radius }}>
                <Text style={{ fontSize: 8, fontWeight: 700, marginBottom: 4 }}>Guide de lecture (Percentiles) :</Text>
                {[
                    { color: COLORS.green, label: 'Vert :', desc: 'Rang percentile ≥ 9 (zone normale).' },
                    { color: COLORS.orange, label: 'Orange :', desc: 'Rang percentile 2–9 (norme basse).' },
                    { color: COLORS.red, label: 'Rouge :', desc: 'Rang percentile < 2 (zone de difficulté).' },
                ].map((item, i) => (
                    <View key={i} style={{ flexDirection: 'row', gap: 4, marginBottom: 2 }}>
                        <Text style={{ fontSize: 8, fontWeight: 700, color: item.color }}>{item.label}</Text>
                        <Text style={{ fontSize: 8, color: COLORS.stone600 }}>{item.desc}</Text>
                    </View>
                ))}
            </View>
        </View>
    );
};

// ─── SCORE TABLE ─────────────────────────────────────────────────────────

const PdfScoreTable: React.FC<{
    testId: string;
    subtests: Record<string, ScoreResult>;
    catalog: CategoryDef[];
    branding: BrandingConfig;
    scoreMode: 'Brut' | 'NS' | 'ET' | '%';
}> = ({ testId, subtests, catalog, branding, scoreMode }) => {
    const { primary } = getColors(branding);
    const fontFamily = getFontFamily(branding);
    const isCustom = branding?.isEnabled;
    const radius = getCornerRadius(branding?.cornerStyle);

    const catalogDef = catalog.flatMap(c => c.tests).find(t => t.id === testId);
    // Fallback for private/custom tests not in catalog — still render their score data
    const def = catalogDef || {
        id: testId,
        name: testId === 'custom_observations' ? 'Observations personnalisées' : testId.startsWith('priv_') ? 'Test personnalisé' : testId,
        subtests: Object.keys(subtests).map(subId => ({ id: subId, name: (subtests[subId] as any)?.customLabel || subId, displayName: (subtests[subId] as any)?.customLabel || undefined, unit: 'pts', scoreType: 'standard' as const, lowerIsBetter: false, computationMode: 'LOOKUP' as const, inputModel: 'numeric_4mode' as const, inputConfig: undefined as any })),
    };

    const validSubtests = Object.entries(subtests).filter(([, val]) => hasAnyScoreValue(val as ScoreResult)) as [string, ScoreResult][];
    if (validSubtests.length === 0) return null;

    const enrichedSubtests = validSubtests.map(([subId, result]: [string, ScoreResult]) => {
        const subDef = def.subtests.find(s => s.id === subId);
        const isQualitative = subDef?.inputModel === 'qualitative_category' || !!result.qualitativeCode;
        const isScoreable = !isQualitative && (subDef?.scoreType || 'standard') !== 'none';
        const zComputed = isScoreable ? getZ(result, subDef?.scoreType) : null;
        return { subId, result, subDef, isQualitative, isScoreable, zComputed };
    });

    const quantitativeSubtests = enrichedSubtests.filter(s => !s.isQualitative);
    const qualitativeSubtests = enrichedSubtests.filter(s => s.isQualitative);
    const hasScoreableSubtests = quantitativeSubtests.some(s => s.isScoreable);
    const currentMode = hasScoreableSubtests ? scoreMode : 'Brut';

    const getDisplayScore = (result: ScoreResult, isScoreable: boolean, zComputed: number | null): string => {
        if (!isScoreable && currentMode !== 'Brut') return '-';

        if (currentMode === 'Brut') return result.raw || '-';
        if (currentMode === 'NS') return isScoreable ? (result.standard || '-') : '-';
        if (currentMode === 'ET') return (isScoreable && zComputed !== null) ? `${zComputed > 0 ? '+' : ''}${zComputed.toFixed(2)} ET` : '-';
        if (currentMode === '%') return (isScoreable && result.percentile !== undefined && result.percentile !== null) ? `${result.percentile}%` : '-';
        return '-';
    };

    const getScoreColor = (isScoreable: boolean, zComputed: number | null): string => {
        if (!isScoreable || currentMode === 'Brut') return COLORS.stone500;
        if (zComputed === null) return COLORS.stone500;
        if (zComputed <= -2) return COLORS.red;
        if (zComputed <= -1) return COLORS.orange;
        return COLORS.green;
    };

    // Custom observations: simple card layout (no score table)
    if (testId === 'custom_observations') {
        return (
            <View style={{ marginBottom: 16, backgroundColor: COLORS.white, border: `0.5pt solid ${COLORS.stone200}`, borderRadius: radius, overflow: 'hidden' }} wrap={false}>
                <View style={{ backgroundColor: primary + '08', padding: 10, borderBottomWidth: 0.5, borderBottomColor: COLORS.stone200 }}>
                    <Text style={{ fontSize: 12, fontWeight: 700, color: primary, fontFamily }}>{def.name}</Text>
                </View>
                <View style={{ padding: 12, gap: 10 }}>
                    {validSubtests.map(([subId, result]: [string, ScoreResult]) => (
                        <View key={subId} style={{ border: `0.5pt solid ${COLORS.stone100}`, borderRadius: 4, padding: 8 }}>
                            <Text style={{ fontSize: 9, fontWeight: 700, color: COLORS.stone700, marginBottom: 4 }}>{result.customLabel || 'Observation personnalisée'}</Text>
                            <Text style={{ fontSize: 8, color: COLORS.stone600 }}>{result.observation || '-'}</Text>
                        </View>
                    ))}
                </View>
            </View>
        );
    }

    return (
        <View style={{ marginBottom: 16, backgroundColor: COLORS.white, border: `0.5pt solid ${COLORS.stone200}`, borderRadius: radius, overflow: 'hidden' }} wrap={false}>
            {/* Test header */}
            <View style={{ backgroundColor: isCustom ? primary + '08' : COLORS.stone100, padding: 10, borderBottomWidth: 0.5, borderBottomColor: COLORS.stone200, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 12, fontWeight: 700, color: isCustom ? primary : COLORS.stone700, fontFamily }}>{def.name}</Text>
                    <Text style={{ fontSize: 7, fontWeight: 700, color: COLORS.stone400, textTransform: 'uppercase', letterSpacing: 0.8 }}>{validSubtests.length} épreuves</Text>
                </View>
                {hasScoreableSubtests && (
                    <Text style={{ fontSize: 7, fontWeight: 700, color: COLORS.stone400, textTransform: 'uppercase', letterSpacing: 0.8 }}>Score ({currentMode})</Text>
                )}
            </View>

            <View style={{ padding: 12 }}>
                {/* Quantitative subtests */}
                {quantitativeSubtests.length > 0 && (
                    <View style={{ marginBottom: qualitativeSubtests.length > 0 ? 12 : 0 }}>
                        <Text style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.stone400, marginBottom: 6 }}> </Text>

                        {/* Header */}
                        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.stone100, paddingBottom: 4, marginBottom: 2 }}>
                            <Text style={{ width: '35%', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.stone400 }}>Épreuves</Text>
                            <Text style={{ width: '15%', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.stone400, textAlign: 'center' }}>{hasScoreableSubtests ? `Score` : 'Résultat'}</Text>
                            <Text style={{ width: '50%', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.stone400, paddingLeft: 8 }}>Observations</Text>
                        </View>

                        {/* Rows */}
                        {quantitativeSubtests.map(({ subId, result, subDef, isScoreable, zComputed }) => (
                            <View key={subId} style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: COLORS.stone50, paddingVertical: 4, alignItems: 'flex-start' }}>
                                <Text style={{ width: '35%', fontSize: 9, fontWeight: 600, color: COLORS.stone700, paddingRight: 6 }}>• {subDef?.displayName || subDef?.name}</Text>
                                <Text style={{ width: '15%', fontSize: 9, textAlign: 'center', fontWeight: 700, color: getScoreColor(isScoreable, zComputed) }}>
                                    {getDisplayScore(result, isScoreable, zComputed)}
                                </Text>
                                <Text style={{ width: '50%', fontSize: 8, fontStyle: 'italic', color: COLORS.stone500, paddingLeft: 8 }}>
                                    {result.observation || '-'}
                                </Text>
                            </View>
                        ))}
                    </View>
                )}

                {/* Qualitative subtests */}
                {qualitativeSubtests.length > 0 && (
                    <View>
                        <Text style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.stone400, marginBottom: 6 }}>Qualitatif</Text>

                        {/* Header */}
                        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.stone100, paddingBottom: 4, marginBottom: 2 }}>
                            <Text style={{ width: '30%', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.stone400 }}>Épreuves</Text>
                            <Text style={{ width: '20%', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.stone400, textAlign: 'center' }}>Catégorie</Text>
                            <Text style={{ width: '25%', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.stone400, paddingLeft: 6 }}>Interprétation</Text>
                            <Text style={{ width: '25%', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.stone400, paddingLeft: 6 }}>Observations</Text>
                        </View>

                        {/* Rows */}
                        {qualitativeSubtests.map(({ subId, result, subDef }: { subId: string; result: ScoreResult; subDef: any }) => {
                            const selectedOption = subDef?.inputConfig?.options?.find(
                                (opt) =>
                                    opt.code === result.qualitativeCode ||
                                    opt.code === result.raw ||
                                    opt.label === result.qualitativeLabel,
                            );
                            const displayCategory = result.qualitativeLabel || selectedOption?.label || result.qualitativeCode || result.raw || '-';
                            const displayInterpretation = selectedOption?.reportText || '-';

                            return (
                                <View key={subId} style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: COLORS.stone50, paddingVertical: 4, alignItems: 'flex-start' }}>
                                    <Text style={{ width: '30%', fontSize: 9, fontWeight: 600, color: COLORS.stone700, paddingRight: 4 }}>• {subDef?.displayName || subDef?.name}</Text>
                                    <Text style={{ width: '20%', fontSize: 9, textAlign: 'center', fontWeight: 700, color: DEFAULT_PRIMARY }}>{displayCategory}</Text>
                                    <Text style={{ width: '25%', fontSize: 8, color: COLORS.stone600, paddingLeft: 6 }}>{displayInterpretation}</Text>
                                    <Text style={{ width: '25%', fontSize: 8, fontStyle: 'italic', color: COLORS.stone500, paddingLeft: 6 }}>{result.observation || '-'}</Text>
                                </View>
                            );
                        })}
                    </View>
                )}
            </View>
        </View>
    );
};

// ─── ANNEXES SECTION ─────────────────────────────────────────────────────

const PdfAnnexes: React.FC<{
    tests: TestData;
    catalog: CategoryDef[];
    branding: BrandingConfig;
    scoreDisplayModes?: Record<string, 'Brut' | 'NS' | 'ET' | '%'>;
    chartType?: 'radar' | 'bar' | 'percentile';
}> = ({ tests, catalog, branding, scoreDisplayModes, chartType = 'bar' }) => {
    const { primary } = getColors(branding);
    const fontFamily = getFontFamily(branding);

    return (
        <View>
            {/* Title */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
                <View style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: primary + '15', alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 8, height: 2, backgroundColor: primary, borderRadius: 1 }} />
                </View>
                <Text style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: primary, fontFamily }}>
                    Annexes : Résultats
                </Text>
            </View>

            {/* Chart: conditionally rendered by chartType and contentVisibility */}
            {branding.contentVisibility?.showScoreChart !== false && chartType === 'radar' && <PdfRadarChart tests={tests} catalog={catalog} branding={branding} />}
            {branding.contentVisibility?.showScoreChart !== false && chartType === 'bar' && <PdfBarChart tests={tests} catalog={catalog} branding={branding} />}
            {branding.contentVisibility?.showScoreChart !== false && chartType === 'bar' && branding.contentVisibility?.showScoreGuide !== false && <PdfReadingGuide branding={branding} />}
            {branding.contentVisibility?.showScoreChart !== false && chartType === 'percentile' && <PdfPercentileChart tests={tests} catalog={catalog} branding={branding} />}

            {/* Per-test score tables */}
            {branding.contentVisibility?.showScoreTables !== false && Object.entries(tests).map(([testId, subtests]) => {
                if (Object.keys(subtests).length === 0) return null;

                const catalogDef = catalog.flatMap(c => c.tests).find(t => t.id === testId);
                const hasScoreableSubtests = Object.entries(subtests).some(([subId, result]) => {
                    const subDef = catalogDef?.subtests.find(s => s.id === subId);
                    const isQualitative = subDef?.inputModel === 'qualitative_category' || !!result.qualitativeCode;
                    // If test not in catalog, assume scoreable unless qualitative
                    const isScr = !isQualitative && (subDef?.scoreType || 'standard') !== 'none';
                    return isScr;
                });

                const mode = scoreDisplayModes?.[testId] || (hasScoreableSubtests ? 'ET' : 'Brut');

                return (
                    <PdfScoreTable
                        key={testId}
                        testId={testId}
                        subtests={subtests}
                        catalog={catalog}
                        branding={branding}
                        scoreMode={mode}
                    />
                );
            })}
        </View>
    );
};

// ─── FOOTER (fixed on every page) ────────────────────────────────────────

const PdfFooter: React.FC<{
    branding: BrandingConfig;
    isLastPage?: boolean;
}> = ({ branding, isLastPage }) => (
    <View
        style={baseStyles.footer}
        fixed
    >
        <View>
            <Text style={baseStyles.footerText}>{branding?.footerText || 'Document confidentiel'}</Text>
            <Text style={[baseStyles.footerText, { marginTop: 2 }]}>Profession inscrite au code de la santé publique.</Text>
        </View>
        {branding?.showPageNumbers && (
            <Text
                style={[baseStyles.footerText, { fontFamily: 'Roboto' }]}
                render={({ pageNumber, totalPages }) => `Page ${pageNumber}/${totalPages}`}
            />
        )}
    </View>
);

// ─── MAIN DOCUMENT ───────────────────────────────────────────────────────

export const PdfDocument: React.FC<PdfDocumentProps> = ({
    patient,
    sections,
    tests,
    branding,
    catalog,
    scoreDisplayModes,
    chartType: chartTypeProp,
    attachmentUrls,
}) => {
    const chartType = chartTypeProp ?? branding.chartType ?? 'bar';
    const { primary, secondary } = getColors(branding);
    const fontFamily = getFontFamily(branding);
    const isCustom = branding?.isEnabled;
    const radius = getCornerRadius(branding?.cornerStyle);

    // Determine section order
    const defaultOrder = ['mandat_ref', 'mandat_eval', 'profil', 'diagnostic', 'objectifs', 'project', 'recommandations'];
    const orderedSectionIds = defaultOrder;

    const getSection = (id: string) => sections.find(s => s.id === id);

    const titleStyleProp = isCustom ? branding.titleStyle : 'simple';
    const documentTitleStyle: any = {
        fontSize: 24,
        fontWeight: 700,
        textAlign: 'center' as const,
        marginBottom: 32,
        fontFamily,
        color: primary,
    };

    if (titleStyleProp === 'underline') {
        documentTitleStyle.borderBottomWidth = 4;
        documentTitleStyle.borderBottomColor = secondary;
        documentTitleStyle.paddingBottom = 8;
    }

    return (
        <Document
            title={`Bilan_${patient.lastName}_${patient.firstName}`}
            author={branding?.practitionerName || 'Ergothérapeute'}
            subject="Rapport d'évaluation en ergothérapie"
        >
            <Page size="A4" style={[baseStyles.page, { fontFamily }]}>

                {/* Fixed footer on every page */}
                <PdfFooter branding={branding} />

                {/* Header */}
                <PdfHeader patient={patient} branding={branding} />

                {/* Date */}
                {branding.contentVisibility?.showAssessmentDate !== false && (
                <Text style={{ fontSize: 9, fontStyle: 'italic', color: COLORS.stone500, textAlign: 'right', marginBottom: 20 }}>
                    Fait le {new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}
                </Text>
                )}

                {/* Document title */}
                <Text style={documentTitleStyle}>
                    {branding?.documentTitle || "Rapport d'évaluation"}
                </Text>

                {/* Consent / Intro block */}
                {branding.contentVisibility?.showConsentBlock !== false && (
                <View style={{
                    marginBottom: 24,
                    borderLeftWidth: 3,
                    borderLeftColor: secondary,
                    paddingLeft: 10,
                    paddingVertical: 6,
                    backgroundColor: COLORS.stone50,
                    borderRadius: radius,
                }}>
                    <Text style={{ fontSize: 9, color: COLORS.stone600, lineHeight: 1.6, marginBottom: 4 }}>
                        <Text style={{ fontWeight: 700 }}>{patient.firstName}</Text>
                        {' '}et ses parents consentent à cette évaluation.
                    </Text>
                    <Text style={{ fontSize: 9, color: COLORS.stone600, lineHeight: 1.6 }}>
                        Ce bilan a pour objectif d'analyser les capacités fonctionnelles et de proposer des axes d'intervention adaptés.
                    </Text>
                </View>
                )}

                {/* Report sections */}
                {orderedSectionIds.map(sectionId => {
                    const section = getSection(sectionId);
                    if (!section) return null;
                    return (
                        <PdfTextSection
                            key={sectionId}
                            section={section}
                            branding={branding}
                            attachmentUrls={attachmentUrls}
                        />
                    );
                })}

                {/* Annexes */}
                <PdfAnnexes
                    tests={tests}
                    catalog={catalog}
                    branding={branding}
                    scoreDisplayModes={scoreDisplayModes}
                    chartType={chartType}
                />

            </Page>
        </Document>
    );
};

export default PdfDocument;
