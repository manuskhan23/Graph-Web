import React, { useState, useEffect } from 'react';
import { getUserGraphs, saveGraphData, updateGraphData, graphNameExists, database } from '../../firebase';
import { ref, remove } from 'firebase/database';
import Graph from '../../components/Graph';
import { showSuccessAlert, showErrorAlert, showConfirmDeleteAlert } from '../../utils/alerts';

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
  const [viewGraphId, setViewGraphId] = useState(null);
  const [editGraphId, setEditGraphId] = useState(null);

  const metrics = {
    weight: 'Weight (kg)',
    bloodPressure: 'Blood Pressure',
    heartRate: 'Heart Rate (bpm)',
    steps: 'Steps'
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

      if (values.some(v => isNaN(v))) {
        setError('[!] Please enter valid numbers');
        return;
      }

      const previewData = {
        labels: days,
        datasets: [
          {
            label: metrics[metric],
            data: values,
            borderColor: '#95E1D3',
            backgroundColor: 'rgba(149, 225, 211, 0.3)',
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
        metric: metric
      };

      if (editGraphId) {
        // Update existing graph
        await updateGraphData(user.uid, 'health', editGraphId, reportName, graphData);
        showSuccessAlert('Updated!', 'Health report updated successfully');
        setEditGraphId(null);
      } else {
        // Check if graph name already exists (only for new graphs)
        const nameExists = await graphNameExists(user.uid, 'health', reportName);
        if (nameExists) {
          setError(`[!] A graph with the name "${reportName}" already exists. Please choose a different name.`);
          setSaving(false);
          return;
        }

        // Save new graph
        await saveGraphData(user.uid, 'health', reportName, graphData);
        showSuccessAlert('Saved!', 'Health report saved successfully');
      }

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
    const result = await showConfirmDeleteAlert();
    if (!result.isConfirmed) return;

    try {
      await remove(ref(database, `graphs/${user.uid}/health/${graphId}`));
      setGraphs(prev => {
        const updated = { ...prev };
        delete updated[graphId];
        return updated;
      });
      showSuccessAlert('Deleted!', 'Graph deleted successfully');
    } catch (err) {
      showErrorAlert('Error!', 'Failed to delete graph: ' + err.message);
    }
  };

  const handleEdit = async (graphId, graphData) => {
    setEditGraphId(graphId);
    setReportName(graphData.name);
    setMetric(graphData.metric || 'weight');
    setChartType(graphData.type);
    setFormData(graphData.labels.map((label, idx) => ({
      day: label,
      weight: graphData.data[idx]
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
          borderColor: '#95E1D3',
          backgroundColor: 'rgba(149, 225, 211, 0.3)',
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
        <p>Metric: {metrics[graph.metric] || 'Weight'}</p>

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
              <option value="pie">Pie Chart</option>
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
                     Remove
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
            <p>No health graphs yet!</p>
          </div>
        ) : (
          Object.entries(graphs).map(([id, graph]) => (
            <div key={id} className="graph-item-card">
              <div className="graph-item-content">
                <h3>{graph.name}</h3>
                <p>Created: {new Date(graph.createdAt).toLocaleDateString()}</p>
                <p className="graph-type">Metric: {graph.metric || 'Weight'}</p>
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

          export default HealthGraph;
