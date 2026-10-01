// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';

const captureFeedback = vi.fn();
const flush = vi.fn().mockResolvedValue(undefined);
vi.mock('@sentry/react', () => ({
  captureFeedback: (...args: unknown[]) => captureFeedback(...args),
  getReplay: () => ({ flush }),
  lastEventId: () => 'error-event-id',
}));

let service: typeof import('./sentryService');

beforeAll(async () => {
  // Sentry is on only with a DSN (and, outside a build, the dev opt-in): read at module load.
  vi.stubEnv('VITE_SENTRY_DSN_FRONTEND', 'https://key@example.ingest.de.sentry.io/1');
  vi.stubEnv('VITE_SENTRY_ENABLE_IN_DEV', 'true');
  vi.resetModules();
  service = await import('./sentryService');
});

describe('sendAppFeedback', () => {
  it('asks the replay integration to attach the replay to the feedback', () => {
    service.sendAppFeedback('Le bouton ne répond plus', 'header');
    const [params, hint] = captureFeedback.mock.calls[0];
    expect(hint).toEqual({ includeReplay: true });
    expect(params).toMatchObject({ message: 'Le bouton ne répond plus', tags: { feedback_source: 'header' } });
    expect(params.associatedEventId).toBeUndefined();
  });

  it('links the last captured error when sent from the error screen', () => {
    service.sendAppFeedback('Écran blanc', 'error_screen');
    expect(captureFeedback.mock.calls.at(-1)?.[0]).toMatchObject({ associatedEventId: 'error-event-id' });
  });
});

describe('prepareFeedback', () => {
  it('sends the buffered replay (error-only sampling) so the feedback can point to it', async () => {
    await service.prepareFeedback();
    expect(flush).toHaveBeenCalledOnce();
  });
});
