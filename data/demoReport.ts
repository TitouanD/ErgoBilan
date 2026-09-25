/**
 * demoReport.ts — static sections used to simulate AI generation in demo mode
 * (no network call, no credit).
 */

import type { ReportSection } from '../types';
import { sectionToHtml } from '../utils/reportContent';

const demo = (id: string, title: string, content: string, contentFormat: ReportSection['contentFormat'] = 'plain'): ReportSection => ({
  id,
  title,
  content,
  originalContent: sectionToHtml({ content, contentFormat }),
  contentFormat,
  status: 'draft',
  isAiGenerated: true,
});

export const DEMO_SECTIONS: ReportSection[] = [
  demo(
    'mandat_ref',
    'Mandat de référencement en ergothérapie',
    "**Motif de la demande**\nL'évaluation est sollicitée par la famille et l'équipe enseignante en raison d'une lenteur marquée, de difficultés d'organisation et d'une écriture coûteuse. Les enseignants signalent une fatigabilité et une perte de confiance lors des tâches écrites.",
  ),
  demo(
    'mandat_eval',
    "Mandat d'évaluation en ergothérapie",
    "L'objectif de ce bilan est d'observer et d'évaluer les capacités graphomotrices d'Elya, ainsi que les facteurs sous-jacents tels que la motricité fine, les capacités visuo-perceptives et la coordination bimanuelle.",
  ),
  demo(
    'profil',
    'Profil occupationnel',
    "Elya est une jeune fille de 7 ans, scolarisée en CE1. Elle est volontaire mais se décourage vite quand la tâche dure. À la maison, l'autonomie est acquise mais la lenteur est notable (habillage, douche, brossage des dents). Elle a besoin de bouger et bénéficie d'activités sportives régulières.",
  ),
  demo(
    'diagnostic',
    'Diagnostic en ergothérapie',
    "- Sur le plan de la motricité fine :\nLa dextérité manuelle est fragile, avec une lenteur d'exécution et une fatigabilité.\n\n- Concernant l'écriture manuscrite :\nL'écriture est lente et peu lisible. La prise du crayon est crispée, avec une forte pression, ce qui engendre une fatigue lors des productions écrites.\n\nCes difficultés ont un retentissement sur l'efficience scolaire et l'estime de soi.",
  ),
  demo(
    'objectifs',
    'Les objectifs généraux',
    '- Diminuer le coût graphomoteur et la fatigue.\n- Stabiliser la tenue de crayon et la posture.\n- Renforcer l’efficience à l’écrit (vitesse et lisibilité).',
  ),
  demo(
    'project',
    "Projet d'accompagnement",
    'Elya est une enfant volontaire et investie. Je propose la mise en place de séances régulières :\n- Travail de la motricité fine et de la coordination bi-manuelle pour favoriser la rééducation graphique.\n- Rééducation graphique pour améliorer la lisibilité, la qualité et la vitesse lors des écrits.\nUne réévaluation des compétences est préconisée tous les 6 mois.',
  ),
  demo(
    'recommandations',
    'Recommandations',
    'Adaptations pédagogiques recommandées :\n- Limiter la charge de copie (photocopies, textes à trous...), lorsque cela est possible.\n- Accorder un temps majoré pour les évaluations longues.\n- Segmenter les consignes et proposer des repères visuels.',
  ),
];

export const DEMO_REEVALUATION_SECTIONS: ReportSection[] = [
  demo(
    'resume_initial',
    'Rappel du bilan initial',
    '<p>Le bilan initial mettait en évidence :</p><ul><li>une lenteur graphomotrice ;</li><li>une prise du crayon crispée.</li></ul><p>Les objectifs de prise en charge étaient :</p><ul><li>diminuer le coût graphomoteur ;</li><li>améliorer la lisibilité.</li></ul>',
    'html',
  ),
  demo(
    'evolution',
    'Évolution des résultats',
    '<p>Le tableau comparatif détaille l’évolution de chaque épreuve. On observe une progression de la dextérité manuelle et de la qualité graphique.</p>',
    'html',
  ),
  demo(
    'conclusion',
    'Conclusion',
    '<p>L’enfant progresse de manière encourageante. Les objectifs restent d’actualité et le suivi est poursuivi.</p>',
    'html',
  ),
  demo(
    'recommandations_reev',
    'Préconisations',
    '<ul><li>Poursuivre les séances régulières.</li><li>Maintenir le temps majoré en classe.</li></ul>',
    'html',
  ),
];
