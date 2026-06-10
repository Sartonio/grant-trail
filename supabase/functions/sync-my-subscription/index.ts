import { adminSupabase, corsHeaders, getOrCreateStripeCustomer, requireAuthenticatedProfile, stripe, upsertSubscriptionFromStripe } from '../_shared/stripe.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { profile } = await requireAuthenticatedProfile(request.headers.get('Authorization'));
    const customerId = await getOrCreateStripeCustomer(profile);

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 20,
    });

    const sorted = [...subscriptions.data].sort(
      (a, b) => Number(b.created ?? 0) - Number(a.created ?? 0),
    );

    const preferred =
      sorted.find((sub) => ['active', 'trialing', 'past_due'].includes(sub.status)) ||
      sorted.find((sub) => ['canceled', 'incomplete', 'incomplete_expired', 'unpaid'].includes(sub.status)) ||
      null;

    if (!preferred) {
      const { error: membershipClearError } = await adminSupabase
        .from('user_memberships')
        .update({ is_active: false, ends_at: new Date().toISOString() })
        .eq('user_id', profile.profileId);

      if (membershipClearError) {
        throw new Error(`Unable to clear membership status: ${membershipClearError.message}`);
      }

      return new Response(JSON.stringify({ synced: false, reason: 'no_subscriptions_found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    await upsertSubscriptionFromStripe(preferred);

    return new Response(
      JSON.stringify({
        synced: true,
        stripe_subscription_id: preferred.id,
        status: preferred.status,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to sync subscription.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});