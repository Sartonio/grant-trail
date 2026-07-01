import { adminSupabase, corsHeaders } from '../_shared/stripe-client.ts';
import { assertPostRequest, parseJsonBody, ValidationError } from '../_shared/validation.ts';
import { sendInquiryNotificationEmail } from '../_shared/email.ts';

// Notify the charity (fiscal agent) when a seeker submits a sponsorship inquiry.
//
// The inquiry row is written client-side under RLS (see the directory UI). This
// function is the server-side notification half: the seeker's RLS deliberately
// hides the charity's contact email, so resolving the recipient and sending the
// mail must happen with the service role here.
//
// Failure isolation, mirroring the stripe-webhook email block: a notification
// failure must NEVER look like a submission failure to the seeker (the inquiry is
// already saved). Every non-validation failure is logged to system_logs and the
// handler still returns 200.

const APP_URL = (Deno.env.get('APP_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');

function asString(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : String(value);
}

function ok(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
}

// supabase-js query builders are thenables, not Promises — and a logging failure
// must never re-throw out of the handler. Wrap every write defensively.
async function logSystem(
  eventName: string,
  severity: 'info' | 'warning' | 'error' | 'critical',
  message: string,
  metadata: Record<string, unknown>,
  stack?: string,
): Promise<void> {
  try {
    await adminSupabase.from('system_logs').insert({
      event_name: eventName,
      error_message: message,
      error_stack: stack,
      severity,
      metadata,
    });
  } catch (_logError) {
    /* swallow */
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    assertPostRequest(request);
    const body = await parseJsonBody(request);
    const inquiryId = Number(body.inquiryId ?? body.inquiry_id);
    if (!Number.isInteger(inquiryId) || inquiryId <= 0) {
      throw new ValidationError('inquiryId is required and must be a positive integer.');
    }

    // Load the inquiry with the service role (the seeker can't read the listing's
    // contact email under RLS).
    const { data: inquiry, error: inquiryError } = await adminSupabase
      .from('sponsorship_inquiries')
      .select('id, listing_id, project, contact, message')
      .eq('id', inquiryId)
      .maybeSingle();
    if (inquiryError) throw inquiryError;
    if (!inquiry) {
      // Unknown id — succeed quietly rather than confirm/deny existence.
      return ok({ sent: false, reason: 'not_found' });
    }

    // Throttle (F7): an authenticated caller could otherwise replay the same
    // inquiryId to spam the charity's inbox. Atomically claim the notify slot
    // by flipping notified_at from NULL — only the request that wins the
    // update actually sends mail. ponytail: caps spam to the obvious replay
    // vector (same id); upgrade to a windowed per-user limiter if abuse via
    // many distinct ids shows up.
    const { data: claimed, error: claimError } = await adminSupabase
      .from('sponsorship_inquiries')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', inquiryId)
      .is('notified_at', null)
      .select('id')
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) {
      return ok({ sent: false, reason: 'already_notified' });
    }

    const { data: listing, error: listingError } = await adminSupabase
      .from('fiscal_agent_listings')
      .select('id, name, email, owner_user_id')
      .eq('id', inquiry.listing_id)
      .maybeSingle();
    if (listingError) throw listingError;

    // Recipient: the listing's published contact email, falling back to the
    // owning account's email.
    let recipient = asString(listing?.email).trim();
    if (!recipient && listing?.owner_user_id) {
      const { data: owner } = await adminSupabase
        .from('users')
        .select('email')
        .eq('id', listing.owner_user_id)
        .maybeSingle();
      recipient = asString(owner?.email).trim();
    }

    const project = (inquiry.project ?? {}) as Record<string, unknown>;
    const contact = (inquiry.contact ?? {}) as Record<string, unknown>;
    const seekerName = asString(contact.name).trim() || 'A grant seeker';
    const projectName = asString(project.name).trim() || 'their project';
    const listingName = asString(listing?.name).trim() || 'there';

    if (!recipient) {
      await logSystem(
        'inquiry_notification_skipped',
        'warning',
        `No notification address resolved for listing ${inquiry.listing_id}.`,
        { inquiry_id: inquiryId, listing_id: inquiry.listing_id },
      );
      return ok({ sent: false, reason: 'no_recipient' });
    }

    // RESEND_API_KEY may be unset (e.g. preview/staging without mail). Fail
    // silently for the seeker, but record the skip so operators can see that
    // notifications aren't going out.
    if (!Deno.env.get('RESEND_API_KEY')) {
      await logSystem(
        'inquiry_notification_skipped',
        'warning',
        'RESEND_API_KEY not set — sponsorship inquiry notification email not sent.',
        { inquiry_id: inquiryId, listing_id: inquiry.listing_id },
      );
      return ok({ sent: false, reason: 'email_disabled' });
    }

    await sendInquiryNotificationEmail({
      to: recipient,
      listingName,
      seekerName,
      projectName,
      message: asString(inquiry.message),
      inboxUrl: `${APP_URL}/fiscal-agents/me/inbox`,
    });

    return ok({ sent: true });
  } catch (error) {
    if (error instanceof ValidationError) {
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }
    // Non-validation failures (DB lookup or Resend API) must not bubble up as a
    // submission failure — the inquiry is already persisted. Log and 200.
    console.error('Inquiry notification error:', error);
    await logSystem(
      'inquiry_notification_failure',
      'error',
      error instanceof Error ? error.message : String(error),
      {},
      error instanceof Error ? error.stack : undefined,
    );
    return ok({ sent: false, reason: 'error' });
  }
});
