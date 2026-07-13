-- Stripe webhook event-ordering guard.
--
-- Problem: subscription sync (stripe-webhook / sync-my-subscription) was
-- last-writer-wins. Stripe does NOT guarantee delivery order, so an older
-- customer.subscription.updated arriving after a newer one (or after
-- customer.subscription.deleted) could transiently resurrect a stale
-- entitlement until the next sync.
--
-- Fix: persist a monotonic per-subscription marker (the Stripe event's
-- `created` timestamp, or the fetch time for authoritative API reads) and make
-- the check-and-set ATOMIC at the DB level. Edge functions call
-- claim_stripe_subscription_event() BEFORE applying an event; a `false` return
-- means a newer event was already processed and the stale write must be
-- skipped.
--
-- RLS: this table is service-role-only plumbing (written exclusively by edge
-- functions using the service key). It carries no tenant data beyond a Stripe
-- subscription id, and is not readable by app users.

CREATE TABLE IF NOT EXISTS "public"."stripe_subscription_event_cursors" (
    "stripe_subscription_id" character varying(255) PRIMARY KEY,
    "last_event_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."stripe_subscription_event_cursors" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage subscription event cursors"
    ON "public"."stripe_subscription_event_cursors"
    USING (("auth"."role"() = 'service_role'::"text"))
    WITH CHECK (("auth"."role"() = 'service_role'::"text"));

-- Super admins may read the cursors for billing debugging (read-only).
CREATE POLICY "Super admins can read subscription event cursors"
    ON "public"."stripe_subscription_event_cursors"
    FOR SELECT USING ("public"."is_super_admin"());

REVOKE ALL ON TABLE "public"."stripe_subscription_event_cursors" FROM "anon";
GRANT SELECT ON TABLE "public"."stripe_subscription_event_cursors" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_subscription_event_cursors" TO "service_role";

-- Atomic check-and-set: advance the marker iff p_event_at is not older than
-- what is already recorded (<= tolerates same-second ties and event
-- redelivery — exact-duplicate deliveries are already deduped by
-- billing_webhook_events.stripe_event_id). The single INSERT ... ON CONFLICT
-- DO UPDATE ... WHERE is atomic under concurrency: two racing deliveries
-- serialize on the row and the stale one matches zero rows and returns false.
CREATE OR REPLACE FUNCTION "public"."claim_stripe_subscription_event"(
    "p_stripe_subscription_id" "text",
    "p_event_at" timestamp with time zone
) RETURNS boolean
    LANGUAGE "plpgsql"
    SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  claimed boolean;
BEGIN
  INSERT INTO stripe_subscription_event_cursors AS c
    (stripe_subscription_id, last_event_at, updated_at)
  VALUES (p_stripe_subscription_id, p_event_at, now())
  ON CONFLICT (stripe_subscription_id) DO UPDATE
    SET last_event_at = EXCLUDED.last_event_at,
        updated_at = now()
    WHERE c.last_event_at <= EXCLUDED.last_event_at
  RETURNING true INTO claimed;

  RETURN COALESCE(claimed, false);
END;
$$;

ALTER FUNCTION "public"."claim_stripe_subscription_event"("text", timestamp with time zone) OWNER TO "postgres";

-- Callable by edge functions (service role) only.
REVOKE ALL ON FUNCTION "public"."claim_stripe_subscription_event"("text", timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."claim_stripe_subscription_event"("text", timestamp with time zone) FROM "anon";
REVOKE ALL ON FUNCTION "public"."claim_stripe_subscription_event"("text", timestamp with time zone) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."claim_stripe_subscription_event"("text", timestamp with time zone) TO "service_role";
