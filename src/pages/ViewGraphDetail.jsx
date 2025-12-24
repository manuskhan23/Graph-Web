import React, { useState, useEffect } from 'react';
import { getGraph, deleteGraph, set, ref } from '../firebase';
import Graph from '../components/Graph';
import { getDatabase } from 'firebase/database';

function ViewGraphDetail({ user, categoryType, graphId, onBack }) {
  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [editedLabels, setEditedLabels] = useState('');
  const [editedData, setEditedData] = useState('');
  const [editedType, setEditedType] = useState('');
  const [saving, setSaving] = useState(false);

  const database = getDatabase();

  useEffect(() => {
    const fetchGraph = async () => {
      try {
        const data = await getGraph(user.uid, categoryType, graphId);
        if (!data) {
          setError('Graph not found');
        } else {
          setGraph(data);
          setEditedName(data.name);
          setEditedLabels(data.labels.join(', '));
          setEditedData(data.data.join(', '));
          setEditedType(data.type);
        }
      } catch (err) {
        setError(`Error: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };
    fetchGraph();
  }, [user, categoryType, graphId]);

  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this graph?')) {
      try {
        await deleteGraph(user.uid, categoryType, graphId);
        alert('✅ Graph deleted successfully!');
        onBack();
      } catch (err) {
        setError(`❌ Error deleting graph: ${err.message}`);
      }
    }
  };

  const handleEditToggle = () => {
    setIsEditing(!isEditing);
  };

  const handleSaveEdit = async () => {
    if (!editedName.trim() || !editedLabels.trim() || !editedData.trim()) {
      setError('⚠️ Please fill all fields');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const labelArray = editedLabels.split(',').map(l => l.trim()).filter(l => l);
      const dataArray = editedData.split(',').map(d => {
        const num = parseFloat(d.trim());
        if (isNaN(num)) throw new Error('Invalid number');
        return num;
      });

      if (labelArray.length !== dataArray.length) {
        setError('⚠️ Labels and data count must match');
        setSaving(false);
        return;
      }

      const updatedGraph = {
        id: graphId,
        name: editedName,
        type: editedType,
        labels: labelArray,
        data: dataArray,
        createdAt: graph.createdAt
      };

      await set(ref(database, `graphs/${user.uid}/${categoryType}/${graphId}`), updatedGraph);
      setGraph(updatedGraph);
      setIsEditing(false);
      alert('✅ Graph updated successfully!');
    } catch (err) {
      setError(`❌ Error updating graph: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ margin: '20px', textAlign: 'center' }}>Loading graph...</div>;
  }

  if (error && !graph) {
    return (
      <div className="view-graph-container">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <div className="error">{error}</div>
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="view-graph-container">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <p>Graph not found</p>
      </div>
    );
  }

  const chartData = {
    labels: graph.labels,
    datasets: [
      {
        label: graph.name,
        data: graph.data,
        borderColor: '#667eea',
        backgroundColor: graph.type === 'pie'
          ? ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF']
          : 'rgba(102, 126, 234, 0.1)',
        tension: 0.3
      }
    ]
  };

  if (isEditing) {
    return (
      <div className="view-graph-container">
        <button className="back-btn" onClick={handleEditToggle}>← Cancel</button>
        
        <h1>Edit Graph</h1>

        <div className="form-section">
          <div className="form-group">
            <label>Graph Name *</label>
            <input
              type="text"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              placeholder="Graph name"
            />
          </div>

          <div className="form-group">
            <label>Chart Type *</label>
            <select value={editedType} onChange={(e) => setEditedType(e.target.value)}>
              <option value="line">Line Chart</option>
              <option value="bar">Bar Chart</option>
              <option value="pie">Pie Chart</option>
            </select>
          </div>

          <div className="form-group">
            <label>Labels (comma-separated) *</label>
            <input
              type="text"
              value={editedLabels}
              onChange={(e) => setEditedLabels(e.target.value)}
              placeholder="e.g., Jan, Feb, Mar"
            />
          </div>

          <div className="form-group">
            <label>Data (comma-separated numbers) *</label>
            <input
              type="text"
              value={editedData}
              onChange={(e) => setEditedData(e.target.value)}
              placeholder="e.g., 100, 150, 200"
            />
          </div>

          {error && <div className="error">{error}</div>}

          <div className="form-buttons">
            <button 
              className="save-btn" 
              onClick={handleSaveEdit} 
              disabled={saving}
            >
              {saving ? '⏳ Saving...' : '💾 Save Changes'}
            </button>
            <button className="cancel-btn" onClick={handleEditToggle}>
              ❌ Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view-graph-container">
      <button className="back-btn" onClick={onBack}>← Back</button>
      
      <h1>{graph.name}</h1>
      <p>📅 Created: {new Date(graph.createdAt).toLocaleDateString()}</p>
      <p>📈 Type: {graph.type.toUpperCase()}</p>

      <div className="graph-actions">
        <button className="edit-btn" onClick={handleEditToggle}>
          ✏️ Edit
        </button>
        <button className="delete-btn" onClick={handleDelete}>
          🗑️ Delete
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="graph-display">
        <Graph type={graph.type} title={graph.name} data={chartData} />
      </div>
    </div>
  );
}

export default ViewGraphDetail;