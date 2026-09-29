/**
 * ai.ts — the two report generators of the app, created once so the state of
 * a resumable initial report survives a remount of the screens.
 *
 * - real mode: the edge function `generate` (`callAIProxyTask`);
 * - demo mode: simulated answers (`data/demoReport.ts`), nothing leaves the browser.
 *
 * Everything else (payload, anonymization, parsing, re-hydration) is in
 * `utils/reportGenerator.ts`.
 */

import { demoTransport } from '../data/demoReport';
import { createReportGenerator, type ReportGenerator } from '../utils/reportGenerator';
import { callAIProxyTask } from './aiProxy';

const edgeGenerator = createReportGenerator(callAIProxyTask);
const demoGenerator = createReportGenerator(demoTransport);

export const getReportGenerator = (isDemoMode: boolean): ReportGenerator => (isDemoMode ? demoGenerator : edgeGenerator);

export { describeGenerationError } from '../utils/reportGenerator';
