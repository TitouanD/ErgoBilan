
# Documentation du Schéma de Base de Données (Supabase)

**Source de Vérité :** Export CSV Système
**Mise à jour :** Post-Refactoring v1.6.1

Ce document référence la structure exacte de la base de données telle qu'elle est déployée et utilisée par l'application.

## 1. Tables & Vues (Structure)

### `admin_candidates_promotion` (Table/Vue)
*File d'attente pour la modération des tests communautaires.*
| Colonne | Type | Notes |
| :--- | :--- | :--- |
| `id` | text | ID du test |
| `name` | text | Nom du test |
| `author` | text | Email auteur |
| `organization_id` | uuid | Org source |
| `subtest_count` | bigint | Nombre d'épreuves |
| `created_at` | timestamp | |

### `contribution_insights`
*Stockage des données anonymisées pour les statistiques.*
| Colonne | Type | Default |
| :--- | :--- | :--- |
| `id` | uuid | `gen_random_uuid()` |
| `source_hash` | text | Hash session anonyme |
| `test_id` | text | |
| `subtest_id` | text | |
| `age_months` | integer | |
| `gender` | text | |
| `raw_score` | numeric | |
| `computed_standard` | numeric | |
| `computed_percentile` | numeric | |
| `diagnostic_tag` | text | |
| `is_clinical` | boolean | `false` |
| `created_at` | timestamp | `now()` |

### `drafts`
*Brouillons de travail (État volatil).*
| Colonne | Type | Notes |
| :--- | :--- | :--- |
| `id` | uuid | PK |
| `user_id` | uuid | Owner |
| `patient_id` | uuid | Nullable (si création) |
| `iv` | text | Vecteur init |
| `encrypted_data` | text | Blob complet (JSON) |
| `updated_at` | timestamp | |

### `official_norms`
*Étalonnages (Moyennes/ET ou Tables).*
| Colonne | Type | Notes |
| :--- | :--- | :--- |
| `id` | uuid | PK |
| `subtest_id` | text | FK |
| `organization_id` | uuid | NULL = Public |
| `age_min_months` | integer | |
| `age_max_months` | integer | |
| `gender` | text | 'M', 'F', 'Mixed' |
| `raw_min` | real | Pour Lookup |
| `raw_max` | real | Pour Lookup |
| `mean` | real | Pour Paramétrique |
| `sd` | real | Pour Paramétrique |
| `standard_score` | real | Resultat (NS) |
| `percentile` | real | Resultat (%) |

### `official_subtests`
*Définition des épreuves.*
| Colonne | Type | Notes |
| :--- | :--- | :--- |
| `id` | text | PK |
| `test_id` | text | FK |
| `name` | text | |
| `unit` | text | |
| `score_type` | text | 'standard', 'scaled', etc. |
| `computation_mode` | text | 'PARAMETRIC' ou 'LOOKUP' |
| `organization_id` | uuid | |

### `official_tests`
*Catalogue des tests.*
| Colonne | Type | Notes |
| :--- | :--- | :--- |
| `id` | text | PK |
| `name` | text | |
| `category_id` | text | |
| `version` | text | |
| `author` | text | |
| `organization_id` | uuid | NULL = Public |

### `organizations`
| Colonne | Type | Default |
| :--- | :--- | :--- |
| `id` | uuid | PK |
| `name` | text | 'Mon Cabinet' |
| `stripe_customer_id` | text | |

### `organization_members`
| Colonne | Type | Notes |
| :--- | :--- | :--- |
| `organization_id` | uuid | FK |
| `user_id` | uuid | FK |
| `role` | text | 'owner' |
| `encrypted_org_key` | text | Clé partagée chiffrée |
| `joined_at` | timestamp | |

### `patients`
*Dossiers (Identité chiffrée). Ne contient PAS les résultats ni les rapports.*
| Colonne | Type | Notes |
| :--- | :--- | :--- |
| `id` | uuid | PK |
| `organization_id` | uuid | FK |
| `encrypted_identity` | text | **Blob Identité** (+ flag archived) |
| `iv` | text | |
| `encrypted_preview` | text | (Legacy/Opt) |
| `preview_iv` | text | (Legacy/Opt) |
| `encrypted_file_key` | text | (Legacy/Opt) |
| `last_interaction` | timestamp | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `pending_questionnaires`
*Portail Famille.*
| Colonne | Type | Notes |
| :--- | :--- | :--- |
| `id` | uuid | PK (Token URL) |
| `practitioner_id` | uuid | FK |
| `organization_id` | uuid | FK |
| `label` | text | |
| `status` | text | 'pending' |
| `practitioner_encrypted_key` | text | Clé transmise |
| `family_encrypted_data` | text | Réponse famille |

### `practitioners`
*Profil métier.*
| Colonne | Type | Notes |
| :--- | :--- | :--- |
| `id` | uuid | PK (Auth ID) |
| `email` | text | |
| `credits` | integer | Solde IA |
| `is_admin` | boolean | |
| `encryption_salt` | text | Sécurité |
| `encryption_validator` | text | Sécurité |
| `first_name` | text | |
| `last_name` | text | |
| `siret` | text | |
| `address_pro` | text | |
| `phone_pro` | text | |

### `reports`
*Textes générés (Architecture Relationnelle).*
| Colonne | Type | Notes |
| :--- | :--- | :--- |
| `id` | uuid | PK |
| `patient_id` | uuid | FK |
| `user_id` | uuid | FK |
| `type` | text | 'initial', 'reeval' |
| `status` | text | |
| `encrypted_content` | text | Blob Sections |
| `iv` | text | |

### `sessions`
*Données brutes des tests (Architecture Relationnelle).*
| Colonne | Type | Notes |
| :--- | :--- | :--- |
| `id` | uuid | PK |
| `patient_id` | uuid | FK |
| `user_id` | uuid | FK |
| `test_id` | text | |
| `test_name` | text | |
| `date` | timestamp | |
| `encrypted_results` | text | Blob Scores |
| `iv` | text | |

### `subscriptions`
| Colonne | Type | Notes |
| :--- | :--- | :--- |
| `id` | uuid | PK |
| `user_id` | uuid | FK |
| `plan_id` | text | 'free', 'essential', etc. |
| `status` | text | 'active', 'trialing' |
| `trial_ends_at` | timestamp | |

### `view_unified_catalog` (Vue)
*Vue agrégée des tests publics et privés de l'utilisateur courant.*

---

## 2. Sécurité (RLS Policies)

Les politiques Row Level Security appliquées :

*   **`contribution_insights`** :
    *   `Admin Read`: `check_is_admin()`
    *   `Deposit`: `INSERT` pour authenticated.
*   **`drafts`** :
    *   `Private`: `user_id = auth.uid()`
*   **`official_tests` / `subtests` / `norms`** :
    *   `Unified View`: Visible si `organization_id IS NULL` OU `check_is_member_of(organization_id)`.
    *   `Manage Own`: Update/Delete seulement si `check_is_member_of(organization_id)`.
    *   `Admin Global`: Update/Delete si `check_is_admin()`.
*   **`organizations`** :
    *   `Access Own`: Via `organization_members`.
*   **`patients` / `reports` / `sessions`** :
    *   `Org Access`: Visible si le patient appartient à une organisation dont l'utilisateur est membre.
*   **`pending_questionnaires`** :
    *   `Family Read`: `SELECT` pour `anon` (Public access via ID).
    *   `Family Update`: `UPDATE` pour `anon` (Soumission réponse).
    *   `Practitioner`: Full access si `practitioner_id = auth.uid()`.
*   **`practitioners`** :
    *   `Self`: `id = auth.uid()`.

---

## 3. Fonctions & Triggers (Server-Side)

### Fonctions
*   `check_is_admin()`: Vérifie le flag admin.
*   `check_is_member_of(org_id)`: Vérifie l'appartenance.
*   `check_paid_access()`: Vérifie abonnement/trial.
*   `consume_credit()`: Décrémente le solde de manière atomique.

### Triggers
*   `handle_new_user`: À la création du compte Auth -> Crée Praticien + Org + Sub.
*   `enforce_practitioner_defaults`: Empêche modif manuelle crédits/admin.
*   `enforce_subscription_defaults`: Force le plan 'free'/'trialing' par défaut.
*   `protect_practitioner_sensitive_data`: Sécurité supplémentaire sur `practitioners`.
*   `rls_auto_enable`: Active RLS automatiquement sur toute nouvelle table.
