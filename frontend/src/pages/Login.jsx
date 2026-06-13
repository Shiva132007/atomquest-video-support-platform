import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function Login() {
  const { user, login, register } = useAuth();
  const { addToast } = useToast();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('login');
  
  // Login Form States
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register Form States
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regRole, setRegRole] = useState('agent');

  const [submitting, setSubmitting] = useState(false);

  // Redirection helper
  const handleRedirect = (loggedInUser) => {
    const inviteToken = searchParams.get('token');
    if (inviteToken) {
      navigate(`/call?token=${inviteToken}`);
    } else {
      if (loggedInUser.role === 'admin') {
        navigate('/admin');
      } else {
        navigate('/dashboard');
      }
    }
  };

  // If already logged in, redirect on mount
  useEffect(() => {
    if (user) {
      handleRedirect(user);
    }
  }, [user]);

  const onLoginSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const u = await login(loginEmail, loginPassword);
      handleRedirect(u);
    } catch (err) {
      // toast is already shown inside AuthContext
    } finally {
      setSubmitting(false);
    }
  };

  const onRegisterSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const u = await register(regName, regEmail, regPassword, regRole);
      handleRedirect(u);
    } catch (err) {
      // toast is already shown inside AuthContext
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card glass-panel">
        <div className="auth-logo">
          <h1 className="logo-glow">
            <i className="fa-solid fa-video"></i> AtomQuest
          </h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem', fontSize: '0.9rem' }}>
            Real-Time Video Support Platform
          </p>
        </div>

        <div className="auth-tabs">
          <div
            className={`auth-tab ${activeTab === 'login' ? 'active' : ''}`}
            onClick={() => setActiveTab('login')}
          >
            Sign In
          </div>
          <div
            className={`auth-tab ${activeTab === 'register' ? 'active' : ''}`}
            onClick={() => setActiveTab('register')}
          >
            Register
          </div>
        </div>

        {activeTab === 'login' ? (
          <form onSubmit={onLoginSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="login-email">Email Address</label>
              <input
                type="email"
                id="login-email"
                className="form-input"
                placeholder="agent@demo.com"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="login-password">Password</label>
              <input
                type="password"
                id="login-password"
                className="form-input"
                placeholder="••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '1rem' }}
              disabled={submitting}
            >
              {submitting ? 'Signing In...' : 'Sign In'}{' '}
              <i className="fa-solid fa-arrow-right-to-bracket"></i>
            </button>
          </form>
        ) : (
          <form onSubmit={onRegisterSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="reg-name">Full Name</label>
              <input
                type="text"
                id="reg-name"
                className="form-input"
                placeholder="Jane Doe"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="reg-email">Email Address</label>
              <input
                type="email"
                id="reg-email"
                className="form-input"
                placeholder="jane.doe@company.com"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="reg-password">Password</label>
              <input
                type="password"
                id="reg-password"
                className="form-input"
                placeholder="••••••••"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="reg-role">Role Type</label>
              <select
                id="reg-role"
                className="form-input"
                style={{ background: 'rgba(0,0,0,0.35)', color: 'white' }}
                value={regRole}
                onChange={(e) => setRegRole(e.target.value)}
                required
              >
                <option value="agent" style={{ background: '#15102a' }}>Call Agent</option>
                <option value="customer" style={{ background: '#15102a' }}>Customer</option>
                <option value="admin" style={{ background: '#15102a' }}>Administrator</option>
              </select>
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '1rem' }}
              disabled={submitting}
            >
              {submitting ? 'Creating...' : 'Create Account'}{' '}
              <i className="fa-solid fa-user-plus"></i>
            </button>
          </form>
        )}

        <div style={{ marginTop: '2rem', padding: '1rem', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)', fontSize: '0.8rem' }}>
          <p style={{ fontWeight: '600', color: 'var(--text-main)', marginBottom: '0.5rem' }}>
            <i className="fa-solid fa-key"></i> Quick-Start Demo Logins:
          </p>
          <ul style={{ listStyle: 'none', paddingLeft: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem', color: 'var(--text-muted)' }}>
            <li>💼 <b>Agent:</b> <span style={{ fontFamily: 'monospace', color: 'var(--accent-hover)' }}>agent@demo.com</span> / <span style={{ fontFamily: 'monospace' }}>agent123</span></li>
            <li>👤 <b>Customer:</b> <span style={{ fontFamily: 'monospace', color: 'var(--accent-hover)' }}>customer@demo.com</span> / <span style={{ fontFamily: 'monospace' }}>customer123</span></li>
            <li>🛠️ <b>Admin:</b> <span style={{ fontFamily: 'monospace', color: 'var(--accent-hover)' }}>admin@demo.com</span> / <span style={{ fontFamily: 'monospace' }}>admin123</span></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
