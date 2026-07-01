import React, { useState, useRef, useCallback } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { FiUser, FiChevronDown, FiLogOut, FiActivity, FiUsers, FiSettings, FiBriefcase } from 'react-icons/fi';
import NotificationBell from './NotificationBell';
import { useClickOutside } from './useClickOutside';
import './Header.css';

function Header({ session, onLogout, notifications, onMarkRead, onMarkAllRead, onClearAll }) {
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useClickOutside(dropdownRef, useCallback(() => setDropdownOpen(false), []));

  const handleLogoutClick = async () => {
    setDropdownOpen(false);
    await onLogout();
    navigate('/login');
  };

  const isAdmin = session?.userRecord?.role === 'admin';
  const isSuperAdmin = session?.userRecord?.role === 'super_admin';
  const isGrantee = session?.userRecord?.role === 'grantee';
  const subscriptionLocked = !!session && !isSuperAdmin && !session?.membership?.isExempt && !(
    isAdmin ? session?.membership?.hasPremiumAccess : session?.membership?.hasBasicAccess
  );
  const showSubscriptionNav = session && !isSuperAdmin;
  const userRecord = session?.userRecord;
  const displayName = userRecord
    ? `${userRecord.firstname} ${userRecord.lastname}`
    : '';
  const isPublicView = !session;

  // Directory is for everyone (seekers, grantees, fiscal agents) — shown in both
  // the public and authenticated nav. Mutually exclusive branches, so reusing one
  // element instance is safe.
  const fiscalAgentsLink = (
    <li>
      <NavLink to="/fiscal-agents" className={({ isActive }) => (isActive ? 'active' : '')}>
        Fiscal Agents
      </NavLink>
    </li>
  );

  const handlePublicSectionNav = (e, sectionId) => {
    e.preventDefault();

    const scrollToSection = () => {
      const section = document.getElementById(sectionId);
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.history.replaceState({}, '', `/#${sectionId}`);
      }
    };

    if (window.location.pathname !== '/') {
      navigate('/');
      window.setTimeout(scrollToSection, 90);
      return;
    }

    scrollToSection();
  };

  return (
    <>
    <header>
      <h1>
        <NavLink to="/" end className="logo-link">
          <img src="/logo-full-white.png" alt="Grant Trail Logo" className="header-logo" />
          {/* <span>GrantTrail</span>*/}
        </NavLink>
      </h1>
      {userRecord?.organization_name && (
        <div className="organization-name">
          {userRecord.organization_name}
        </div>
      )}
      <nav>
        <ul>
          {isPublicView && (
            <>
              <li>
                <a href="/#features" onClick={(e) => handlePublicSectionNav(e, 'features')}>Features</a>
              </li>
              <li>
                <a href="/#plans" onClick={(e) => handlePublicSectionNav(e, 'plans')}>Plans</a>
              </li>
              <li>
                <a href="/#how-it-works" onClick={(e) => handlePublicSectionNav(e, 'how-it-works')}>How It Works</a>
              </li>
              {fiscalAgentsLink}
              <li>
                <NavLink to="/login" className={({ isActive }) => isActive ? 'active' : ''}>
                  Login
                </NavLink>
              </li>
              <li>
                <NavLink to="/join" className={({ isActive }) => `header-public-cta${isActive ? ' active' : ''}`}>
                  Get Started
                </NavLink>
              </li>
            </>
          )}
          {session && isAdmin && (
            <>
              <li>
                <NavLink to="/home" className={({ isActive }) => isActive ? "active" : ""}>
                  Home
                </NavLink>
              </li>
              {!subscriptionLocked && (
                <>
              <li>
                <NavLink to="/admin" end className={({ isActive }) => isActive ? "active" : ""}>
                  Dashboard
                </NavLink>
              </li>
              <li>
                <NavLink to="/admin/grants" className={({ isActive }) => isActive ? "active" : ""}>
                  All Grants
                </NavLink>
              </li>
                </>
              )}
              <li>
                <NavLink to="/subscription" className={({ isActive }) => isActive ? "active" : ""}>
                  Manage Subscription
                </NavLink>
              </li>
            </>
          )}
          {session && isSuperAdmin && (
            <li>
              <NavLink to="/super/tenants" className={({ isActive }) => isActive ? "active" : ""}>
                Tenants
              </NavLink>
            </li>
          )}
          {session && isSuperAdmin && (
            <li>
              <NavLink to="/super/listings" className={({ isActive }) => isActive ? "active" : ""}>
                Listings
              </NavLink>
            </li>
          )}
          {showSubscriptionNav && !isAdmin && (
            <>
              <li>
                <NavLink to="/home" className={({ isActive }) => isActive ? "active" : ""}>
                  Home
                </NavLink>
              </li>
              {!subscriptionLocked && (
                <>
              <li>
                <NavLink to="/" className={({ isActive }) => isActive ? "active" : ""}>
                  Dashboard
                </NavLink>
              </li>
              {isGrantee && (
                <>
              <li>
                <NavLink to="/grants" className={({ isActive }) => isActive ? "active" : ""}>
                  Grants
                </NavLink>
              </li>
              <li>
                <NavLink to="/expenses" className={({ isActive }) => isActive ? "active" : ""}>
                  Expenses
                </NavLink>
              </li>
                </>
              )}
                </>
              )}
              <li>
                <NavLink to="/subscription" className={({ isActive }) => isActive ? "active" : ""}>
                  Manage Subscription
                </NavLink>
              </li>
            </>
          )}
          {session && fiscalAgentsLink}
          {session && (
            <NotificationBell
              notifications={notifications}
              onMarkRead={onMarkRead}
              onMarkAllRead={onMarkAllRead}
              onClearAll={onClearAll}
            />
          )}
          {session && (
            <li className="profile-menu-wrapper" ref={dropdownRef}>
              <button
                className="profile-menu-trigger"
                onClick={() => setDropdownOpen(o => !o)}
                aria-expanded={dropdownOpen}
              >
                <FiUser size={18} />
                <FiChevronDown size={14} className={`profile-chevron${dropdownOpen ? ' open' : ''}`} />
              </button>

              {dropdownOpen && (
                <div className="dropdown-panel profile-dropdown">
                  <div className="profile-dropdown-header">
                    <span className="profile-dropdown-name">{displayName}</span>
                    <span className="profile-dropdown-role">
                      {isAdmin ? 'Administrator' : (userRecord?.organization_name || 'Grantee')}
                    </span>
                  </div>

                  <div className="profile-dropdown-divider" />

                  {isAdmin && (
                    <>
                      <Link
                        to="/fiscal-agents/me"
                        className="profile-dropdown-item"
                        onClick={() => setDropdownOpen(false)}
                      >
                        <FiBriefcase size={15} />
                        Fiscal Agent dashboard
                      </Link>
                      <Link
                        to="/admin/users"
                        className="profile-dropdown-item"
                        onClick={() => setDropdownOpen(false)}
                      >
                        <FiUsers size={15} />
                        Users
                      </Link>
                      <Link
                        to="/admin/audit"
                        className="profile-dropdown-item"
                        onClick={() => setDropdownOpen(false)}
                      >
                        <FiActivity size={15} />
                        Audit Log
                      </Link>
                      <Link
                        to="/admin/settings"
                        className="profile-dropdown-item"
                        onClick={() => setDropdownOpen(false)}
                      >
                        <FiSettings size={15} />
                        Settings
                      </Link>
                    </>
                  )}

                  <button className="profile-dropdown-item profile-dropdown-logout" onClick={handleLogoutClick}>
                    <FiLogOut size={15} />
                    Logout
                  </button>
                </div>
              )}
            </li>
          )}
        </ul>
      </nav>
    </header>
    {session && (
      <div className="user-bar">
        Logged in as <strong>{displayName}</strong>
        <span className="user-bar-role">
          {isSuperAdmin ? 'Super Admin' : isAdmin ? 'Administrator' : 'Grantee'}
        </span>
        {session?.tenantConfig?.name && (
          <span className="user-bar-tenant" title={session.tenantConfig.name}>
            {session.tenantConfig.name}
          </span>
        )}
      </div>
    )}
    </>
  );
}

export default Header;