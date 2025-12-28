import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { saveGraphData, graphNameExists } from '../firebase';
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
      // Check if graph name already exists
      const nameExists = await graphNameExists(user.uid, categoryType, graphName);
      if (nameExists) {
        setError(`[✗] A graph with the name "${graphName}" already exists. Please choose a different name.`);
        setSaving(false);
        return;
      }

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

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
    },
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: { duration: 0.5 },
    },
  };

  return (
    <motion.div 
      className="create-graph-container"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      <motion.button 
        className="back-btn" 
        onClick={onBack}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        ← Back
      </motion.button>
      
      <motion.h1 variants={itemVariants}>Create {categoryTitles[categoryType]} Graph</motion.h1>

      <motion.div className="form-section" variants={containerVariants}>
        <motion.div className="form-group" variants={itemVariants}>
          <motion.label variants={itemVariants}>Graph Name *</motion.label>
          <motion.input
            type="text"
            value={graphName}
            onChange={(e) => setGraphName(e.target.value)}
            placeholder="e.g., Q1 Sales Report"
            whileFocus={{ scale: 1.02, boxShadow: '0 0 10px rgba(102, 126, 234, 0.5)' }}
          />
        </motion.div>

        <motion.div className="form-group" variants={itemVariants}>
          <motion.label variants={itemVariants}>Chart Type *</motion.label>
          <motion.select 
            value={chartType} 
            onChange={(e) => setChartType(e.target.value)}
            whileFocus={{ scale: 1.02 }}
          >
            <option value="line">Line Chart</option>
            <option value="bar">Bar Chart</option>
            <option value="pie">Pie Chart</option>
          </motion.select>
        </motion.div>

        <motion.div className="form-group" variants={itemVariants}>
          <motion.label variants={itemVariants}>Labels (comma-separated) *</motion.label>
          <motion.input
            type="text"
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            placeholder="e.g., Jan, Feb, Mar, Apr, May"
            whileFocus={{ scale: 1.02, boxShadow: '0 0 10px rgba(102, 126, 234, 0.5)' }}
          />
        </motion.div>

        <motion.div className="form-group" variants={itemVariants}>
          <motion.label variants={itemVariants}>Data (comma-separated numbers) *</motion.label>
          <motion.input
            type="text"
            value={data}
            onChange={(e) => setData(e.target.value)}
            placeholder="e.g., 100, 150, 200, 250, 300"
            whileFocus={{ scale: 1.02, boxShadow: '0 0 10px rgba(102, 126, 234, 0.5)' }}
          />
        </motion.div>

        {error && (
          <motion.div 
            className="error"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {error}
          </motion.div>
        )}

        <motion.div className="form-buttons" variants={containerVariants}>
          <motion.button 
            className="preview-btn" 
            onClick={handlePreview}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            variants={itemVariants}
          >
            Preview
          </motion.button>
          <motion.button 
            className="save-btn" 
            onClick={handleSave} 
            disabled={!preview || saving}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            variants={itemVariants}
          >
            {saving ? 'Saving...' :  'Save Graph'}
          </motion.button>
        </motion.div>
      </motion.div>

      {preview && (
        <motion.div 
          className="preview-section-inline"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <motion.h2
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            Graph Preview
          </motion.h2>
          <Graph type={chartType} title={graphName} data={preview} />
        </motion.div>
      )}
    </motion.div>
  );
}

export default CreateGraphForm;