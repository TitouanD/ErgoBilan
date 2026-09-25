import type { BrandingConfig } from '../types';

/** Report layout used until the practitioner customizes it (and as the base merged under saved settings). */
export const DEFAULT_BRANDING: BrandingConfig = {
  isEnabled: false,
  primaryColor: '#3D405B',
  secondaryColor: '#E07A5F',
  fontFamily: 'Merriweather',
  headerTemplate: 'classic',
  titleStyle: 'simple',
  headerLayout: 'row',
  headerAlignment: 'left',
  logoSize: 'medium',
  cornerStyle: 'rounded',
  cabinetName: "Cabinet d'Ergothérapie",
  brandSubtitle: '',
  documentTitle: "Bilan d'Ergothérapie",
  patientBlockStyle: 'modern',
  practitionerName: '',
  address: '',
  siret: '',
  footerText: 'Document confidentiel - Bilan Ergothérapique',
  showPageNumbers: true,
};

/**
 * Identity fields shown in the report header. They always come from the
 * practitioner profile (edited in "Mon profil"), never from the saved branding.
 */
export const PROFILE_BRANDING_FIELDS = ['practitionerName', 'email', 'phone', 'address', 'siret'] as const;

/** Largest logo accepted in the branding (stored as a data URL in `practitioners.branding_config`). */
export const MAX_LOGO_BYTES = 500 * 1024;
