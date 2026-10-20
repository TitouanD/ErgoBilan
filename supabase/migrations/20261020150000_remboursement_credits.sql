-- Remboursement ou litige d'un achat à l'unité (#107, accord de Titouan du 2026-10-20).
--
-- L'edge stripe-webhook reçoit charge.refunded et charge.dispute.created, retrouve l'achat à
-- l'unité payé par la charge (session Checkout) et appelle billing_remove_credits avec le
-- nombre total de crédits à retirer pour cette charge (part de la quantité achetée que paie le
-- montant remboursé ou contesté, arrondie à l'inférieur).
--
-- Idempotence sans nouvelle table : chaque crédit retiré est retenu dans billing_events sous
-- « <p_event_id>:<rang> » (p_event_id = « reversal:<charge> »). Un événement reçu deux fois,
-- un second remboursement partiel (montant cumulé) ou un litige après un remboursement ne
-- retirent que les crédits pas encore retirés pour cette charge.
--
-- Seuls les crédits achetés sont retirés, sans descendre sous 0 (déjà consommés : rien à
-- reprendre). Les crédits du mois et les formules ne sont pas touchés.
--
-- Compatibilité : nouvelle fonction ; main et les edges déployées ne l'appellent pas.
-- CREATE FUNCTION déclenche enforce_public_acl_on_ddl : les GRANT sont rejoués.

CREATE OR REPLACE FUNCTION public.billing_remove_credits(p_event_id text, p_customer_id text, p_count integer, p_user_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid;
  v_new integer := 0;
BEGIN
  IF p_count IS NULL OR p_count < 1 OR p_count > 100 THEN
    RAISE EXCEPTION 'billing_remove_credits: nombre invalide (%)', p_count;
  END IF;

  SELECT user_id INTO v_user_id FROM public.subscriptions WHERE id = public.billing_find_subscription(p_customer_id, p_user_id);
  IF v_user_id IS NULL THEN
    RETURN 'unknown_customer';
  END IF;

  FOR i IN 1..p_count LOOP
    IF public.billing_record_event(p_event_id || ':' || i, 'reversal') THEN
      v_new := v_new + 1;
    END IF;
  END LOOP;
  IF v_new = 0 THEN
    RETURN 'duplicate';
  END IF;

  PERFORM set_config('app.internal_operation', 'true', true);
  UPDATE public.practitioners SET credits = greatest(credits - v_new, 0) WHERE id = v_user_id;
  PERFORM set_config('app.internal_operation', 'false', true);
  RETURN 'applied';
END;
$function$;

REVOKE ALL ON FUNCTION public.billing_remove_credits(text, text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_remove_credits(text, text, integer, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
