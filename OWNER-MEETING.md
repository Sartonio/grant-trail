# GrantTrail — Owner Meeting Checklist

> Everything that requires the Supabase / Vercel / GoDaddy account owner in the room.
> Work through this top-to-bottom in one sitting, then hand back to Ryan for the post-meeting steps.

---

## Before the meeting — Ryan does this alone

- [ ] Log in to [resend.com](https://resend.com) → **Domains** → **Add Domain** → enter `send.atkasolutions.org` → **Create**
- [ ] Leave the Resend record table open — you'll read values from it during the DNS step below

---

## In the meeting — needs account owner

## After the meeting — Ryan does these alone

- [ ] Resend → **Domains** → **Verify** — wait for all records to go green (check back after ~30 min)
- [ ] Create a Resend API key → push to GitHub Actions environments:
  ```bash
  gh secret set RESEND_API_KEY --env production --body "re_..."
  gh variable set EMAIL_FROM --env production --body "GrantTrail <receipts@send.atkasolutions.org>"

  gh secret set RESEND_API_KEY --env staging --body "re_..."
  gh variable set EMAIL_FROM --env staging --body "GrantTrail <receipts@send.atkasolutions.org>"
  ```
- [ ] GitHub Actions → **Deploy to Production** → **Run workflow**
- [ ] End-to-end smoke test: one real purchase with a live card → refund after → confirm paywall lifts **and** receipt email arrives (check Resend → Emails dashboard if it doesn't)
- [ ] Re-run load test against prod Supabase after upgrading the instance: `tests/load/k6-load-test.js`
- [ ] Run security overview (`🟢` item in TEST-CHECKLIST.md)
