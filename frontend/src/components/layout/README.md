# components/layout

App chrome rendered around the routed pages.

- `Header.js` — top nav + user dropdown; role-aware links; hosts NotificationBell.
- `Footer.js` — support contact (tenant -> platform -> hardcoded fallback) + copyright.
- `NotificationBell.js` — bell dropdown for the notifications passed down from App.

Invariant: presentational chrome only. Notification data and mark-read/clear
handlers are owned by `App.js` and passed in as props — don't fetch state here.
