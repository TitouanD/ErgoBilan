/**
 * DevTools — development only (loaded by App behind `import.meta.env.DEV`, or
 * in the recette build with `VITE_SCENARIOS=1`; absent from the deployed build).
 *
 * - Runs the scenario of the URL (`?scenario=…`, dev/scenarios.ts) once per
 *   page load, then opens its screen (and its modal, `&modale=`). Reloading
 *   the page rebuilds it.
 * - « Purger les fictifs »: deletes every FICTIF patient of the local database.
 *
 * The scenario state is exposed on `<html data-scenario="running|ready|error">`
 * for the screenshot script (e2e/capture.mjs) and the recette (e2e/recette/).
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useCatalog } from '../contexts/CatalogContext';
import { useToast } from '../contexts/ToastContext';
import { createDemoTransport } from '../data/demoReport';
import { StorageService } from '../services/storage';
import type { Patient, PendingQuestionnaire } from '../types';
import { withChildNames } from '../utils/familyQuestionnaire';
import { createReportGenerator } from '../utils/reportGenerator';
import { Logger } from '../utils/logger';
import { buildFictiveQuestionnaires } from './fictiveQuestionnaires';
import { parseScenario, purgeFictivePatients, runScenario, type ScenarioWelcome } from './scenarios';
import { FICTIF_LAST_NAME } from './fictivePatients';

interface Props {
  onLoadData: () => Promise<void>;
  onResumeDraft: (patientId: string) => Promise<void>;
  onShowDashboard: () => void;
  /** Show fictitious parent questionnaires on the dashboard (memory only). */
  onShowQuestionnaires: (rows: PendingQuestionnaire[]) => void;
  onShowPricing: (mode: 'plans' | 'paywall', paymentClosed: boolean) => void;
  /** Terms of sale (`&modale=cgv`), also reachable at the public address /?legal=cgv. */
  onShowTermsOfSale: () => void;
  /** Welcome screen after sign-up at its last step (`scenario=accueil`, #113). */
  onShowWelcome: (welcome: ScenarioWelcome) => void;
  /** Parent portal form pre-filled with the profile (`scenario=portail`, #152), its introduction signed by a fictitious practitioner (#149): nothing written, nothing sent. */
  onShowPortal: (patient: Patient, practitionerName: string) => void;
}

/** Search string whose scenario already ran (the component can remount after a lock). */
let ranFor: string | null = null;

const setStatus = (status: 'running' | 'ready' | 'error', error?: string) => {
  document.documentElement.dataset.scenario = status;
  if (error) document.documentElement.dataset.scenarioError = error;
};

/** Ready once the screen opened by the scenario has painted. */
const afterPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export const DevTools: React.FC<Props> = ({
  onLoadData,
  onResumeDraft,
  onShowDashboard,
  onShowQuestionnaires,
  onShowPricing,
  onShowTermsOfSale,
  onShowWelcome,
  onShowPortal,
}) => {
  const { ensureCatalogLoaded } = useCatalog();
  const { sessionKey } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const search = window.location.search;
    if (ranFor === search) return;
    ranFor = search;
    const parsed = parseScenario(search);
    if (!parsed) return;
    if (!parsed.ok) {
      setStatus('error', parsed.error);
      toast.error(parsed.error);
      return;
    }
    setStatus('running');
    void (async () => {
      try {
        const index = await ensureCatalogLoaded();
        const generator = createReportGenerator(createDemoTransport(0));
        const result = await runScenario(parsed.scenario, { store: StorageService, index, generator, now: new Date() });
        await onLoadData();
        if (parsed.scenario.questionnaires && sessionKey) {
          // Same decryption as the questionnaires loaded from Supabase (useDataLoader → loadPending).
          onShowQuestionnaires(await withChildNames(await buildFictiveQuestionnaires(sessionKey, new Date()), sessionKey));
        }
        if (parsed.scenario.name === 'portail') onShowPortal(parsed.scenario.profile.patient, `Sophie ${FICTIF_LAST_NAME}`);
        else if (result.open) await onResumeDraft(result.open);
        else onShowDashboard();
        if (parsed.scenario.modal === 'cgv') onShowTermsOfSale();
        else if (parsed.scenario.modal) onShowPricing(parsed.scenario.modal, parsed.scenario.paymentClosed);
        if (parsed.scenario.welcome) onShowWelcome(parsed.scenario.welcome);
        if (result.missing.length > 0) toast.warning(`Absents du catalogue : ${result.missing.join(', ')}`);
        await afterPaint();
        setStatus('ready');
      } catch (e) {
        Logger.error('UI', 'Dev scenario failed', e);
        const message = e instanceof Error ? e.message : String(e);
        setStatus('error', message);
        toast.error(`Scénario en échec : ${message}`);
      }
    })();
    // Once per page load: the handlers change on every render of App.
  }, []);

  const purge = async () => {
    if (!window.confirm('Supprimer tous les patients FICTIF de cette base locale ?')) return;
    setBusy(true);
    try {
      const count = await purgeFictivePatients(StorageService);
      await onLoadData();
      onShowDashboard();
      toast.success(`${count} patient(s) fictif(s) supprimé(s).`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void purge()}
      disabled={busy}
      data-devtools
      className="fixed bottom-3 left-3 z-[60] rounded-full bg-stone-800/80 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white shadow hover:bg-stone-900 disabled:opacity-50"
      title="Outil de développement (absent de la production)"
    >
      Dev · Purger les fictifs
    </button>
  );
};
