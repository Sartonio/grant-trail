import { adminSupabase, corsHeaders, stripe, upsertSubscriptionFromStripe } from '../_shared/stripe.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const stripeWebhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
    const signature = request.headers.get('stripe-signature');
    const payload = await request.text();

    if (!stripeWebhookSecret || !signature) {
      throw new Error('Missing Stripe webhook configuration.');
    }

    const event = await stripe.webhooks.constructEventAsync(payload, signature, stripeWebhookSecret);

    const { data: existingEvent } = await adminSupabase
      .from('billing_webhook_events')
      .select('id')
      .eq('stripe_event_id', event.id)
      .maybeSingle();

    if (existingEvent) {
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription' && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
          await upsertSubscriptionFromStripe(subscription);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await upsertSubscriptionFromStripe(event.data.object);
        break;
      }
      default:
        break;
    }

    const { error: insertEventError } = await adminSupabase.from('billing_webhook_events').insert({
      stripe_event_id: event.id,
      event_type: event.type,
      payload: event,
    });

    if (insertEventError) {
      throw new Error(`Unable to persist webhook event: ${insertEventError.message}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Webhook processing failed.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});