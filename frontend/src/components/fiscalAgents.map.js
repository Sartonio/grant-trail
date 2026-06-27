// src/components/fiscalAgents.map.js
//
// Adapters between the Supabase row shapes (snake_case columns on
// `fiscal_agent_listings` / `fiscal_agent_listings_public`, see the charity
// directory contract) and the camelCase view-model the existing Fiscal Agent
// components were built against (`feeNum`, `assetsManaged`, `responseTime`…).
//
// Keeping the mapping in one place means the directory, profile, owner panel,
// and editor all speak the same in-memory shape regardless of which view the
// row came from. The teaser view exposes only a safe subset; missing fields map
// to neutral defaults so cards still render without leaking contact info.

// Map a row from the PUBLIC teaser view. The view exposes only:
//   id, name, location, region, verified, focus, blurb, accepting, rating,
//   reviews, sponsored. Contact/fee/about fields are intentionally absent.
export function mapTeaserListing(row) {
  return {
    id: String(row.id),
    name: row.name || '',
    location: row.location || '',
    region: row.region || '',
    verified: !!row.verified,
    focus: row.focus || [],
    blurb: row.blurb || '',
    accepting: row.accepting !== false,
    rating: typeof row.rating === 'number' ? row.rating : 0,
    reviews: row.reviews || 0,
    sponsored: row.sponsored || 0,
    // Teaser-only: no contact/fee/track-record detail. Neutral display defaults
    // keep the card markup happy without inventing data.
    assetsManaged: '—',
    feeNum: 0,
    responseTime: '',
    isTeaser: true,
  };
}

// Map a full row from `fiscal_agent_listings`.
export function mapFullListing(row) {
  return {
    id: String(row.id),
    tenantId: row.tenant_id,
    ownerUserId: row.owner_user_id,
    name: row.name || '',
    location: row.location || '',
    region: row.region || '',
    ein: row.ein || '',
    verified: !!row.verified,
    focus: row.focus || [],
    blurb: row.blurb || '',
    about: row.about || '',
    services: row.services || [],
    projects: row.projects || [],
    website: row.website || '',
    email: row.email || '',
    phone: row.phone || '',
    responseTime: row.response_time || '',
    accepting: row.accepting !== false,
    feeNum: row.fee_admin_pct != null ? Number(row.fee_admin_pct) : 0,
    rating: typeof row.rating === 'number' ? row.rating : 0,
    reviews: row.reviews || 0,
    sponsored: row.sponsored || 0,
    assetsManaged: row.assets_managed || '—',
    status: row.status || 'draft',
    verification: row.verification || 'pending',
    isTeaser: false,
  };
}

// Inverse of mapFullListing for the listing editor: turn the camelCase
// view-model back into the column set the `fiscal_agent_listings` table accepts
// on update. Only columns the owner can edit are included.
export function listingToRow(model) {
  return {
    name: (model.name || '').trim(),
    location: (model.location || '').trim(),
    region: model.region || null,
    blurb: (model.blurb || '').trim(),
    about: model.about || null,
    focus: model.focus || [],
    services: (model.services || []).map((s) => String(s).trim()).filter(Boolean),
    website: model.website || null,
    email: model.email || null,
    phone: model.phone || null,
    response_time: model.responseTime || null,
    accepting: model.accepting !== false,
    fee_admin_pct: Number(model.feeNum) || 0,
  };
}

// Map a `sponsorship_inquiries` row into the inbox view-model. The table stores
// `project`/`contact` as jsonb and uses `submitted_at`; the inbox expects
// camelCase `submittedAt` plus the parsed jsonb objects.
export function mapInquiry(row) {
  return {
    id: String(row.id),
    listingId: row.listing_id,
    status: row.status || 'new',
    submittedAt: row.submitted_at || row.created_at || new Date().toISOString(),
    project: row.project || {},
    contact: row.contact || {},
    message: row.message || '',
  };
}
