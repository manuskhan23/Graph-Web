import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
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

  const navItems = [
    { label: 'Home', page: 'home' },
    { label: 'AI Assistant', page: 'ai-chat' },
    { label: 'Calculator', page: 'calculator' },
    { label: 'Survey Form', page: 'survey-form' },
  ];

  const adminItems = [
    { label: 'Survey Graph', page: 'survey-graph' },
    { label: 'Admin Dashboard', page: 'admin-dashboard' },
    { label: 'Manage Admins', page: 'admin-manager' },
  ];

  return (
    <motion.nav 
      className="navbar navbar-expand-lg navbar-dark bg-primary sticky-top"
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="container-fluid">
        <motion.a 
          className="navbar-brand fw-bold fs-5" 
          href="#"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
        >
          MyGraph
        </motion.a>
        <button className="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
          <span className="navbar-toggler-icon"></span>
        </button>
        <div className="collapse navbar-collapse" id="navbarNav">
           <motion.div 
            className="navbar-nav ms-auto gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ staggerChildren: 0.1, delayChildren: 0.2 }}
           >
             {navItems.map((item) => (
              <motion.button
                key={item.page}
                className={`nav-link ${currentPage === item.page ? 'active' : ''}`}
                onClick={() => onPageChange(item.page)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {item.label}
              </motion.button>
            ))}
            {isAdmin && (
              <>
                {adminItems.map((item) => (
                  <motion.button
                    key={item.page}
                    className={`nav-link ${currentPage === item.page ? 'active' : ''}`}
                    onClick={() => onPageChange(item.page)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    {item.label}
                  </motion.button>
                ))}
              </>
            )}
            <motion.button 
              onClick={handleLogout} 
              className="btn btn-danger btn-sm ms-2"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              Logout
            </motion.button>
          </motion.div>
        </div>
      </div>
    </motion.nav>
  );
}

export default Navbar;