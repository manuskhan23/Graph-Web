import React, { useState, useEffect } from 'react';
import { getUserGraphs, saveGraphData, database } from '../../firebase';
import { ref, remove } from 'firebase/database';
import Graph from '../../components/Graph';

function SportsGraph({ user, onBack }) {
  const [graphs, setGraphs] = useState({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState([
    { match: '', teamScore: '' }
  ]);
  const [reportName, setReportName] = useState('');
  const [chartType, setChartType] = useState('bar');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchGraphs();
  }, [user]);

  const fetchGraphs = async () => {
    try {
      const data = await getUserGraphs(user.uid, 'sports');
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
    setFormData([...formData, { match: '', teamScore: '' }]);
  };

  const handleRemoveInput = (index) => {
    if (formData.length > 1) {
      setFormData(formData. filter((_, i) => i !== index));
    }
  };

  const handlePreview = () => {
    if (!reportName.trim()) {
       setError('[!] Please enter report name');
      return;
    }

    if (formData.some(d => !d.match || !d.teamScore)) {
       setError('[!] Please fill all match data');
      return;
    }

    try {
      const matches = formData.map(d => d.match);
      const scores = formData.map(d => parseInt(d.teamScore));

      const previewData = {
        labels: matches,
        datasets: [
          {
            label: 'Team Scores',
            data: scores,
            borderColor: '#FFE66D',
            backgroundColor: 'rgba(255, 230, 109, 0.6)',
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
        labels: preview. labels,
        datasets: preview. datasets,
        type: chartType
      };

      await saveGraphData(user.uid, 'sports', reportName, graphData);
      alert('[✓] Sports report saved!');
      
      setFormData([{ match: '', teamScore: '' }]);
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
      await remove(ref(database, `graphs/${user.uid}/sports/${graphId}`));
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
      
      <div className="category-header" style={{ borderLeft: '5px solid #FFE66D' }}>
         <h1>Sports Graphs</h1>
        <p>Track match results and team performance</p>
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
              placeholder="e.g., Cricket Season 2024"
            />
          </div>

          <div className="form-group">
            <label>Chart Type *</label>
            <select value={chartType} onChange={(e) => setChartType(e.target.value)}>
              <option value="bar">Bar Chart</option>
              <option value="line">Line Chart</option>
            </select>
          </div>

          <div className="dynamic-inputs">
            <h3>Match Results</h3>
            {formData.map((item, index) => (
              <div key={index} className="input-row">
                <input
                  type="text"
                  placeholder="Match Name"
                  value={item.match}
                  onChange={(e) => handleInputChange(index, 'match', e.target.value)}
                />
                <input
                  type="number"
                  placeholder="Team Score"
                  value={item.teamScore}
                  onChange={(e) => handleInputChange(index, 'teamScore', e.target.value)}
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
              Add Match
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
            <p>No sports graphs yet!</p>
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

export default SportsGraph;