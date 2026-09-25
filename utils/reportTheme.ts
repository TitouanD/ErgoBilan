/**
 * reportTheme.ts — branding values resolved once for both report renderers
 * (HTML preview and PDF). When the branding is disabled, the defaults apply.
 */

import type { BrandingConfig } from '../types';
import { DEFAULT_BRANDING } from '../data/brandingDefaults';

export interface ReportTheme {
  isCustom: boolean;
  primary: string;
  secondary: string;
  /** Heading font (document title, section titles). */
  headingFont: BrandingConfig['fontFamily'];
  corners: BrandingConfig['cornerStyle'];
  logoSize: BrandingConfig['logoSize'];
  headerTemplate: BrandingConfig['headerTemplate'];
  titleStyle: BrandingConfig['titleStyle'];
  patientBlockStyle: BrandingConfig['patientBlockStyle'];
}

export const resolveReportTheme = (branding?: BrandingConfig): ReportTheme => {
  const custom = Boolean(branding?.isEnabled);
  const source = custom && branding ? branding : DEFAULT_BRANDING;
  return {
    isCustom: custom,
    primary: source.primaryColor || DEFAULT_BRANDING.primaryColor,
    secondary: source.secondaryColor || DEFAULT_BRANDING.secondaryColor,
    headingFont: source.fontFamily || DEFAULT_BRANDING.fontFamily,
    corners: source.cornerStyle || DEFAULT_BRANDING.cornerStyle,
    logoSize: source.logoSize || DEFAULT_BRANDING.logoSize,
    headerTemplate: source.headerTemplate || DEFAULT_BRANDING.headerTemplate,
    titleStyle: source.titleStyle || DEFAULT_BRANDING.titleStyle,
    patientBlockStyle: source.patientBlockStyle || DEFAULT_BRANDING.patientBlockStyle,
  };
};

/** "12 mars 2024" — date shown on the report ("Fait le ..."). */
export const formatReportDate = (date: Date | string = new Date()): string =>
  new Date(date).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });

/** Date of birth as dd/mm/yyyy, or the raw value when it cannot be parsed. */
export const formatBirthDate = (dob: string): string => {
  const d = new Date(dob);
  return dob && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('fr-FR') : dob;
};
