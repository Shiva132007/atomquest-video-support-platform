import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function GuestJoin() {
  const [searchParams] = useSearchParams();
  const sessionToken = searchParams.get('token');
  const navigate = useNavigate();
  const { guestLogin } = useAuth();
  const { addToast } = useToast();

  const [guestName, setGuestName] = useState('');
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [sessionValid, setSessionValid] = useState(false);

  // Validate session token on mount
  useEffect(() => {
    if (!sessionToken) {
      addToast('Invalid invite link — no token provided.', 'danger');
      setValidating(false);
      return;
    }

    fetch(`/api/sessions/by-token/${sessionToken}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          addToast(data.error, 'danger');
          setSessionValid(false);
        } else {
          setSessionValid(true);
        }
      })
      .catch(() => {
        addToast('Could not verify invite link.', 'danger');
        setSessionValid(false);
      })
      .finally(() => setValidating(false));
  }, [sessionToken]);

  const handleJoin = async (e) => {
    e.preventDefault();
    const name = guestName.trim();
    if (!name) {
      addToast('Please enter your name to continue.', 'warning');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/guest-join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, guestName: name }),
      });
      const data = await res.json();

      if (!res.ok) {
        addToast(data.error || 'Failed to join session.', 'danger');
        setLoading(false);
        return;
      }

      // Store guest credentials and navigate to call room
      await guestLogin(data.token, data.user);
      navigate(`/call?token=${sessionToken}`);
    } catch (err) {
      addToast('Connection error. Please try again.', 'danger');
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background glow orbs */}
      <div style={{
        position: 'absolute', top: '15%', left: '10%',
        width: '400px', height: '400px',
        background: 'radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 70%)',
        borderRadius: '50%', pointerEvents: 'none'
      }} />
      <div style={{
        position: 'absolute', bottom: '10%', right: '8%',
        width: '320px', height: '320px',
        background: 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)',
        borderRadius: '50%', pointerEvents: 'none'
      }} />

      <div style={{
        width: '100%',
        maxWidth: '460px',
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Header branding */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '72px', height: '72px',
            background: 'linear-gradient(135deg, var(--accent), #a855f7)',
            borderRadius: '20px',
            marginBottom: '1.25rem',
            boxShadow: '0 0 40px rgba(124,58,237,0.4)',
          }}>
            <i className="fa-solid fa-headset" style={{ fontSize: '2rem', color: 'white' }}></i>
          </div>
          <h1 style={{
            fontSize: '2rem', fontWeight: 700, color: 'white',
            background: 'linear-gradient(135deg, #ffffff 0%, #c084fc 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            marginBottom: '0.5rem'
          }}>
            You're Invited!
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.5 }}>
            An agent is waiting to help you. Just enter your name to join the call instantly — no account needed.
          </p>
        </div>

        {/* Main card */}
        <div className="glass-panel" style={{ padding: '2.5rem' }}>
          {validating ? (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
              <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '2rem', marginBottom: '1rem', display: 'block' }}></i>
              Verifying your invite link...
            </div>
          ) : !sessionValid ? (
            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <i className="fa-solid fa-triangle-exclamation" style={{
                fontSize: '2.5rem', color: 'var(--danger)', marginBottom: '1rem', display: 'block'
              }}></i>
              <h3 style={{ color: 'white', marginBottom: '0.5rem' }}>Invalid Invite Link</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                This invite link is invalid or the session has already ended. Please request a new link from your support agent.
              </p>
            </div>
          ) : (
            <form onSubmit={handleJoin}>
              {/* Live indicator */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem',
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.2)',
                borderRadius: '10px',
                padding: '0.75rem 1rem',
                marginBottom: '2rem',
              }}>
                <span style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: '#10b981',
                  boxShadow: '0 0 8px #10b981',
                  display: 'inline-block',
                  animation: 'pulse 2s infinite'
                }}></span>
                <span style={{ color: '#34d399', fontSize: '0.875rem', fontWeight: 500 }}>
                  Session is active — join now
                </span>
              </div>

              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">Your Name</label>
                <input
                  type="text"
                  id="guest-name-input"
                  className="form-input"
                  placeholder="e.g. John Smith"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  autoFocus
                  maxLength={60}
                  required
                  style={{ fontSize: '1.05rem' }}
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                  This name will be shown to the support agent during the call.
                </p>
              </div>

              <button
                type="submit"
                id="guest-join-btn"
                className="btn btn-primary"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '0.875rem',
                  fontSize: '1rem',
                  fontWeight: 600,
                  gap: '0.5rem',
                }}
              >
                {loading ? (
                  <><i className="fa-solid fa-spinner fa-spin"></i> Connecting...</>
                ) : (
                  <><i className="fa-solid fa-video"></i> Join Support Call</>
                )}
              </button>

              <p style={{
                textAlign: 'center', fontSize: '0.75rem',
                color: 'rgba(255,255,255,0.25)', marginTop: '1.25rem', lineHeight: 1.6
              }}>
                <i className="fa-solid fa-lock" style={{ marginRight: '0.3rem' }}></i>
                Your call is end-to-end encrypted via WebRTC. No personal data is stored from guest sessions.
              </p>
            </form>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.8rem', color: 'rgba(255,255,255,0.2)' }}>
          Powered by <strong style={{ color: 'rgba(255,255,255,0.35)' }}>AtomQuest</strong>
        </p>
      </div>
    </div>
  );
}
