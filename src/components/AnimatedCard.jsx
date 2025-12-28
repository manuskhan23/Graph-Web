import React from 'react';
import { motion } from 'framer-motion';

function AnimatedCard({ children, index = 0, onClick, className = '', ...props }) {
  const cardVariants = {
    hidden: { scale: 0.8, opacity: 0 },
    visible: {
      scale: 1,
      opacity: 1,
      transition: { duration: 0.5, delay: index * 0.1 },
    },
    hover: {
      scale: 1.05,
      boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
      transition: { duration: 0.3 },
    },
  };

  return (
    <motion.div
      className={className}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      whileHover="hover"
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export default AnimatedCard;
