/**
 * HTML to react-pdf/renderer converter.
 * Takes an HTML string (from TipTap) and converts it to react-pdf primitives.
 * Supports: p, strong, em, u, h2, h3, ul, ol, li, mark, span[style=color], br.
 */
import React from 'react';
import { Text, View } from '@react-pdf/renderer';
import type { BrandingConfig } from '../types';

const DEFAULT_PRIMARY = '#3D405B';
const STONE600 = '#57534E';
const STONE500 = '#78716C';

function getFontSize(branding?: BrandingConfig) {
    return 10; // base body font size for PDF
}

function getPrimary(branding?: BrandingConfig) {
    return branding?.isEnabled ? branding.primaryColor : DEFAULT_PRIMARY;
}

/** Extract inline color from style attribute */
function extractColor(styleAttr: string): string | undefined {
    const match = styleAttr.match(/color:\s*([^;]+)/);
    return match ? match[1].trim() : undefined;
}

/** Extract background-color from style for highlight */
function extractBgColor(styleAttr: string): string | undefined {
    const match = styleAttr.match(/background(?:-color)?:\s*([^;]+)/);
    return match ? match[1].trim() : undefined;
}

type PdfStyle = Record<string, unknown>;

/** Recursively render a DOM node into a react-pdf Text subtree (inline content) */
function renderInline(node: ChildNode, fontFamily: string): React.ReactNode[] {
    const results: React.ReactNode[] = [];

    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        if (text) results.push(text);
        return results;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return results;

    const el = node as Element;
    const tag = el.tagName?.toLowerCase();
    const styleAttr = el.getAttribute('style') || '';
    const color = extractColor(styleAttr);
    const bgColor = extractBgColor(styleAttr);

    const children = Array.from(el.childNodes).flatMap(c => renderInline(c, fontFamily));

    const style: PdfStyle = { fontFamily };
    if (color) style.color = color;

    switch (tag) {
        case 'strong':
        case 'b':
            results.push(<Text key={Math.random()} style={{ ...style, fontWeight: 700 }}>{children}</Text>);
            break;
        case 'em':
        case 'i':
            results.push(<Text key={Math.random()} style={{ ...style, fontStyle: 'italic' }}>{children}</Text>);
            break;
        case 'u':
            results.push(<Text key={Math.random()} style={{ ...style, textDecoration: 'underline' }}>{children}</Text>);
            break;
        case 'mark':
            results.push(
                <Text key={Math.random()} style={{ ...style, backgroundColor: bgColor || '#FEF08A' }}>{children}</Text>
            );
            break;
        case 'span':
            results.push(<Text key={Math.random()} style={style}>{children}</Text>);
            break;
        case 'br':
            results.push('\n');
            break;
        default:
            results.push(...children.map((c, i) => <React.Fragment key={i}>{c}</React.Fragment>));
    }

    return results;
}

/** Render a block-level element to a react-pdf View/Text */
function renderBlock(el: Element, branding: BrandingConfig | undefined, fontFamily: string, primary: string): React.ReactNode | null {
    const tag = el.tagName?.toLowerCase();
    const fs = getFontSize(branding);
    const radius = 4;

    switch (tag) {
        case 'h2':
            return (
                <Text key={Math.random()} style={{
                    fontSize: fs + 3, fontWeight: 700, color: primary,
                    marginTop: 10, marginBottom: 4,
                    paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: primary + '30',
                    fontFamily,
                }}>
                    {el.textContent}
                </Text>
            );

        case 'h3':
            return (
                <Text key={Math.random()} style={{
                    fontSize: fs + 1, fontWeight: 700, color: primary,
                    marginTop: 8, marginBottom: 3, fontFamily,
                }}>
                    {el.textContent}
                </Text>
            );

        case 'p': {
            const children = Array.from(el.childNodes).flatMap(c => renderInline(c, fontFamily));
            if (!children.length || el.textContent?.trim() === '') return null;
            return (
                <Text key={Math.random()} style={{ fontSize: fs, lineHeight: 1.6, color: STONE600, marginBottom: 4, fontFamily }}>
                    {children}
                </Text>
            );
        }

        case 'ul':
        case 'ol': {
            const items = Array.from(el.querySelectorAll('li'));
            return (
                <View key={Math.random()} style={{ marginBottom: 4 }}>
                    {items.map((li, i) => {
                        const children = Array.from(li.childNodes).flatMap(c => renderInline(c, fontFamily));
                        const marker = tag === 'ol' ? `${i + 1}.` : '•';
                        return (
                            <View key={i} style={{ flexDirection: 'row', marginBottom: 2, paddingLeft: 8 }}>
                                <Text style={{ fontSize: fs, color: STONE500, marginRight: 6, fontFamily }}>{marker}</Text>
                                <Text style={{ fontSize: fs, lineHeight: 1.6, color: STONE600, flex: 1, fontFamily }}>{children}</Text>
                            </View>
                        );
                    })}
                </View>
            );
        }

        case 'blockquote': {
            const children = Array.from(el.childNodes).flatMap(c => renderInline(c, fontFamily));
            return (
                <View key={Math.random()} style={{ borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: primary, paddingLeft: 8, marginBottom: 4, backgroundColor: primary + '08' }}>
                    <Text style={{ fontSize: fs, lineHeight: 1.6, color: STONE600, fontStyle: 'italic', fontFamily }}>{children}</Text>
                </View>
            );
        }

        default:
            // Fallback: render as paragraph if has text content
            if (el.textContent?.trim()) {
                return (
                    <Text key={Math.random()} style={{ fontSize: fs, lineHeight: 1.6, color: STONE600, marginBottom: 4, fontFamily }}>
                        {el.textContent}
                    </Text>
                );
            }
            return null;
    }
}

/**
 * Convert an HTML string (from TipTap) into an array of react-pdf nodes.
 * Safe to call only in browser context (uses DOMParser).
 */
export function htmlToPdfNodes(
    html: string,
    branding?: BrandingConfig,
    fontFamily = 'Quicksand',
): React.ReactNode[] {
    if (!html || !html.trim()) return [];

    // DOMParser is available in the browser (react-pdf renders in browser worker context)
    let doc: Document;
    try {
        const parser = new DOMParser();
        doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    } catch {
        // Fallback: plain text
        return [<Text key="fallback" style={{ fontSize: 10, color: STONE600, fontFamily }}>{html.replace(/<[^>]+>/g, '')}</Text>];
    }

    const primary = getPrimary(branding);
    const container = doc.body.firstChild as Element;
    if (!container) return [];

    const nodes: React.ReactNode[] = [];
    Array.from(container.children).forEach((child) => {
        const rendered = renderBlock(child, branding, fontFamily, primary);
        if (rendered !== null) nodes.push(rendered);
    });

    return nodes;
}
