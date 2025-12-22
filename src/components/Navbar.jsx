import React from 'react';
import { logout } from '../firebase';

function Navbar({ onLogout, onPageChange, currentPage }) {
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
        <button onClick={handleLogout} className="logout-btn">
          Logout
        </button>
      </div>
    </nav>
  );
}

export default Navbar;