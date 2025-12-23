import React, { useState, useEffect } from 'react';
import { logout, getCurrentUser } from '../firebase';
import { getDatabase, ref, onValue } from 'firebase/database';

function Navbar({ onLogout, onPageChange, currentPage }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isMainAdmin, setIsMainAdmin] = useState(false);
  const mainAdminEmail = 'anus2580@gmail.com';

  useEffect(() => {
    const checkAdmin = async () => {
      const user = getCurrentUser();
      if (!user) return;

      const userEmail = user.email;

      // Check if main admin
      if (userEmail === mainAdminEmail) {
        setIsMainAdmin(true);
        setIsAdmin(true);
        return;
      }

      // Check if in added admins list
      try {
        const surveyDb = getDatabase();
        const adminsRef = ref(surveyDb, 'admins');

        onValue(adminsRef, (snapshot) => {
          const admins = [];
          snapshot.forEach((childSnapshot) => {
            admins.push(childSnapshot.val().email);
          });

          if (admins.includes(userEmail)) {
            setIsAdmin(true);
          }
        }, { onlyOnce: true });
      } catch (error) {
        console.error('Error checking admin status:', error);
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
            {isMainAdmin && (
              <button
                className={currentPage === 'admin-manager' ? 'nav-btn active' : 'nav-btn'}
                onClick={() => onPageChange('admin-manager')}
              >
                👥 Manage Admins
              </button>
            )}
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