// src/components/CompleteProfile.js
// Step 2 of signup: collect profile details after email verification.
// Handles both invite-based (managed tenant) and self-service flows.
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { getInviteByToken, consumeInvite } from '../../lib/invites';
import { startCheckoutSession, MEMBERSHIP_TIERS } from '../../lib/billing';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FaUser, FaBuilding, FaPhone, FaCalendarAlt, FaCheckCircle } from 'react-icons/fa';
import '../../styles/Login.css';

function CompleteProfile({ session, onProfileComplete }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');

  const [firstname, setFirstname] = useState('');
  const [lastname, setLastname] = useState('');
  const [organization, setOrganization] = useState('');
  const [phone, setPhone] = useState('');
  const [taxMonth, setTaxMonth] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // Invite state
  const [invite, setInvite] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(!!inviteToken);

  // Validate invite token on mount
  useEffect(() => {
    if (!inviteToken) return;

    async function validateInvite() {
      const { data } = await getInviteByToken(inviteToken);

      if (data && !data.used_at) {
        setInvite(data);
      }
      setInviteLoading(false);
    }

    validateInvite();
  }, [inviteToken]);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMsg('');

    if (!firstname.trim() || !lastname.trim()) {
      setErrorMsg('First name and last name are required.');
      return;
    }
    if (!phone.trim()) {
      setErrorMsg('Phone number is required.');
      return;
    }
    if (!organization.trim()) {
      setErrorMsg('Organization name is required.');
      return;
    }

    setLoading(true);
    try {
      const user = session?.user;
      if (!user) {
        setErrorMsg('No authenticated user found. Please log in again.');
        setLoading(false);
        return;
      }

      let userRecord;

      if (invite) {
        // Invite flow - create user in the invite's tenant with the invite's role
        const { data: record, error: insertError } = await supabase
          .from('users')
          .upsert(
            {
              tenant_id: invite.tenant_id,
              email: user.email?.toLowerCase(),
              user_id: user.id,
              firstname,
              lastname,
              organization_name: organization,
              phone_number: phone,
              tax_month: taxMonth ? parseInt(taxMonth) : null,
              role: invite.role,
            },
            { onConflict: 'email' }
          )
          .select()
          .single();

        if (insertError) {
          setErrorMsg(insertError.message || 'Error creating user record.');
          setLoading(false);
          return;
        }
        userRecord = record;

        // Mark invite as used via the token-scoped SECURITY DEFINER RPC.
        // (Post-D7 the client can't write the invites table directly.)
        await consumeInvite(inviteToken, user.id);

      } else {
        // Self-service flow - provision a new tenant atomically via RPC
        const { data: record, error: rpcError } = await supabase
          .rpc('provision_self_service_tenant', {
            p_auth_uid: user.id,
            p_email: user.email,
            p_firstname: firstname,
            p_lastname: lastname,
            p_organization: organization,
            p_phone: phone,
            p_tax_month: taxMonth ? parseInt(taxMonth) : null,
          });

        if (rpcError) {
          setErrorMsg(rpcError.message || 'Error creating account.');
          setLoading(false);
          return;
        }

        // Pay at signup: a self-serve grantee goes straight into Basic checkout as
        // the final step of signup. The role is already assigned by the RPC; the
        // return lands on /subscription, where the billing sync flips access (and
        // resume-pay is available if they abandon checkout).
        // ponytail/redesign: when billing-model-redesign makes seekers free, this
        // becomes conditional (free seeker -> skip checkout, enter the app directly).
        const { url } = await startCheckoutSession({
          membershipTier: MEMBERSHIP_TIERS.BASIC,
          returnPath: '/subscription',
        });
        window.location.assign(url);
        return;
      }

      // Invite flow: role + tenant come from the invite and the org covers billing,
      // so no checkout. Notify App.js to refresh session; it redirects from there.
      if (onProfileComplete) await onProfileComplete({ user, userRecord });
    } catch (err) {
      setErrorMsg('Unexpected error completing profile');
    } finally {
      setLoading(false);
    }
  }

  if (inviteLoading) {
    return (
      <div className="signup">
        <div className="signup-container wide">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="signup">
      <div className="signup-container wide">
        <div style={{ textAlign: 'center', marginBottom: '1em' }}>
          <FaCheckCircle style={{ fontSize: '2rem', color: 'var(--color-primary)' }} />
        </div>
        <h2>Complete Your Profile</h2>
        {invite ? (
          <p className="signup-subtitle">
            Welcome! Your grants will be managed by <strong>{invite.tenants?.name}</strong>.<br />
            Just a few more details to get started.
          </p>
        ) : (
          <p className="signup-subtitle">One more step - tell us about yourself to set up your workspace.</p>
        )}

        <form onSubmit={handleSubmit}>

          {/* Row 1: First Name + Last Name */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="firstname">First Name</label>
              <div className="input-with-icon">
                <FaUser className="input-icon" />
                <input
                  id="firstname"
                  type="text"
                  placeholder="First name"
                  value={firstname}
                  onChange={e => setFirstname(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="lastname">Last Name</label>
              <div className="input-with-icon">
                <FaUser className="input-icon" />
                <input
                  id="lastname"
                  type="text"
                  placeholder="Last name"
                  value={lastname}
                  onChange={e => setLastname(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
            </div>
          </div>

          {/* Row 2: Tax Month + Phone */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="taxMonth">Tax Filing Month</label>
              <div className="input-with-icon">
                <FaCalendarAlt className="input-icon" />
                <select
                  id="taxMonth"
                  value={taxMonth}
                  onChange={e => setTaxMonth(e.target.value)}
                  disabled={loading}
                  style={{ color: taxMonth ? undefined : 'var(--color-gray-400)' }}
                >
                  <option value="" disabled hidden>Select your tax month</option>
                  <option value="1">January</option>
                  <option value="2">February</option>
                  <option value="3">March</option>
                  <option value="4">April</option>
                  <option value="5">May</option>
                  <option value="6">June</option>
                  <option value="7">July</option>
                  <option value="8">August</option>
                  <option value="9">September</option>
                  <option value="10">October</option>
                  <option value="11">November</option>
                  <option value="12">December</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="phone">Phone Number</label>
              <div className="input-with-icon">
                <FaPhone className="input-icon" />
                <input
                  id="phone"
                  type="tel"
                  placeholder="Phone number"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
            </div>
          </div>

          {/* Row 3: Organization */}
          <div className="form-group">
            <label htmlFor="organization">Organization</label>
            <div className="input-with-icon">
              <FaBuilding className="input-icon" />
              <input
                id="organization"
                type="text"
                placeholder="Organization name"
                value={organization}
                onChange={e => setOrganization(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </div>

          <button type="submit" disabled={loading}>
            {loading && <span className="button-spinner"></span>}
            <span>{loading ? 'Saving…' : 'Complete Setup'}</span>
          </button>

        </form>

        {errorMsg && (
          <div className="error">
            <span className="error-icon">⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default CompleteProfile;
