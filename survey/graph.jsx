import React, { useEffect, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement } from 'chart.js';
import { Pie, Bar, Line } from 'react-chartjs-2';
import { surveyDatabase } from './surveyFirebase';
import './form.css';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement);

function SurveyGraph({ onBack }) {
  const [surveyData, setSurveyData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState('pie');

  useEffect(() => {
    const surveysRef = ref(surveyDatabase, 'surveys');

    const unsubscribe = onValue(surveysRef, (snapshot) => {
      const data = [];
      snapshot.forEach((childSnapshot) => {
        data.push(childSnapshot.val());
      });
      setSurveyData(data);
      setLoading(false);
    }, (error) => {
      console.error('Error loading survey data:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const calculateStatistics = () => {
    if (surveyData.length === 0) {
      return {
        totalResponses: 0,
        platformStats: {},
        timeSpentStats: {}
      };
    }

    const totalResponses = surveyData.length;
    const platformStats = {};
    const timeSpentStats = {
      '2hrs': 0,
      '4hrs': 0,
      '6hrs': 0,
      '8hrs': 0,
      '8plus': 0
    };

    surveyData.forEach(response => {
      // Platform statistics - handle both array (platforms) and single (platform)
      if (Array.isArray(response.platforms)) {
        response.platforms.forEach(platform => {
          platformStats[platform] = (platformStats[platform] || 0) + 1;
        });
      } else if (response.platform) {
        platformStats[response.platform] = (platformStats[response.platform] || 0) + 1;
      }

      // Time spent statistics
      if (response.timeSpent) {
        timeSpentStats[response.timeSpent] = (timeSpentStats[response.timeSpent] || 0) + 1;
      }
    });

    // Convert counts back to actual counts (not percentages) for accurate display
    const platformCounts = { ...platformStats };
    
    // Convert to percentages for display
    Object.keys(platformStats).forEach(key => {
      platformStats[key] = Math.round((platformStats[key] / surveyData.length) * 100);
    });

    Object.keys(timeSpentStats).forEach(key => {
      timeSpentStats[key] = Math.round((timeSpentStats[key] / totalResponses) * 100);
    });

    return {
      totalResponses,
      platformStats,
      timeSpentStats,
      platformCounts
    };
  };

  const stats = calculateStatistics();

  // Platform color mapping
  const platformColors = {
    youtube: '#FF0000',
    instagram: '#E4405F',
    facebook: '#1877F2',
    linkedin: '#0A66C2',
    tiktok: '#000000',
    others: '#9C27B0'
  };

  // Platform Distribution Chart Data
  const platformChartData = {
    labels: Object.keys(stats.platformCounts).map(p => p.charAt(0).toUpperCase() + p.slice(1)),
    datasets: [{
      label: 'Number of Users',
      data: Object.values(stats.platformCounts),
      backgroundColor: Object.keys(stats.platformCounts).map(
        platform => platformColors[platform] || '#999'
      ),
      borderColor: '#fff',
      borderWidth: 2
    }]
  };

  // Time Spent color mapping
  const timeSpentColors = {
    '2hrs': '#4CAF50',
    '4hrs': '#8BC34A',
    '6hrs': '#FFC107',
    '8hrs': '#FF9800',
    '8plus': '#F44336'
  };

  // Time Spent Chart Data
  const timeChartData = {
    labels: ['2 hrs', '4 hrs', '6 hrs', '8 hrs', '8+ hrs'],
    datasets: [{
      label: 'Number of Users',
      data: [
        Math.round(stats.timeSpentStats['2hrs'] * stats.totalResponses / 100),
        Math.round(stats.timeSpentStats['4hrs'] * stats.totalResponses / 100),
        Math.round(stats.timeSpentStats['6hrs'] * stats.totalResponses / 100),
        Math.round(stats.timeSpentStats['8hrs'] * stats.totalResponses / 100),
        Math.round(stats.timeSpentStats['8plus'] * stats.totalResponses / 100)
      ],
      backgroundColor: ['#4CAF50', '#8BC34A', '#FFC107', '#FF9800', '#F44336'],
      borderColor: '#fff',
      borderWidth: 2,
      borderRadius: 6
    }]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          font: { size: 12 },
          padding: 20
        }
      }
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: '#333' }}>
        <h2>Loading survey data...</h2>
      </div>
    );
  }

  return (
    <div className="survey-graph-container" style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <button 
        onClick={onBack} 
        style={{
          padding: '10px 20px',
          marginBottom: '20px',
          background: '#667eea',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontWeight: '600'
        }}
      >
        ← Back
      </button>

      <h1 style={{ color: '#333', marginBottom: '10px' }}>Survey Analytics Dashboard</h1>
      <p style={{ color: '#666', marginBottom: '30px' }}>Total Responses: <strong>{stats.totalResponses}</strong></p>

      {stats.totalResponses === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '40px',
          background: '#f5f5f5',
          borderRadius: '8px',
          color: '#666'
        }}>
          <h3>No survey responses yet</h3>
        </div>
      ) : (
        <>
          {/* Chart Type Selector */}
          <div style={{ marginBottom: '30px', display: 'flex', gap: '10px' }}>
            {['pie', 'bar', 'line'].map(type => (
              <button
                key={type}
                onClick={() => setChartType(type)}
                style={{
                  padding: '10px 20px',
                  background: chartType === type ? '#667eea' : '#e0e0e0',
                  color: chartType === type ? 'white' : '#333',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600',
                  transition: 'all 0.3s ease'
                }}
              >
                {type.toUpperCase()} Chart
              </button>
            ))}
          </div>

          {/* Charts */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginBottom: '40px' }}>
            {/* Platform Chart */}
            <div style={{
              background: 'white',
              padding: '20px',
              borderRadius: '8px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}>
              <h3 style={{ color: '#333', marginBottom: '20px' }}>Social Media Platform Usage ({chartType.toUpperCase()})</h3>
              {chartType === 'pie' && <Pie data={platformChartData} options={chartOptions} />}
              {chartType === 'bar' && <Bar data={platformChartData} options={chartOptions} />}
              {chartType === 'line' && <Line data={platformChartData} options={chartOptions} />}
            </div>

            {/* Time Spent Chart */}
            <div style={{
              background: 'white',
              padding: '20px',
              borderRadius: '8px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}>
              <h3 style={{ color: '#333', marginBottom: '20px' }}>Daily Time Spent on Social Media ({chartType.toUpperCase()})</h3>
              {chartType === 'pie' && <Pie data={timeChartData} options={chartOptions} />}
              {chartType === 'bar' && <Bar data={timeChartData} options={chartOptions} />}
              {chartType === 'line' && <Line data={timeChartData} options={chartOptions} />}
            </div>
          </div>

          {/* Detailed Statistics */}
          <div style={{
            background: 'white',
            padding: '30px',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ color: '#333', marginBottom: '20px' }}>Detailed Statistics</h3>
            
            <div style={{ marginBottom: '30px' }}>
              <h4 style={{ color: '#667eea', marginBottom: '15px' }}>Platform Usage Breakdown</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px' }}>
                {Object.entries(stats.platformCounts).map(([platform, count]) => (
                  <div key={platform} style={{
                    background: platformColors[platform] || '#f5f5f5',
                    padding: '15px',
                    borderRadius: '6px',
                    textAlign: 'center',
                    color: 'white',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                  }}>
                    <p style={{ color: 'rgba(255,255,255,0.9)', margin: '0 0 8px 0', fontSize: '14px' }}>
                      {platform.charAt(0).toUpperCase() + platform.slice(1)}
                    </p>
                    <p style={{ color: 'white', margin: 0, fontSize: '24px', fontWeight: '700' }}>
                      {count}
                    </p>
                    <p style={{ color: 'rgba(255,255,255,0.8)', margin: '5px 0 0 0', fontSize: '12px' }}>
                      {stats.platformStats[platform]}%
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 style={{ color: '#667eea', marginBottom: '15px' }}>Daily Time Spent Breakdown</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px' }}>
                {[
                  { label: '2 hours', key: '2hrs', value: stats.timeSpentStats['2hrs'] },
                  { label: '4 hours', key: '4hrs', value: stats.timeSpentStats['4hrs'] },
                  { label: '6 hours', key: '6hrs', value: stats.timeSpentStats['6hrs'] },
                  { label: '8 hours', key: '8hrs', value: stats.timeSpentStats['8hrs'] },
                  { label: '8+ hours', key: '8plus', value: stats.timeSpentStats['8plus'] }
                ].map(item => {
                  const count = Math.round(item.value * stats.totalResponses / 100);
                  const color = timeSpentColors[item.key];
                  return (
                    <div key={item.label} style={{
                      background: color,
                      padding: '15px',
                      borderRadius: '6px',
                      textAlign: 'center',
                      color: 'white',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}>
                      <p style={{ color: 'rgba(255,255,255,0.9)', margin: '0 0 8px 0', fontSize: '14px' }}>
                        {item.label}
                      </p>
                      <p style={{ color: 'white', margin: 0, fontSize: '24px', fontWeight: '700' }}>
                        {count}
                      </p>
                      <p style={{ color: 'rgba(255,255,255,0.8)', margin: '5px 0 0 0', fontSize: '12px' }}>
                        {item.value}%
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default SurveyGraph;
