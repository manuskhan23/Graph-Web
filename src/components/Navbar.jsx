import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { logout, getCurrentUser } from '../firebase';
import logo from '../logo.png';

function Navbar({ onLogout, isAdmin: userIsAdmin }) {
  const navigate = useNavigate();
  const { username, adminname } = useParams();
  
  // Determine baseUrl based on route and admin status
  let baseUrl;
  if (adminname) {
    baseUrl = `/admin/${adminname}`;
  } else if (username) {
    // If in /user route but user is admin, should navigate to /admin instead
    baseUrl = userIsAdmin ? `/admin/${username}` : `/user/${username}`;
  } else {
    baseUrl = `/`;
  }
  
  // Admin status is passed via props, no need to check here

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
    { label: 'Home', path: baseUrl },
    { label: 'AI Assistant', path: `${baseUrl}/ai-assistant/default` },
    { label: 'Calculator', path: `${baseUrl}/calculator` },
    { label: 'Survey Form', path: `${baseUrl}/survey-form` },
  ];

  const adminItems = [
    { label: 'Survey Graph', path: `${baseUrl}/survey-graph` },
    { label: 'Admin Dashboard', path: `${baseUrl}/admin-dashboard` },
    { label: 'Manage Admins', path: `${baseUrl}/manage-admins` },
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
          className="navbar-brand d-flex align-items-center gap-2" 
          href="#"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <img 
            src={logo} 
            alt="MyGraph Logo" 
            style={{ height: '40px', width: '40px', objectFit: 'contain' }}
          />
          <span className="fw-bold fs-5">MyGraph</span>
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
                 key={item.label}
                 className="nav-link"
                 onClick={() => navigate(item.path)}
                 whileHover={{ scale: 1.05 }}
                 whileTap={{ scale: 0.95 }}
                 initial={{ opacity: 0, y: -10 }}
                 animate={{ opacity: 1, y: 0 }}
               >
                 {item.label}
               </motion.button>
             ))}
             {userIsAdmin && (
               <>
                 {adminItems.map((item) => (
                   <motion.button
                     key={item.label}
                     className="nav-link"
                     onClick={() => navigate(item.path)}
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