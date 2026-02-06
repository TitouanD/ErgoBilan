
# Documentation du Schéma de Base de Données (Supabase)

**Date de génération :** 26 Octobre 2023
**Source :** Introspection SQL (CSV Dump)

Ce document référence la structure actuelle de la base de données, les politiques de sécurité (RLS), les fonctions stockées et les déclencheurs (triggers).

## 1. Structure des Tables

### `contribution_insights`
*Stockage des données anonymisées pour les statistiques et le crowdsourcing.*
| Colonne | Type | Contraintes |
| :--- | :--- | :--- |
| `id` | uuid | NOT NULL DEFAULT gen_random_uuid() |
| `source_hash` | text | NOT NULL |
| `test_id` | text | NOT NULL |
| `subtest_id` | text | NOT NULL |
| `age_months` | integer | NOT NULL |
| `gender` | text | NULL |
| `raw_score` | numeric | NULL |
| `computed_standard` | numeric | NULL |
| `computed_percentile` | numeric | NULL |
| `diagnostic_tag` | text | NULL |
| `is_clinical` | boolean | NULL DEFAULT false |
| `created_at` | timestamp with time zone | NULL DEFAULT now() |

### `drafts`
*Stockage temporaire (brouillons) chiffré des évaluations en cours.*
| Colonne | Type | Contraintes |
| :--- | :--- | :--- |
| `id` | uuid | NOT NULL DEFAULT gen_random_uuid() |
| `user_id` | uuid | NOT NULL |
| `patient_id` | uuid | NULL |
| `iv` | text | NOT NULL |
| `encrypted_data` | text | NOT NULL |
| `updated_at` | timestamp with time zone | NULL DEFAULT now() |

### `official_tests` (Catalogue)
*Définitions des tests (WISC, MABC, etc.).*
| Colonne | Type | Contraintes |
| :--- | :--- | :--- |
| `id` | text | NOT NULL |
| `name` | text | NOT NULL |
| `category_id` | text | NOT NULL |
| `version` | text | NULL |
| `author` | text | NULL |
| `organization_id` | uuid | NULL (NULL = Public) |
| `created_at` | timestamp with time zone | NULL DEFAULT now() |

### `official_subtests` (Catalogue)
*Sous-épreuves associées aux tests.*
| Colonne | Type | Contraintes |
| :--- | :--- | :--- |
| `id` | text | NOT NULL |
| `test_id` | text | NOT NULL |
| `name` | text | NOT NULL |
| `unit` | text | NULL |
| `score_type` | text | NOT NULL |
| `computation_mode` | text | NULL DEFAULT 'PARAMETRIC' |
| `organization_id` | uuid | NULL |
| `created_at` | timestamp with time zone | NULL DEFAULT now() |

### `official_norms` (Catalogue)
*Données d'étalonnage (Moyennes/ET ou Tables de conversion).*
| Colonne | Type | Contraintes |
| :--- | :--- | :--- |
| `id` | uuid | NOT NULL DEFAULT gen_random_uuid() |
| `subtest_id` | text | NOT NULL |
| `organization_id` | uuid | NULL |
| `age_min_months` | integer | NULL |
| `age_max_months` | integer | NULL |
| `gender` | text | NULL |
| `raw_min` | real | NULL |
| `raw_max` | real | NULL |
| `mean` | real | NULL |
| `sd` | real | NULL |
| `standard_score` | real | NULL |
| `percentile` | real | NULL |

### `organizations`
*Cabinets ou structures de soins.*
| Colonne | Type | Contraintes |
| :--- | :--- | :--- |
| `id` | uuid | NOT NULL DEFAULT gen_random_uuid() |
| `name` | text | NOT NULL DEFAULT 'Mon Cabinet' |
| `stripe_customer_id` | text | NULL |
| `created_at` | timestamp with time zone | NULL DEFAULT now() |

### `organization_members`
*Lien Utilisateur <-> Organisation (Gestion des droits et clés chiffrées).*
| Colonne | Type | Contraintes |
| :--- | :--- | :--- |
| `organization_id` | uuid | NOT NULL |
| `user_id` | uuid | NOT NULL |
| `role` | text | NULL DEFAULT 'owner' |
| `encrypted_org_key` | text | NULL |
| `joined_at` | timestamp with time zone | NULL DEFAULT now() |

### `patients`
*Dossiers patients (Données chiffrées E2EE).*
| Colonne | Type | Contraintes |
| :--- | :--- | :--- |
| `id` | uuid | NOT NULL DEFAULT gen_random_uuid() |
| `organization_id` | uuid | NOT NULL |
| `encrypted_file_key` | text | NULL |
| `encrypted_identity` | text | NOT NULL |
| `iv` | text | NOT NULL |
| `encrypted_preview` | text | NULL |
| `preview_iv` | text | NULL |
| `last_interaction` | timestamp with time zone | NULL DEFAULT now() |
| `created_at` | timestamp with time zone | NULL DEFAULT now() |
| `updated_at` | timestamp with time zone | NULL DEFAULT now() |

### `practitioners`
*Profils utilisateurs étendus (liés à auth.users).*
| Colonne | Type | Contraintes |
| :--- | :--- | :--- |
| `id` | uuid | NOT NULL |
| `email` | text | NOT NULL |
| `first_name` | text | NULL |
| `last_name` | text | NULL |
| `phone_pro` | text | NULL |
| `address_pro` | text | NULL |
| `siret` | text | NULL |
| `credits` | integer | NULL DEFAULT 3 |
| `is_admin` | boolean | NULL DEFAULT false |
| `encryption_salt` | text | NOT NULL DEFAULT 'pending' |
| `encryption_validator` | text | NOT NULL DEFAULT 'pending' |
| `created_at` | timestamp with time zone | NULL DEFAULT now() |

### `reports`
*Rapports générés (Chiffrés).*
| Colonne | Type | Contraintes |
| :--- | :--- | :--- |
| `id` | uuid | NOT NULL DEFAULT gen_random_uuid() |
| `patient_id` | uuid | NOT NULL |
| `user_id` | uuid | NOT NULL |
| `type` | text | NOT NULL |
| `status` | text | NOT NULL |
| `iv` | text | NOT NULL |
| `encrypted_content` | text | NOT NULL |
| `created_at` | timestamp with time zone | NULL DEFAULT now() |

### `sessions`
*Sessions de tests (Scores chiffrés).*
| Colonne | Type | Contraintes |
| :--- | :--- | :--- |
| `id` | uuid | NOT NULL DEFAULT gen_random_uuid() |
| `patient_id` | uuid | NOT NULL |
| `user_id` | uuid | NOT NULL |
| `test_id` | text | NOT NULL |
| `test_name` | text | NULL |
| `date` | timestamp with time zone | NULL DEFAULT now() |
| `iv` | text | NOT NULL |
| `encrypted_results` | text | NOT NULL |

### `subscriptions`
*Gestion des abonnements.*
| Colonne | Type | Contraintes |
| :--- | :--- | :--- |
| `id` | uuid | NOT NULL DEFAULT gen_random_uuid() |
| `user_id` | uuid | NOT NULL |
| `plan_id` | text | NOT NULL DEFAULT 'free' |
| `status` | text | NOT NULL DEFAULT 'trialing' |
| `trial_ends_at` | timestamp with time zone | NULL DEFAULT (now() + '30 days'::interval) |
| `current_period_end` | timestamp with time zone | NULL |
| `created_at` | timestamp with time zone | NULL DEFAULT now() |

### `pending_questionnaires`
*Portail Famille (Zone tampon).*
| Colonne | Type | Contraintes |
| :--- | :--- | :--- |
| `id` | uuid | NOT NULL DEFAULT gen_random_uuid() |
| `practitioner_id` | uuid | NOT NULL |
| `organization_id` | uuid | NULL |
| `label` | text | NULL |
| `status` | text | NULL DEFAULT 'pending' |
| `practitioner_encrypted_key` | text | NOT NULL |
| `family_encrypted_data` | text | NULL |
| `created_at` | timestamp with time zone | NULL DEFAULT now() |

---

## 2. Sécurité (Row Level Security - RLS)

### `practitioners`
*   **Users can manage own profile:** `auth.uid() = id`

### `organizations` & `organization_members`
*   **Access own orgs:** L'utilisateur doit être listé dans `organization_members`.
*   **View own membership:** `user_id = auth.uid()`

### `patients`, `reports`, `sessions`
*   **Access via organization:** L'utilisateur peut accéder si `patient.organization_id` correspond à une organisation dont il est membre.
    *   *Query:* `organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())`

### `drafts`
*   **Private:** `user_id = auth.uid()`

### `pending_questionnaires`
*   **Practitioner Access:** `practitioner_id = auth.uid()` ET check organisation.
*   **Public Family Access:** Ouvert aux anonymes (`anon`) pour permettre aux familles de répondre (sécurisé par UUID et clé de chiffrement côté client).

### `official_tests`, `official_subtests`, `official_norms` (Catalogue)
*   **View Mixed:**
    *   Si `organization_id` est NULL (Test Public).
    *   OU si `organization_id` correspond à l'utilisateur (Test Privé).
*   **Manage Own:** Modification autorisée uniquement pour ses propres tests privés.

### `contribution_insights`
*   **Admin Analysis:** `is_admin = true` pour lire.
*   **Anonymous Deposit:** `INSERT` autorisé pour tous les authentifiés.

---

## 3. Fonctions Stockées (RPC)

### `handle_new_user()`
*Trigger sur `auth.users` (INSERT).*
1. Crée l'entrée `practitioners`.
2. Crée une organisation par défaut "Mon Cabinet".
3. Crée l'abonnement "Free Trial".
4. Lie l'utilisateur à l'organisation comme "Owner".

### `consume_credit()`
*RPC sécurisée appelée par le client.*
*   Vérifie si `credits > 0`.
*   Décrémente `credits`.
*   Retourne `TRUE` si succès, `FALSE` sinon.

### `check_paid_access()`
*Fonction utilitaire.*
*   Vérifie si l'abonnement est actif ou si la période d'essai est valide.

### `enforce_practitioner_defaults()`
*Trigger sur `practitioners`.*
*   Empêche la modification manuelle des champs sensibles (`credits`, `is_admin`) via une requête UPDATE standard.
*   Force l'initialisation des crédits à 3 à la création.

---

## 4. Triggers

*   `on_auth_user_created` -> Exécute `handle_new_user()` après création du compte.
*   `on_practitioner_save` -> Exécute `enforce_practitioner_defaults()` avant INSERT/UPDATE.
*   `on_subscription_insert` -> Exécute `enforce_subscription_defaults()` pour forcer le statut 'trialing'.
*   `prevent_sensitive_updates` -> Bloque les updates directs sur les colonnes critiques.
