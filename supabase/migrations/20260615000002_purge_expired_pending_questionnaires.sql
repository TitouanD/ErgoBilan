-- ============================================================
-- Purge automatique des pending_questionnaires expirés (> 72h)
--
-- Les questionnaires familles non traités après 72h sont supprimés
-- automatiquement. Cela limite l'exposition de données chiffrées
-- dans Supabase et satisfait au principe de minimisation (Art. 5 RGPD).
--
-- Pré-requis : extension pg_cron activée dans le projet Supabase
-- (Settings → Database → Extensions → pg_cron).
-- ============================================================

-- Index pour rendre le DELETE efficace (évite un seqscan)
CREATE INDEX IF NOT EXISTS idx_pq_created_at
  ON public.pending_questionnaires (created_at);

-- Active pg_cron si pas déjà fait (nécessite rôle postgres/superuser)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Purge toutes les heures les questionnaires 'pending' de plus de 72h
-- et les questionnaires 'processed' de plus de 24h (nettoyage post-import)
SELECT cron.schedule(
  'purge-expired-pending-questionnaires',
  '15 * * * *',   -- à hh:15 chaque heure (évite les pics d'heure ronde)
  $$
    DELETE FROM public.pending_questionnaires
    WHERE
      (status = 'pending'   AND created_at < NOW() - INTERVAL '72 hours')
      OR
      (status = 'processed' AND created_at < NOW() - INTERVAL '24 hours');
  $$
);
