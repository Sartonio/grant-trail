import { adminSupabase, corsHeaders, normalizeMembershipTier, provisionFiscalAgentFromCheckout, stripe, upsertSubscriptionFromStripe } from '../_shared/stripe.ts';
import { assertPostRequest, ValidationError } from '../_shared/validation.ts';
import { sendFiscalAgentInviteEmail, sendPaymentConfirmationEmail } from '../_shared/email.ts';
import { logSystemEvent } from '../_shared/logging.ts';

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
              const { token, signupUrl, email, orgName } = await provisionFiscalAgentFromCheckout(session);
              console.log('Fiscal agent provisioned; invite token issued:', Boolean(token));

              // Send the "signup link" email the checkout return page promises.
              // Isolated like the receipt below: a mail failure must never re-throw
              // here, or Stripe would retry the whole (already-done) provisioning.
              if (signupUrl && email) {
                try {
                  await sendFiscalAgentInviteEmail({ to: email, orgName, signupUrl });
                } catch (inviteEmailError) {
                  console.error('Fiscal agent invite email failed:', inviteEmailError);
                  await logSystemEvent(
                    'fiscal_agent_invite_email_failure',
                    'error',
                    inviteEmailError instanceof Error ? inviteEmailError.message : String(inviteEmailError),
                    { stripe_event_id: event.id },
                  );
                }
              }
            } catch (provisionError) {
              console.error('Fiscal agent provisioning failed:', provisionError);
              await logSystemEvent(
                'fiscal_agent_provisioning_failure',
                'critical',
                provisionError instanceof Error ? provisionError.message : String(provisionError),
                { stripe_event_id: event.id },
                provisionError instanceof Error ? provisionError.stack : undefined,
              );
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

              const tier = normalizeMembershipTier(subscription.metadata ?? {});
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
            await logSystemEvent(
              'payment_confirmation_email_failure',
              'error',
              emailError instanceof Error ? emailError.message : String(emailError),
              { stripe_event_id: event.id },
            );
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
    await logSystemEvent(
      'stripe_webhook_failure',
      'critical',
      error instanceof Error ? error.message : String(error),
      { signature: request.headers.get('stripe-signature') },
      error instanceof Error ? error.stack : undefined,
    );

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Webhook processing failed.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});