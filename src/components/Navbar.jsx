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
    <nav className="navbar navbar-expand-lg navbar-dark bg-primary sticky-top">
      <div className="container-fluid">
        <a className="navbar-brand fw-bold fs-5" href="#">MyGraph</a>
        <button className="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
          <span className="navbar-toggler-icon"></span>
        </button>
        <div className="collapse navbar-collapse" id="navbarNav">
          <div className="navbar-nav ms-auto gap-2">
            <button
              className={`nav-link ${currentPage === 'home' ? 'active' : ''}`}
              onClick={() => onPageChange('home')}
            >
              Home
            </button>
            <button
              className={`nav-link ${currentPage === 'ai-chat' ? 'active' : ''}`}
              onClick={() => onPageChange('ai-chat')}
            >
              AI Assistant
            </button>
            <button
              className={`nav-link ${currentPage === 'calculator' ? 'active' : ''}`}
              onClick={() => onPageChange('calculator')}
            >
              Calculator
            </button>
            <button
              className={`nav-link ${currentPage === 'survey-form' ? 'active' : ''}`}
              onClick={() => onPageChange('survey-form')}
            >
              Survey Form
            </button>
            {isAdmin && (
              <>
                <button
                  className={`nav-link ${currentPage === 'survey-graph' ? 'active' : ''}`}
                  onClick={() => onPageChange('survey-graph')}
                >
                  Survey Graph
                </button>
                <button
                  className={`nav-link ${currentPage === 'admin-dashboard' ? 'active' : ''}`}
                  onClick={() => onPageChange('admin-dashboard')}
                >
                  Admin Dashboard
                </button>
                <button
                  className={`nav-link ${currentPage === 'admin-manager' ? 'active' : ''}`}
                  onClick={() => onPageChange('admin-manager')}
                >
                  Manage Admins
                </button>
              </>
            )}
            <button onClick={handleLogout} className="btn btn-danger btn-sm ms-2">
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;