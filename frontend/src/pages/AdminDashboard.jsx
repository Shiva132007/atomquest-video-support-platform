import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiFetch, formatDate, formatDuration } from '../utils/api';

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();

  // Metrics
  const [metrics, setMetrics] = useState({
    activeSessions: 0,
    totalSessions: 0,
    system: {
      memoryUsedMB: 0,
      uptime: 0
    }
  });

  const [liveSessions, setLiveSessions] = useState([]);
  const [historySessions, setHistorySessions] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Validate Admin Role on Mount
  useEffect(() => {
    if (user.role !== 'admin') {
      addToast('Unauthorized access. Admin role required.', 'danger');
      navigate('/dashboard');
    }
  }, [user, navigate]);

  // Fetch all stats/data
  const refreshStats = async () => {
    try {
      // 1. Fetch system metrics
      const m = await apiFetch('/api/admin/metrics');
      setMetrics(m);

      // 2. Fetch live session list
      const live = await apiFetch('/api/admin/live-sessions');
      setLiveSessions(live);
    } catch (err) {
      console.error('Error polling admin metrics:', err);
    }
  };

  const fetchHistory = async () => {
    try {
      setLoadingHistory(true);
      const hist = await apiFetch('/api/admin/session-history');
      setHistorySessions(hist);
    } catch (err) {
      addToast('Failed to load logs: ' + err.message, 'danger');
    } finally {
      setLoadingHistory(false);
    }
  };

  // Poll metrics every 5 seconds
  useEffect(() => {
    refreshStats();
    fetchHistory();

    const interval = setInterval(() => {
      refreshStats();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Administrative termination
  const handleTerminateSession = async (sessionId) => {
    const confirmEnd = window.confirm('Are you sure you want to administratively terminate this active session? All connections will be dropped.');
    if (!confirmEnd) return;

    try {
      await apiFetch(`/api/admin/sessions/${sessionId}/end`, { method: 'POST' });
      addToast('Session terminated successfully', 'success');
      refreshStats();
      fetchHistory();
    } catch (err) {
      addToast('Failed to terminate session: ' + err.message, 'danger');
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  if (user.role !== 'admin') {
    return null; // Don't render anything if unauthorized
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Top Navbar */}
      <nav className="navbar">
        <div className="nav-brand">
          <i className="fa-solid fa-screwdriver-wrench"></i> AtomQuest Admin
        </div>
        <div className="nav-user">
          <span className="user-badge" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
            ADMINISTRATOR
          </span>
          <span style={{ fontWeight: 500 }}>{user.name}</span>
          <button className="btn btn-secondary" style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }} onClick={handleLogout}>
            Logout <i className="fa-solid fa-arrow-right-from-bracket"></i>
          </button>
        </div>
      </nav>

      {/* Main Admin Dashboard */}
      <div className="dashboard-container">
        <div className="dashboard-header">
          <div>
            <h1 style={{ fontSize: '2rem', color: 'white' }}>System Metrics & Audits</h1>
            <p style={{ color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Real-time server resource observability and live call channel interceptions.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/dashboard')} style={{ fontSize: '0.9rem' }}>
            Agent Dashboard <i className="fa-solid fa-gauge"></i>
          </button>
        </div>

        {/* System metrics row */}
        <div className="stats-grid">
          <div className="stat-card glass-panel" style={{ borderLeft: '3px solid var(--accent)' }}>
            <span className="stat-value" style={{ color: 'var(--accent-hover)' }}>{metrics.activeSessions}</span>
            <span className="stat-label">Live Active Calls</span>
          </div>
          <div className="stat-card glass-panel">
            <span className="stat-value">{metrics.totalSessions}</span>
            <span className="stat-label">Total Channels Today</span>
          </div>
          <div className="stat-card glass-panel">
            <span className="stat-value">{metrics.system.memoryUsedMB} MB</span>
            <span className="stat-label">Server Memory Allocated</span>
          </div>
          <div className="stat-card glass-panel">
            <span className="stat-value">{metrics.system.uptime}s</span>
            <span className="stat-label">Server Uptime</span>
          </div>
        </div>

        {/* Live sessions & historical logs panels */}
        <div className="admin-grid">
          {/* Live Sessions Column */}
          <div>
            <div className="dashboard-header" style={{ marginBottom: '1rem' }}>
              <h3 style={{ color: 'white', fontSize: '1.25rem' }}>Live Ongoing Channels</h3>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} id="live-calls-container">
              {liveSessions.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '4rem', background: 'rgba(0,0,0,0.15)', borderRadius: '12px', border: '1px dashed rgba(255,255,255,0.05)' }}>
                  <i className="fa-solid fa-face-smile" style={{ fontSize: '2rem', color: 'rgba(255,255,255,0.15)', marginBottom: '0.75rem', display: 'block' }}></i>
                  No support calls active at this time.
                </div>
              ) : (
                liveSessions.map((session) => {
                  const participantsList = session.current_participants
                    ? session.current_participants.split(',')
                    : ['No active participants'];

                  return (
                    <div key={session.id} className="glass-panel" style={{ padding: '1.25rem', background: 'rgba(0, 0, 0, 0.2)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontWeight: 600, color: 'white', fontSize: '0.95rem' }}>
                            Session {session.token}
                          </span>
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: '0.15rem' }}>
                            ID: {session.id.substring(0, 8)}...
                          </p>
                        </div>
                        <button className="btn btn-danger" onClick={() => handleTerminateSession(session.id)} style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem' }}>
                          End Call <i className="fa-solid fa-power-off"></i>
                        </button>
                      </div>

                      <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '8px', padding: '0.75rem', fontSize: '0.8rem', border: '1px solid rgba(255,255,255,0.03)' }}>
                        <p style={{ fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                          Host Agent: {session.agent_name || 'N/A'}
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <p style={{ color: 'var(--text-main)', fontWeight: 500 }}>Connected Users:</p>
                          <ul style={{ listStyle: 'none', paddingLeft: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.15rem', color: 'var(--accent-hover)' }}>
                            {participantsList.map((p, i) => (
                              <li key={i}>
                                <i className="fa-solid fa-circle-user"></i> {p.trim()}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifySelf: 'flex-end', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        <span>Opened: {new Date(session.created_at).toLocaleTimeString()}</span>
                        <div className="live-badge">
                          <span className="live-dot"></span>
                          <span>{session.status}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Historical Logs column */}
          <div className="glass-panel admin-list-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ color: 'white', fontSize: '1.25rem' }}>Channel Audit Trails</h3>
              <button className="btn btn-secondary" onClick={fetchHistory} style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}>
                Reload Logs
              </button>
            </div>

            <div className="table-container" style={{ maxHeight: '450px', overflowY: 'auto' }}>
              {loadingHistory ? (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                  Loading logs...
                </p>
              ) : historySessions.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                  No past session logs found.
                </p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Token</th>
                      <th>Status</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historySessions.map((session) => {
                      let durationStr = '—';
                      if (session.created_at && session.ended_at) {
                        const diffSecs = Math.round(
                          (new Date(session.ended_at) - new Date(session.created_at)) / 1000
                        );
                        durationStr = formatDuration(diffSecs);
                      }

                      return (
                        <tr key={session.id}>
                          <td style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                            {session.agent_name || 'N/A'}
                          </td>
                          <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                            {session.token}
                          </td>
                          <td>
                            <span className={`badge badge-${session.status}`}>
                              {session.status}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.85rem' }}>{durationStr}</td>
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
    </div>
  );
}
