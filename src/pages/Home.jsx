import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { getUserData } from '../firebase';

function Home({ onSelectCategory, isAdmin }) {
  const navigate = useNavigate();
  const { username, adminname } = useParams();
  const baseUrl = adminname ? `/admin/${adminname}` : `/user/${username}`;
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUserData = async () => {
      try {
        const userStr = localStorage.getItem('currentUser');
        if (userStr) {
          const user = JSON.parse(userStr);
          const data = await getUserData(user.uid);
          setUserData(data);
        }
      } catch (err) {
        console.error('Error loading user data:', err);
      } finally {
        setLoading(false);
      }
    };
    loadUserData();
  }, []);

  const categories = [
    { 
      id: 'business', 
      name: 'Business', 
      description: 'Sales, Revenue, Profit trends',
      color: '#FF6B6B'
    },
    { 
      id: 'education', 
      name: 'Education', 
      description: 'Student scores, attendance, progress',
      color: '#4ECDC4'
    },
    { 
      id: 'sports', 
      name:  'Sports', 
      description: 'Team stats, player performance',
      color: '#FFE66D'
    },
    { 
      id: 'health', 
      name: 'Health', 
      description: 'Patient vitals, metrics',
      color: '#95E1D3'
    },
    { 
      id:  'weather', 
      name: 'Weather', 
      description: 'Temperature, rainfall, climate',
      color: '#A8D8EA'
    },
    { 
      id: 'analytics', 
      name: 'Web Analytics', 
      description: 'Traffic, conversion, engagement',
      color: '#AA96DA'
    },
    { 
      id: 'expression', 
      name: 'Expression Graphs', 
      description: 'Visualize mathematical functions and expressions',
      color: '#4F46E5'
    }
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
    },
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: { duration: 0.5 },
    },
  };

  const cardVariants = {
    hidden: { scale: 0.8, opacity: 0 },
    visible: {
      scale: 1,
      opacity: 1,
      transition: { duration: 0.5 },
    },
    hover: {
      scale: 1.05,
      boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
      transition: { duration: 0.3 },
    },
  };

  if (loading) {
    return (
      <div className="home-container" style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '400px'
      }}>
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: '4px solid #f0f0f0',
            borderTop: '4px solid #667eea'
          }}
        />
      </div>
    );
  }

  return (
    <motion.div 
      className="home-container"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      <motion.div className="home-header mb-5" variants={itemVariants}>
        <motion.h1
          initial={{ x: -50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.6 }}
        >
          Welcome, {userData?.name || 'User'}!
        </motion.h1>
        <motion.p
          initial={{ x: -50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          Create and manage your graphs across different categories
        </motion.p>
      </motion.div>

      <motion.div 
        className="row g-3"
        variants={containerVariants}
      >
        {categories.map((cat, index) => (
          <motion.div 
            key={cat.id} 
            className="col-12 col-sm-6 col-lg-4"
            variants={cardVariants}
          >
            <motion.div
              className="category-card h-100"
              style={{ borderTop: `4px solid ${cat.color}`, cursor: 'pointer' }}
              onClick={() => navigate(`${baseUrl}/${cat.id}`)}
              variants={cardVariants}
              whileHover="hover"
              whileTap={{ scale: 0.98 }}
            >
              <motion.h3
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 + index * 0.1 }}
              >
                {cat.name}
              </motion.h3>
              <motion.p
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 + index * 0.1 }}
              >
                {cat.description}
              </motion.p>
              <motion.button 
                className="explore-btn"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
              >
                Explore
              </motion.button>
            </motion.div>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}

export default Home;