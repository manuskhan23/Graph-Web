import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Swal from 'sweetalert2';
import { getUserGraphs, saveGraphData, graphNameExists, database } from '../../firebase';
import { ref, remove } from 'firebase/database';
import Graph from '../../components/Graph';

function EducationGraph({ user, onBack }) {
  const [graphs, setGraphs] = useState({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState([
    { name: '', firstResult: '', secondResult: '' }
  ]);
  const [reportName, setReportName] = useState('');
  const [chartType, setChartType] = useState('bar');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [viewingGraphId, setViewingGraphId] = useState(null);

  useEffect(() => {
    fetchGraphs();
  }, [user]);

  const fetchGraphs = async () => {
    try {
      const data = await getUserGraphs(user.uid, 'education');
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
    setFormData([...formData, { name: '', firstResult: '', secondResult: '' }]);
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

    if (formData.some(d => !d.name || !d.firstResult || !d.secondResult)) {
       setError('[!] Please fill all student data');
      return;
    }

    try {
      const names = formData.map(d => d.name);
      const firstResults = formData.map(d => parseFloat(d.firstResult));
      const secondResults = formData.map(d => parseFloat(d.secondResult));

      const previewData = {
        labels: names,
        datasets: [
          {
            label: 'First Result',
            data:  firstResults,
            borderColor: '#4ECDC4',
            backgroundColor:  'rgba(78, 205, 196, 0.6)',
            tension: 0.3
          },
          {
            label: 'Second Result',
            data: secondResults,
            borderColor: '#FF9800',
            backgroundColor: 'rgba(255, 152, 0, 0.6)',
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
      // Check if graph name already exists
      const nameExists = await graphNameExists(user.uid, 'education', reportName);
      if (nameExists) {
        setError(`[!] A graph with the name "${reportName}" already exists. Please choose a different name.`);
        setSaving(false);
        return;
      }

      const graphData = {
        labels: preview.labels,
        data: preview.datasets,
        type: chartType
      };

      await saveGraphData(user.uid, 'education', reportName, graphData);
       Swal.fire({
         icon: 'success',
         title: 'Saved!',
         text: 'Education report saved successfully',
         timer: 1500,
         showConfirmButton: false
       });
       
       // Reset form
       setFormData([{ name: '', firstResult: '', secondResult: '' }]);
       setReportName('');
       setPreview(null);
       setShowForm(false);
       
       // Refresh graphs
       fetchGraphs();
    } catch (err) {
      setError(`[✗] Error: ${err.message}`);
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
      await remove(ref(database, `graphs/${user.uid}/education/${graphId}`));
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

  const graphCount = Object.keys(graphs).length;

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

  return (
    <div className="category-page-container">
      <button className="back-btn" onClick={onBack}>← Back to Home</button>
      
      <div className="category-header" style={{ borderLeft: '5px solid #4ECDC4' }}>
         <h1>Education Graphs</h1>
        <p>Compare student results across exams</p>
      </div>

      <button className="create-btn" onClick={() => setShowForm(!showForm)}>
        {showForm ? 'Close Form' : 'Create New Graph'}
      </button>

      {/* Form */}
      {showForm && (
        <div className="form-section">
          <div className="form-group">
            <label>Report Name *</label>
            <input
              type="text"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              placeholder="e.g., Semester 1 Results"
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
            <h3>Student Results</h3>
            {formData.map((item, index) => (
              <div key={index} className="input-row">
                <input
                  type="text"
                  placeholder="Student Name"
                  value={item.name}
                  onChange={(e) => handleInputChange(index, 'name', e.target.value)}
                />
                <input
                  type="number"
                  placeholder="1st Result"
                  value={item.firstResult}
                  onChange={(e) => handleInputChange(index, 'firstResult', e.target.value)}
                />
                <input
                  type="number"
                  placeholder="2nd Result"
                  value={item.secondResult}
                  onChange={(e) => handleInputChange(index, 'secondResult', e.target.value)}
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
              Add Student
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
          {loading ?  (
            <p style={{ textAlign: 'center' }}>Loading graphs...</p>
          ) : graphCount === 0 ? (
            <div className="no-graphs">
              <p>No education graphs yet. Create one to get started!</p>
            </div>
          ) : (
            Object.entries(graphs).map(([id, graph]) => (
              <div key={id} className="graph-item-card">
                <div className="graph-item-content">
                  <h3>{graph.name}</h3>
                  <p>Created: {new Date(graph.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="graph-item-actions">
                  <button className="preview-btn" onClick={() => setViewingGraphId(id)}>
                    Preview
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

      {/* Graph Preview Modal */}
      {viewingGraphId && graphs[viewingGraphId] && (
        <div className="preview-section">
          <div className="preview-header">
            <h2>{graphs[viewingGraphId].name}</h2>
            <button className="close-btn" onClick={() => setViewingGraphId(null)}>Close</button>
          </div>
          <Graph 
            type={graphs[viewingGraphId].type} 
            title={graphs[viewingGraphId].name} 
            data={{
              labels: graphs[viewingGraphId].labels,
              datasets: graphs[viewingGraphId].data
            }} 
          />
        </div>
      )}
      </div>
      );
      }

      export default EducationGraph;