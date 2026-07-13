# GrantTrail — Master Task Checklist

Open work and known items. See `docs/how_to/dev_practices.md` for everyday ops.

- [ ] Confirm each admin / fiscal agent is assigned to the correct tenant
- [ ] End-to-end manual testing of all critical flows:
  - [ ] Emails (signup, invite, reset, payment confirmation)
  - [ ] Invitation flow
  - [ ] Grantee / Admin / Super Admin journeys
- [ ] Set up Resend in Supabase (see `docs/how_to/local_email_testing.md`)
- [ ] Run a load test against the production Supabase project
- [ ] Complete a security review of the current release
