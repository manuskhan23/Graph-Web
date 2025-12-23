import React, { useState, useEffect } from 'react';
import { getUserData } from '../firebase';

function Home({ onSelectCategory }) {
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
    }
  ];

  if (loading) {
    return (
      <div className="home-container" style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '400px'
      }}>
        <p style={{ color: '#999', fontSize: '16px' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="home-container">
      <div className="home-header">
        <h1>Welcome, {userData?.name || 'User'}!</h1>
        <p>Create and manage your graphs across different categories</p>
      </div>

      <div className="categories-grid">
        {categories.map((cat) => (
          <div
            key={cat.id}
            className="category-card"
            style={{ borderTop: `4px solid ${cat.color}` }}
            onClick={() => onSelectCategory(cat.id)}
          >
            <h3>{cat.name}</h3>
            <p>{cat.description}</p>
            <button className="explore-btn">Explore →</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Home;