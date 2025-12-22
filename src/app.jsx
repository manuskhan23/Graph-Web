import React, { useState, useEffect } from 'react';
import { onAuthStateReady } from './firebase';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Home from './pages/Home.jsx';
import AIChat from './pages/AIChat.jsx';
import BusinessGraph from './pages/graphs/BusinessGraph.jsx';
import EducationGraph from './pages/graphs/EducationGraph.jsx';
import SportsGraph from './pages/graphs/SportsGraph.jsx';
import HealthGraph from './pages/graphs/HealthGraph.jsx';
import WeatherGraph from './pages/graphs/WeatherGraph.jsx';
import AnalyticsGraph from './pages/graphs/AnalyticsGraph.jsx';
import Navbar from './components/Navbar.jsx';
import Footer from './components/Footer.jsx';
import './styles/main.css';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState('login');
  const [selectedCategory, setSelectedCategory] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateReady((authUser) => {
      setUser(authUser);
      setLoading(false);
      
      if (authUser && (currentPage === 'login' || currentPage === 'signup')) {
        setCurrentPage('home');
      } else if (!authUser && currentPage !== 'login' && currentPage !== 'signup') {
        setCurrentPage('login');
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
    setCurrentPage('login');
    setSelectedCategory(null);
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
    return <div style={{ margin: '20px', textAlign: 'center' }}>Checking session...</div>;
  }

  return (
    <div className="app">
      {user && <Navbar onLogout={handleLogout} onPageChange={setCurrentPage} currentPage={currentPage} />}
      
      <main className="main-content">
        {currentPage === 'login' && !user && (
          <Login onSignupClick={() => setCurrentPage('signup')} onLoginSuccess={() => setCurrentPage('home')} />
        )}
        
        {currentPage === 'signup' && !user && (
          <Signup onLoginClick={() => setCurrentPage('login')} onSignupSuccess={() => setCurrentPage('home')} />
        )}
        
        {user && currentPage === 'home' && (
          <Home onSelectCategory={handleSelectCategory} />
        )}

        {user && currentPage === 'ai-chat' && (
          <AIChat user={user} onBack={() => setCurrentPage('home')} />
        )}
        
        {user && currentPage === 'category' && selectedCategory && (
          renderCategoryPage()
        )}
      </main>

      {user && <Footer />}
    </div>
  );
}

export default App;