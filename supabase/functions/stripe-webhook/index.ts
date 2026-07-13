import { adminSupabase, corsHeaders, stripe } from '../_shared/stripe-client.ts';
import { upsertSubscriptionFromStripe } from '../_shared/stripe-subscription-sync.ts';
import { assertPostRequest, ValidationError } from '../_shared/validation.ts';
import { sendPaymentConfirmationEmail, sendPaymentFailedEmail } from '../_shared/email.ts';

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
          // Account-first: the tenant + admin user + draft listing are already
          // provisioned by provision_fiscal_agent_tenant during signup, so the
          // webhook just syncs the subscription like every other tier.
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
                // Tenant-owned premium customers have a NULL user_id — greet the
                // initiating admin recorded in the subscription metadata instead.
                const metaUserId = String(subscription.metadata?.user_id ?? '').trim();
                const greetUserId = billingCustomer?.user_id
                  ?? (/^\d+$/.test(metaUserId) ? Number(metaUserId) : null);
                if (greetUserId) {
                  const { data: userRecord } = await adminSupabase
                    .from('users')
                    .select('firstname')
                    .eq('id', greetUserId)
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
      case 'invoice.payment_failed': {
        // First-failure dunning signal ONLY. Subscription status stays driven by
        // customer.subscription.updated (Stripe flips it to past_due and delivers
        // that event separately) — this handler never touches the projection, it
        // just notifies the subscriber. The email send is fully isolated so a mail
        // failure can never 4xx/5xx the webhook and trigger a Stripe retry.
        try {
          const invoice = event.data.object;
          const stripeCustomerId = String(invoice.customer ?? '');
          const customerEmail = invoice.customer_email ?? '';
          if (stripeCustomerId && customerEmail) {
            let firstName = '';
            let tier = '';
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
              const { data: subRecord } = await adminSupabase
                .from('subscriptions')
                .select('membership_tier')
                .eq('stripe_customer_id', stripeCustomerId)
                .maybeSingle();
              tier = String(subRecord?.membership_tier ?? '').toLowerCase();
            }
            const PLAN_NAMES: Record<string, string> = {
              premium: 'Fiscal Agents Plan',
              basic: 'Basic Plan',
            };
            const planName = PLAN_NAMES[tier] ?? 'membership';

            const nextAttemptTs = invoice.next_payment_attempt;
            const nextAttempt = nextAttemptTs ? new Date(nextAttemptTs * 1000) : null;
            const appUrl = Deno.env.get('APP_URL') || 'https://granttrail.ca';

            await sendPaymentFailedEmail({
              to: customerEmail,
              firstName,
              planName,
              amountCents: invoice.amount_due ?? 0,
              currency: invoice.currency ?? 'cad',
              manageUrl: `${appUrl}/subscription`,
              nextAttempt,
            });
          }
        } catch (emailError) {
          console.error('Payment failed email failed:', emailError);
          try {
            await adminSupabase.from('system_logs').insert({
              event_name: 'payment_failed_email_failure',
              error_message: emailError instanceof Error ? emailError.message : String(emailError),
              severity: 'error',
              metadata: { stripe_event_id: event.id },
            });
          } catch (_logError) { /* swallow */ }
        }
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
      // Concurrent re-delivery: both passed the maybeSingle() check above, the
      // loser hits the stripe_event_id unique constraint. Treat it as the
      // duplicate it is rather than 400ing (which triggers a Stripe retry).
      if (insertEventError.code === '23505') {
        return new Response(JSON.stringify({ received: true, duplicate: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }
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
          // Never log the raw signature header (sensitive); record only presence.
          signature_present: request.headers.get('stripe-signature') !== null,
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