import { supabase } from "../supabaseClient";

// Fetch a single invite by its token via the `get_invite_by_token` RPC.
//
// The `invites` table is no longer directly readable by `anon` (D7 security
// fix): a token-scoped SECURITY DEFINER function returns ONLY the matching
// invite, so unauthenticated callers can't enumerate every invite/token/email.
//
// Returns the invite shaped like the old `select('*, tenants(name)')` result
// (so callers keep using `invite.tenants?.name`), or null if not found.
// On error, returns { data: null, error }.
/** @param {string|null|undefined} token */
export async function getInviteByToken(token) {
  if (!token) return { data: null, error: null };

  const { data, error } = await supabase.rpc("get_invite_by_token", {
    p_token: token,
  });

  if (error) return { data: null, error };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { data: null, error: null };

  const { tenant_name, ...rest } = row;
  return {
    data: { ...rest, tenants: tenant_name ? { name: tenant_name } : null },
    error: null,
  };
}

// Create the invited user's record via the `register_invited_user` RPC.
//
// The client NEVER sends `role` or `tenant_id`: a SECURITY DEFINER function
// reads them authoritatively from the validated, unused invite row (matched by
// the unguessable token), inserts the users row, and consumes the invite — all
// server-side and atomic. This closes the F1 privilege-escalation hole where the
// old direct `users` upsert trusted a client-supplied `role`.
//
// Returns { data: <created user row>, error }.
/**
 * @param {Object} args
 * @param {string} args.token
 * @param {string} args.firstname
 * @param {string} args.lastname
 * @param {string} args.organization
 * @param {string} args.phone
 * @param {number|null} [args.taxMonth]
 */
export async function registerInvitedUser({
  token,
  firstname,
  lastname,
  organization,
  phone,
  taxMonth,
}) {
  const { data, error } = await supabase.rpc("register_invited_user", {
    p_token: token,
    p_firstname: firstname,
    p_lastname: lastname,
    p_organization: organization,
    p_phone: phone,
    p_tax_month: taxMonth ?? null,
  });

  if (error) return { data: null, error };
  return { data, error: null };
}

// Mark an invite consumed via the `consume_invite` RPC.
//
// The `invites` table is no longer directly writable by the just-authenticated
// user (D7 security model): a token-scoped SECURITY DEFINER function stamps
// `used_by`/`used_at` for the single invite matching the supplied token, only if
// it is not already used, and only when `userId === auth.uid()`.
//
// Returns { data: <boolean whether a row was consumed>, error }.
/** @param {string} token @param {string} userId */
export async function consumeInvite(token, userId) {
  const { data, error } = await supabase.rpc("consume_invite", {
    p_token: token,
    p_user_id: userId,
  });

  if (error) return { data: null, error };
  return { data, error: null };
}
