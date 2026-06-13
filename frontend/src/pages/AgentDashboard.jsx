import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiFetch, formatDate, formatDuration } from '../utils/api';

export default function AgentDashboard() {
  const { user, logout } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteToken, setInviteToken] = useState('');
  const [customerTokenInput, setCustomerTokenInput] = useState('');
  const [publicUrl, setPublicUrl] = useState(window.location.origin); // fallback to current origin

  // Stats
  const [totalSessions, setTotalSessions] = useState(0);
  const [activeSessions, setActiveSessions] = useState(0);
  const [endedSessions, setEndedSessions] = useState(0);

  // Fetch session history
  const loadSessions = async () => {
    try {
      setLoading(true);
      const data = await apiFetch('/api/sessions');
      setSessions(data);

      // Calculate simple stats
      setTotalSessions(data.length);
      let active = 0;
      let ended = 0;
      data.forEach((s) => {
        if (s.status === 'active' || s.status === 'waiting') active++;
        else if (s.status === 'ended') ended++;
      });
      setActiveSessions(active);
      setEndedSessions(ended);
    } catch (err) {
      addToast('Failed to load sessions: ' + err.message, 'danger');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
    // Fetch real public URL (resolves ngrok tunnel even when opened via localhost)
    fetch('/api/public-url')
      .then((r) => r.json())
      .then((data) => { if (data.url) setPublicUrl(data.url); })
      .catch(() => {}); // silently fall back to window.location.origin
  }, []);

  // Create new session (Agent only)
  const handleCreateSession = async () => {
    try {
      const session = await apiFetch('/api/sessions', { method: 'POST' });
      setInviteToken(session.token);
      addToast('Call session generated!', 'success');
      loadSessions();
    } catch (err) {
      addToast('Failed to create session: ' + err.message, 'danger');
    }
  };

  // Build the customer-facing guest join URL using the real public URL
  const buildGuestLink = (token) => `${publicUrl}/join?token=${token}`;
  // Copy invite URL
  const copyInviteLink = (token) => {
    const url = buildGuestLink(token || inviteToken);
    navigator.clipboard.writeText(url)
      .then(() => addToast('Invite link copied to clipboard!', 'success'))
      .catch(() => addToast('Failed to copy link', 'danger'));
  };

  // Share via WhatsApp
  const shareViaWhatsApp = (token) => {
    const url = buildGuestLink(token || inviteToken);
    const msg = encodeURIComponent(`Hi! Your support agent is ready for you. Click this link to join the video call now:\n${url}`);
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  };

  // Join call (Customer / manual input)
  const handleJoinCallInput = (e) => {
    e.preventDefault();
    const token = customerTokenInput.trim();
    if (!token) {
      addToast('Please enter a valid invite token', 'warning');
      return;
    }
    navigate(`/call?token=${token}`);
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const isCustomer = user.role === 'customer';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Navigation Header */}
      <nav className="navbar">
        <div className="nav-brand">
          <i className="fa-solid fa-video"></i> AtomQuest
        </div>
        <div className="nav-user">
          <span
            className="user-badge"
            style={
              isCustomer
                ? { background: 'rgba(236, 72, 153, 0.15)', color: '#f472b6', borderColor: 'rgba(236, 72, 153, 0.3)' }
                : user.role === 'admin'
                ? { background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', borderColor: 'rgba(16, 185, 129, 0.3)' }
                : {}
            }
          >
            {user.role.toUpperCase()}
          </span>
          <span style={{ fontWeight: 500 }} id="user-name-display">
            {user.name}
          </span>
          <button
            className="btn btn-secondary"
            style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }}
            onClick={handleLogout}
          >
            Logout <i className="fa-solid fa-arrow-right-from-bracket"></i>
          </button>
        </div>
      </nav>

      {/* Main Content Dashboard */}
      <div className="dashboard-container">
        <div className="dashboard-header">
          <div>
            <h1 style={{ fontSize: '2rem', color: 'white' }}>Welcome back, {user.name.split(' ')[0]}</h1>
            <p style={{ color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              {isCustomer
                ? 'Connect instantly to support agents using your invite tokens.'
                : 'Monitor active support calls and generate new invitation tunnels.'}
            </p>
          </div>
          {user.role === 'admin' && (
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.9rem' }}
              onClick={() => navigate('/admin')}
            >
              System Dashboard <i className="fa-solid fa-screwdriver-wrench"></i>
            </button>
          )}
        </div>

        {/* Dashboard stats panel */}
        <div className="stats-grid">
          <div className="stat-card glass-panel">
            <span className="stat-value">{totalSessions}</span>
            <span className="stat-label">Total Support Calls</span>
          </div>
          <div className="stat-card glass-panel" style={{ borderLeft: '3px solid var(--accent)' }}>
            <span className="stat-value" style={{ color: 'var(--accent-hover)' }}>
              {activeSessions}
            </span>
            <span className="stat-label">Active Rooms</span>
          </div>
          <div className="stat-card glass-panel" style={{ borderLeft: '3px solid var(--success)' }}>
            <span className="stat-value" style={{ color: '#34d399' }}>
              {endedSessions}
            </span>
            <span className="stat-label">Completed Calls</span>
          </div>
        </div>

        {/* Control Card Actions */}
        <div className="admin-grid" style={{ gridTemplateColumns: '1fr', marginBottom: '2.5rem' }}>
          {!isCustomer ? (
            // AGENT CONTROLS
            <div className="glass-panel" style={{ padding: '2rem' }}>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.75rem', color: 'white' }}>
                Create Call Tunnel
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                Spawn a new secure, self-hosted media channel for customer routing. Once created, send the unique token link to your customer to begin.
              </p>
              <button className="btn btn-primary" onClick={handleCreateSession}>
                Generate Call Session <i className="fa-solid fa-circle-plus"></i>
              </button>

              {inviteToken && (
                <div className="invite-container" style={{ marginTop: '1.5rem', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.4rem' }}>
                      CUSTOMER DIRECT LINK — share this link, no account needed
                    </p>
                    <div style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      padding: '0.6rem 0.9rem',
                      fontFamily: 'monospace',
                      fontSize: '0.8rem',
                      color: 'var(--accent-hover)',
                      wordBreak: 'break-all',
                    }}>
                      {buildGuestLink(inviteToken)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary" onClick={() => copyInviteLink(inviteToken)}>
                      <i className="fa-solid fa-copy"></i> Copy Link
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => shareViaWhatsApp(inviteToken)}
                      style={{ background: 'rgba(37, 211, 102, 0.15)', borderColor: 'rgba(37, 211, 102, 0.3)', color: '#25d366' }}
                    >
                      <i className="fa-brands fa-whatsapp"></i> WhatsApp
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() => navigate(`/call?token=${inviteToken}`)}
                    >
                      Join Call <i className="fa-solid fa-video"></i>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            // CUSTOMER CONTROLS
            <div className="glass-panel" style={{ padding: '2rem' }}>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.75rem', color: 'white' }}>
                Join Video Call Support
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                Have you received an invite token from an agent? Paste it below to start your real-time video consultation.
              </p>
              <form onSubmit={handleJoinCallInput} style={{ display: 'flex', gap: '0.75rem', maxWidth: '500px' }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter invite token (e.g. df534fa2)"
                  value={customerTokenInput}
                  onChange={(e) => setCustomerTokenInput(e.target.value)}
                  style={{ textTransform: 'lowercase' }}
                  required
                />
                <button type="submit" className="btn btn-primary">
                  Connect Call <i className="fa-solid fa-right-to-bracket"></i>
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Sessions history table */}
        <div className="glass-panel sessions-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.25rem', color: 'white' }}>Support Log Archive</h3>
            <button
              className="btn btn-secondary"
              onClick={loadSessions}
              style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
            >
              Refresh <i className="fa-solid fa-arrows-rotate"></i>
            </button>
          </div>

          <div className="table-container">
            {loading ? (
              <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                Loading log list...
              </p>
            ) : sessions.length === 0 ? (
              <table>
                <tbody>
                  <tr>
                    <td
                      style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem' }}
                    >
                      No call records available.
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Session ID</th>
                    <th>Token</th>
                    <th>Status</th>
                    <th>Created At</th>
                    <th>Duration</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => {
                    let durationStr = '—';
                    if (session.created_at && session.ended_at) {
                      const diffSecs = Math.round(
                        (new Date(session.ended_at) - new Date(session.created_at)) / 1000
                      );
                      durationStr = formatDuration(diffSecs);
                    }

                    const canJoin = session.status !== 'ended';

                    return (
                      <tr key={session.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                          {session.id.substring(0, 8)}...
                        </td>
                        <td style={{ fontWeight: 600 }}>{session.token}</td>
                        <td>
                          <span className={`badge badge-${session.status}`}>{session.status}</span>
                        </td>
                        <td style={{ fontSize: '0.85rem' }}>{formatDate(session.created_at)}</td>
                        <td style={{ fontSize: '0.85rem' }}>{durationStr}</td>
                        <td>
                          {canJoin ? (
                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                              <button
                                className="btn btn-secondary"
                                onClick={() => copyInviteLink(session.token)}
                                style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                                title="Copy guest link"
                              >
                                <i className="fa-solid fa-link"></i> Link
                              </button>
                              <button
                                className="btn btn-primary"
                                onClick={() => navigate(`/call?token=${session.token}`)}
                                style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                              >
                                Join <i className="fa-solid fa-video"></i>
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                              Completed
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
