# components/auth

Authentication and account-onboarding flows.

- `Login.js` — email/password login + forgot-password mode.
- `SignUpClean.js` — signup step 1: email + password only (reads `?invite=` token).
- `CompleteProfile.js` — signup step 2: profile details; invite-based vs self-service.
- `ResetPassword.js` — set a new password from a recovery link.
- `Join.js` — the single path-fork for new (non-invited) accounts:
  self-serve grantee (-> /signup) vs fiscal-agent charity (-> /fiscal-agents/list).

Invariant: invite/onboarding is token-based. Use the `lib/invites.js` RPC
helpers (`getInviteByToken` / `consumeInvite`) — the `invites` table is NOT
directly readable/writable by anon/just-authed users (token-scoped SECURITY
DEFINER only). Invited users skip `Join` and go straight to `/signup?invite=…`.
