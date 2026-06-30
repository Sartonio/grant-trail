# components/landing

Public marketing page.

- `LandingPage.js` — unauthenticated marketing/landing page; also serves as the
  upgrade page unpaid grantees are redirected to (`/home`).

Invariant: public and unauthenticated — assume no `session`. Keep it static-ish
(no gated data); route real product features through the authed app instead.
