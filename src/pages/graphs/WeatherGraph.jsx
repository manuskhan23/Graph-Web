import React, { useState, useEffect } from 'react';
import { getUserGraphs, saveGraphData, database } from '../../firebase';
import { ref, remove } from 'firebase/database';
import Graph from '../../components/Graph';

function WeatherGraph({ user, onBack }) {
  const [graphs, setGraphs] = useState({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState([
    { date: '', temperature: '' }
  ]);
  const [reportName, setReportName] = useState('');
  const [weatherType, setWeatherType] = useState('temperature');
  const [chartType, setChartType] = useState('line');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const weatherMetrics = {
    temperature:  'Temperature (°C)',
    rainfall: 'Rainfall (mm)',
    humidity: 'Humidity (%)',
    windSpeed: 'Wind Speed (km/h)'
  };

  useEffect(() => {
    fetchGraphs();
  }, [user]);

  const fetchGraphs = async () => {
    try {
      const data = await getUserGraphs(user.uid, 'weather');
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
    setFormData([...formData, { date: '', temperature: '' }]);
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

    if (formData.some(d => !d.date || !d.temperature)) {
       setError('[!] Please fill all data');
      return;
    }

    try {
      const dates = formData.map(d => d.date);
      const values = formData.map(d => parseFloat(d.temperature));

      const previewData = {
        labels: dates,
        datasets: [
          {
            label: weatherMetrics[weatherType],
            data: values,
            borderColor: '#A8D8EA',
            backgroundColor: 'rgba(168, 216, 234, 0.3)',
            fill: true,
            tension:  0.3
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

      await saveGraphData(user.uid, 'weather', reportName, graphData);
      alert('[✓] Weather report saved!');
      
      setFormData([{ date: '', temperature:  '' }]);
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
      await remove(ref(database, `graphs/${user.uid}/weather/${graphId}`));
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
      
      <div className="category-header" style={{ borderLeft: '5px solid #A8D8EA' }}>
         <h1>Weather Graphs</h1>
        <p>Track weather patterns over time</p>
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
              onChange={(e) => setReportName(e. target.value)}
              placeholder="e.g., January Weather"
            />
          </div>

          <div className="form-group">
            <label>Weather Metric *</label>
            <select value={weatherType} onChange={(e) => setWeatherType(e.target.value)}>
              <option value="temperature">Temperature (°C)</option>
              <option value="rainfall">Rainfall (mm)</option>
              <option value="humidity">Humidity (%)</option>
              <option value="windSpeed">Wind Speed (km/h)</option>
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
            <h3>Weather Data</h3>
            {formData.map((item, index) => (
              <div key={index} className="input-row">
                <input
                  type="text"
                  placeholder="Date"
                  value={item.date}
                  onChange={(e) => handleInputChange(index, 'date', e.target.value)}
                />
                <input
                  type="number"
                  placeholder="Value"
                  value={item. temperature}
                  onChange={(e) => handleInputChange(index, 'temperature', e.target. value)}
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
          <p style={{ textAlign: 'center' }}>Loading graphs... </p>
        ) : graphCount === 0 ? (
          <div className="no-graphs">
            <p>No weather graphs yet!</p>
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

export default WeatherGraph;