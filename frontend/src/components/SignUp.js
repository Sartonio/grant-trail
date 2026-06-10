// src/components/SignUp.js
import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { Link, useNavigate } from 'react-router-dom';

function SignUp({ onSignup }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstname, setFirstname] = useState('');
  const [lastname, setLastname] = useState('');
  const [organization, setOrganization] = useState('');
  const [phone, setPhone] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSignup(e) {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);
    try {
      // Step 1: Create Auth user
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        console.error('SignUp error:', error);
        setErrorMsg(error.message || 'Signup failed');
        setLoading(false);
        return;
      }

      const user = data?.user;

      // Step 2: Update existing seeded grantee row (if present)
      const { data: grantee, error: updateError } = await supabase
        .from('grantee')
        .update({
          user_id: user?.id,
          firstname,
          lastname,
          organization_name: organization,
          phone_number: phone,
        })
        .eq('email', email) // match seeded row by email
        .select()
        .single();

      if (updateError) {
        console.error('Error updating grantee:', updateError);
        setErrorMsg(updateError.message || 'Error linking grantee record.');
        setLoading(false);
        return;
      }

      // Step 3: Pass session up to App.js
      const sessionObj = { user, grantee };
      if (onSignup) onSignup(sessionObj);

      // navigate to home/dashboard after successful signup
      navigate('/');
    } catch (err) {
      console.error('Unexpected signup error:', err);
      setErrorMsg('Unexpected error during signup');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="signup">
      <h2>Sign Up</h2>
      <form onSubmit={handleSignup}>
        <input
          type="text"
          placeholder="First Name"
          value={firstname}
          onChange={e => setFirstname(e.target.value)}
          required
        />
        <input
          type="text"
          placeholder="Last Name"
          value={lastname}
          onChange={e => setLastname(e.target.value)}
          required
        />
        <input
          type="text"
          placeholder="Organization"
          value={organization}
          onChange={e => setOrganization(e.target.value)}
          required
        />
        <input
          type="text"
          placeholder="Phone Number"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          required
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />
        <button type="submit" disabled={loading}>{loading ? 'Creating' : 'Create Account'}</button>
      </form>
      {errorMsg && <p className="error">{errorMsg}</p>}
      <p>
        Already have an account? <Link to="/login">Log in here</Link>
      </p>
    </div>
  );
}

export default SignUp;
