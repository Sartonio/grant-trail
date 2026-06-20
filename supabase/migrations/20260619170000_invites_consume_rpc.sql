-- ============================================================================
-- D7 follow-up — consume invites via a token-scoped SECURITY DEFINER RPC
-- ============================================================================
-- D7 (`20260619140000_invites_token_scoped_read.sql`) revoked anon's direct
-- access to the `invites` table and routed reads through a token-scoped RPC.
--
-- But the complete-profile step still marked an invite consumed with a DIRECT
-- client write:
--     supabase.from('invites').update({ used_by, used_at }).eq('id', invite.id)
-- Post-D7 that updates 0 rows: PostgREST must first SELECT the target row, and a
-- freshly-authenticated grantee has NO SELECT policy on that invite (only the
-- tenant's admins can SELECT it). So invite consumption silently failed.
--
-- Fix (same principle as the read RPC): the client never writes the table
-- directly. A token-scoped SECURITY DEFINER function consumes the invite.
--
-- Abuse-resistance:
--   * Scoped strictly BY TOKEN (`token = p_token::uuid`) — the caller can only
--     ever consume the single invite whose unguessable token they hold; they
--     cannot target an arbitrary invite id.
--   * Only consumes an invite that is NOT already used (`used_at IS NULL`) — it
--     is idempotent/safe and won't re-stamp or hijack a consumed invite.
--   * Enforces `p_user_id = auth.uid()` — a caller cannot consume an invite on
--     behalf of some other user.
--   * EXECUTE granted only to `authenticated` (the post-auth complete-profile
--     step) and `service_role`; NOT to `anon`.
-- ============================================================================

CREATE OR REPLACE FUNCTION "public"."consume_invite"("p_token" "text", "p_user_id" "uuid")
    RETURNS boolean
    LANGUAGE "plpgsql" VOLATILE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated integer;
BEGIN
  -- A caller may only consume an invite on their OWN behalf.
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not allowed to consume an invite on behalf of another user';
  END IF;

  -- Hard-scoped by the unguessable token; only an unused invite is consumed.
  UPDATE public.invites
     SET used_by = p_user_id,
         used_at = now()
   WHERE token = p_token::uuid
     AND used_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

ALTER FUNCTION "public"."consume_invite"("p_token" "text", "p_user_id" "uuid") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."consume_invite"("p_token" "text", "p_user_id" "uuid") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."consume_invite"("p_token" "text", "p_user_id" "uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."consume_invite"("p_token" "text", "p_user_id" "uuid") TO "service_role";
