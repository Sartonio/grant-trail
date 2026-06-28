import { adminSupabase, corsHeaders, provisionFiscalAgentFromCheckout, stripe, upsertSubscriptionFromStripe } from '../_shared/stripe.ts';
import { assertPostRequest, ValidationError } from '../_shared/validation.ts';
import { sendPaymentConfirmationEmail } from '../_shared/email.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    assertPostRequest(request);
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
          // Pay-first charity flow: provision the tenant + admin user +
          // billing_customers link + draft listing + invite BEFORE syncing the
          // subscription (which requires the billing_customers link to exist).
          // The invite token is the hard requirement; the rest is wrapped so a
          // provisioning hiccup never blocks the subscription sync.
          if (String(session.metadata?.provision_flow ?? '').toLowerCase() === 'fiscal_agent_onboarding') {
            try {
              const { token } = await provisionFiscalAgentFromCheckout(session);
              console.log('Fiscal agent provisioned; invite token issued:', Boolean(token));
            } catch (provisionError) {
              console.error('Fiscal agent provisioning failed:', provisionError);
              // supabase-js query builders are thenables, not Promises — no .catch().
              // Wrap the log write so a logging failure can never mask the original.
              try {
                await adminSupabase.from('system_logs').insert({
                  event_name: 'fiscal_agent_provisioning_failure',
                  error_message: provisionError instanceof Error ? provisionError.message : String(provisionError),
                  error_stack: provisionError instanceof Error ? provisionError.stack : undefined,
                  severity: 'critical',
                  metadata: { stripe_event_id: event.id },
                });
              } catch (_logError) { /* swallow */ }
              throw provisionError; // re-raise so Stripe retries provisioning.
            }
          }

          const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
          await upsertSubscriptionFromStripe(subscription);

          // Send payment confirmation email — errors are isolated so Stripe never retries due to email failure.
          try {
            const customerEmail = session.customer_details?.email ?? session.customer_email ?? '';
            if (customerEmail) {
              const stripeCustomerId = String(session.customer ?? '');
              let firstName = '';
              if (stripeCustomerId) {
                const { data: billingCustomer } = await adminSupabase
                  .from('billing_customers')
                  .select('user_id')
                  .eq('stripe_customer_id', stripeCustomerId)
                  .maybeSingle();
                if (billingCustomer?.user_id) {
                  const { data: userRecord } = await adminSupabase
                    .from('users')
                    .select('firstname')
                    .eq('id', billingCustomer.user_id)
                    .maybeSingle();
                  firstName = String(userRecord?.firstname ?? '');
                }
              }

              const meta = subscription.metadata ?? {};
              let tier = String(meta.membership_tier ?? meta.feature_key ?? '').toLowerCase();
              if (tier === 'basic_membership') tier = 'basic';
              if (['admin_membership', 'premium_membership', 'excel_export'].includes(tier)) tier = 'premium';
              const PLAN_NAMES: Record<string, string> = {
                premium: 'Fiscal Agents Plan',
                basic: 'Basic Plan',
              };
              const planName = PLAN_NAMES[tier] ?? 'Basic Plan';

              const periodEndTs = subscription.items.data[0]?.current_period_end;
              const periodEnd = periodEndTs ? new Date(periodEndTs * 1000) : null;

              await sendPaymentConfirmationEmail({
                to: customerEmail,
                firstName,
                planName,
                amountCents: session.amount_total ?? 0,
                currency: session.currency ?? 'cad',
                subscriptionId: subscription.id,
                paymentDate: new Date(event.created * 1000),
                periodEnd,
              });
            }
          } catch (emailError) {
            console.error('Payment confirmation email failed:', emailError);
            // supabase-js query builders are thenables, not Promises — no .catch().
            // Wrap the log write so a logging failure can never re-throw out of
            // this isolated block (which would 4xx/5xx the webhook and trigger a
            // Stripe retry for what is only a non-fatal email failure).
            try {
              await adminSupabase.from('system_logs').insert({
                event_name: 'payment_confirmation_email_failure',
                error_message: emailError instanceof Error ? emailError.message : String(emailError),
                severity: 'error',
                metadata: { stripe_event_id: event.id },
              });
            } catch (_logError) { /* swallow */ }
          }
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
    if (error instanceof ValidationError) {
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }
    console.error('Webhook error:', error);
    try {
      await adminSupabase.from('system_logs').insert({
        event_name: 'stripe_webhook_failure',
        error_message: error instanceof Error ? error.message : String(error),
        error_stack: error instanceof Error ? error.stack : undefined,
        severity: 'critical',
        metadata: {
          signature: request.headers.get('stripe-signature'),
        }
      });
    } catch (logError) {
      console.error('Failed to write system log to database:', logError);
    }

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Webhook processing failed.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});