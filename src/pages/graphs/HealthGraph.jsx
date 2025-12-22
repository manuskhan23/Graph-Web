import React, { useState, useEffect } from 'react';
import { getUserGraphs, saveGraphData, database } from '../../firebase';
import { ref, remove } from 'firebase/database';
import Graph from '../../components/Graph';

function HealthGraph({ user, onBack }) {
  const [graphs, setGraphs] = useState({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState([
    { day: '', weight: '' }
  ]);
  const [reportName, setReportName] = useState('');
  const [metric, setMetric] = useState('weight');
  const [chartType, setChartType] = useState('line');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const metrics = {
    weight: 'Weight (kg)',
    bloodPressure: 'Blood Pressure',
    heartRate: 'Heart Rate (bpm)',
    steps: 'Steps'
  };

  useEffect(() => {
    fetchGraphs();
  }, [user]);

  const fetchGraphs = async () => {
    try {
      const data = await getUserGraphs(user.uid, 'health');
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
    setFormData([...formData, { day: '', weight: '' }]);
  };

  const handleRemoveInput = (index) => {
    if (formData.length > 1) {
      setFormData(formData.filter((_, i) => i !== index));
    }
  };

  const handlePreview = () => {
    if (!reportName.trim()) {
       setError('[!] Please enter report name');
      return;
    }

    if (formData.some(d => !d.day || !d.weight)) {
       setError('[!] Please fill all data');
      return;
    }

    try {
      const days = formData.map(d => d.day);
      const values = formData.map(d => parseFloat(d.weight));

      const previewData = {
        labels: days,
        datasets:  [
          {
            label: metrics[metric],
            data: values,
            borderColor: '#95E1D3',
            backgroundColor:  'rgba(149, 225, 211, 0.3)',
            fill: true,
            tension: 0.3
          }
        ]
      };

      setPreview(previewData);
      setError('');
    } catch (err) {
      setError(`[✗] ${err.message}`);
    }
  };

  const handleSave = async () => {
    if (!preview) {
      setError('[!] Please preview first');
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

      await saveGraphData(user.uid, 'health', reportName, graphData);
      alert('[✓] Health report saved!');
      
      setFormData([{ day: '', weight: '' }]);
      setReportName('');
      setPreview(null);
      setShowForm(false);
      fetchGraphs();
    } catch (err) {
      setError(`[✗] Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (graphId) => {
    if (!window.confirm('Delete this graph?')) return;

    try {
      await remove(ref(database, `graphs/${user.uid}/health/${graphId}`));
      setGraphs(prev => {
        const updated = { ...prev };
        delete updated[graphId];
        return updated;
      });
      alert('[✓] Graph deleted!');
    } catch (err) {
      alert('[✗] Error: ' + err.message);
    }
  };

  const graphCount = Object.keys(graphs).length;

  return (
    <div className="category-page-container">
      <button className="back-btn" onClick={onBack}>← Back to Home</button>
      
      <div className="category-header" style={{ borderLeft: '5px solid #95E1D3' }}>
         <h1>Health Graphs</h1>
        <p>Monitor your health metrics over time</p>
      </div>

      <button className="create-btn" onClick={() => setShowForm(!showForm)}>
        {showForm ? 'Close Form' : 'Create New Graph'}
      </button>

      {showForm && (
        <div className="form-section">
          <div className="form-group">
            <label>Report Name *</label>
            <input
              type="text"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              placeholder="e.g., Weekly Health Check"
            />
          </div>

          <div className="form-group">
            <label>Metric *</label>
            <select value={metric} onChange={(e) => setMetric(e.target.value)}>
              <option value="weight">Weight (kg)</option>
              <option value="bloodPressure">Blood Pressure</option>
              <option value="heartRate">Heart Rate (bpm)</option>
              <option value="steps">Steps</option>
            </select>
          </div>

          <div className="form-group">
            <label>Chart Type *</label>
            <select value={chartType} onChange={(e) => setChartType(e.target.value)}>
              <option value="line">Line Chart</option>
              <option value="bar">Bar Chart</option>
            </select>
          </div>

          <div className="dynamic-inputs">
            <h3>Health Data</h3>
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
                  value={item.weight}
                  onChange={(e) => handleInputChange(index, 'weight', e.target.value)}
                  step="0.1"
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
              Add Reading
            </button>
          </div>

          {error && <div className="error">{error}</div>}

          <div className="form-buttons">
            <button className="preview-btn" onClick={handlePreview}>Preview</button>
            <button 
              className="save-btn" 
              onClick={handleSave} 
              disabled={!preview || saving}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div className="preview-section">
          <h2>Preview</h2>
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
            <p>No health graphs yet!</p>
          </div>
        ) : (
          Object.entries(graphs).map(([id, graph]) => (
            <div key={id} className="graph-item-card">
              <div className="graph-item-content">
                <h3>{graph.name}</h3>
                <p>Created: {new Date(graph.createdAt).toLocaleDateString()}</p>
              </div>
              <div className="graph-item-actions">
                <button className="delete-btn" onClick={() => handleDelete(id)}>
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default HealthGraph;