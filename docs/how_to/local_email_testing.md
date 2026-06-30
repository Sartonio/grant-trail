# Local Email Testing (Resend)

Transactional emails (checkout receipts, inquiry notifications) are sent via the
[Resend](https://resend.com) HTTP API from `supabase/functions/_shared/email.ts`.
If `RESEND_API_KEY` or `EMAIL_FROM` are unset the function silently skips the send
and logs a warning — no crash, no error returned to the caller.

**You don't need this for most local dev.** The app works fully without email. Set
it up when you need to confirm an email actually lands (e.g. testing the inquiry
notification or the post-checkout receipt path).

## How the wiring works

```
edge function (notify-inquiry / stripe-webhook)
    │  HTTP POST (Bearer RESEND_API_KEY)
    ▼
_shared/email.ts  ──>  https://api.resend.com/emails
                                │
                                ▼
                        recipient inbox
```

Both `RESEND_API_KEY` and `EMAIL_FROM` are read from the edge function environment
(`supabase/functions/.env`). Auth emails (magic links, password resets) go through
Supabase's own auth system and Inbucket — they are not affected by Resend config.

## One-time setup

1. **Create a free Resend account** at [resend.com](https://resend.com).

2. **Add and verify a sending domain** — Resend Dashboard → Domains → Add Domain.
   Follow the DNS steps (three records: SPF, DKIM, DMARC). Takes a few minutes to
   propagate. You cannot send `EMAIL_FROM` addresses on unverified domains.

   > For local testing only, Resend's sandbox mode lets you send to your own
   > verified email address without a custom domain. Use the default `onboarding@resend.dev`
   > sender and add your personal email as a verified address.

3. **Create an API key** — Resend Dashboard → API Keys → Create API Key.
   Sending access is sufficient (no need for full access).

4. **Add the values to `supabase/functions/.env`:**

   ```dotenv
   RESEND_API_KEY=re_…
   EMAIL_FROM=noreply@yourdomain.com
   ```

   `EMAIL_FROM` must exactly match an address on a verified domain in your Resend account.

## Running it

Email sends happen inside normal edge function calls — no separate process needed.
Just make sure the functions are running with the env file:

```bash
npx --prefix frontend supabase functions serve --env-file ./supabase/functions/.env
```

Then trigger an email from the app (e.g. submit a sponsorship inquiry from the
Charity Directory, or complete a checkout). The Resend dashboard → Emails shows
delivery status and the rendered message.

## Verifying it worked

Check the Resend dashboard → Emails for a delivery record. If email is silently
skipped you'll see this in the functions serve output:

```
RESEND_API_KEY/EMAIL_FROM not all set — skipping email send.
```

## Common gotchas

| Symptom | Cause / fix |
|---------|-------------|
| Email silently skipped, no error | `RESEND_API_KEY` or `EMAIL_FROM` not set in `supabase/functions/.env`, or functions not restarted after editing it |
| `422 Unprocessable Entity` from Resend | `EMAIL_FROM` domain not verified in Resend |
| `401 Unauthorized` | `RESEND_API_KEY` invalid or expired — regenerate in the Resend dashboard |
| Auth emails (magic links) not working | Those go through Supabase Inbucket, not Resend — check `http://localhost:54324` |
