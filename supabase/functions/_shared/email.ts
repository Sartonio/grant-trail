// Resend HTTP API transport — all env-driven, nothing hardcoded. We send over
// HTTPS (fetch) rather than raw SMTP: a fetch failure (network or non-2xx) is a
// normal awaitable rejection the caller can catch, so a down mail provider can
// never crash the edge worker. (denomailer's SMTP socket failures escape the
// Deno event loop and kill the worker — fatal for the webhook's failure
// isolation; see git history.)
//
// RESEND_API_KEY + EMAIL_FROM are required to send; without them we no-op (the
// same opt-in behaviour as before). EMAIL_FROM must be an address on a domain
// verified in Resend. RESEND_API_URL is overridable only for tests; it defaults
// to the real endpoint.
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
// Prefer EMAIL_FROM; fall back to the legacy SMTP_FROM var for migration.
const FROM_EMAIL = Deno.env.get('EMAIL_FROM') || Deno.env.get('SMTP_FROM') || '';
const RESEND_API_URL = Deno.env.get('RESEND_API_URL') || 'https://api.resend.com/emails';

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  if (!RESEND_API_KEY || !FROM_EMAIL) {
    console.warn('RESEND_API_KEY/EMAIL_FROM not all set — skipping email send.');
    return;
  }

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [options.to],
      subject: options.subject,
      html: options.html,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend API error ${response.status}: ${body.slice(0, 500)}`);
  }
}

interface PaymentConfirmationOptions {
  to: string;
  firstName: string;
  planName: string;
  amountCents: number;
  currency: string;
  subscriptionId: string;
  paymentDate: Date;
  periodEnd: Date | null;
}

export async function sendPaymentConfirmationEmail(opts: PaymentConfirmationOptions): Promise<void> {
  const formattedAmount = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: opts.currency.toUpperCase(),
  }).format(opts.amountCents / 100);

  const formatDate = (d: Date) =>
    d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

  const renewalRow = opts.periodEnd
    ? `
      <tr>
        <td colspan="2" style="border-bottom:1px solid #e5e7eb;padding:0;font-size:0;line-height:0;">&nbsp;</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#6b7280;">Next Renewal</td>
        <td style="padding:8px 0;font-size:14px;color:#111111;text-align:right;">${formatDate(opts.periodEnd)}</td>
      </tr>`
    : '';

  const year = opts.paymentDate.getFullYear();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Payment Confirmation — GrantTrail</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f3f4f6;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background-color:#1a6b3c;padding:32px 40px;text-align:center;">
              <p style="margin:0;font-size:26px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">GrantTrail</p>
              <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,0.75);">Payment Confirmation &amp; Receipt</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">

              <p style="margin:0 0 20px;font-size:16px;color:#111111;">Hi ${opts.firstName || 'there'},</p>
              <p style="margin:0 0 32px;font-size:16px;color:#444444;line-height:1.6;">
                Thank you for your payment. Your <strong>${opts.planName}</strong> membership is now active.
                Please keep this email as your receipt.
              </p>

              <!-- Receipt table -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:32px;">
                <tr>
                  <td style="padding:24px;">
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">

                      <tr>
                        <td style="padding:8px 0;font-size:14px;color:#6b7280;">Plan</td>
                        <td style="padding:8px 0;font-size:14px;color:#111111;text-align:right;font-weight:600;">${opts.planName}</td>
                      </tr>
                      <tr>
                        <td colspan="2" style="border-bottom:1px solid #e5e7eb;padding:0;font-size:0;line-height:0;">&nbsp;</td>
                      </tr>

                      <tr>
                        <td style="padding:8px 0;font-size:14px;color:#6b7280;">Amount Paid</td>
                        <td style="padding:8px 0;font-size:14px;color:#111111;text-align:right;font-weight:600;">${formattedAmount} ${opts.currency.toUpperCase()}</td>
                      </tr>
                      <tr>
                        <td colspan="2" style="border-bottom:1px solid #e5e7eb;padding:0;font-size:0;line-height:0;">&nbsp;</td>
                      </tr>

                      <tr>
                        <td style="padding:8px 0;font-size:14px;color:#6b7280;">Payment Date</td>
                        <td style="padding:8px 0;font-size:14px;color:#111111;text-align:right;">${formatDate(opts.paymentDate)}</td>
                      </tr>
                      ${renewalRow}
                      <tr>
                        <td colspan="2" style="border-bottom:1px solid #e5e7eb;padding:0;font-size:0;line-height:0;">&nbsp;</td>
                      </tr>

                      <tr>
                        <td style="padding:8px 0;font-size:14px;color:#6b7280;">Reference</td>
                        <td style="padding:8px 0;font-size:12px;color:#6b7280;text-align:right;font-family:monospace;">${opts.subscriptionId}</td>
                      </tr>

                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px;font-size:14px;color:#444444;line-height:1.6;">
                You can manage your subscription, update your payment method, or download invoices from the
                <strong>Subscription</strong> page in your GrantTrail account at any time.
              </p>
              <p style="margin:0;font-size:14px;color:#6b7280;">
                Questions? Reply to this email or contact us at
                <a href="mailto:support@granttrail.ca" style="color:#1a6b3c;text-decoration:none;">support@granttrail.ca</a>.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                &copy; ${year} GrantTrail &mdash; This is an automated receipt, please do not reply directly.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await sendEmail({
    to: opts.to,
    subject: `Your GrantTrail receipt — ${opts.planName}`,
    html,
  });
}
