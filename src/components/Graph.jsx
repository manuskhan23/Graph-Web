import React from 'react';
import { Line, Bar, Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

// Color palette for different datasets
const colorPalette = [
  { border: '#FF6B6B', bg: 'rgba(255, 107, 107, 0.3)' },      // Red
  { border: '#4ECDC4', bg: 'rgba(78, 205, 196, 0.3)' },       // Teal
  { border: '#FFD93D', bg: 'rgba(255, 217, 61, 0.3)' },       // Yellow
  { border: '#6BCB77', bg: 'rgba(107, 203, 119, 0.3)' },      // Green
  { border: '#A8E6CF', bg: 'rgba(168, 230, 207, 0.3)' },      // Mint
  { border: '#FF8B94', bg: 'rgba(255, 139, 148, 0.3)' },      // Pink
  { border: '#FFB3BA', bg: 'rgba(255, 179, 186, 0.3)' },      // Light Pink
  { border: '#FFCCCB', bg: 'rgba(255, 204, 203, 0.3)' },      // Blanched Almond
  { border: '#C44569', bg: 'rgba(196, 69, 105, 0.3)' },       // Rose
  { border: '#F08080', bg: 'rgba(240, 128, 128, 0.3)' },      // Light Coral
];

// Pie chart specific colors
const pieColors = [
  '#FF6B6B', '#4ECDC4', '#FFD93D', '#6BCB77', '#A8E6CF',
  '#FF8B94', '#FFB3BA', '#FFCCCB', '#C44569', '#F08080',
  '#FF7675', '#69C0FF', '#95DE64', '#597EF7', '#D3ADF7'
];

function Graph({ type, title, data }) {
  // Apply colors to datasets - ALWAYS apply new colors
  const enrichedData = {
    ...data,
    datasets: data.datasets.map((dataset, index) => {
      if (type === 'pie') {
        // For pie charts, use array of colors for each data point
        const dataLength = dataset.data ? dataset.data.length : 0;
        const colors = pieColors.slice(0, dataLength).concat(
          pieColors.length < dataLength 
            ? Array(dataLength - pieColors.length).fill(pieColors[0])
            : []
        );
        return {
          ...dataset,
          backgroundColor: colors,
          borderColor: '#fff',
          borderWidth: 2,
          fill: false
        };
      } else if (type === 'line') {
        // For line charts
        const color = colorPalette[index % colorPalette.length];
        const dataLength = dataset.data ? dataset.data.length : 0;
        
        return {
          ...dataset,
          borderColor: color.border,
          backgroundColor: color.bg,
          fill: false,
          tension: dataLength > 1 ? 0.4 : 0,  // No tension for single point
          borderWidth: dataLength > 1 ? (dataset.borderWidth || 3) : 0,  // No border for single point
          pointBackgroundColor: color.border,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: dataset.pointRadius || 5,
          pointHoverRadius: dataset.pointHoverRadius || 7,
          showLine: dataLength > 1  // Only show line if more than 1 point
        };
      } else {
        // For bar charts
        const color = colorPalette[index % colorPalette.length];
        return {
          ...dataset,
          borderColor: color.border,
          backgroundColor: color.bg,
          fill: true,
          tension: 0.3,
          borderWidth: dataset.borderWidth || 2,
          pointBackgroundColor: color.border,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: dataset.pointRadius || 4,
          pointHoverRadius: dataset.pointHoverRadius || 6
        };
      }
    })
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins:  {
      legend: {
        position: 'bottom'
      },
      title: {
        display: false
      }
    },
    scales: type === 'pie' ? {} : {
      y: {
        beginAtZero: true,
        ticks: {
          beginAtZero: true
        }
      },
      x: {
        ticks: {
          maxRotation: 45,
          minRotation: 0
        }
      }
    }
  };

  if (!data || !data.labels || !data.datasets) {
    return <div className="graph-card">No data to display</div>;
  }

  return (
    <div className="graph-card">
      <div style={{ position: 'relative', height: '400px', width: '100%' }}>
        {type === 'line' && <Line data={enrichedData} options={chartOptions} />}
        {type === 'bar' && <Bar data={enrichedData} options={chartOptions} />}
        {type === 'pie' && <Pie data={enrichedData} options={chartOptions} />}
      </div>
    </div>
  );
}

export default Graph;