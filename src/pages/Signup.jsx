import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { signup } from '../firebase';

function Signup({ onLoginClick, onSignupSuccess }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signup(email, password, name);
      onSignupSuccess();
    } catch (err) {
      setError(err.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0, scale: 0.9 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: { duration: 0.5 },
    },
  };

  const itemVariants = {
    hidden: { y: 10, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: { duration: 0.4 },
    },
  };

  return (
    <motion.div 
      className="auth-container"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div 
        className="auth-box"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.h1
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6 }}
        >
          MyGraph
        </motion.h1>
        <motion.h2 variants={itemVariants}>Sign Up</motion.h2>
        
        <motion.form 
          onSubmit={handleSubmit}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ staggerChildren: 0.1, delayChildren: 0.2 }}
        >
          <motion.div className="form-group" variants={itemVariants}>
            <motion.label variants={itemVariants}>Name</motion.label>
            <motion.input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              required
              whileFocus={{ scale: 1.02, boxShadow: '0 0 10px rgba(102, 126, 234, 0.5)' }}
              variants={itemVariants}
            />
          </motion.div>

          <motion.div className="form-group" variants={itemVariants}>
            <motion.label variants={itemVariants}>Email</motion.label>
            <motion.input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
              whileFocus={{ scale: 1.02, boxShadow: '0 0 10px rgba(102, 126, 234, 0.5)' }}
              variants={itemVariants}
            />
          </motion.div>

          <motion.div className="form-group" variants={itemVariants}>
            <motion.label variants={itemVariants}>Password</motion.label>
            <motion.input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter a strong password"
              required
              whileFocus={{ scale: 1.02, boxShadow: '0 0 10px rgba(102, 126, 234, 0.5)' }}
              variants={itemVariants}
            />
          </motion.div>

          {error && (
            <motion.div 
              className="error"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              {error}
            </motion.div>
          )}

          <motion.button 
            type="submit" 
            disabled={loading}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            variants={itemVariants}
          >
            {loading ? 'Signing up...' : 'Sign Up'}
          </motion.button>
        </motion.form>

        <motion.p variants={itemVariants}>
          Already have an account? {' '}
          <motion.button 
            className="link-btn" 
            onClick={onLoginClick}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Login
          </motion.button>
        </motion.p>
      </motion.div>
    </motion.div>
  );
}

export default Signup;