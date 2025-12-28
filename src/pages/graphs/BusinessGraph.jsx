import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Swal from 'sweetalert2';
import { getUserGraphs, saveGraphData, updateGraphData, graphNameExists, database, set, ref } from '../../firebase';
import { remove } from 'firebase/database';
import Graph from '../../components/Graph';

function BusinessGraph({ user, onBack }) {
  const [graphs, setGraphs] = useState({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState([
    { month: '', revenue: '' }
  ]);
  const [reportName, setReportName] = useState('');
  const [metric, setMetric] = useState('revenue');
  const [chartType, setChartType] = useState('line');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [viewGraphId, setViewGraphId] = useState(null);
  const [editGraphId, setEditGraphId] = useState(null);

  const metrics = {
    revenue: '💰 Revenue',
    expenses: '💸 Expenses',
    profit: '📈 Profit',
    sales: '🛍️ Sales'
  };

  useEffect(() => {
    fetchGraphs();
    setViewGraphId(null);
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
      const data = await getUserGraphs(user.uid, 'business');
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
    setFormData([...formData, { month: '', revenue: '' }]);
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

    if (formData.some(d => !d.month || !d.revenue)) {
      setError('⚠️ Please fill all data');
      return;
    }

    try {
      const months = formData.map(d => d.month);
      const values = formData.map(d => parseFloat(d.revenue));

      if (values.some(v => isNaN(v))) {
        setError('⚠️ Please enter valid numbers');
        return;
      }

      const previewData = {
        labels: months,
        datasets: [
          {
            label: metrics[metric],
            data: values,
            borderColor: '#FF6B6B',
            backgroundColor: 'rgba(255, 107, 107, 0.3)',
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
        labels: preview.labels || [],
        data: preview.datasets[0].data || [],
        type: chartType,
        metric: metric
      };

      if (!Array.isArray(graphData.labels) || !Array.isArray(graphData.data)) {
        throw new Error('Invalid data format');
      }

      if (graphData.labels.length === 0 || graphData.data.length === 0) {
        throw new Error('No data to save');
      }

      if (editGraphId) {
        // Update existing graph
        await updateGraphData(user.uid, 'business', editGraphId, reportName, graphData);
        Swal.fire({
          icon: 'success',
          title: 'Updated!',
          text: 'Business report updated successfully',
          timer: 1500,
          showConfirmButton: false
        });
        setEditGraphId(null);
      } else {
        // Check if graph name already exists (only for new graphs)
        const nameExists = await graphNameExists(user.uid, 'business', reportName);
        if (nameExists) {
          setError(`⚠️ A graph with the name "${reportName}" already exists. Please choose a different name.`);
          setSaving(false);
          return;
        }

        // Save new graph
        await saveGraphData(user.uid, 'business', reportName, graphData);
        Swal.fire({
          icon: 'success',
          title: 'Saved!',
          text: 'Business report saved successfully',
          timer: 1500,
          showConfirmButton: false
        });
      }
      
      setFormData([{ month: '', revenue: '' }]);
      setReportName('');
      setPreview(null);
      setShowForm(false);
      fetchGraphs();
    } catch (err) {
      setError(`❌ Error: ${err.message}`);
      console.error('Save error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (graphId) => {
    const result = await Swal.fire({
      title: 'Delete Graph?',
      text: 'This action cannot be undone',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Yes, delete it!',
      cancelButtonText: 'Cancel'
    });

    if (!result.isConfirmed) return;

    try {
      await remove(ref(database, `graphs/${user.uid}/business/${graphId}`));
      setGraphs(prev => {
        const updated = { ...prev };
        delete updated[graphId];
        return updated;
      });
      Swal.fire({
        icon: 'success',
        title: 'Deleted!',
        text: 'Graph deleted successfully',
        timer: 1500,
        showConfirmButton: false
      });
    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Error!',
        text: 'Failed to delete graph: ' + err.message
      });
    }
  };

  const handleEdit = async (graphId, graphData) => {
    setEditGraphId(graphId);
    setReportName(graphData.name);
    setMetric(graphData.metric || 'revenue');
    setChartType(graphData.type);
    setFormData(graphData.labels.map((label, idx) => ({
      month: label,
      revenue: graphData.data[idx]
    })));
    setPreview(null);  // Clear preview when starting edit
    setError('');  // Clear any errors
    setShowForm(true);
  };

  const handleViewGraph = (graphId) => {
    setViewGraphId(graphId);
  };

  const graphCount = Object.keys(graphs).length;

  if (viewGraphId && graphs[viewGraphId]) {
    const graph = graphs[viewGraphId];
    const chartData = {
      labels: graph.labels,
      datasets: [
        {
          label: graph.name,
          data: graph.data,
          borderColor: '#FF6B6B',
          backgroundColor: 'rgba(255, 107, 107, 0.3)',
          tension: 0.3
        }
      ]
    };

    return (
      <div className="category-page-container">
        <button className="back-btn" onClick={() => setViewGraphId(null)}>← Back</button>
        
        <h1>{graph.name}</h1>
        <p>📅 Created: {new Date(graph.createdAt).toLocaleDateString()}</p>
        <p>📈 Type: {graph.type.toUpperCase()}</p>
        <p>💰 Metric: {metrics[graph.metric] || 'Revenue'}</p>

        <div className="graph-actions">
          <button className="edit-btn" onClick={() => {
            handleEdit(viewGraphId, graph);
            setViewGraphId(null);
          }}>
            ✏️ Edit
          </button>
          <button className="delete-btn" onClick={() => {
            handleDelete(viewGraphId);
            setViewGraphId(null);
          }}>
            🗑️ Delete
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
      
      <div className="category-header" style={{ borderLeft: '5px solid #FF6B6B' }}>
        <h1>Business Graphs</h1>
        <p>Track financial performance and growth</p>
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
              placeholder="e.g., Q1 Financial Report"
            />
          </div>

          <div className="form-group">
            <label>Metric *</label>
            <select value={metric} onChange={(e) => setMetric(e.target.value)}>
              <option value="revenue">💰 Revenue</option>
              <option value="expenses">💸 Expenses</option>
              <option value="profit">📈 Profit</option>
              <option value="sales">🛍️ Sales</option>
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
            <h3>Financial Data</h3>
            {formData.map((item, index) => (
              <div key={index} className="input-row">
                <input
                  type="text"
                  placeholder="Month/Period"
                  value={item.month}
                  onChange={(e) => handleInputChange(index, 'month', e.target.value)}
                />
                <input
                  type="number"
                  placeholder="Amount"
                  value={item.revenue}
                  onChange={(e) => handleInputChange(index, 'revenue', e.target.value)}
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
              ➕ Add Entry
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
              <p>📭 No business graphs yet!</p>
            </div>
          ) : (
            Object.entries(graphs).map(([id, graph]) => (
              <div key={id} className="graph-item-card">
                <div className="graph-item-content">
                  <h3>{graph.name}</h3>
                  <p>📅 Created: {new Date(graph.createdAt).toLocaleDateString()}</p>
                  <p className="graph-type">Metric: {graph.metric || 'Revenue'}</p>
                </div>
                <div className="graph-item-actions">
                  <button className="preview-btn" onClick={() => handleViewGraph(id)}>
                    👁️ Preview
                  </button>
                  <button className="edit-btn" onClick={() => handleEdit(id, graph)}>
                    ✏️ Edit
                  </button>
                  <button className="delete-btn" onClick={() => handleDelete(id)}>
                    🗑️ Delete
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

export default BusinessGraph;