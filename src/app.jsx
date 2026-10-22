import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { onAuthStateReady, ensureUsername } from './firebase';
import './styles/main.css';

// Pages
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Home from './pages/Home.jsx';
import AIChat from './pages/AIChat.jsx';
import ScientificCalculator from './pages/ScientificCalculator.jsx';
import SharedGraphView from './pages/SharedGraphView.jsx';
import PrivateGraphView from './pages/PrivateGraphView.jsx';
import PrivacyPolicy from './pages/PrivacyPolicy.jsx';
import TermsAndConditions from './pages/TermsAndConditions.jsx';
import AboutUs from './pages/AboutUs.jsx';
import ContactUs from './pages/ContactUs.jsx';
import GraphRouter from './components/GraphRouter.jsx';
import Navbar from './components/Navbar.jsx';
import Footer from './components/Footer.jsx';

// Loading Component
const LoadingScreen = () => (
  <motion.div
    style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      fontSize: '18px',
      fontWeight: '600',
      gap: '20px'
    }}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
  >
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
      style={{
        width: '60px',
        height: '60px',
        borderRadius: '50%',
        border: '4px solid rgba(255,255,255,0.3)',
        borderTop: '4px solid white'
      }}
    />
    <motion.p
      animate={{ opacity: [0.5, 1, 0.5] }}
      transition={{ duration: 2, repeat: Infinity }}
    >
      Loading your application...
    </motion.p>
  </motion.div>
);

// Layout Wrapper
const UserLayout = ({ children, user, onLogout }) => (
  <div className="app">
    {user && <Navbar onLogout={onLogout} />}
    <main className="main-content">{children}</main>
    {user && <Footer />}
  </div>
);

// Note: Navbar doesn't need onPageChange anymore as it uses useNavigate hook

// Protected Route
const ProtectedRoute = ({ children, user, loading }) => {
  if (loading) {
    return <LoadingScreen />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

// Root Route Handler - Check for share links
const RootRouteHandler = ({ user, userUsername, loading }) => {
  const [searchParams] = useSearchParams();
  const shareCode = searchParams.get("share");

  // If share link is present, show SharedGraphView regardless of auth
  if (shareCode) {
    return <SharedGraphView />;
  }

  // Otherwise, handle normal routing
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!userUsername) {
    return <LoadingScreen />;
  }
  return <Navigate to={`/user/${userUsername}`} replace />;
};

function AppRoutes() {
  const [user, setUser] = useState(null);
  const [userUsername, setUserUsername] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateReady(async (authUser) => {
      setUser(authUser);

      if (authUser) {
        // Fetch or create username from database
        try {
          const username = await ensureUsername(authUser.uid);
          setUserUsername(username);
        } catch (err) {
          console.error('Error fetching username:', err);
          setUserUsername(authUser.displayName || authUser.uid);
        }
      } else {
        setUserUsername(null);
      }

      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const handleLogout = () => {
    setUser(null);
    window.location.href = '/login';
  };

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <Routes>
      {/* Root Route - Handle share links */}
      <Route 
        path="/" 
        element={<RootRouteHandler user={user} userUsername={userUsername} loading={loading} />}
      />

      {/* Public Routes */}
      <Route
        path="/login"
        element={
          user && userUsername ? (
            <Navigate to={`/user/${userUsername}`} replace />
          ) : (
            <Login
              onSignupClick={() => (window.location.href = '/signup')}
              onLoginSuccess={() => {
                // Auth state change will redirect automatically
              }}
            />
          )
        }
      />
      <Route
        path="/signup"
        element={
          user && userUsername ? (
            <Navigate to={`/user/${userUsername}`} replace />
          ) : (
            <Signup
              onLoginClick={() => (window.location.href = '/login')}
              onSignupSuccess={() => {
                // Auth state change will redirect automatically
              }}
            />
          )
        }
      />
      <Route path="/share" element={<SharedGraphView />} />
      <Route path="/private/:linkCode" element={<PrivateGraphView />} />
      <Route path="/privacy-policy" element={<PrivacyPolicy />} />
      <Route path="/terms-conditions" element={<TermsAndConditions />} />
      <Route path="/about-us" element={<AboutUs />} />
      <Route path="/contact-us" element={<ContactUs />} />

      {/* ============ USER ROUTES: /user/:username/* ============ */}
      <Route path="/user/:username">
        {/* Home */}
        <Route
          index
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout}>
                <Home user={user} />
              </UserLayout>
            </ProtectedRoute>
          }
        />

        {/* Graph Routes */}
        <Route
          path=":graphType/*"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout}>
                <GraphRouter user={user} onBack={() => window.history.back()} />
              </UserLayout>
            </ProtectedRoute>
          }
        />

        {/* News/Legal Routes */}
        <Route
          path="news/privacy-policy"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout}>
                <PrivacyPolicy />
              </UserLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="news/terms-conditions"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout}>
                <TermsAndConditions />
              </UserLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="news/about-us"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout}>
                <AboutUs />
              </UserLayout>
            </ProtectedRoute>
          }
        />

        {/* AI Assistant Routes */}
        <Route
          path="ai-assistant/:chatName"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout}>
                <AIChat user={user} />
              </UserLayout>
            </ProtectedRoute>
          }
        />

        {/* Contact */}
        <Route
          path="contact"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout}>
                <ContactUs />
              </UserLayout>
            </ProtectedRoute>
          }
        />

        {/* Calculator */}
        <Route
          path="calculator"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout}>
                <ScientificCalculator />
              </UserLayout>
            </ProtectedRoute>
          }
        />

      </Route>

      {/* Fallback */}
      <Route
        path="*"
        element={
          <div style={{ padding: '40px', textAlign: 'center', fontSize: '18px' }}>
            Page not found
          </div>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
