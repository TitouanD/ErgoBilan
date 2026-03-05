# ErgoBilan

Application web clinique pour ergothérapeutes pédiatriques, permettant l'automatisation de la rédaction de bilans avec assistance IA.

## Fonctionnalités

- **Gestion des patients** — création, archivage, tableau de bord avec recherche rapide
- **Passation de tests** — catalogue unifié de tests standardisés (MABC-2, VMI, etc.) avec scoring automatique et normes intégrées
- **Génération de rapports IA** — rédaction assistée par Gemini, avec anonymisation automatique avant envoi et réhydratation des données après
- **Export PDF** — rendu de rapport structuré via `@react-pdf/renderer`
- **Portail patient** — lien de questionnaire partageable avec chiffrement par URL hash
- **Mode démo** — exploration complète sans compte, sans effet de bord sur la base de données
- **Panneau admin** — gestion des utilisateurs, bibliothèque de normes, monitoring

## Architecture

```
Vite + React 19 + TypeScript  (SPA, pas de react-router)
Supabase                       (auth, RLS, stockage relationnel)
Chiffrement client-side        (AES-GCM, hiérarchie MasterKey → OrgKey → FileKey)
Google Gemini                  (génération de rapports)
```

Le backend est **aveugle** : toutes les données personnelles (identité patient, résultats) sont chiffrées côté client avant persistance. Supabase ne voit que des blobs chiffrés.

## Structure du projet

```
App.tsx                     # Composition racine + routeur interne (mode: landing/dashboard/assessment/portal/admin)
index.tsx                   # Point d'entrée React
contexts/                   # AuthContext, AssessmentContext, CatalogContext, ToastContext, ThemeContext
components/
  assessment/               # Stepper (Step1–Step5), PdfDocument, ReportView
  dashboard/                # Dashboard, PatientDetail, CommandPalette
  auth/                     # AuthWizard, PinUnlock, OnboardingExperience
  admin/                    # AdminPanel et sous-vues
  portal/                   # PatientPortal (questionnaire partagé)
  shared/                   # Composants utilitaires
services/
  db.ts                     # Client Supabase
  storage.ts                # Chiffrement/déchiffrement + persistance
  ai.ts                     # Appels Gemini
  scoringEngine.ts          # Calcul des scores et normes
  subscription.ts           # Gestion des crédits IA
utils/
  crypto.ts                 # Hiérarchie de clés, AES-GCM
  anonymizer.ts             # Anonymisation avant IA / réhydratation après
  scoring.ts                # Conversions de scores
supabase/
  functions/                # Edge Functions (generate, signup, extract-norms)
  migrations/               # Migrations SQL
```

## Démarrage local

### Prérequis

- Node.js ≥ 18
- Un projet Supabase (URL + clé anon)
- Une clé API Google Gemini

### Installation

```bash
npm install
```

### Variables d'environnement

Créer un fichier `.env.local` à la racine :

```env
VITE_SUPABASE_URL=https://<votre-projet>.supabase.co
VITE_SUPABASE_ANON_KEY=<votre-clé-anon>
API_KEY=<votre-clé-gemini>
```

### Lancer en développement

```bash
npm run dev
```

### Build de production

```bash
npm run build
npm run preview
```

## Tests

```bash
npm test           # exécution unique
npm run test:watch # mode watch
```

## Sécurité & vie privée

- Aucune donnée patient n'est transmise en clair au serveur
- L'IA reçoit uniquement des données anonymisées (pseudonymes) — les identifiants réels sont réhydratés localement après génération
- Le statut d'archivage est stocké dans le blob chiffré (pas de colonne claire)
- Les liens de questionnaire portail utilisent une clé dans le hash URL (non transmis au serveur)

## Licence

Propriétaire — usage interne.
