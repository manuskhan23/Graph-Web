import React, { useState } from 'react';
import { saveGraphData } from '../firebase';
import Graph from '../components/Graph';

function CreateGraphForm({ user, categoryType, onBack }) {
  const [graphName, setGraphName] = useState('');
  const [labels, setLabels] = useState('');
  const [data, setData] = useState('');
  const [chartType, setChartType] = useState('line');
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const categoryTitles = {
    business: 'Business',
    education: 'Education',
    sports: 'Sports',
    health: 'Health',
    weather: 'Weather',
    analytics:  'Analytics'
  };

  const handlePreview = () => {
    if (!graphName.trim() || !labels.trim() || !data.trim()) {
      setError('[!] Please fill all fields');
      return;
    }

    try {
      const labelArray = labels.split(',').map(l => l.trim()).filter(l => l);
      const dataArray = data.split(',').map(d => {
        const num = parseFloat(d.trim());
        if (isNaN(num)) throw new Error('Invalid number');
        return num;
      });

      if (labelArray.length !== dataArray.length) {
        setError('[!] Labels and data count must match');
        return;
      }

      const previewData = {
        labels: labelArray,
        datasets: [
          {
            label: graphName,
            data: dataArray,
            borderColor: '#667eea',
            backgroundColor: chartType === 'pie' 
              ? ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF']
              : 'rgba(102, 126, 234, 0.1)',
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
        type: chartType
      };

      await saveGraphData(user.uid, categoryType, graphName, graphData);
      alert('[✓] Graph saved successfully!');
      
      // Reset form state
      setGraphName('');
      setLabels('');
      setData('');
      setChartType('line');
      setPreview(null);
      setError('');
      
      onBack();
    } catch (err) {
      setError(`[✗] Error saving graph: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="create-graph-container">
      <button className="back-btn" onClick={onBack}>← Back</button>
      
      <h1>Create {categoryTitles[categoryType]} Graph</h1>

      <div className="form-section">
        <div className="form-group">
          <label>Graph Name *</label>
          <input
            type="text"
            value={graphName}
            onChange={(e) => setGraphName(e.target.value)}
            placeholder="e.g., Q1 Sales Report"
          />
        </div>

        <div className="form-group">
          <label>Chart Type *</label>
          <select value={chartType} onChange={(e) => setChartType(e.target.value)}>
            <option value="line">Line Chart</option>
            <option value="bar">Bar Chart</option>
            <option value="pie">Pie Chart</option>
          </select>
        </div>

        <div className="form-group">
          <label>Labels (comma-separated) *</label>
          <input
            type="text"
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            placeholder="e.g., Jan, Feb, Mar, Apr, May"
          />
        </div>

        <div className="form-group">
          <label>Data (comma-separated numbers) *</label>
          <input
            type="text"
            value={data}
            onChange={(e) => setData(e.target.value)}
            placeholder="e.g., 100, 150, 200, 250, 300"
          />
        </div>

        {error && <div className="error">{error}</div>}

        <div className="form-buttons">
          <button className="preview-btn" onClick={handlePreview}>
            Preview
          </button>
          <button 
            className="save-btn" 
            onClick={handleSave} 
            disabled={!preview || saving}
          >
            {saving ? 'Saving...' :  'Save Graph'}
          </button>
        </div>
      </div>

      {preview && (
        <div className="preview-section-inline">
          <h2>Graph Preview</h2>
          <Graph type={chartType} title={graphName} data={preview} />
        </div>
      )}
    </div>
  );
}

export default CreateGraphForm;