import React, { useState } from 'react';
import { X, FileText, ShieldCheck, Receipt } from 'lucide-react';
import type { LegalTab } from '../../utils/legalLink';

interface LegalModalProps {
  initialTab?: LegalTab;
  onClose: () => void;
}

// ─── Identité de l'éditeur (factures, CGU, CGV, confidentialité) ──────────────

const Publisher: React.FC = () => (
  <>
    <strong>TD Corp</strong>, nom commercial de <strong>Titouan D'Halluin EI</strong> (entrepreneur individuel), 420 rue Eugène Berest,
    29200 Brest, SIRET <strong>929 224 459 00024</strong>
  </>
);

const Mail: React.FC<{ to: 'contact' | 'privacy' }> = ({ to }) => (
  <a href={`mailto:${to}@ergobilan.com`} className="text-[var(--primary)] underline">
    {to}@ergobilan.com
  </a>
);

// ─── Contenu CGU ──────────────────────────────────────────────────────────────

const CGUContent: React.FC = () => (
  <div className="prose prose-sm max-w-none text-[var(--text-main)] space-y-6">
    <p className="text-xs text-[var(--text-secondary)]">Version en vigueur au 12 octobre 2026</p>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">1. Éditeur du service</h2>
      <p>
        ErgoBilan est édité par <Publisher />.
      </p>
      <p className="mt-2">
        Contact : <Mail to="contact" />
      </p>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        Hébergeur des données de compte : Supabase Inc., 970 Toa Payoh North, Singapour 318992 — infrastructure serveurs : AWS eu-west-1
        (Irlande).
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">2. Description du service</h2>
      <p>ErgoBilan est un logiciel SaaS (Software as a Service) à destination des ergothérapeutes exerçant en France. Il permet :</p>
      <ul className="list-disc ml-5 mt-2 space-y-1">
        <li>La saisie et la mise en forme de bilans ergothérapiques ;</li>
        <li>Le calcul automatique de scores normés à partir de catalogues de tests cliniques ;</li>
        <li>La génération assistée par intelligence artificielle de sections de compte-rendu ;</li>
        <li>L'envoi de questionnaires anamnestiques sécurisés aux familles (portail famille).</li>
      </ul>
      <p className="mt-2">
        <strong>Architecture locale-first :</strong> les données relatives aux patients (identité, résultats de tests, comptes-rendus) sont
        stockées exclusivement dans le navigateur de l'utilisateur (IndexedDB). ErgoBilan n'héberge pas et ne peut pas accéder aux données
        patients.
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">3. Accès au service et inscription</h2>
      <p>
        L'accès au service est réservé aux professionnels de santé (ergothérapeutes inscrits à l'ANFE ou tout professionnel habilité à
        réaliser des bilans ergothérapiques). En créant un compte, l'utilisateur déclare exercer à titre professionnel.
      </p>
      <p className="mt-2">
        Un essai gratuit de <strong>3 générations</strong> est offert à l'inscription, valable 30 jours. Au-delà, la rédaction par l'IA est
        conditionnée à la souscription d'une formule ou à l'achat de crédits, selon les Conditions Générales de Vente. Le reste du service
        (saisie, calcul des scores, aperçu et export des bilans) reste accessible sans formule.
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">4. Responsabilité des données patients — Séparation des rôles</h2>
      <p>Au sens du RGPD (Règlement (UE) 2016/679) :</p>
      <ul className="list-disc ml-5 mt-2 space-y-1">
        <li>
          <strong>L'ergothérapeute</strong> est le <strong>responsable de traitement</strong> des données de ses patients. Il détermine les
          finalités et les moyens du traitement (art. 4.7 RGPD).
        </li>
        <li>
          <strong>ErgoBilan</strong> est un <strong>éditeur de logiciel</strong>. Il ne traite pas les données patients car celles-ci ne
          quittent jamais le poste de l'ergothérapeute (stockage IndexedDB local).
        </li>
      </ul>
      <p className="mt-2">En conséquence :</p>
      <ul className="list-disc ml-5 mt-2 space-y-1">
        <li>
          L'ergothérapeute est seul responsable du respect de ses obligations légales envers ses patients (information, consentement, droit
          d'accès, droit à l'effacement).
        </li>
        <li>L'ergothérapeute est seul responsable de la sécurité physique du poste sur lequel les données sont stockées.</li>
        <li>
          ErgoBilan recommande l'utilisation d'un chiffrement de disque (BitLocker, FileVault) et d'une session Windows/macOS protégée par
          mot de passe.
        </li>
        <li>ErgoBilan recommande de ne pas utiliser le service sur un ordinateur partagé.</li>
      </ul>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">5. Portail famille et questionnaires</h2>
      <p>
        Les questionnaires envoyés aux familles sont chiffrés de bout en bout (AES-GCM, clé générée côté praticien). Supabase héberge
        temporairement les données chiffrées, illisibles sans la clé détenue par le praticien. Les données du portail sont supprimées
        automatiquement 72 heures après leur création (questionnaires non traités) ou 24 heures après leur traitement.
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">6. Intelligence artificielle</h2>
      <p>
        ErgoBilan utilise l'API Gemini de Google pour la génération de texte.{' '}
        <strong>Aucune donnée nominative n'est transmise à l'IA.</strong> Avant tout envoi, les données sont pseudonymisées côté client :
        les noms, prénoms et coordonnées du patient, de sa famille et des professionnels cités sont remplacés par des marqueurs (ex. «&nbsp;
        {'{{PATIENT_PRENOM}}'}&nbsp;»), puis réinsérés localement dans le texte reçu.
      </p>
      <p className="mt-2">
        Chaque génération consomme un crédit. Une génération qui échoue ne consomme rien : son crédit est rendu automatiquement.
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">7. Abonnement et facturation</h2>
      <p>
        Les formules, les crédits, leurs prix, le paiement et la résiliation sont régis par les Conditions Générales de Vente, accessibles
        depuis la page d'accueil et à chaque paiement.
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">8. Propriété intellectuelle</h2>
      <p>
        Le catalogue de tests cliniques, les algorithmes de scoring, l'interface et le code source d'ErgoBilan sont la propriété exclusive
        de l'éditeur. Les normes cliniques intégrées sont issues de publications scientifiques dont les droits appartiennent à leurs auteurs
        respectifs.
      </p>
      <p className="mt-2">L'utilisateur conserve la pleine propriété des bilans qu'il génère via le service.</p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">9. Disponibilité et maintenance</h2>
      <p>
        ErgoBilan s'engage à mettre en œuvre les moyens raisonnables pour assurer la disponibilité du service. Des interruptions pour
        maintenance peuvent survenir, de préférence annoncées par email avec un préavis raisonnable.
      </p>
      <p className="mt-2">
        ErgoBilan ne peut être tenu responsable d'une perte de données due à la suppression du cache navigateur, à une réinitialisation du
        poste ou à tout autre événement affectant le stockage local de l'utilisateur. ErgoBilan recommande des exports réguliers via la
        fonction «&nbsp;Télécharger un backup&nbsp;» disponible dans Mon Profil.
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">10. Suspension et résiliation</h2>
      <p>
        ErgoBilan se réserve le droit de suspendre ou résilier un compte en cas de violation des présentes CGU, d'utilisation frauduleuse ou
        abusive du service.
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">11. Modification des CGU</h2>
      <p>
        ErgoBilan peut modifier les présentes CGU. Les modifications substantielles seront notifiées par email au moins 15 jours avant leur
        entrée en vigueur. La poursuite de l'utilisation du service après cette période vaut acceptation des nouvelles CGU.
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">12. Droit applicable et juridiction</h2>
      <p>
        Les présentes CGU sont soumises au droit français. En cas de litige, les parties s'efforceront de trouver une solution amiable. À
        défaut, les tribunaux français seront compétents.
      </p>
    </section>
  </div>
);

// ─── Contenu CGV ──────────────────────────────────────────────────────────────

const CGVContent: React.FC = () => (
  <div className="prose prose-sm max-w-none text-[var(--text-main)] space-y-6">
    <p className="text-xs text-[var(--text-secondary)]">Version en vigueur au 12 octobre 2026</p>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">1. Vendeur et champ d'application</h2>
      <p>
        Les présentes Conditions Générales de Vente (CGV) régissent la vente des formules et des crédits du service ErgoBilan par{' '}
        <Publisher /> (le « Vendeur »). Contact : <Mail to="contact" />.
      </p>
      <p className="mt-2">
        Elles s'adressent exclusivement à des professionnels (le « Client ») qui achètent le service pour l'exercice de leur activité. En
        validant un paiement, le Client déclare agir à titre professionnel et accepte les présentes CGV, qui complètent les Conditions
        Générales d'Utilisation.
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">2. Crédits</h2>
      <p>
        Un crédit permet une génération par l'IA : la rédaction d'un bilan initial ou d'une réévaluation. Le reste du service (saisie,
        calcul des scores, aperçu, export PDF, saisie de bilans historiques) ne consomme aucun crédit. Une génération qui échoue ne consomme
        rien : son crédit est rendu automatiquement.
      </p>
      <ul className="list-disc ml-5 mt-2 space-y-1">
        <li>
          <strong>Crédits du mois</strong> : donnés par la formule à chaque renouvellement. Ils ne se reportent pas : à chaque
          renouvellement, leur nombre est remis à celui prévu par la formule.
        </li>
        <li>
          <strong>Crédits achetés</strong> : achetés à l'unité. Ils n'expirent pas tant que le compte existe.
        </li>
      </ul>
      <p className="mt-2">Les crédits du mois sont utilisés en premier. Les crédits ne sont ni cessibles ni convertibles en argent.</p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">3. Essai gratuit</h2>
      <p>
        L'inscription ouvre un essai gratuit de 30 jours avec 3 crédits, sans moyen de paiement. Les crédits d'essai non utilisés sont
        conservés si le Client souscrit une formule pendant l'essai ; ils sont perdus à la fin de l'essai sinon.
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">4. Formules et prix</h2>
      <div className="overflow-x-auto mt-2">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-[var(--card-bg-raised)]">
              <th className="border border-[var(--border-color)] p-2 text-left">Formule</th>
              <th className="border border-[var(--border-color)] p-2 text-left">Prix mensuel</th>
              <th className="border border-[var(--border-color)] p-2 text-left">Crédits du mois</th>
              <th className="border border-[var(--border-color)] p-2 text-left">Crédit acheté à l'unité</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-[var(--border-color)] p-2 font-medium">Essentiel</td>
              <td className="border border-[var(--border-color)] p-2">19 €</td>
              <td className="border border-[var(--border-color)] p-2">2</td>
              <td className="border border-[var(--border-color)] p-2">15 €</td>
            </tr>
            <tr className="bg-[var(--card-bg-raised)]/50">
              <td className="border border-[var(--border-color)] p-2 font-medium">Performance</td>
              <td className="border border-[var(--border-color)] p-2">34 €</td>
              <td className="border border-[var(--border-color)] p-2">6</td>
              <td className="border border-[var(--border-color)] p-2">8 €</td>
            </tr>
            <tr>
              <td className="border border-[var(--border-color)] p-2 font-medium">Expert</td>
              <td className="border border-[var(--border-color)] p-2">89 €</td>
              <td className="border border-[var(--border-color)] p-2">20</td>
              <td className="border border-[var(--border-color)] p-2">5 €</td>
            </tr>
            <tr className="bg-[var(--card-bg-raised)]/50">
              <td className="border border-[var(--border-color)] p-2 font-medium">Sans formule</td>
              <td className="border border-[var(--border-color)] p-2">—</td>
              <td className="border border-[var(--border-color)] p-2">—</td>
              <td className="border border-[var(--border-color)] p-2">15 €</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2">
        Les prix sont exprimés en euros. TVA non applicable, article 293 B du Code général des impôts. Aucune formule n'est illimitée.
      </p>
      <p className="mt-2">
        Le Vendeur peut modifier ses prix. Toute hausse est notifiée par e-mail au moins 30 jours avant son application à une formule en
        cours ; le Client peut résilier avant cette date.
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">5. Commande et paiement</h2>
      <p>
        Le paiement se fait par carte bancaire sur la page sécurisée de Stripe, prestataire de paiement du Vendeur ; ErgoBilan n'a jamais
        accès aux données de la carte. Une formule est payable d'avance chaque mois, à la date anniversaire de la souscription, par
        prélèvement automatique sur la carte enregistrée. Un achat à l'unité est payé à la commande. Chaque paiement donne lieu à une
        facture envoyée par e-mail et consultable dans l'espace de gestion de l'abonnement.
      </p>
      <p className="mt-2">
        En cas d'échec d'un paiement, Stripe procède à de nouvelles tentatives. Tant que le paiement n'a pas abouti, les crédits du mois ne
        sont pas renouvelés ; les crédits restants restent utilisables. Si les tentatives échouent, la formule est résiliée.
      </p>
      <p className="mt-2 text-xs text-[var(--text-secondary)]">
        Toute somme non payée à l'échéance porte intérêt au taux de trois fois le taux d'intérêt légal, et donne lieu à une indemnité
        forfaitaire pour frais de recouvrement de 40 € (article L441-10 du Code de commerce).
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">6. Changement de formule</h2>
      <p>
        Le Client change de formule depuis l'espace de gestion de son abonnement. Le passage à une formule supérieure est immédiat : la
        différence de prix pour le mois en cours est facturée au prorata et la différence de crédits du mois est ajoutée aussitôt. Le
        passage à une formule inférieure prend effet au renouvellement suivant.
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">7. Durée et résiliation</h2>
      <p>
        Les formules sont sans engagement de durée. Le Client résilie à tout moment depuis l'espace de gestion de son abonnement ; la
        résiliation prend effet à la fin du mois déjà payé, sans remboursement au prorata. Jusque-là, les crédits du mois restent
        utilisables. Les crédits achetés sont conservés après la résiliation.
      </p>
      <p className="mt-2">
        Les sommes versées ne sont pas remboursables, sauf erreur de facturation. Le service étant acheté pour l'exercice d'une activité
        professionnelle, les dispositions du Code de la consommation relatives au droit de rétractation ne s'appliquent pas. La suppression
        du compte met fin à la formule et entraîne la perte des crédits restants.
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">8. Responsabilité</h2>
      <p>
        Les textes rédigés par l'IA sont des propositions que le Client relit, corrige et valide sous sa seule responsabilité
        professionnelle. La responsabilité du Vendeur, toutes causes confondues, est limitée aux sommes payées par le Client au cours des
        douze mois précédant le fait générateur.
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">9. Droit applicable et litiges</h2>
      <p>
        Les présentes CGV sont soumises au droit français. En cas de litige, les parties recherchent d'abord une solution amiable ; à
        défaut, les tribunaux du ressort de Brest sont seuls compétents.
      </p>
    </section>
  </div>
);

// ─── Contenu Politique de Confidentialité ─────────────────────────────────────

const PrivacyContent: React.FC = () => (
  <div className="prose prose-sm max-w-none text-[var(--text-main)] space-y-6">
    <p className="text-xs text-[var(--text-secondary)]">Version en vigueur au 12 octobre 2026 — conforme au RGPD (UE) 2016/679</p>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">1. Responsable de traitement</h2>
      <p>
        <Publisher />.
      </p>
      <p className="mt-2">
        Contact pour vos données personnelles : <Mail to="privacy" />
      </p>
      <p className="mt-2 text-xs text-[var(--text-secondary)] bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3">
        <strong>Important :</strong> ErgoBilan est responsable de traitement uniquement pour les données de compte des praticiens (email,
        nom, SIRET). Les données relatives aux patients sont traitées exclusivement sur le poste du praticien et relèvent de sa propre
        responsabilité de traitement.
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">2. Données collectées par ErgoBilan</h2>
      <p>ErgoBilan collecte uniquement les données nécessaires à la fourniture du service :</p>
      <div className="overflow-x-auto mt-3">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-[var(--card-bg-raised)]">
              <th className="border border-[var(--border-color)] p-2 text-left">Catégorie</th>
              <th className="border border-[var(--border-color)] p-2 text-left">Données</th>
              <th className="border border-[var(--border-color)] p-2 text-left">Finalité</th>
              <th className="border border-[var(--border-color)] p-2 text-left">Durée</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-[var(--border-color)] p-2 font-medium">Compte</td>
              <td className="border border-[var(--border-color)] p-2">Email, nom, prénom, téléphone, SIRET, adresse cabinet</td>
              <td className="border border-[var(--border-color)] p-2">Authentification, facturation, affichage sur les bilans</td>
              <td className="border border-[var(--border-color)] p-2">Durée du compte + 3 ans</td>
            </tr>
            <tr className="bg-[var(--card-bg-raised)]/50">
              <td className="border border-[var(--border-color)] p-2 font-medium">Abonnement</td>
              <td className="border border-[var(--border-color)] p-2">
                Formule, crédits, log de génération IA (sans contenu), identifiants client et abonnement Stripe
              </td>
              <td className="border border-[var(--border-color)] p-2">Facturation, anti-abus, statistiques agrégées</td>
              <td className="border border-[var(--border-color)] p-2">5 ans (obligation comptable)</td>
            </tr>
            <tr>
              <td className="border border-[var(--border-color)] p-2 font-medium">Portail famille</td>
              <td className="border border-[var(--border-color)] p-2">Questionnaire chiffré E2EE (contenu illisible par ErgoBilan)</td>
              <td className="border border-[var(--border-color)] p-2">Transit sécurisé vers le praticien</td>
              <td className="border border-[var(--border-color)] p-2">72h (purge automatique)</td>
            </tr>
            <tr className="bg-[var(--card-bg-raised)]/50">
              <td className="border border-[var(--border-color)] p-2 font-medium">Logs techniques</td>
              <td className="border border-[var(--border-color)] p-2">
                User-agent, identifiant technique du compte, erreurs et parcours technique, relecture de session en cas d'erreur avec textes
                et saisies masqués, retours envoyés par le bouton « Signaler » (message, e-mail facultatif en démo) (Sentry)
              </td>
              <td className="border border-[var(--border-color)] p-2">Sécurité, débogage, amélioration du service</td>
              <td className="border border-[var(--border-color)] p-2">90 jours</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">3. Données NON collectées par ErgoBilan</h2>
      <p>
        Les données suivantes restent stockées <strong>exclusivement sur le poste du praticien</strong> (IndexedDB) et ne transitent jamais
        par les serveurs d'ErgoBilan :
      </p>
      <ul className="list-disc ml-5 mt-2 space-y-1">
        <li>Identité des patients (nom, prénom, date de naissance, coordonnées)</li>
        <li>Résultats de tests cliniques</li>
        <li>Observations et notes cliniques</li>
        <li>Comptes-rendus et bilans générés</li>
        <li>Brouillons en cours de rédaction</li>
      </ul>
      <p className="mt-2">
        Les données transmises à l'IA Gemini sont préalablement pseudonymisées côté client et ne contiennent aucune information nominative.
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">4. Base légale du traitement</h2>
      <ul className="list-disc ml-5 space-y-1">
        <li>
          <strong>Exécution du contrat</strong> (art. 6.1.b RGPD) : données de compte, abonnement.
        </li>
        <li>
          <strong>Intérêt légitime</strong> (art. 6.1.f RGPD) : logs de sécurité, prévention des abus.
        </li>
        <li>
          <strong>Obligation légale</strong> (art. 6.1.c RGPD) : conservation des données de facturation (art. L123-22 Code de commerce).
        </li>
      </ul>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">5. Sous-traitants et transferts</h2>
      <div className="overflow-x-auto mt-3">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-[var(--card-bg-raised)]">
              <th className="border border-[var(--border-color)] p-2 text-left">Sous-traitant</th>
              <th className="border border-[var(--border-color)] p-2 text-left">Pays / Région</th>
              <th className="border border-[var(--border-color)] p-2 text-left">Données traitées</th>
              <th className="border border-[var(--border-color)] p-2 text-left">Garanties</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-[var(--border-color)] p-2 font-medium">Supabase Inc.</td>
              <td className="border border-[var(--border-color)] p-2">UE (AWS eu-west-1, Irlande)</td>
              <td className="border border-[var(--border-color)] p-2">Compte praticien, abonnement, portail E2EE</td>
              <td className="border border-[var(--border-color)] p-2">DPA signé, SCCs</td>
            </tr>
            <tr className="bg-[var(--card-bg-raised)]/50">
              <td className="border border-[var(--border-color)] p-2 font-medium">Google LLC (Gemini API)</td>
              <td className="border border-[var(--border-color)] p-2">USA (SCCs)</td>
              <td className="border border-[var(--border-color)] p-2">Texte pseudonymisé uniquement</td>
              <td className="border border-[var(--border-color)] p-2">DPA Google, SCCs</td>
            </tr>
            <tr>
              <td className="border border-[var(--border-color)] p-2 font-medium">Stripe Payments Europe Ltd.</td>
              <td className="border border-[var(--border-color)] p-2">UE (Irlande)</td>
              <td className="border border-[var(--border-color)] p-2">
                E-mail, nom et adresse de facturation, carte bancaire (saisie chez Stripe, jamais transmise à ErgoBilan), factures
              </td>
              <td className="border border-[var(--border-color)] p-2">DPA Stripe, RGPD</td>
            </tr>
            <tr className="bg-[var(--card-bg-raised)]/50">
              <td className="border border-[var(--border-color)] p-2 font-medium">Sentry (Functional Software)</td>
              <td className="border border-[var(--border-color)] p-2">UE (ingest.de.sentry.io)</td>
              <td className="border border-[var(--border-color)] p-2">Journaux d'erreurs pseudonymisés, relecture de session masquée</td>
              <td className="border border-[var(--border-color)] p-2">DPA Sentry, RGPD</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-[var(--text-secondary)]">Aucun transfert de données patients vers des pays tiers n'a lieu.</p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">6. Vos droits</h2>
      <p>Conformément aux articles 15 à 22 du RGPD, vous disposez des droits suivants concernant vos données de compte :</p>
      <ul className="list-disc ml-5 mt-2 space-y-1">
        <li>
          <strong>Droit d'accès</strong> : obtenir une copie de vos données ;
        </li>
        <li>
          <strong>Droit de rectification</strong> : corriger des données inexactes ;
        </li>
        <li>
          <strong>Droit à l'effacement</strong> : demander la suppression de votre compte ;
        </li>
        <li>
          <strong>Droit à la portabilité</strong> : recevoir vos données dans un format structuré ;
        </li>
        <li>
          <strong>Droit d'opposition</strong> : vous opposer au traitement fondé sur l'intérêt légitime ;
        </li>
        <li>
          <strong>Droit à la limitation</strong> : restreindre le traitement de vos données.
        </li>
      </ul>
      <p className="mt-3">
        Pour exercer ces droits : <Mail to="privacy" />. Nous nous engageons à répondre dans un délai d'un mois (art. 12 RGPD).
      </p>
      <p className="mt-2">
        Vous pouvez également introduire une réclamation auprès de la <strong>CNIL</strong> (
        <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] underline">
          www.cnil.fr
        </a>
        ).
      </p>
      <p className="mt-2 text-xs text-[var(--text-secondary)]">
        Pour les données patients stockées localement sur votre poste : adressez-vous directement au praticien qui vous suit, responsable de
        traitement de vos données.
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">7. Cookies et stockage local</h2>
      <p>
        ErgoBilan n'utilise <strong>pas de cookies de traçage ou publicitaires</strong>.
      </p>
      <ul className="list-disc ml-5 mt-2 space-y-1">
        <li>
          <strong>localStorage / sessionStorage</strong> : session d'authentification Supabase (JWT).
        </li>
        <li>
          <strong>IndexedDB</strong> : données patients stockées localement (sous contrôle exclusif du praticien).
        </li>
      </ul>
      <p className="mt-2">
        Ces stockages sont strictement nécessaires au fonctionnement du service (base légale : intérêt légitime / nécessité contractuelle).
        Aucun bandeau cookie n'est requis.
      </p>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">8. Sécurité</h2>
      <ul className="list-disc ml-5 space-y-1">
        <li>Transport chiffré HTTPS/TLS 1.3 pour toutes les communications serveur ;</li>
        <li>Authentification Supabase avec hachage de mot de passe (bcrypt) ;</li>
        <li>PIN local dérivé via PBKDF2 (600 000 itérations, SHA-256) pour le verrouillage de session ;</li>
        <li>Chiffrement de bout en bout AES-GCM pour les questionnaires portail famille ;</li>
        <li>Aucune donnée patient stockée côté serveur.</li>
      </ul>
    </section>

    <section>
      <h2 className="text-base font-bold text-[var(--text-heading)] mb-2">9. Modifications</h2>
      <p>
        La présente politique peut être mise à jour. Les modifications substantielles seront notifiées par email. La version en vigueur est
        toujours accessible depuis la page d'accueil.
      </p>
    </section>
  </div>
);

// ─── Modal ────────────────────────────────────────────────────────────────────

export const LegalModal: React.FC<LegalModalProps> = ({ initialTab = 'cgu', onClose }) => {
  const [activeTab, setActiveTab] = useState<LegalTab>(initialTab);

  return (
    <div className="fixed inset-0 z-[300] bg-[#3D405B]/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-[var(--card-bg)] rounded-[32px] w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl border border-[var(--border-color)] animate-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-6 border-b border-[var(--border-color)] shrink-0">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('cgu')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                activeTab === 'cgu'
                  ? 'bg-[var(--secondary)] text-white shadow-md'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
              }`}
            >
              <FileText size={14} /> Conditions Générales
            </button>
            <button
              onClick={() => setActiveTab('cgv')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                activeTab === 'cgv'
                  ? 'bg-[var(--secondary)] text-white shadow-md'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
              }`}
            >
              <Receipt size={14} /> Conditions de Vente
            </button>
            <button
              onClick={() => setActiveTab('privacy')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                activeTab === 'privacy'
                  ? 'bg-[var(--secondary)] text-white shadow-md'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
              }`}
            >
              <ShieldCheck size={14} /> Confidentialité
            </button>
          </div>
          <button
            onClick={onClose}
            className="p-2 bg-[var(--hover-bg)] rounded-full hover:bg-[var(--border-color)] text-[var(--text-light)] transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-8 py-6">
          {activeTab === 'cgu' ? <CGUContent /> : activeTab === 'cgv' ? <CGVContent /> : <PrivacyContent />}
        </div>

        {/* Footer */}
        <div className="px-8 py-4 border-t border-[var(--border-color)] shrink-0 text-center">
          <button
            onClick={onClose}
            className="px-8 py-3 bg-[var(--secondary)] text-white rounded-xl font-bold text-sm hover:bg-[#2c2e42] transition-all"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
