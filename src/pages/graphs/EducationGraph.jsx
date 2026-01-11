import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Swal from 'sweetalert2';
import { getUserGraphs, saveGraphData, updateGraphData, graphNameExists, database, shareGraph, getGraphShareCodes, revokeShareCode } from '../../firebase';
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
  const [viewGraphId, setViewGraphId] = useState(null);
  const [editGraphId, setEditGraphId] = useState(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [currentShareGraphId, setCurrentShareGraphId] = useState(null);
  const [shareCodes, setShareCodes] = useState([]);
  const [loadingShares, setLoadingShares] = useState(false);

  useEffect(() => {
    fetchGraphs();
    setViewGraphId(null);
    setShowForm(false);
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

  const handleViewGraph = (graphId) => {
    setViewGraphId(graphId);
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
       const names = formData.map(d => d.name.trim());
       const firstResults = formData.map(d => parseFloat(d.firstResult));
       const secondResults = formData.map(d => parseFloat(d.secondResult));

       // Validate numbers
       if (firstResults.some(v => isNaN(v)) || secondResults.some(v => isNaN(v))) {
         setError('[!] Please enter valid numbers');
         return;
       }

       if (names.length === 0 || firstResults.length === 0 || secondResults.length === 0) {
         setError('[!] No data to preview');
         return;
       }

       const previewData = {
         labels: names,
         datasets: [
           {
             label: 'First Result',
             data:  firstResults
           },
           {
             label: 'Second Result',
             data: secondResults
           }
         ]
       };

       console.log('Preview Data:', { chartType, previewData });
       setPreview(previewData);
       setError('');
     } catch (err) {
       console.error('Preview Error:', err);
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
        data: preview.datasets,
        type: chartType
      };

      if (editGraphId) {
        // Update existing graph
        await updateGraphData(user.uid, 'education', editGraphId, reportName, graphData);
        Swal.fire({
          icon: 'success',
          title: 'Updated!',
          text: 'Education report updated successfully',
          timer: 1500,
          showConfirmButton: false
        });
        setEditGraphId(null);
      } else {
        // Check if graph name already exists (only for new graphs)
        const nameExists = await graphNameExists(user.uid, 'education', reportName);
        if (nameExists) {
          setError(`[!] A graph with the name "${reportName}" already exists. Please choose a different name.`);
          setSaving(false);
          return;
        }

        // Save new graph
        await saveGraphData(user.uid, 'education', reportName, graphData);
        Swal.fire({
          icon: 'success',
          title: 'Saved!',
          text: 'Education report saved successfully',
          timer: 1500,
          showConfirmButton: false
        });
      }

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

  const handleEdit = async (graphId, graphData) => {
    setEditGraphId(graphId);
    setReportName(graphData.name);
    setChartType(graphData.type);
    setFormData(graphData.labels.map((label, idx) => ({
      name: label,
      firstResult: graphData.data[0].data[idx],
      secondResult: graphData.data[1].data[idx]
    })));
    setPreview(null);  // Clear preview when starting edit
    setError('');  // Clear any errors
    setShowForm(true);
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

  const handleOpenShareModal = async (graphId) => {
    setCurrentShareGraphId(graphId);
    setShareModalOpen(true);
    setLoadingShares(true);
    
    try {
      const codes = await getGraphShareCodes(user.uid, 'education', graphId);
      setShareCodes(codes);
    } catch (err) {
      console.error('Error fetching share codes:', err);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Failed to load share codes'
      });
    } finally {
      setLoadingShares(false);
    }
  };

  const handleCreateShare = async (isPublic) => {
    if (!currentShareGraphId) return;

    try {
      const code = await shareGraph(user.uid, 'education', currentShareGraphId, isPublic);
      setShareCodes([...shareCodes, {
        shareCode: code,
        isPublic: isPublic,
        createdAt: new Date().toISOString()
      }]);
      
      Swal.fire({
        icon: 'success',
        title: 'Share Link Created!',
        html: `
          <div style="text-align: left; margin: 15px 0;">
            <p><strong>Share Code:</strong></p>
            <code style="background: #f0f0f0; padding: 8px; border-radius: 4px; display: block; word-break: break-all;">${code}</code>
            <p style="margin-top: 10px;"><strong>Full Link:</strong></p>
            <code style="background: #f0f0f0; padding: 8px; border-radius: 4px; display: block; word-break: break-all;">${window.location.origin}/?share=${code}</code>
            <p style="margin-top: 10px; font-size: 12px;">
              ${isPublic ? '🌐 This graph is PUBLIC - anyone with the link can view it' : '🔒 This graph is PRIVATE - only shared links work'}
            </p>
          </div>
        `,
        confirmButtonText: 'Copy & Close'
      }).then(() => {
        navigator.clipboard.writeText(`${window.location.origin}/?share=${code}`);
      });
    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Failed to create share link: ' + err.message
      });
    }
  };

  const handleRevokeShare = async (shareCode) => {
    const result = await Swal.fire({
      title: 'Revoke Share Link?',
      text: 'This share link will no longer work',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'Yes, revoke it!'
    });

    if (result.isConfirmed) {
      try {
        await revokeShareCode(shareCode);
        setShareCodes(shareCodes.filter(s => s.shareCode !== shareCode));
        Swal.fire({
          icon: 'success',
          title: 'Revoked!',
          text: 'Share link has been revoked'
        });
      } catch (err) {
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'Failed to revoke share link'
        });
      }
    }
  };

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

  // If viewing a graph, show detail view
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

        <div className="graph-actions">
          <button className="share-btn" onClick={() => handleOpenShareModal(viewGraphId)}>
            Share
          </button>
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
              <option value="pie">Pie Chart</option>
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
                   <button className="preview-btn" onClick={() => handleViewGraph(id)}>
                     Preview
                   </button>
                   <button className="share-btn" onClick={() => handleOpenShareModal(id)}>
                     Share
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

      {/* Share Modal */}
      {shareModalOpen && (
        <div className="modal-overlay" onClick={() => setShareModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShareModalOpen(false)}>×</button>
            <h2>Share Graph</h2>
            
            <div className="share-buttons">
              <button 
                className="public-share-btn"
                onClick={() => handleCreateShare(true)}
              >
                🌐 Create Public Link
              </button>
              <p className="share-desc">Anyone with the link can view (read-only)</p>
            </div>

            <h3>Existing Share Links</h3>
            {loadingShares ? (
              <p>Loading share codes...</p>
            ) : shareCodes.length === 0 ? (
              <p className="no-shares">No share links created yet</p>
            ) : (
              <div className="share-codes-list">
                {shareCodes.map((share) => (
                  <div key={share.shareCode} className="share-code-item">
                    <div className="share-code-info">
                      <span className={`visibility-badge ${share.isPublic ? 'public' : 'private'}`}>
                        {share.isPublic ? '🌐 PUBLIC' : '🔒 PRIVATE'}
                      </span>
                      <code>{share.shareCode.substring(0, 12)}...</code>
                      <small>{new Date(share.createdAt).toLocaleDateString()}</small>
                    </div>
                    <div className="share-code-actions">
                      <button 
                        className="copy-btn"
                        onClick={() => {
                          const url = `${window.location.origin}/?share=${share.shareCode}`;
                          navigator.clipboard.writeText(url);
                          Swal.fire({
                            icon: 'success',
                            title: 'Copied!',
                            text: 'Share link copied to clipboard',
                            timer: 1500,
                            showConfirmButton: false
                          });
                        }}
                      >
                        Copy Link
                      </button>
                      <button 
                        className="revoke-btn"
                        onClick={() => handleRevokeShare(share.shareCode)}
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default EducationGraph;
