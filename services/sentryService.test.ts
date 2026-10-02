import { describe, expect, it } from 'vitest';
import type { Event } from '@sentry/react';
import { scrubFeedback } from './sentryService';

describe('scrubFeedback', () => {
  const feedbackEvent = (): Event => ({
    type: 'feedback',
    contexts: {
      feedback: {
        message: 'Le bilan de Sarah Martin plante, écrire à parent@example.com',
        name: 'Titouan',
        contact_email: 'testeuse@example.com',
        url: 'https://dev.ergobilan.com/?q_id=abc#key=secret',
        source: 'header',
      },
      app_context: { patientName: 'Sarah Martin' },
      browser: { name: 'Chrome' },
    },
    breadcrumbs: [{ message: 'Ouverture du dossier de Sarah Martin' }],
  });

  it('scrubs names and e-mails from the free-text message and the portal key from the URL', () => {
    const feedback = scrubFeedback(feedbackEvent()).contexts?.feedback as Record<string, unknown>;
    expect(feedback.message).toBe('Le bilan de [REDACTED] plante, écrire à [REDACTED]');
    expect(feedback.url).toBe('https://dev.ergobilan.com/?q_id=[REDACTED]');
  });

  it('keeps the contact e-mail and the source, drops the name', () => {
    const feedback = scrubFeedback(feedbackEvent()).contexts?.feedback as Record<string, unknown>;
    expect(feedback.contact_email).toBe('testeuse@example.com');
    expect(feedback.source).toBe('header');
    expect(feedback).not.toHaveProperty('name');
  });

  it('scrubs app contexts and breadcrumbs like an error event, keeps SDK contexts', () => {
    const event = scrubFeedback(feedbackEvent());
    expect(event.contexts?.app_context).toEqual({ patientName: '[REDACTED]' });
    expect(event.contexts?.browser).toEqual({ name: 'Chrome' });
    expect(event.breadcrumbs?.[0].message).toBe('Ouverture du dossier de [REDACTED]');
  });
});
