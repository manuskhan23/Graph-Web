import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { onAuthStateReady, isUserAdmin, getUserData, ensureUsername } from './firebase';
import './styles/main.css';

// Pages
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Home from './pages/Home.jsx';
import AIChat from './pages/AIChat.jsx';
import ScientificCalculator from './pages/ScientificCalculator.jsx';
import SharedGraphView from './pages/SharedGraphView.jsx';
import PrivacyPolicy from './pages/PrivacyPolicy.jsx';
import TermsAndConditions from './pages/TermsAndConditions.jsx';
import AboutUs from './pages/AboutUs.jsx';
import ContactUs from './pages/ContactUs.jsx';
import SurveyForm from '../survey/form.jsx';
import SurveyGraph from '../survey/graph.jsx';
import AdminDashboard from '../survey/admin.jsx';
import AdminManager from '../survey/adminManager.jsx';
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
const UserLayout = ({ children, user, onLogout, isAdmin }) => (
  <div className="app">
    {user && <Navbar onLogout={onLogout} isAdmin={isAdmin} />}
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
const RootRouteHandler = ({ user, userUsername, isAdmin, surveyCompleted, onSurveyComplete, loading }) => {
  const [searchParams] = useSearchParams();
  const shareCode = searchParams.get("share");

  // If share link is present, show SharedGraphView regardless of auth
  if (shareCode) {
    return <SharedGraphView />;
  }

  // Otherwise, handle normal routing
  if (!surveyCompleted) {
    return <SurveyForm onComplete={onSurveyComplete} />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!userUsername) {
    return <LoadingScreen />;
  }
  if (isAdmin) {
    return <Navigate to={`/admin/${userUsername}`} replace />;
  }
  return <Navigate to={`/user/${userUsername}`} replace />;
};

function AppRoutes() {
  const [user, setUser] = useState(null);
  const [userUsername, setUserUsername] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [surveyCompleted, setSurveyCompleted] = useState(() => {
    return localStorage.getItem('surveyCompleted') === 'true';
  });

  useEffect(() => {
    const unsubscribe = onAuthStateReady(async (authUser) => {
      setUser(authUser);
      
      // Check if user is admin
      if (authUser) {
        const mainAdminEmail = 'anus2580@gmail.com';
        const adminStatus = authUser.email && authUser.email.toLowerCase() === mainAdminEmail.toLowerCase();
        setIsAdmin(adminStatus);
        
        // Fetch or create username from database
        try {
          const username = await ensureUsername(authUser.uid);
          setUserUsername(username);
        } catch (err) {
          console.error('Error fetching username:', err);
          setUserUsername(authUser.displayName || authUser.uid);
        }
      } else {
        setIsAdmin(false);
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

  const handleSurveyComplete = () => {
    localStorage.setItem('surveyCompleted', 'true');
    setSurveyCompleted(true);
  };

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <Routes>
      {/* Root Route - Handle share links */}
      <Route 
        path="/" 
        element={<RootRouteHandler user={user} userUsername={userUsername} isAdmin={isAdmin} surveyCompleted={surveyCompleted} onSurveyComplete={handleSurveyComplete} loading={loading} />}
      />

      {/* Public Routes */}
      <Route
        path="/login"
        element={
          user && userUsername ? (
            isAdmin ? (
              <Navigate to={`/admin/${userUsername}`} replace />
            ) : (
              <Navigate to={`/user/${userUsername}`} replace />
            )
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
            isAdmin ? (
              <Navigate to={`/admin/${userUsername}`} replace />
            ) : (
              <Navigate to={`/user/${userUsername}`} replace />
            )
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
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
                <Home user={user} isAdmin={false} />
              </UserLayout>
            </ProtectedRoute>
          }
        />

        {/* Graph Routes */}
        <Route
          path=":graphType/:graphName"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
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
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
                <PrivacyPolicy />
              </UserLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="news/terms-conditions"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
                <TermsAndConditions />
              </UserLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="news/about-us"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
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
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
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
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
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
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
                <ScientificCalculator />
              </UserLayout>
            </ProtectedRoute>
          }
        />

        {/* Survey Form */}
        <Route
          path="survey-form"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
                <SurveyForm user={user} />
              </UserLayout>
            </ProtectedRoute>
          }
        />

        {/* Survey Graph */}
        <Route
          path="survey-graph"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
                <SurveyGraph user={user} />
              </UserLayout>
            </ProtectedRoute>
          }
        />
      </Route>

      {/* ============ ADMIN ROUTES: /admin/:adminname/* ============ */}
      <Route path="/admin/:adminname">
         {/* Home */}
        <Route
          index
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
                <Home user={user} isAdmin={true} />
              </UserLayout>
            </ProtectedRoute>
          }
        />

        {/* Graph Routes */}
        <Route
          path=":graphType/:graphName"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
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
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
                <PrivacyPolicy />
              </UserLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="news/terms-conditions"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
                <TermsAndConditions />
              </UserLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="news/about-us"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
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
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
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
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
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
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
                <ScientificCalculator />
              </UserLayout>
            </ProtectedRoute>
          }
        />

        {/* Survey Form */}
        <Route
          path="survey-form"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
                <SurveyForm user={user} />
              </UserLayout>
            </ProtectedRoute>
          }
        />

        {/* Survey Graph */}
        <Route
          path="survey-graph"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
                <SurveyGraph user={user} />
              </UserLayout>
            </ProtectedRoute>
          }
        />

        {/* Admin Dashboard */}
        <Route
          path="admin-dashboard"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
                <AdminDashboard user={user} />
              </UserLayout>
            </ProtectedRoute>
          }
        />

        {/* Admin Dashboard - Unique Students */}
        <Route
          path="admin-dashboard/unique-students"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
                <AdminDashboard user={user} tab="unique-students" />
              </UserLayout>
            </ProtectedRoute>
          }
        />

        {/* Admin Dashboard - Responses */}
        <Route
          path="admin-dashboard/responses"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
                <AdminDashboard user={user} tab="responses" />
              </UserLayout>
            </ProtectedRoute>
          }
        />

        {/* Admin Dashboard - Manage Admins */}
        <Route
          path="admin-dashboard/manage-admins"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
                <AdminDashboard user={user} tab="manage-admins" />
              </UserLayout>
            </ProtectedRoute>
          }
        />

        {/* Manage Admins */}
        <Route
          path="manage-admins"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <UserLayout user={user} onLogout={handleLogout} isAdmin={isAdmin}>
                <AdminManager user={user} />
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
