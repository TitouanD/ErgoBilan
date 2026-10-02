-- Comptes orphelins (#64). À lancer en LECTURE ; le nettoyage (en commentaire en bas)
-- ne se lance qu'après relecture de la liste par Titouan.
--
-- Relevé le 2026-10-01 : auth.users 7, practitioners 5, organizations 9,
-- organization_members 5, subscriptions 5.
--   Organisations sans membre (aucun test, sous-test ni questionnaire rattaché) :
--     58163a62-b55d-410a-8dad-fe82eb5074ba  créée 2026-02-13 17:36
--     50e06912-3965-4216-b271-a187991561e6  créée 2026-02-17 08:52
--     107f2787-d6cd-400d-816d-7828ac03180b  créée 2026-02-22 11:31
--     6c317e20-0bb3-413b-ba52-c7e907dd44ce  créée 2026-02-22 17:39 (même instant que
--       le compte 39c499e3-… : créée par handle_new_user, membre perdu à la
--       suppression du praticien, la cascade ne remonte pas à l'organisation)
--   Comptes auth sans praticien (pas d'abonnement, pas d'ai_request_log) :
--     39c499e3-d4b3-44a2-ba1a-52ce74f75cd6  créé 2026-02-22, confirmé, dernière
--       connexion 2026-02-22, 3 lignes generation_log (2026-02-22)
--     7ad2ca90-6985-48ef-b61c-05b136418e1a  créé 2026-02-11, confirmé, dernière
--       connexion 2026-02-13, rien de rattaché
-- Aucun praticien sans organisation.

-- 1. Listage (identifiants et rattachements, pas d'e-mail)
SELECT 'org_sans_membre' AS kind, o.id, o.created_at,
       (SELECT count(*) FROM public.official_tests t WHERE t.organization_id = o.id) AS tests,
       (SELECT count(*) FROM public.official_subtests s WHERE s.organization_id = o.id) AS subtests,
       (SELECT count(*) FROM public.pending_questionnaires q WHERE q.organization_id = o.id) AS questionnaires,
       NULL::bigint AS generation_log, NULL::bigint AS ai_request_log, NULL::timestamptz AS last_sign_in_at
FROM public.organizations o
WHERE NOT EXISTS (SELECT 1 FROM public.organization_members m WHERE m.organization_id = o.id)
UNION ALL
SELECT 'auth_sans_praticien', u.id, u.created_at, NULL, NULL, NULL,
       (SELECT count(*) FROM public.generation_log g WHERE g.user_id = u.id),
       (SELECT count(*) FROM public.ai_request_log a WHERE a.user_id = u.id),
       u.last_sign_in_at
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.practitioners p WHERE p.id = u.id)
UNION ALL
SELECT 'praticien_sans_org', p.id, p.created_at, NULL, NULL, NULL, NULL, NULL, NULL
FROM public.practitioners p
WHERE NOT EXISTS (SELECT 1 FROM public.organization_members m WHERE m.user_id = p.id)
ORDER BY 1, 3;

-- 2. Nettoyage, APRÈS relecture et accord de Titouan. Ids figés : si le listage
--    ci-dessus a changé, mettre à jour les listes avant de lancer.
--
-- begin;
--
-- DELETE FROM public.organizations o
-- WHERE o.id IN ('58163a62-b55d-410a-8dad-fe82eb5074ba',
--                '50e06912-3965-4216-b271-a187991561e6',
--                '107f2787-d6cd-400d-816d-7828ac03180b',
--                '6c317e20-0bb3-413b-ba52-c7e907dd44ce')
--   AND NOT EXISTS (SELECT 1 FROM public.organization_members m WHERE m.organization_id = o.id);
-- -- attendu : DELETE 4
--
-- -- generation_log.user_id référence auth.users sans ON DELETE : à vider d'abord.
-- DELETE FROM public.generation_log g
-- WHERE g.user_id IN ('39c499e3-d4b3-44a2-ba1a-52ce74f75cd6',
--                     '7ad2ca90-6985-48ef-b61c-05b136418e1a')
--   AND NOT EXISTS (SELECT 1 FROM public.practitioners p WHERE p.id = g.user_id);
-- -- attendu : DELETE 3
--
-- DELETE FROM public.ai_request_log a
-- WHERE a.user_id IN ('39c499e3-d4b3-44a2-ba1a-52ce74f75cd6',
--                     '7ad2ca90-6985-48ef-b61c-05b136418e1a')
--   AND NOT EXISTS (SELECT 1 FROM public.practitioners p WHERE p.id = a.user_id);
-- -- attendu : DELETE 0
--
-- commit;
--
-- Les 2 comptes auth : de préférence par le tableau de bord (Authentication > Users >
-- Delete user), qui nettoie identités et sessions. À défaut, en SQL :
-- DELETE FROM auth.users u
-- WHERE u.id IN ('39c499e3-d4b3-44a2-ba1a-52ce74f75cd6',
--                '7ad2ca90-6985-48ef-b61c-05b136418e1a')
--   AND NOT EXISTS (SELECT 1 FROM public.practitioners p WHERE p.id = u.id);
-- -- attendu : DELETE 2
