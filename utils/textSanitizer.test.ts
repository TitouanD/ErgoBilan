import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities, sanitizeReportText } from './textSanitizer';

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal and hexadecimal entities', () => {
    expect(decodeHtmlEntities('&Eacute;cole &agrave; l&#39;&oelig;uvre, s&#x27;il&hellip; &euro;')).toBe("École à l'œuvre, s'il… €");
  });

  it('decodes once and leaves unknown entities and bare ampersands alone', () => {
    expect(decodeHtmlEntities('A &amp;eacute; B &foo; C & D')).toBe('A &eacute; B &foo; C & D');
  });
});

describe('sanitizeReportText', () => {
  it('repairs misordered combining accents before latin letters', () => {
    const input = "L'entretien met en \u0301evidence la n\u0301ecessite d'\u0301evaluer.";
    expect(sanitizeReportText(input)).toBe("L'entretien met en évidence la nécessite d'évaluer.");
  });

  it('removes replacement/square placeholders and control chars', () => {
    const input = 'adress�e en ergoth□erapie\u0007 pour r�esultats';
    expect(sanitizeReportText(input)).toBe('adresse en ergotherapie pour resultats');
  });

  it('preserves markdown structure', () => {
    const input = '## Titre\n\n- Point \u0301evaluation\nParagraphe';
    expect(sanitizeReportText(input)).toBe('## Titre\n\n- Point évaluation\nParagraphe');
  });
});
