/**
 * demoReport.ts — transport of the demo report generator: answers shaped like
 * those of the edge function `generate`, after a simulated delay (no network
 * call, no credit). Parsing and re-hydration run as in the real mode, so the
 * answers use the same placeholders (`{{PATIENT_PRENOM}}`).
 */

import type { AIRequest, AITransport } from '../utils/reportGenerator';

const DEMO_GENERATION_DELAY_MS = 2_500;

const DEMO_ANSWERS: Record<AIRequest['task'], object> = {
  report_bio: {
    mandat_referencement:
      "**Motif de la demande**\nL'évaluation est sollicitée par la famille et l'équipe enseignante en raison d'une lenteur marquée, de difficultés d'organisation et d'une écriture coûteuse. Les enseignants signalent une fatigabilité et une perte de confiance lors des tâches écrites.",
    mandat_evaluation:
      "L'objectif de ce bilan est d'observer et d'évaluer les capacités graphomotrices de {{PATIENT_PRENOM}}, ainsi que les facteurs sous-jacents tels que la motricité fine, les capacités visuo-perceptives et la coordination bimanuelle.",
    profil_occupationnel:
      "{{PATIENT_PRENOM}} est une jeune fille de 7 ans, scolarisée en CE1. Elle est volontaire mais se décourage vite quand la tâche dure. À la maison, l'autonomie est acquise mais la lenteur est notable (habillage, douche, brossage des dents). Elle a besoin de bouger et bénéficie d'activités sportives régulières.",
  },
  report_diagnostic: {
    synthese_diagnostic:
      "- Sur le plan de la motricité fine :\nLa dextérité manuelle est fragile, avec une lenteur d'exécution et une fatigabilité.\n\n- Concernant l'écriture manuscrite :\nL'écriture est lente et peu lisible. La prise du crayon est crispée, avec une forte pression, ce qui engendre une fatigue lors des productions écrites.\n\nCes difficultés ont un retentissement sur l'efficience scolaire et l'estime de soi.",
    objectifs_generaux:
      '- Diminuer le coût graphomoteur et la fatigue.\n- Stabiliser la tenue de crayon et la posture.\n- Renforcer l’efficience à l’écrit (vitesse et lisibilité).',
    projet_accompagnement:
      '{{PATIENT_PRENOM}} est une enfant volontaire et investie. Je propose la mise en place de séances régulières :\n- Travail de la motricité fine et de la coordination bi-manuelle pour favoriser la rééducation graphique.\n- Rééducation graphique pour améliorer la lisibilité, la qualité et la vitesse lors des écrits.\nUne réévaluation des compétences est préconisée tous les 6 mois.',
    recommandations:
      'Adaptations pédagogiques recommandées :\n- Limiter la charge de copie (photocopies, textes à trous...), lorsque cela est possible.\n- Accorder un temps majoré pour les évaluations longues.\n- Segmenter les consignes et proposer des repères visuels.',
  },
  report_reevaluation: {
    resume_initial:
      '<p>Le bilan initial mettait en évidence :</p><ul><li>une lenteur graphomotrice ;</li><li>une prise du crayon crispée.</li></ul><p>Les objectifs de prise en charge étaient :</p><ul><li>diminuer le coût graphomoteur ;</li><li>améliorer la lisibilité.</li></ul>',
    evolution_commentee:
      '<p>Le tableau comparatif détaille l’évolution de chaque épreuve. On observe une progression de la dextérité manuelle et de la qualité graphique.</p>',
    conclusion:
      '<p>{{PATIENT_PRENOM}} progresse de manière encourageante. Les objectifs restent d’actualité et le suivi est poursuivi.</p>',
    recommandations: '<ul><li>Poursuivre les séances régulières.</li><li>Maintenir le temps majoré en classe.</li></ul>',
  },
  extract_style_feedback: {},
};

export const createDemoTransport =
  (delayMs = DEMO_GENERATION_DELAY_MS): AITransport =>
  async ({ task }) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { text: JSON.stringify(DEMO_ANSWERS[task]) };
  };

export const demoTransport = createDemoTransport();
