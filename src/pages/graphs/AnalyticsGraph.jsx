import React, { useState, useEffect } from 'react';
import { getUserGraphs, saveGraphData, database } from '../../firebase';
import { ref, remove } from 'firebase/database';
import Graph from '../../components/Graph';

function AnalyticsGraph({ user, onBack }) {
  const [graphs, setGraphs] = useState({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState([
    { day: '', visitors: '' }
  ]);
  const [reportName, setReportName] = useState('');
  const [metric, setMetric] = useState('traffic');
  const [chartType, setChartType] = useState('line');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const metrics = {
    traffic: '👥 Website Traffic',
    clicks: '🖱️ User Clicks',
    conversions:  '✅ Conversions',
    engagement: '💬 Engagement (%)'
  };

  useEffect(() => {
    fetchGraphs();
  }, [user]);

  const fetchGraphs = async () => {
    try {
      const data = await getUserGraphs(user.uid, 'analytics');
      setGraphs(data || {});
    } catch (err) {
      console.error('Error fetching graphs:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (index, field, value) => {
    const updated = [...formData];
    updated[index][field] = value;
    setFormData(updated);
  };

  const handleAddMore = () => {
    setFormData([...formData, { day: '', visitors: '' }]);
  };

  const handleRemoveInput = (index) => {
    if (formData.length > 1) {
      setFormData(formData.filter((_, i) => i !== index));
    }
  };

  const handlePreview = () => {
    if (!reportName.trim()) {
      setError('⚠️ Please enter report name');
      return;
    }

    if (formData.some(d => !d.day || !d. visitors)) {
      setError('⚠️ Please fill all data');
      return;
    }

    try {
      const days = formData.map(d => d.day);
      const values = formData.map(d => parseInt(d.visitors));

      const previewData = {
        labels: days,
        datasets: [
          {
            label: metrics[metric],
            data: values,
            borderColor: '#AA96DA',
            backgroundColor: 'rgba(170, 150, 218, 0.3)',
            fill: true,
            tension: 0.3
          }
        ]
      };

      setPreview(previewData);
      setError('');
    } catch (err) {
      setError(`❌ ${err.message}`);
    }
  };

  const handleSave = async () => {
    if (!preview) {
      setError('⚠️ Please preview first');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const graphData = {
        labels: preview.labels,
        datasets: preview.datasets,
        type: chartType
      };

      await saveGraphData(user. uid, 'analytics', reportName, graphData);
      alert('✅ Analytics report saved!');
      
      setFormData([{ day: '', visitors: '' }]);
      setReportName('');
      setPreview(null);
      setShowForm(false);
      fetchGraphs();
    } catch (err) {
      setError(`❌ Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (graphId) => {
    if (!window.confirm('Delete this graph?')) return;

    try {
      await remove(ref(database, `graphs/${user.uid}/analytics/${graphId}`));
      setGraphs(prev => {
        const updated = { ...prev };
        delete updated[graphId];
        return updated;
      });
      alert('✅ Graph deleted!');
    } catch (err) {
      alert('❌ Error: ' + err.message);
    }
  };

  const graphCount = Object.keys(graphs).length;

  return (
    <div className="category-page-container">
      <button className="back-btn" onClick={onBack}>← Back to Home</button>
      
      <div className="category-header" style={{ borderLeft: '5px solid #AA96DA' }}>
        <h1>📈 Analytics Graphs</h1>
        <p>Track website and app performance</p>
      </div>

      <button className="create-btn" onClick={() => setShowForm(!showForm)}>
        {showForm ? '✕ Close Form' : '➕ Create New Graph'}
      </button>

      {showForm && (
        <div className="form-section">
          <div className="form-group">
            <label>Report Name *</label>
            <input
              type="text"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              placeholder="e.g., December Traffic Report"
            />
          </div>

          <div className="form-group">
            <label>Metric *</label>
            <select value={metric} onChange={(e) => setMetric(e.target.value)}>
              <option value="traffic">👥 Website Traffic</option>
              <option value="clicks">🖱️ User Clicks</option>
              <option value="conversions">✅ Conversions</option>
              <option value="engagement">💬 Engagement (%)</option>
            </select>
          </div>

          <div className="form-group">
            <label>Chart Type *</label>
            <select value={chartType} onChange={(e) => setChartType(e.target.value)}>
              <option value="line">📈 Line Chart</option>
              <option value="bar">📊 Bar Chart</option>
            </select>
          </div>

          <div className="dynamic-inputs">
            <h3>Analytics Data</h3>
            {formData.map((item, index) => (
              <div key={index} className="input-row">
                <input
                  type="text"
                  placeholder="Day/Date"
                  value={item.day}
                  onChange={(e) => handleInputChange(index, 'day', e.target.value)}
                />
                <input
                  type="number"
                  placeholder="Value"
                  value={item. visitors}
                  onChange={(e) => handleInputChange(index, 'visitors', e.target. value)}
                />
                {formData.length > 1 && (
                  <button 
                    className="remove-btn" 
                    onClick={() => handleRemoveInput(index)}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button className="add-more-btn" onClick={handleAddMore}>
              ➕ Add Data
            </button>
          </div>

          {error && <div className="error">{error}</div>}

          <div className="form-buttons">
            <button className="preview-btn" onClick={handlePreview}>👁️ Preview</button>
            <button 
              className="save-btn" 
              onClick={handleSave} 
              disabled={!preview || saving}
            >
              {saving ? '⏳ Saving...' : '💾 Save'}
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div className="preview-section">
          <h2>📊 Preview</h2>
          <div className="graph-display">
            <Graph type={chartType} title={reportName} data={preview} />
          </div>
        </div>
      )}

      <div className="graphs-list">
        {loading ? (
          <p style={{ textAlign: 'center' }}>Loading graphs...</p>
        ) : graphCount === 0 ? (
          <div className="no-graphs">
            <p>📭 No analytics graphs yet!</p>
          </div>
        ) : (
          Object.entries(graphs).map(([id, graph]) => (
            <div key={id} className="graph-item-card">
              <div className="graph-item-content">
                <h3>{graph.name}</h3>
                <p>📅 Created: {new Date(graph. createdAt).toLocaleDateString()}</p>
              </div>
              <div className="graph-item-actions">
                <button className="delete-btn" onClick={() => handleDelete(id)}>
                  🗑️ Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default AnalyticsGraph;