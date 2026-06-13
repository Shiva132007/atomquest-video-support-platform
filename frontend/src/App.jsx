import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import Login from './pages/Login';
import AgentDashboard from './pages/AgentDashboard';
import CallRoom from './pages/CallRoom';
import AdminDashboard from './pages/AdminDashboard';
import GuestJoin from './pages/GuestJoin';

// Route Guard component
function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('token');

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#06020f', color: 'white' }}>
        <h3 style={{ fontFamily: 'Outfit, sans-serif' }}><i className="fa-solid fa-spinner fa-spin"></i> Initializing Secure Shell...</h3>
      </div>
    );
  }

  if (!user) {
    const redirectPath = inviteToken ? `/?token=${inviteToken}` : '/';
    return <Navigate to={redirectPath} replace />;
  }

  if (adminOnly && user.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

export default function App() {
  return (
    <Router>
      <ToastProvider>
        <AuthProvider>
          <SocketProvider>
            <Routes>
              {/* Public routes */}
              <Route path="/" element={<Login />} />
              {/* Direct invite link for customers — no account required */}
              <Route path="/join" element={<GuestJoin />} />

              {/* Protected dashboard and call paths */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <AgentDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/call"
                element={
                  <ProtectedRoute>
                    <CallRoom />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute adminOnly>
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />

              {/* Catch-all redirection */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </SocketProvider>
        </AuthProvider>
      </ToastProvider>
    </Router>
  );
}
