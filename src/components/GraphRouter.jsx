import React from 'react';
import { useParams, useLocation } from 'react-router-dom';
import BusinessGraph from '../pages/graphs/BusinessGraph.jsx';
import EducationGraph from '../pages/graphs/EducationGraph.jsx';
import SportsGraph from '../pages/graphs/SportsGraph.jsx';
import HealthGraph from '../pages/graphs/HealthGraph.jsx';
import WeatherGraph from '../pages/graphs/WeatherGraph.jsx';
import AnalyticsGraph from '../pages/graphs/AnalyticsGraph.jsx';
import ExpressionGraph from '../pages/graphs/ExpressionGraph.jsx';

const GraphRouter = ({ user, onBack }) => {
  const { graphType } = useParams();
  const location = useLocation();
  
  // Extract graphName and action from pathname
  // Example: /user/education/d/edit → graphType=education, graphName=d, action=edit
  const parts = location.pathname.split('/').filter(Boolean);
  const graphTypePos = parts.indexOf(graphType);
  
  let graphName = null;
  let action = null;
  
  if (graphTypePos !== -1) {
    if (parts[graphTypePos + 1]) {
      graphName = parts[graphTypePos + 1];
    }
    if (parts[graphTypePos + 2]) {
      action = parts[graphTypePos + 2];
    }
  }
  
  const graphComponents = {
    business: BusinessGraph,
    education: EducationGraph,
    sports: SportsGraph,
    health: HealthGraph,
    weather: WeatherGraph,
    analytics: AnalyticsGraph,
    expression: ExpressionGraph
  };

  const GraphComponent = graphComponents[graphType] || EducationGraph;
  
  console.log('GraphRouter - graphType:', graphType, 'graphName:', graphName, 'action:', action, 'pathname:', location.pathname);
  
  return <GraphComponent user={user} onBack={onBack} graphName={graphName} action={action} />;
};

export default GraphRouter;
