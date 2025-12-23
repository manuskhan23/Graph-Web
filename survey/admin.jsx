import React, { useEffect, useState } from 'react';
import { ref, onValue, remove } from 'firebase/database';
import { surveyDatabase } from './surveyFirebase';
import AdminManager from './adminManager';
import './admin.css';

function AdminDashboard({ onBack }) {
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('dashboard'); // dashboard, responses, export
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    const surveysRef = ref(surveyDatabase, 'surveys');

    const unsubscribe = onValue(surveysRef, (snapshot) => {
      const data = [];
      snapshot.forEach((childSnapshot) => {
        data.push({
          id: childSnapshot.key,
          ...childSnapshot.val()
        });
      });
      setSurveys(data.reverse());
      setLoading(false);
    }, (error) => {
      console.error('Error loading surveys:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleDeleteResponse = async (id) => {
    if (window.confirm('Are you sure you want to delete this response?')) {
      try {
        setDeletingId(id);
        const surveyRef = ref(surveyDatabase, `surveys/${id}`);
        await remove(surveyRef);
        setSurveys(prev => prev.filter(s => s.id !== id));
        alert('Response deleted successfully');
      } catch (error) {
        console.error('Error deleting response:', error);
        alert('Failed to delete response');
      } finally {
        setDeletingId(null);
      }
    }
  };

  const handleExportCSV = () => {
    if (surveys.length === 0) {
      alert('No data to export');
      return;
    }

    // Create CSV header
    const headers = ['Name', 'Father Name', 'Class', 'Section', 'Social Media Platform', 'Platform Other', 'Time Spent Daily', 'Timestamp'];
    const rows = surveys.map(survey => [
      survey.name,
      survey.fatherName,
      survey.class,
      survey.section,
      survey.platform,
      survey.platformOther || '-',
      survey.timeSpent,
      new Date(survey.timestamp).toLocaleString()
    ]);

    // Create CSV content
    let csvContent = headers.join(',') + '\n';
    rows.forEach(row => {
      csvContent += row.map(cell => `"${cell}"`).join(',') + '\n';
    });

    // Download
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent));
    element.setAttribute('download', `survey_responses_${new Date().getTime()}.csv`);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleExportJSON = () => {
    if (surveys.length === 0) {
      alert('No data to export');
      return;
    }

    const jsonData = JSON.stringify(surveys, null, 2);
    const element = document.createElement('a');
    element.setAttribute('href', 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonData));
    element.setAttribute('download', `survey_responses_${new Date().getTime()}.json`);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const filteredSurveys = surveys.filter(survey =>
    survey.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    survey.fatherName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    survey.class.toLowerCase().includes(searchTerm.toLowerCase()) ||
    survey.section.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    totalResponses: surveys.length,
    uniqueStudents: new Set(surveys.map(s => s.name)).size,
    platforms: {},
    timeSpent: {}
  };

  surveys.forEach(survey => {
    stats.platforms[survey.platform] = (stats.platforms[survey.platform] || 0) + 1;
    stats.timeSpent[survey.timeSpent] = (stats.timeSpent[survey.timeSpent] || 0) + 1;
  });

  if (loading) {
    return (
      <div className="admin-loading">
        <h2>Loading admin dashboard...</h2>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <h1>📊 Admin Dashboard</h1>
        <button className="btn-back" onClick={onBack}>← Back</button>
      </div>

      <div className="admin-nav">
        <button
          className={`admin-nav-btn ${view === 'dashboard' ? 'active' : ''}`}
          onClick={() => setView('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={`admin-nav-btn ${view === 'responses' ? 'active' : ''}`}
          onClick={() => setView('responses')}
        >
          Responses ({surveys.length})
        </button>
        <button
          className={`admin-nav-btn ${view === 'manage-admins' ? 'active' : ''}`}
          onClick={() => setView('manage-admins')}
        >
          👥 Manage Admins
        </button>
      </div>

      {/* Dashboard View */}
      {view === 'dashboard' && (
        <div className="admin-dashboard">
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon">📝</div>
              <div className="stat-content">
                <div className="stat-label">Total Responses</div>
                <div className="stat-value">{stats.totalResponses}</div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon">👥</div>
              <div className="stat-content">
                <div className="stat-label">Unique Students</div>
                <div className="stat-value">{stats.uniqueStudents}</div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon">📱</div>
              <div className="stat-content">
                <div className="stat-label">Most Used Platform</div>
                <div className="stat-value">
                  {Object.keys(stats.platforms).length > 0
                    ? Object.entries(stats.platforms).reduce((a, b) => a[1] > b[1] ? a : b)[0]
                    : 'N/A'
                  }
                </div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon">⏱️</div>
              <div className="stat-content">
                <div className="stat-label">Avg Time Spent</div>
                <div className="stat-value">
                  {Object.keys(stats.timeSpent).length > 0
                    ? Object.entries(stats.timeSpent).reduce((a, b) => a[1] > b[1] ? a : b)[0]
                    : 'N/A'
                  }
                </div>
              </div>
            </div>
          </div>

          <div className="admin-breakdown">
            <div className="breakdown-section">
              <h3>Platform Usage</h3>
              <div className="breakdown-list">
                {Object.entries(stats.platforms).map(([platform, count]) => (
                  <div key={platform} className="breakdown-item">
                    <span className="breakdown-label">{platform}</span>
                    <div className="breakdown-bar">
                      <div
                        className="breakdown-fill"
                        style={{
                          width: `${(count / stats.totalResponses) * 100}%`
                        }}
                      ></div>
                    </div>
                    <span className="breakdown-count">
                      {count} ({Math.round((count / stats.totalResponses) * 100)}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="breakdown-section">
              <h3>Daily Time Spent</h3>
              <div className="breakdown-list">
                {Object.entries(stats.timeSpent).map(([time, count]) => (
                  <div key={time} className="breakdown-item">
                    <span className="breakdown-label">{time}</span>
                    <div className="breakdown-bar">
                      <div
                        className="breakdown-fill"
                        style={{
                          width: `${(count / stats.totalResponses) * 100}%`
                        }}
                      ></div>
                    </div>
                    <span className="breakdown-count">
                      {count} ({Math.round((count / stats.totalResponses) * 100)}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Responses View */}
      {view === 'responses' && (
        <div className="admin-responses">
          <div className="responses-header">
            <input
              type="text"
              placeholder="Search by name, father name, class, or section..."
              className="search-input"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {filteredSurveys.length === 0 ? (
            <div className="no-data">
              <p>No survey responses found</p>
            </div>
          ) : (
            <div className="responses-table-wrapper">
              <table className="responses-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Father Name</th>
                    <th>Class</th>
                    <th>Section</th>
                    <th>Platform</th>
                    <th>Time Spent</th>
                    <th>Submitted</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSurveys.map((survey) => (
                    <tr key={survey.id}>
                      <td>{survey.name}</td>
                      <td>{survey.fatherName}</td>
                      <td>{survey.class}</td>
                      <td>{survey.section}</td>
                      <td>
                        <span className="platform-badge">{survey.platform}</span>
                        {survey.platformOther && (
                          <span className="platform-badge-other">{survey.platformOther}</span>
                        )}
                      </td>
                      <td>{survey.timeSpent}</td>
                      <td className="timestamp">
                        {new Date(survey.timestamp).toLocaleDateString()}<br/>
                        <small>{new Date(survey.timestamp).toLocaleTimeString()}</small>
                      </td>
                      <td>
                        <button
                          className="btn-delete"
                          onClick={() => handleDeleteResponse(survey.id)}
                          disabled={deletingId === survey.id}
                        >
                          {deletingId === survey.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Manage Admins View */}
      {view === 'manage-admins' && (
        <AdminManager onBack={() => setView('dashboard')} />
      )}
    </div>
  );
}

export default AdminDashboard;
