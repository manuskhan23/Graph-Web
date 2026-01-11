import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getUserGraphs, saveGraphData, updateGraphData, graphNameExists, database } from '../../firebase';
import { ref, remove } from 'firebase/database';
import Graph from '../../components/Graph';
import ShareModal from '../../components/ShareModal';

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
  const [viewGraphId, setViewGraphId] = useState(null);
  const [editGraphId, setEditGraphId] = useState(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [currentShareGraphId, setCurrentShareGraphId] = useState(null);

  const metrics = {
    traffic: 'Website Traffic',
    clicks: 'User Clicks',
    conversions: 'Conversions',
    engagement: 'Engagement (%)'
  };

  useEffect(() => {
    fetchGraphs();
    // Reset states on mount
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

    if (formData.some(d => !d.day || !d.visitors)) {
      setError('⚠️ Please fill all data');
      return;
    }

    try {
      const days = formData.map(d => d.day);
      const values = formData.map(d => parseInt(d.visitors));

      if (values.some(v => isNaN(v))) {
        setError('⚠️ Please enter valid numbers');
        return;
      }

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
        data: preview.datasets,
        type: chartType,
        metric: metric
      };

      if (editGraphId) {
        // Update existing graph
        await updateGraphData(user.uid, 'analytics', editGraphId, reportName, graphData);
        alert('✅ Analytics report updated!');
        setEditGraphId(null);
      } else {
        // Check if graph name already exists (only for new graphs)
        const nameExists = await graphNameExists(user.uid, 'analytics', reportName);
        if (nameExists) {
          setError(`⚠️ A graph with the name "${reportName}" already exists. Please choose a different name.`);
          setSaving(false);
          return;
        }

        // Save new graph
        await saveGraphData(user.uid, 'analytics', reportName, graphData);
        alert('✅ Analytics report saved!');
      }

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

  const handleEdit = async (graphId, graphData) => {
    setEditGraphId(graphId);
    setReportName(graphData.name);
    setMetric(graphData.metric || 'traffic');
    setChartType(graphData.type);
    setFormData(graphData.labels.map((label, idx) => ({
      day: label,
      visitors: graphData.data[idx]
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
      datasets: graph.data
    };

    return (
      <div className="category-page-container">
        <button className="back-btn" onClick={() => setViewGraphId(null)}>← Back</button>

        <h1>{graph.name}</h1>
        <p>Created: {new Date(graph.createdAt).toLocaleDateString()}</p>
        <p>Type: {graph.type.toUpperCase()}</p>
        <p>Metric: {metrics[graph.metric] || 'Traffic'}</p>

        <div className="graph-actions">
          <button className="share-btn" onClick={() => {
            setCurrentShareGraphId(viewGraphId);
            setShareModalOpen(true);
          }}>
            Share
          </button>
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

      <div className="category-header" style={{ borderLeft: '5px solid #AA96DA' }}>
        <h1>📈 Analytics Graphs</h1>
        <p>Track website and app performance</p>
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
              placeholder="e.g., December Traffic Report"
            />
          </div>

          <div className="form-group">
            <label>Metric *</label>
            <select value={metric} onChange={(e) => setMetric(e.target.value)}>
              <option value="traffic">Website Traffic</option>
              <option value="clicks">User Clicks</option>
              <option value="conversions">Conversions</option>
              <option value="engagement">Engagement (%)</option>
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
                  value={item.visitors}
                  onChange={(e) => handleInputChange(index, 'visitors', e.target.value)}
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
            <p>📭 No analytics graphs yet!</p>
          </div>
        ) : (
          Object.entries(graphs).map(([id, graph]) => (
            <div key={id} className="graph-item-card">
              <div className="graph-item-content">
                <h3>{graph.name}</h3>
                <p>📅 Created: {new Date(graph.createdAt).toLocaleDateString()}</p>
                <p className="graph-type">Metric: {graph.metric || 'Traffic'}</p>
              </div>
              <div className="graph-item-actions">
                 <button className="preview-btn" onClick={() => handleViewGraph(id)}>
                   👁️ Preview
                 </button>
                 <button className="share-btn" onClick={() => {
                   setCurrentShareGraphId(id);
                   setShareModalOpen(true);
                 }}>
                   Share
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

          <ShareModal 
          isOpen={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
          graphId={currentShareGraphId}
          graphType="analytics"
          userId={user.uid}
          />
          </div>
          );
          }

          export default AnalyticsGraph;
