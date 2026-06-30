// Barrel re-export. This file used to hold all Stripe billing helpers in one
// 500+ line module; it's now split by responsibility (client construction,
// subscription sync) but every existing `import { X } from '../_shared/stripe.ts'`
// across the edge functions keeps working unchanged.
export * from './stripe-client.ts';
export * from './stripe-subscription-sync.ts';
