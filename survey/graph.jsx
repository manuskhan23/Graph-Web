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
  const [error, setError] = useState(null);
  const [chartType, setChartType] = useState('pie');

  useEffect(() => {
    console.log('SurveyGraph mounted');
    const surveysRef = ref(surveyDatabase, 'surveys');

    const unsubscribe = onValue(surveysRef, (snapshot) => {
      try {
        console.log('Firebase snapshot received');
        const data = [];
        snapshot.forEach((childSnapshot) => {
          data.push(childSnapshot.val());
        });
        console.log('Survey data loaded:', data.length, 'records');
        setSurveyData(data);
        setLoading(false);
      } catch (err) {
        console.error('Error processing survey data:', err);
        setError('Error loading survey data');
        setLoading(false);
      }
    }, (error) => {
      console.error('Firebase error:', error);
      setError('Error connecting to database: ' + error.message);
      setLoading(false);
    });

    return () => {
      console.log('SurveyGraph unmounting');
      unsubscribe();
    };
  }, []);

  const calculateStatistics = () => {
    if (surveyData.length === 0) {
      return {
        totalResponses: 0,
        platformStats: {},
        timeSpentStats: {},
        platformCounts: {}
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

    // Convert counts for display
    const platformCounts = { ...platformStats };
    
    // Convert to percentages
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
      backgroundColor: chartType === 'line' ? 'rgba(102, 126, 234, 0.1)' : Object.keys(stats.platformCounts).map(
        platform => platformColors[platform] || '#999'
      ),
      borderColor: chartType === 'line' ? '#667eea' : '#fff',
      borderWidth: chartType === 'line' ? 3 : 2,
      pointBackgroundColor: Object.keys(stats.platformCounts).map(
        platform => platformColors[platform] || '#999'
      ),
      pointBorderColor: Object.keys(stats.platformCounts).map(
        platform => platformColors[platform] || '#999'
      ),
      pointRadius: 6,
      pointHoverRadius: 8,
      tension: 0.4,
      fill: chartType === 'line',
      borderJoinStyle: 'round',
      borderCapStyle: 'round'
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
        Math.round((stats.timeSpentStats['2hrs'] || 0) * stats.totalResponses / 100),
        Math.round((stats.timeSpentStats['4hrs'] || 0) * stats.totalResponses / 100),
        Math.round((stats.timeSpentStats['6hrs'] || 0) * stats.totalResponses / 100),
        Math.round((stats.timeSpentStats['8hrs'] || 0) * stats.totalResponses / 100),
        Math.round((stats.timeSpentStats['8plus'] || 0) * stats.totalResponses / 100)
      ],
      backgroundColor: chartType === 'line' ? 'rgba(76, 175, 80, 0.1)' : ['#4CAF50', '#8BC34A', '#FFC107', '#FF9800', '#F44336'],
      borderColor: chartType === 'line' ? '#4CAF50' : '#fff',
      borderWidth: chartType === 'line' ? 3 : 2,
      borderRadius: chartType === 'line' ? 0 : 6,
      pointBackgroundColor: ['#4CAF50', '#8BC34A', '#FFC107', '#FF9800', '#F44336'],
      pointBorderColor: ['#4CAF50', '#8BC34A', '#FFC107', '#FF9800', '#F44336'],
      pointRadius: 6,
      pointHoverRadius: 8,
      tension: 0.4,
      fill: chartType === 'line',
      borderJoinStyle: 'round',
      borderCapStyle: 'round'
    }]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: 10
    },
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          font: { size: 12 },
          padding: 20,
          usePointStyle: true
        }
      },
      tooltip: {
        enabled: true
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          precision: 0
        }
      }
    }
  };

  // Special options for line charts
  const lineChartOptions = {
    ...chartOptions,
    plugins: {
      ...chartOptions.plugins,
      filler: {
        propagate: true
      }
    },
    tension: 0.4,
    elements: {
      line: {
        borderWidth: 3,
        borderJoinStyle: 'round',
        borderCapStyle: 'round'
      },
      point: {
        radius: 5,
        hitRadius: 10,
        hoverRadius: 7
      }
    }
  };

  if (error) {
    return (
      <div className="survey-graph-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          background: 'white',
          padding: '40px',
          borderRadius: '8px',
          textAlign: 'center',
          maxWidth: '500px'
        }}>
          <h2 style={{ color: '#e74c3c', marginBottom: '20px' }}>Error</h2>
          <p style={{ color: '#666', marginBottom: '20px' }}>{error}</p>
          <button 
            onClick={onBack}
            style={{
              padding: '10px 20px',
              background: '#667eea',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '600'
            }}
          >
            ← Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="survey-graph-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '50px',
            height: '50px',
            border: '4px solid #f3f3f3',
            borderTop: '4px solid #667eea',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 20px'
          }}></div>
          <h2 style={{ color: '#333' }}>Loading survey data...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="survey-graph-container">
      <div className="chart-wrapper">
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
            <div style={{ marginBottom: '30px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '30px', marginBottom: '40px' }}>
              {/* Platform Chart */}
              <div style={{
                background: 'white',
                padding: '20px',
                borderRadius: '8px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                minHeight: '450px'
              }}>
                <h3 style={{ color: '#333', marginBottom: '20px', textAlign: 'center' }}>Social Media Platform Usage ({chartType.toUpperCase()})</h3>
                <div style={{ height: '350px', position: 'relative' }}>
                  {chartType === 'pie' && <Pie data={platformChartData} options={chartOptions} />}
                  {chartType === 'bar' && <Bar data={platformChartData} options={chartOptions} />}
                  {chartType === 'line' && <Line data={platformChartData} options={lineChartOptions} />}
                </div>
              </div>

              {/* Time Spent Chart */}
              <div style={{
                background: 'white',
                padding: '20px',
                borderRadius: '8px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                minHeight: '450px'
              }}>
                <h3 style={{ color: '#333', marginBottom: '20px', textAlign: 'center' }}>Daily Time Spent on Social Media ({chartType.toUpperCase()})</h3>
                <div style={{ height: '350px', position: 'relative' }}>
                  {chartType === 'pie' && <Pie data={timeChartData} options={chartOptions} />}
                  {chartType === 'bar' && <Bar data={timeChartData} options={chartOptions} />}
                  {chartType === 'line' && <Line data={timeChartData} options={lineChartOptions} />}
                </div>
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '15px' }}>
                  {Object.entries(stats.platformCounts).map(([platform, count]) => (
                    <div key={platform} style={{
                      background: platformColors[platform] || '#f5f5f5',
                      padding: '15px',
                      borderRadius: '6px',
                      textAlign: 'center',
                      color: 'white',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}>
                      <p style={{ color: 'rgba(255,255,255,0.9)', margin: '0 0 8px 0', fontSize: '13px' }}>
                        {platform.charAt(0).toUpperCase() + platform.slice(1)}
                      </p>
                      <p style={{ color: 'white', margin: 0, fontSize: '22px', fontWeight: '700' }}>
                        {count}
                      </p>
                      <p style={{ color: 'rgba(255,255,255,0.8)', margin: '5px 0 0 0', fontSize: '11px' }}>
                        {stats.platformStats[platform] || 0}%
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 style={{ color: '#667eea', marginBottom: '15px' }}>Daily Time Spent Breakdown</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '15px' }}>
                  {[
                    { label: '2 hours', key: '2hrs', value: stats.timeSpentStats['2hrs'] },
                    { label: '4 hours', key: '4hrs', value: stats.timeSpentStats['4hrs'] },
                    { label: '6 hours', key: '6hrs', value: stats.timeSpentStats['6hrs'] },
                    { label: '8 hours', key: '8hrs', value: stats.timeSpentStats['8hrs'] },
                    { label: '8+ hours', key: '8plus', value: stats.timeSpentStats['8plus'] }
                  ].map(item => {
                    const count = Math.round((item.value || 0) * stats.totalResponses / 100);
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
                        <p style={{ color: 'rgba(255,255,255,0.9)', margin: '0 0 8px 0', fontSize: '13px' }}>
                          {item.label}
                        </p>
                        <p style={{ color: 'white', margin: 0, fontSize: '22px', fontWeight: '700' }}>
                          {count}
                        </p>
                        <p style={{ color: 'rgba(255,255,255,0.8)', margin: '5px 0 0 0', fontSize: '11px' }}>
                          {item.value || 0}%
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

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default SurveyGraph;
