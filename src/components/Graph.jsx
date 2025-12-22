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

function Graph({ type, title, data }) {
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
        beginAtZero: true
      }
    }
  };

  return (
    <div className="graph-card">
      <div style={{ position: 'relative', height: '400px' }}>
        {type === 'line' && <Line data={data} options={chartOptions} />}
        {type === 'bar' && <Bar data={data} options={chartOptions} />}
        {type === 'pie' && <Pie data={data} options={chartOptions} />}
      </div>
    </div>
  );
}

export default Graph;