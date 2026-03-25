/**
 * pdfStyles.ts — Shared style definitions for @react-pdf/renderer PDF export.
 * 
 * All dimensions are in points (1pt = 1/72 inch).
 * A4 = 595.28 x 841.89 pt. 15mm padding ≈ 42.52pt.
 */
import { StyleSheet, Font } from '@react-pdf/renderer';

// ─── FONT REGISTRATION ──────────────────────────────────────────────────
// Google Fonts TTF URLs (latin subset — @react-pdf requires TTF/OTF, NOT woff2/eot)
// Fetched via Google Fonts CSS2 API with Android user-agent to obtain genuine TrueType files.
// IMPORTANT: URLs from fonts.gstatic.com/s/ serve real .ttf; /l/font?kit= URLs serve EOT.

let fontsRegistered = false;

export async function ensurePdfFontsRegistered(): Promise<void> {
    if (fontsRegistered) return;

Font.register({
    family: 'Quicksand',
    fonts: [
        { src: 'https://fonts.gstatic.com/s/quicksand/v37/6xK-dSZaM9iE8KbpRA_LJ3z8mH9BOJvgkP8o18E.ttf', fontWeight: 400 },
        { src: 'https://fonts.gstatic.com/s/quicksand/v37/6xK-dSZaM9iE8KbpRA_LJ3z8mH9BOJvgkP8o18E.ttf', fontWeight: 400, fontStyle: 'italic' },
        { src: 'https://fonts.gstatic.com/s/quicksand/v37/6xK-dSZaM9iE8KbpRA_LJ3z8mH9BOJvgkCEv18E.ttf', fontWeight: 600 },
        { src: 'https://fonts.gstatic.com/s/quicksand/v37/6xK-dSZaM9iE8KbpRA_LJ3z8mH9BOJvgkCEv18E.ttf', fontWeight: 600, fontStyle: 'italic' },
        { src: 'https://fonts.gstatic.com/s/quicksand/v37/6xK-dSZaM9iE8KbpRA_LJ3z8mH9BOJvgkBgv18E.ttf', fontWeight: 700 },
        { src: 'https://fonts.gstatic.com/s/quicksand/v37/6xK-dSZaM9iE8KbpRA_LJ3z8mH9BOJvgkBgv18E.ttf', fontWeight: 700, fontStyle: 'italic' },
    ],
});

Font.register({
    family: 'Merriweather',
    fonts: [
        { src: 'https://fonts.gstatic.com/s/merriweather/v33/u-4D0qyriQwlOrhSvowK_l5UcA6zuSYEqOzpPe3HOZJ5eX1WtLaQwmYiScCmDxhtNOKl8yDr3icqEw.ttf', fontWeight: 400 },
        { src: 'https://fonts.gstatic.com/s/merriweather/v33/u-4B0qyriQwlOrhSvowK_l5-eTxCVx0ZbwLvKH2Gk9hLmp0v5yA-xXPqCzLvPee1XYk_XSf-FmTCUF3w.ttf', fontWeight: 400, fontStyle: 'italic' },
        { src: 'https://fonts.gstatic.com/s/merriweather/v33/u-4D0qyriQwlOrhSvowK_l5UcA6zuSYEqOzpPe3HOZJ5eX1WtLaQwmYiScCmDxhtNOKl8yDrOSAqEw.ttf', fontWeight: 700 },
        { src: 'https://fonts.gstatic.com/s/merriweather/v33/u-4B0qyriQwlOrhSvowK_l5-eTxCVx0ZbwLvKH2Gk9hLmp0v5yA-xXPqCzLvPee1XYk_XSf-FmQlV13w.ttf', fontWeight: 700, fontStyle: 'italic' },
    ],
});

Font.register({
    family: 'Roboto',
    fonts: [
        { src: 'https://fonts.gstatic.com/s/roboto/v50/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWubEbWmT.ttf', fontWeight: 400 },
        { src: 'https://fonts.gstatic.com/s/roboto/v50/KFOKCnqEu92Fr1Mu53ZEC9_Vu3r1gIhOszmOClHrs6ljXfMMLoHQiA8.ttf', fontWeight: 400, fontStyle: 'italic' },
        { src: 'https://fonts.gstatic.com/s/roboto/v50/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWuYjammT.ttf', fontWeight: 700 },
    ],
});

Font.register({
    family: 'Playfair Display',
    fonts: [
        { src: 'https://fonts.gstatic.com/s/playfairdisplay/v40/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKdFvUDQ.ttf', fontWeight: 400 },
        { src: 'https://fonts.gstatic.com/s/playfairdisplay/v40/nuFRD-vYSZviVYUb_rj3ij__anPXDTnCjmHKM4nYO7KN_qiTbtY.ttf', fontWeight: 400, fontStyle: 'italic' },
        { src: 'https://fonts.gstatic.com/s/playfairdisplay/v40/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKeiukDQ.ttf', fontWeight: 700 },
    ],
});

Font.register({
    family: 'Open Sans',
    fonts: [
        { src: 'https://fonts.gstatic.com/s/opensans/v44/memSYaGs126MiZpBA-UvWbX2vVnXBbObj2OVZyOOSr4dVJWUgsjZ0C4n.ttf', fontWeight: 400 },
        { src: 'https://fonts.gstatic.com/s/opensans/v44/memQYaGs126MiZpBA-UFUIcVXSCEkx2cmqvXlWq8tWZ0Pw86hd0Rk8ZkaVc.ttf', fontWeight: 400, fontStyle: 'italic' },
        { src: 'https://fonts.gstatic.com/s/opensans/v44/memSYaGs126MiZpBA-UvWbX2vVnXBbObj2OVZyOOSr4dVJWUgsg-1y4n.ttf', fontWeight: 700 },
    ],
});

Font.register({
    family: 'Lato',
    fonts: [
        { src: 'https://fonts.gstatic.com/s/lato/v25/S6uyw4BMUTPHvxk.ttf', fontWeight: 400 },
        { src: 'https://fonts.gstatic.com/s/lato/v25/S6u8w4BMUTPHjxswWw.ttf', fontWeight: 400, fontStyle: 'italic' },
        { src: 'https://fonts.gstatic.com/s/lato/v25/S6u9w4BMUTPHh6UVew8.ttf', fontWeight: 700 },
    ],
});

// Hyphenation callback - disable hyphenation
Font.registerHyphenationCallback((word) => [word]);

    fontsRegistered = true;
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────
export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;
export const PAGE_PADDING = 42.52; // ~15mm
export const FOOTER_HEIGHT = 50;

// Color palette (default)
export const DEFAULT_PRIMARY = '#3D405B';
export const DEFAULT_SECONDARY = '#E07A5F';
export const COLORS = {
    stone50: '#fafaf9',
    stone100: '#f5f5f4',
    stone200: '#e7e5e4',
    stone300: '#d6d3d1',
    stone400: '#a8a29e',
    stone500: '#78716c',
    stone600: '#57534e',
    stone700: '#44403c',
    stone800: '#292524',
    rose100: '#ffe4e6',
    amber100: '#fef3c7',
    emerald100: '#d1fae5',
    green: '#81B29A',
    orange: '#F2CC8F',
    red: '#E07A5F',
    white: '#ffffff',
    black: '#1C1C1E',
};

// ─── CORNER STYLE HELPER ────────────────────────────────────────────────
export const getCornerRadius = (style?: string): number => {
    switch (style) {
        case 'sharp': return 0;
        case 'extra-rounded': return 16;
        case 'rounded':
        default: return 12;
    }
};

// ─── LOGO SIZE HELPER ───────────────────────────────────────────────────
export const getLogoHeight = (size?: string): number => {
    switch (size) {
        case 'small': return 36;
        case 'large': return 96;
        case 'medium':
        default: return 60;
    }
};

// ─── BASE STYLES ─────────────────────────────────────────────────────────
export const baseStyles = StyleSheet.create({
    page: {
        width: A4_WIDTH,
        height: A4_HEIGHT,
        padding: PAGE_PADDING,
        paddingBottom: PAGE_PADDING + FOOTER_HEIGHT,
        fontFamily: 'Quicksand',
        fontSize: 10,
        color: COLORS.black,
        backgroundColor: COLORS.white,
    },
    // ── Typography ──
    heading1: {
        fontSize: 24,
        fontWeight: 700,
        textAlign: 'center',
        marginBottom: 32,
    },
    heading2: {
        fontSize: 14,
        fontWeight: 700,
        marginBottom: 6,
        marginTop: 10,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.8,
    },
    heading3: {
        fontSize: 12,
        fontWeight: 700,
        marginBottom: 4,
        marginTop: 8,
    },
    paragraph: {
        fontSize: 10,
        lineHeight: 1.6,
        marginBottom: 4,
        textAlign: 'justify' as const,
        color: COLORS.stone700,
    },
    bold: {
        fontWeight: 700,
    },
    italic: {
        fontStyle: 'italic' as const,
    },
    small: {
        fontSize: 8,
    },
    tiny: {
        fontSize: 7,
    },
    label: {
        fontSize: 8,
        fontWeight: 700,
        textTransform: 'uppercase' as const,
        letterSpacing: 1,
        color: COLORS.stone400,
    },
    // ── Layout ──
    row: {
        flexDirection: 'row' as const,
    },
    col: {
        flexDirection: 'column' as const,
    },
    center: {
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    },
    spaceBetween: {
        justifyContent: 'space-between' as const,
    },
    flexGrow: {
        flexGrow: 1,
    },
    // ── Spacing ──
    mb4: { marginBottom: 4 },
    mb8: { marginBottom: 8 },
    mb12: { marginBottom: 12 },
    mb16: { marginBottom: 16 },
    mb24: { marginBottom: 24 },
    mb32: { marginBottom: 32 },
    mt4: { marginTop: 4 },
    mt8: { marginTop: 8 },
    mt16: { marginTop: 16 },
    // ── Decorative ──
    divider: {
        borderBottomWidth: 1,
        borderBottomColor: COLORS.stone200,
        marginBottom: 12,
        marginTop: 12,
    },
    card: {
        border: `1pt solid ${COLORS.stone200}`,
        backgroundColor: COLORS.white,
        overflow: 'hidden' as const,
    },
    cardHeader: {
        backgroundColor: COLORS.stone100,
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.stone200,
    },
    cardBody: {
        padding: 16,
    },
    // ── Table ──
    tableRow: {
        flexDirection: 'row' as const,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.stone100,
        alignItems: 'flex-start' as const,
    },
    tableHeaderRow: {
        flexDirection: 'row' as const,
        borderBottomWidth: 1.5,
        borderBottomColor: COLORS.stone100,
        paddingBottom: 6,
        marginBottom: 4,
    },
    tableHeaderText: {
        fontSize: 8,
        fontWeight: 700,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.8,
        color: COLORS.stone400,
    },
    tableCell: {
        paddingVertical: 6,
        paddingHorizontal: 4,
    },
    // ── Footer ──
    footer: {
        position: 'absolute' as const,
        bottom: PAGE_PADDING - 10,
        left: PAGE_PADDING,
        right: PAGE_PADDING,
        borderTopWidth: 1,
        borderTopColor: COLORS.stone200,
        paddingTop: 8,
        flexDirection: 'row' as const,
        justifyContent: 'space-between' as const,
        alignItems: 'flex-end' as const,
    },
    footerText: {
        fontSize: 8,
        color: COLORS.stone400,
    },
});
