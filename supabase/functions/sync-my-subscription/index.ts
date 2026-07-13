import type Stripe from 'npm:stripe@18.1.1';
import { adminSupabase, corsHeaders, getOrCreateStripeCustomer, requireAuthenticatedProfile, stripe } from '../_shared/stripe-client.ts';
import { upsertSubscriptionFromStripe } from '../_shared/stripe-subscription-sync.ts';
import { assertPostRequest, AuthError, ValidationError } from '../_shared/validation.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    assertPostRequest(request);
    const { profile } = await requireAuthenticatedProfile(request.headers.get('Authorization'));

    // Pick the most relevant subscription on a customer: a live one, else the
    // most recent terminal one, else null.
    const pickPreferred = (subs: Stripe.Subscription[]) => {
      const sorted = [...subs].sort((a, b) => Number(b.created ?? 0) - Number(a.created ?? 0));
      return (
        sorted.find((sub) => ['active', 'trialing', 'past_due'].includes(sub.status)) ||
        sorted.find((sub) => ['canceled', 'incomplete', 'incomplete_expired', 'unpaid'].includes(sub.status)) ||
        null
      );
    };

    // ── Caller's own (per-user / basic) customer ─────────────────────────────
    const customerId = await getOrCreateStripeCustomer(profile);
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 20,
    });
    const preferred = pickPreferred(subscriptions.data);

    if (preferred) {
      await upsertSubscriptionFromStripe(preferred);
    } else {
      const { error: membershipClearError } = await adminSupabase
        .from('user_memberships')
        .update({ is_active: false, ends_at: new Date().toISOString() })
        .eq('user_id', profile.profileId);

      if (membershipClearError) {
        throw new Error(`Unable to clear membership status: ${membershipClearError.message}`);
      }
    }

    // ── Caller's TENANT-owned (premium org) customer, if one exists ──────────
    // A tenant customer is shared across admins, so sync it too — any admin can
    // reconcile the org plan. Idempotent; a tenant customer with nothing to sync
    // is a no-op and must not fail the whole call (the per-user sync above may
    // have already succeeded).
    let tenantSynced: { stripe_subscription_id: string; status: string } | null = null;
    if (profile.tenantId) {
      try {
        const { data: tenantCustomer } = await adminSupabase
          .from('billing_customers')
          .select('stripe_customer_id')
          .eq('tenant_id', profile.tenantId)
          .maybeSingle();

        if (tenantCustomer?.stripe_customer_id) {
          const tenantSubs = await stripe.subscriptions.list({
            customer: tenantCustomer.stripe_customer_id,
            status: 'all',
            limit: 20,
          });
          const tenantPreferred = pickPreferred(tenantSubs.data);
          if (tenantPreferred) {
            await upsertSubscriptionFromStripe(tenantPreferred);
            tenantSynced = { stripe_subscription_id: tenantPreferred.id, status: tenantPreferred.status };
          }
        }
      } catch (tenantSyncError) {
        // Don't fail the whole call if the tenant leg has nothing / errors —
        // log and carry the per-user result. Wrapped so a log failure can't
        // re-throw out of this isolated block.
        console.error('Tenant subscription sync error:', tenantSyncError);
        try {
          await adminSupabase.from('system_logs').insert({
            event_name: 'sync_my_subscription_tenant_leg_failure',
            error_message: tenantSyncError instanceof Error ? tenantSyncError.message : String(tenantSyncError),
            error_stack: tenantSyncError instanceof Error ? tenantSyncError.stack : undefined,
            severity: 'error',
            metadata: { path: new URL(request.url).pathname },
          });
        } catch (_logError) { /* swallow */ }
      }
    }

    if (!preferred && !tenantSynced) {
      return new Response(JSON.stringify({ synced: false, reason: 'no_subscriptions_found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    return new Response(
      JSON.stringify({
        synced: true,
        stripe_subscription_id: preferred?.id ?? tenantSynced?.stripe_subscription_id ?? null,
        status: preferred?.status ?? tenantSynced?.status ?? null,
        tenant_synced: tenantSynced,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }
    console.error('Subscription sync error:', error);
    try {
      await adminSupabase.from('system_logs').insert({
        event_name: 'sync_my_subscription_failure',
        error_message: error instanceof Error ? error.message : String(error),
        error_stack: error instanceof Error ? error.stack : undefined,
        severity: 'critical',
        metadata: {
          path: new URL(request.url).pathname,
        }
      });
    } catch (logError) {
      console.error('Failed to write system log to database:', logError);
    }

    if (error instanceof AuthError) {
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to sync subscription.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});