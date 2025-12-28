import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { onAuthStateReady } from './firebase';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Home from './pages/Home.jsx';
import AIChat from './pages/AIChat.jsx';
import ScientificCalculator from './pages/ScientificCalculator.jsx';
import BusinessGraph from './pages/graphs/BusinessGraph.jsx';
import EducationGraph from './pages/graphs/EducationGraph.jsx';
import SportsGraph from './pages/graphs/SportsGraph.jsx';
import HealthGraph from './pages/graphs/HealthGraph.jsx';
import WeatherGraph from './pages/graphs/WeatherGraph.jsx';
import AnalyticsGraph from './pages/graphs/AnalyticsGraph.jsx';
import SurveyForm from '../survey/form.jsx';
import SurveyGraph from '../survey/graph.jsx';
import AdminDashboard from '../survey/admin.jsx';
import AdminManager from '../survey/adminManager.jsx';
import Navbar from './components/Navbar.jsx';
import Footer from './components/Footer.jsx';
import './styles/main.css';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [surveyCompleted, setSurveyCompleted] = useState(() => {
    const saved = localStorage.getItem('surveyCompleted');
    return saved === 'true';
  });
  const [currentPage, setCurrentPage] = useState(() => {
    const surveyDone = localStorage.getItem('surveyCompleted') === 'true';
    return surveyDone ? 'login' : 'survey';
  });

  useEffect(() => {
    const unsubscribe = onAuthStateReady((authUser) => {
      setUser(authUser);
      setLoading(false);
      
      // Only navigate if user just logged in/out
      if (authUser) {
        // User logged in, navigate to home
        setCurrentPage('home');
      } else {
        // User logged out, check if survey is completed
        const surveyDone = localStorage.getItem('surveyCompleted') === 'true';
        setCurrentPage(surveyDone ? 'login' : 'survey');
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const handleNavigate = (e) => {
      const category = e.detail;
      setSelectedCategory(category);
      setCurrentPage('category');
    };
    const handleAINavigate = () => {
      setCurrentPage('ai-chat');
    };
    window.addEventListener('navigateToCategory', handleNavigate);
    window.addEventListener('navigateToAI', handleAINavigate);
    return () => {
      window.removeEventListener('navigateToCategory', handleNavigate);
      window.removeEventListener('navigateToAI', handleAINavigate);
    };
  }, []);

  const handleLogout = () => {
    setUser(null);
    // If survey was already completed, stay on login page; otherwise show survey
    const surveyDone = localStorage.getItem('surveyCompleted') === 'true';
    setCurrentPage(surveyDone ? 'login' : 'survey');
    setSelectedCategory(null);
  };

  const handleSurveyComplete = () => {
    localStorage.setItem('surveyCompleted', 'true');
    setSurveyCompleted(true);
    setCurrentPage('login');
  };

  const handleSelectCategory = (category) => {
    setSelectedCategory(category);
    setCurrentPage('category');
  };

  const handleBackToHome = () => {
    setCurrentPage('home');
    setSelectedCategory(null);
  };

  const renderCategoryPage = () => {
    const props = {
      user,
      onBack: handleBackToHome
    };

    switch (selectedCategory) {
      case 'business':
        return <BusinessGraph {...props} />;
      case 'education': 
        return <EducationGraph {...props} />;
      case 'sports':
        return <SportsGraph {...props} />;
      case 'health': 
        return <HealthGraph {...props} />;
      case 'weather':
        return <WeatherGraph {...props} />;
      case 'analytics':
        return <AnalyticsGraph {...props} />;
      default: 
        return <Home onSelectCategory={handleSelectCategory} />;
    }
  };

  if (loading) {
    return (
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
  }

  return (
    <div className="app">
      {user && <Navbar onLogout={handleLogout} onPageChange={setCurrentPage} currentPage={currentPage} />}
      
      <main className="main-content">
        {!user && !surveyCompleted && (
          <SurveyForm onComplete={handleSurveyComplete} />
        )}

        {!user && surveyCompleted && currentPage === 'login' && (
          <Login onSignupClick={() => setCurrentPage('signup')} onLoginSuccess={() => setCurrentPage('home')} />
        )}
        
        {!user && surveyCompleted && currentPage === 'signup' && (
          <Signup onLoginClick={() => setCurrentPage('login')} onSignupSuccess={() => setCurrentPage('home')} />
        )}
        
        {user && currentPage === 'home' && (
          <Home onSelectCategory={handleSelectCategory} />
        )}

        {user && currentPage === 'ai-chat' && (
          <AIChat user={user} onBack={() => setCurrentPage('home')} />
        )}

        {user && currentPage === 'calculator' && (
          <ScientificCalculator onBack={() => setCurrentPage('home')} />
        )}

        {user && currentPage === 'survey-form' && (
          <SurveyForm onBack={() => setCurrentPage('home')} />
        )}
        
        {user && currentPage === 'category' && selectedCategory && (
          renderCategoryPage()
        )}

        {user && currentPage === 'survey-graph' && (
          <SurveyGraph onBack={() => setCurrentPage('home')} />
        )}

        {user && currentPage === 'admin-dashboard' && (
          <AdminDashboard onBack={() => setCurrentPage('home')} />
        )}

        {user && currentPage === 'admin-manager' && (
          <AdminManager onBack={() => setCurrentPage('home')} />
        )}

        {user && !['home', 'ai-chat', 'calculator', 'survey-form', 'category', 'survey-graph', 'admin-dashboard', 'admin-manager'].includes(currentPage) && (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: '#999'
          }}>
            <p>Loading...</p>
          </div>
        )}
      </main>

      {user && <Footer />}
    </div>
  );
}

export default App;