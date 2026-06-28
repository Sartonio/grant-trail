# GrantTrail — Email DNS Setup (Resend + GoDaddy)

> **Temporary working doc.** One-time DNS task to let GrantTrail send payment-receipt
> emails from a verified domain. Delete once `send.atkasolutions.org` is verified in
> Resend and the prod `SMTP_FROM` is switched over.

**Goal:** verify `send.atkasolutions.org` in Resend so receipts can be sent to *any*
customer (not just the Resend account owner's address). Uses a `send.` subdomain so
the main website on the apex domain is untouched.

**Who does what:**
- **Resend access** (you) → Step 1, Step 4
- **GoDaddy DNS access** (whoever owns the domain) → Step 2, Step 3

---

## Step 1 — Get the exact records (Resend)

1. Log in to [resend.com](https://resend.com) → **Domains** → **Add Domain**.
2. Enter **`send.atkasolutions.org`** → **Create**.
3. Resend shows a table of records (MX, TXT-SPF, TXT-DKIM, DMARC). Leave this page
   open — the **Value** of each gets pasted into GoDaddy below.

## Step 2 — Open GoDaddy DNS

1. Sign in to GoDaddy → **My Products** → next to **atkasolutions.org** click **DNS**
   (or `dcc.godaddy.com` → pick the domain → **DNS → DNS Records**).
2. For each record below, click **Add New Record**.

## Step 3 — Add each record

> ⚠️ **GoDaddy auto-appends `.atkasolutions.org` to the Name/Host field.** Enter only
> the part *before* it. e.g. if Resend shows `resend._domainkey.send.atkasolutions.org`,
> type just `resend._domainkey.send`.

| # | Type | Name/Host (enter this) | Value | Priority | TTL |
|---|------|------------------------|-------|----------|-----|
| 1 | MX   | `send`                 | *(Resend's MX target, e.g. `feedback-smtp.us-east-1.amazonses.com`)* | 10 | 1 hr |
| 2 | TXT  | `send`                 | *(Resend's SPF, e.g. `v=spf1 include:amazonses.com ~all`)* | — | 1 hr |
| 3 | TXT  | `resend._domainkey.send` | *(Resend's long DKIM key)* | — | 1 hr |
| 4 | TXT  | `_dmarc.send`          | `v=DMARC1; p=none;` *(or Resend's suggested value)* | — | 1 hr |

## Step 4 — Verify (Resend)

1. Save in GoDaddy, wait ~15–60 min for propagation.
2. Resend → **Domains** → **Verify**. All records should turn green.

---

## After verification — app change (handled by dev)

The app sends via the Resend HTTP API (not SMTP). Two config values, no code change:

```
RESEND_API_KEY=<resend api key>                          # secret
EMAIL_FROM=GrantTrail <receipts@send.atkasolutions.org>  # variable
```

Both must be set in the prod secrets/variables (see `docs/PROD-EMAIL-RUNBOOK.md` §1),
not just locally. `EMAIL_FROM` must be on the domain verified above.
