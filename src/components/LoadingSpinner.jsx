import React from 'react';
import { motion } from 'framer-motion';

function LoadingSpinner({ text = 'Loading...' }) {
  const containerVariants = {
    animate: {
      rotate: 360,
      transition: {
        duration: 2,
        repeat: Infinity,
        ease: 'linear',
      },
    },
  };

  const dotVariants = {
    animate: {
      scale: [1, 1.2, 1],
      opacity: [0.5, 1, 0.5],
      transition: {
        duration: 1.5,
        repeat: Infinity,
      },
    },
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '400px',
      gap: '20px',
    }}>
      <motion.div
        variants={containerVariants}
        animate="animate"
        style={{
          width: '50px',
          height: '50px',
          borderRadius: '50%',
          border: '4px solid #f0f0f0',
          borderTop: '4px solid #667eea',
        }}
      />
      <motion.p
        style={{
          color: '#666',
          fontSize: '16px',
          fontWeight: '500',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        {text}
      </motion.p>
    </div>
  );
}

export default LoadingSpinner;
