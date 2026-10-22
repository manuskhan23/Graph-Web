import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getPrivateLink, updateGraphDataOnly } from '../firebase';
import Graph from '../components/Graph';
import '../styles/shared-graph.css';

// Normalise a stored graph into { labels, datasets:[{ label, data[] }] }
function normalise(graph) {
  const labels = Array.isArray(graph.labels) ? graph.labels : [];
  let datasets = [];
  const raw = Array.isArray(graph.data) ? graph.data : (Array.isArray(graph.datasets) ? graph.datasets : []);

  if (raw.length > 0 && typeof raw[0] === 'object') {
    // multi-dataset (e.g. education)
    datasets = raw.map(d => ({ label: d.label || 'Dataset', data: Array.isArray(d.data) ? d.data : [] }));
  } else {
    // flat numeric array
    datasets = [{ label: graph.name || 'Dataset', data: raw.map(Number) }];
  }
  return { labels, datasets };
}

function PrivateGraphView() {
  const { linkCode } = useParams();
  const [state, setState] = useState('loading'); // loading | closed | ready
  const [closedInfo, setClosedInfo] = useState(null); // { title, message }
  const [link, setLink] = useState(null);
  const [graph, setGraph] = useState(null);

  const [isEditing, setIsEditing] = useState(false);
  const [labelsText, setLabelsText] = useState('');
  const [datasetTexts, setDatasetTexts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getPrivateLink(linkCode);
        if (cancelled) return;

        if (res.status === 'ok') {
          setLink(res.link);
          setGraph(res.graph);
          setState('ready');
        } else if (res.status === 'revoked') {
          setClosedInfo({
            title: 'This private link has been revoked or does not exist',
            message: 'The graph owner has revoked this private link, so it can no longer be opened.'
          });
          setState('closed');
        } else if (res.status === 'limit_reached') {
          setClosedInfo({
            title: 'Open limit reached',
            message: 'This private link has reached its maximum number of opens and has automatically closed.'
          });
          setState('closed');
        } else {
          setClosedInfo({
            title: 'This private link has been revoked or does not exist',
            message: 'The key is invalid — it was revoked by the owner or never existed.'
          });
          setState('closed');
        }
      } catch (err) {
        if (cancelled) return;
        setClosedInfo({ title: 'Something went wrong', message: String(err.message || err) });
        setState('closed');
      }
    })();
    return () => { cancelled = true; };
  }, [linkCode]);

  const startEdit = () => {
    const { labels, datasets } = normalise(graph);
    setLabelsText(labels.join(', '));
    setDatasetTexts(datasets.map(d => d.data.join(', ')));
    setError('');
    setSaved(false);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setError('');
  };

  const updateDatasetText = (idx, val) => {
    setDatasetTexts(prev => prev.map((t, i) => (i === idx ? val : t)));
  };

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      const labelArray = labelsText.split(',').map(l => l.trim()).filter(l => l !== '');
      if (labelArray.length === 0) throw new Error('Labels cannot be empty');

      const parsedDatasets = datasetTexts.map((text, i) => {
        const nums = text.split(',').map(v => {
          const n = parseFloat(String(v).trim());
          if (isNaN(n)) throw new Error(`Dataset ${i + 1} contains a non-numeric value`);
          return n;
        });
        if (nums.length !== labelArray.length) {
          throw new Error(`Dataset ${i + 1} has ${nums.length} values but there are ${labelArray.length} labels`);
        }
        return nums;
      });

      const wasMulti = (() => {
        const raw = Array.isArray(graph.data) ? graph.data : [];
        return raw.length > 0 && typeof raw[0] === 'object';
      })();

      let data, datasets;
      if (wasMulti) {
        const original = Array.isArray(graph.data) ? graph.data : [];
        datasets = original.map((d, i) => ({ ...d, data: parsedDatasets[i] || [] }));
        data = datasets;
      } else {
        data = parsedDatasets[0];
        datasets = data;
      }

      await updateGraphDataOnly(link.ownerUid, link.graphType, link.graphId, { labels: labelArray, data, datasets });

      const updatedGraph = { ...graph, labels: labelArray, data, datasets };
      setGraph(updatedGraph);
      setIsEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  if (state === 'loading') {
    return (
      <div className="shared-graph-container">
        <div className="loading-message">
          <div className="spinner"></div>
          <p>Loading graph...</p>
        </div>
      </div>
    );
  }

  if (state === 'closed') {
    return (
      <div className="shared-graph-container">
        <div className="error-message">
          <h2>🔒 {closedInfo.title}</h2>
          <p>{closedInfo.message}</p>
          <a href="/">Return to Home</a>
        </div>
      </div>
    );
  }

  const { labels, datasets } = normalise(graph);
  const chartData = { labels, datasets };
  const limitLabel = link.openLimit === 'none' ? 'No open limit' : `${link.openCount || 0}/${link.openLimit} opens used`;

  return (
    <div className="shared-graph-container">
      <div className="shared-graph-header">
        <h1>{graph.name}</h1>
        <p className="graph-meta">
          {graph.createdAt ? `Created: ${new Date(graph.createdAt).toLocaleDateString()} • ` : ''}
          Type: {String(graph.type || '').toUpperCase()}
        </p>
        <p className="read-only-badge">✏️ Edit access • You can change this graph's data only</p>
        <p className="private-link-meter">{limitLabel}</p>
      </div>

      <div className="shared-graph-display">
        {chartData.datasets && chartData.datasets.length > 0 ? (
          <Graph type={graph.type} title={graph.name} data={chartData} />
        ) : (
          <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
            <p>No data available for this graph</p>
          </div>
        )}
      </div>

      {isEditing ? (
        <div className="private-edit-form">
          <h3>Edit Graph Data</h3>
          <div className="form-group">
            <label>Labels (comma-separated)</label>
            <input
              type="text"
              value={labelsText}
              onChange={(e) => setLabelsText(e.target.value)}
              placeholder="e.g. Jan, Feb, Mar"
            />
          </div>
          {datasetTexts.map((text, i) => (
            <div className="form-group" key={i}>
              <label>{datasets[i]?.label || `Dataset ${i + 1}`} (values, comma-separated)</label>
              <input
                type="text"
                value={text}
                onChange={(e) => updateDatasetText(i, e.target.value)}
                placeholder="e.g. 100, 150, 200"
              />
            </div>
          ))}
          {error && <div className="error">{error}</div>}
          <div className="form-buttons">
            <button className="save-btn" onClick={handleSave} disabled={saving}>
              {saving ? '⏳ Saving...' : '💾 Save Changes'}
            </button>
            <button className="cancel-btn" onClick={cancelEdit} disabled={saving}>
              ❌ Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="share-info">
          <button className="copy-link-btn" onClick={startEdit}>
            ✏️ Edit Data
          </button>
          {saved && <span className="saved-flash">✓ Changes saved!</span>}
          <p className="share-note">
            You can change this graph's data. You cannot delete the graph or create new links.
          </p>
        </div>
      )}
    </div>
  );
}

export default PrivateGraphView;
