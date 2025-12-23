import React, { useState, useEffect } from 'react';
import { logout, getCurrentUser } from '../firebase';

function Navbar({ onLogout, onPageChange, currentPage }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isMainAdmin, setIsMainAdmin] = useState(false);
  const mainAdminEmail = 'anus2580@gmail.com';

  useEffect(() => {
    const checkAdmin = async () => {
      const user = getCurrentUser();
      if (!user) return;

      const userEmail = user.email.toLowerCase();

      // Check if main admin
      if (userEmail === mainAdminEmail.toLowerCase()) {
        setIsMainAdmin(true);
        setIsAdmin(true);
        return;
      }

      // Check if in added admins list
      try {
        // Dynamically import surveyDatabase to avoid circular dependency
        const { surveyDatabase } = await import('../../survey/surveyFirebase');
        const { ref, onValue } = await import('firebase/database');

        const adminsRef = ref(surveyDatabase, 'admins');

        const unsubscribe = onValue(adminsRef, (snapshot) => {
          const admins = [];
          snapshot.forEach((childSnapshot) => {
            const adminEmail = childSnapshot.val().email.toLowerCase();
            admins.push(adminEmail);
          });

          if (admins.includes(userEmail)) {
            setIsAdmin(true);
          }
        }, (error) => {
          console.error('Error checking admin status:', error);
        });

        // Cleanup subscription
        return () => unsubscribe();
      } catch (error) {
        console.error('Error checking admin status:', error);
      }
    };
    
    const cleanup = checkAdmin();
    return () => {
      if (cleanup && typeof cleanup === 'function') {
        cleanup();
      }
    };
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
            <button
              className={currentPage === 'admin-manager' ? 'nav-btn active' : 'nav-btn'}
              onClick={() => onPageChange('admin-manager')}
            >
              👥 Manage Admins
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