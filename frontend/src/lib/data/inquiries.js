// Data-access for sponsorship_inquiries (charity directory inbox).
import { supabase } from '../../supabaseClient';

/**
 * Accept a sponsorship inquiry via the `accept_sponsorship_inquiry` RPC.
 *
 * The RPC is SECURITY DEFINER: server-side it verifies the caller is an admin
 * of the inquiry's tenant, onboards the seeker as a grantee of that tenant,
 * creates a pending grant_record there, and marks the inquiry accepted — all
 * atomically and idempotently (a double-accept returns the existing grant).
 *
 * Resolves to { data, error } where data is
 * { grant_id, tenant_id, already_accepted }.
 *
 * @param {number|string} inquiryId
 */
export const acceptSponsorshipInquiry = (inquiryId) =>
  supabase.rpc('accept_sponsorship_inquiry', { p_inquiry_id: Number(inquiryId) });

/**
 * Move an inquiry to a non-accepted pipeline status (reviewing/declined/
 * waitlisted). Accepting must go through acceptSponsorshipInquiry instead.
 *
 * @param {number|string} inquiryId
 * @param {'new'|'reviewing'|'declined'|'waitlisted'} status
 */
export const updateInquiryStatus = (inquiryId, status) =>
  supabase.from('sponsorship_inquiries').update({ status }).eq('id', Number(inquiryId));
