import React from 'react';
import { useParams } from 'react-router-dom';
import BusinessGraph from '../pages/graphs/BusinessGraph.jsx';
import EducationGraph from '../pages/graphs/EducationGraph.jsx';
import SportsGraph from '../pages/graphs/SportsGraph.jsx';
import HealthGraph from '../pages/graphs/HealthGraph.jsx';
import WeatherGraph from '../pages/graphs/WeatherGraph.jsx';
import AnalyticsGraph from '../pages/graphs/AnalyticsGraph.jsx';

const GraphRouter = ({ user, onBack }) => {
  const { graphType, graphName } = useParams();
  
  const graphComponents = {
    business: BusinessGraph,
    education: EducationGraph,
    sports: SportsGraph,
    health: HealthGraph,
    weather: WeatherGraph,
    analytics: AnalyticsGraph
  };

  const GraphComponent = graphComponents[graphType] || EducationGraph;
  
  return <GraphComponent user={user} onBack={onBack} graphName={graphName} />;
};

export default GraphRouter;
