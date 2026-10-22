// Helper functions for chart data preparation

export const prepareLineChartData = (labels, data, label = 'Data') => {
  return {
    labels,
    datasets:  [
      {
        label,
        data,
        borderColor: '#667eea',
        backgroundColor: 'rgba(102, 126, 234, 0.1)',
        tension: 0.3
      }
    ]
  };
};

export const prepareBarChartData = (labels, data, label = 'Data') => {
  return {
    labels,
    datasets: [
      {
        label,
        data,
        backgroundColor: '#667eea'
      }
    ]
  };
};

export const preparePieChartData = (labels, data, label = 'Data') => {
  const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF'];
  return {
    labels,
    datasets: [
      {
        label,
        data,
        backgroundColor: colors. slice(0, data.length)
      }
    ]
  };
};