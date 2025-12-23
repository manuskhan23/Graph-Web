import React, { useState, useEffect } from 'react';
import { getUserGraphs, saveGraphData, updateGraphData, database } from '../../firebase';
import { ref, remove } from 'firebase/database';
import Graph from '../../components/Graph';
import { showSuccessAlert, showErrorAlert, showConfirmDeleteAlert } from '../../utils/alerts';

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
  const [viewGraphId, setViewGraphId] = useState(null);
  const [editGraphId, setEditGraphId] = useState(null);

  const weatherMetrics = {
    temperature: 'Temperature (°C)',
    rainfall: 'Rainfall (mm)',
    humidity: 'Humidity (%)',
    windSpeed: 'Wind Speed (km/h)'
  };

  useEffect(() => {
    fetchGraphs();
    setViewGraphId(null);
    setPreview(null);
    setShowForm(false);
  }, [user]);

  // Scroll to preview when it appears
  useEffect(() => {
    if (preview) {
      setTimeout(() => {
        const previewElement = document.getElementById('preview-section');
        if (previewElement) {
          previewElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  }, [preview]);

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

      if (values.some(v => isNaN(v))) {
        setError('[!] Please enter valid numbers');
        return;
      }

      const previewData = {
        labels: dates,
        datasets: [
          {
            label: weatherMetrics[weatherType],
            data: values,
            borderColor: '#A8D8EA',
            backgroundColor: 'rgba(168, 216, 234, 0.3)',
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
        data: preview.datasets[0].data,
        type: chartType,
        weatherType: weatherType
      };

      if (editGraphId) {
        // Update existing graph
        await updateGraphData(user.uid, 'weather', editGraphId, reportName, graphData);
        alert('[✓] Weather report updated!');
        setEditGraphId(null);
      } else {
        // Save new graph
        await saveGraphData(user.uid, 'weather', reportName, graphData);
        alert('[✓] Weather report saved!');
      }

      setFormData([{ date: '', temperature: '' }]);
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

  const handleEdit = async (graphId, graphData) => {
    setEditGraphId(graphId);
    setReportName(graphData.name);
    setWeatherType(graphData.weatherType || 'temperature');
    setChartType(graphData.type);
    setFormData(graphData.labels.map((label, idx) => ({
      date: label,
      temperature: graphData.data[idx]
    })));
    setPreview(null);  // Clear preview when starting edit
    setError('');  // Clear any errors
    setShowForm(true);
  };

  const handleViewGraph = (graphId) => {
    setViewGraphId(graphId);
  };

  const graphCount = Object.keys(graphs).length;

  // View full graph page
  if (viewGraphId && graphs[viewGraphId]) {
    const graph = graphs[viewGraphId];
    const chartData = {
      labels: graph.labels,
      datasets: [
        {
          label: graph.name,
          data: graph.data,
          borderColor: '#A8D8EA',
          backgroundColor: 'rgba(168, 216, 234, 0.3)',
          tension: 0.3
        }
      ]
    };

    return (
      <div className="category-page-container">
        <button className="back-btn" onClick={() => setViewGraphId(null)}>← Back</button>

        <h1>{graph.name}</h1>
        <p>Created: {new Date(graph.createdAt).toLocaleDateString()}</p>
        <p>Type: {graph.type.toUpperCase()}</p>
        <p>Weather Type: {weatherMetrics[graph.weatherType] || 'Temperature'}</p>

        <div className="graph-actions">
          <button className="edit-btn" onClick={() => {
            handleEdit(viewGraphId, graph);
            setViewGraphId(null);
          }}>
            Edit
          </button>
          <button className="delete-btn" onClick={() => {
            handleDelete(viewGraphId);
            setViewGraphId(null);
          }}>
            Delete
          </button>
        </div>

        <div className="graph-display">
          <Graph type={graph.type} title={graph.name} data={chartData} />
        </div>
      </div>
    );
  }

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
              onChange={(e) => setReportName(e.target.value)}
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
              <option value="pie">Pie Chart</option>
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
                  value={item.temperature}
                  onChange={(e) => handleInputChange(index, 'temperature', e.target.value)}
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

      {/* Preview */}
       {preview && (
         <div className="preview-section" id="preview-section">
           <h2>Preview</h2>
           <div className="graph-display">
             <Graph type={chartType} title={reportName} data={preview} />
           </div>
         </div>
       )}

       {!showForm && (
       <div className="graphs-list">
        {loading ? (
          <p style={{ textAlign: 'center' }}>Loading graphs...</p>
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
                <p className="graph-type">Weather Type: {graph.weatherType || 'Temperature'}</p>
              </div>
              <div className="graph-item-actions">
                <button className="preview-btn" onClick={() => handleViewGraph(id)}>
                  Preview
                </button>
                <button className="edit-btn" onClick={() => handleEdit(id, graph)}>
                  Edit
                </button>
                <button className="delete-btn" onClick={() => handleDelete(id)}>
                  Delete
                </button>
              </div>
            </div>
          ))
          )}
          </div>
          )}
          </div>
          );
          }

          export default WeatherGraph;
