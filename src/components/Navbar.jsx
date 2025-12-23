import React, { useState, useEffect } from 'react';
import { logout, getCurrentUser } from '../firebase';

function Navbar({ onLogout, onPageChange, currentPage }) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const checkAdmin = async () => {
      const user = getCurrentUser();
      if (user && user.email === 'anus2580@gmail.com') {
        setIsAdmin(true);
      }
    };
    checkAdmin();
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      localStorage.removeItem('currentUser');
      onLogout();
    } catch (err) {
      alert('Error logging out: ' + err.message);
    }
  };

  return (
    <nav className="navbar">
      <div className="navbar-brand">📊 MyGraph</div>
      <div className="navbar-links">
        <button
          className={currentPage === 'home' ? 'nav-btn active' : 'nav-btn'}
          onClick={() => onPageChange('home')}
        >
          Home
        </button>
        <button
          className={currentPage === 'ai-chat' ? 'nav-btn active' : 'nav-btn'}
          onClick={() => onPageChange('ai-chat')}
        >
          AI Assistant
        </button>
        {isAdmin && (
          <>
            <button
              className={currentPage === 'survey-graph' ? 'nav-btn active' : 'nav-btn'}
              onClick={() => onPageChange('survey-graph')}
            >
              📊 Survey Graph
            </button>
            <button
              className={currentPage === 'admin-dashboard' ? 'nav-btn active' : 'nav-btn'}
              onClick={() => onPageChange('admin-dashboard')}
            >
              ⚙️ Admin Dashboard
            </button>
          </>
        )}
        <button onClick={handleLogout} className="logout-btn">
          Logout
        </button>
      </div>
    </nav>
  );
}

export default Navbar;