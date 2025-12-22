import React from 'react';

function ProtectedRoute({ user, children }) {
  if (!user) {
    return <div style={{ margin: '20px' }}>Loading...</div>;
  }
  return children;
}

export default ProtectedRoute;