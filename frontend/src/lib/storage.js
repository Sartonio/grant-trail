// Shared Supabase Storage helpers. Extracted from the inline createSignedUrl
// calls in AdminGrantReview / GrantBreakdown / GrantAttachments
// (see docs/architecture-review/modularity.md, Phase 1).
import { supabase } from '../supabaseClient';

// Returns a short-lived signed URL string, or null if it could not be created.
export async function getSignedUrl(bucket, path, expiresIn = 60) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export const getReceiptSignedUrl = (path, expiresIn = 60) =>
  getSignedUrl('receipts', path, expiresIn);
