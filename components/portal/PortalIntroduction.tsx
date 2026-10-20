/**
 * PortalIntroduction — letter shown at the top of the family questionnaire (#149):
 * why it is asked, how to fill it, what to bring to the first appointment. Signed
 * with the practitioner's name carried by the link (encrypted), else generically.
 */

import React from 'react';
import { Check } from 'lucide-react';

const DOCUMENTS = [
  'La prescription médicale',
  'Les cahiers scolaires en cours ainsi que l’agenda (cahier de texte)',
  'Les différents comptes rendus des professionnels médicaux, paramédicaux et scolaires',
  'Le stylo habituel de votre enfant',
];

/** « Name, ergothérapeute » unless the name already says it; generic without a name. */
export const portalSignature = (practitionerName?: string): string => {
  const name = practitionerName?.trim();
  if (!name) return 'Votre ergothérapeute';
  return /ergoth/i.test(name) ? name : `${name}, ergothérapeute`;
};

export const PortalIntroduction: React.FC<{ practitionerName?: string }> = ({ practitionerName }) => (
  <div className="bg-[var(--card-bg)] p-8 rounded-[32px] mb-8 shadow-xl shadow-black/20 border border-[var(--border-color)]">
    <h2 className="font-serif text-2xl font-bold text-[var(--text-heading)] mb-4">Préparation du Bilan</h2>
    <div className="text-[var(--text-main)] text-sm leading-relaxed space-y-3">
      <p>Monsieur, Madame,</p>
      <p>
        Vous avez souhaité convenir d’un rendez-vous afin de réaliser un bilan pour votre enfant. Je vous remercie de bien vouloir compléter
        ce questionnaire afin de préparer notre rencontre. L’objectif de ce questionnaire est de mieux comprendre votre enfant. Vos réponses
        nous aideront à préparer notre premier rendez-vous, où nous aborderons plus en détail les points que vous aurez signalés.
      </p>
      <p>
        Vous pouvez ajouter des observations supplémentaires si besoin. Si certaines questions vous semblent difficiles à renseigner, ne
        vous inquiétez pas : nous les aborderons ensemble lors du rendez-vous.
      </p>
      <p>
        Si certains éléments sont difficiles à évoquer en présence de votre enfant, je vous invite à les mentionner dans la zone de texte «
        Remarques complémentaires » de la partie « Motif de consultation ». Nous pourrons alors convenir d’un moment privilégié pour en
        parler.
      </p>
      <div>
        <p>Pour le premier rendez-vous, je vous invite à apporter :</p>
        <ul className="mt-2 space-y-1.5">
          {DOCUMENTS.map((doc) => (
            <li key={doc} className="flex items-start gap-2">
              <Check size={16} className="shrink-0 mt-0.5 text-[#81B29A]" />
              <span>{doc}</span>
            </li>
          ))}
        </ul>
      </div>
      <p>En vous remerciant par avance pour le temps consacré à ce questionnaire, je vous dis à très bientôt.</p>
      <p className="font-bold text-[var(--text-heading)]">{portalSignature(practitionerName)}</p>
    </div>
    <p className="mt-6 text-xs text-[var(--text-secondary)]">Vos réponses sont chiffrées avant envoi.</p>
  </div>
);
