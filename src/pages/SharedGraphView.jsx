import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { getSharedGraph } from "../firebase";
import Graph from "../components/Graph";
import "../styles/shared-graph.css";

function SharedGraphView({ shareCode, graphType }) {
  const [searchParams] = useSearchParams();
  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const share = shareCode || searchParams.get("share");
  const type = graphType || searchParams.get("type");

  useEffect(() => {
    if (share) {
      fetchSharedGraph();
    } else {
      setError("No share code provided");
      setLoading(false);
    }
  }, [share]);

  const fetchSharedGraph = async () => {
    try {
      setLoading(true);
      setError("");

      const data = await getSharedGraph(share);

      if (!data) {
        setError("Graph not found or no longer available");
        setGraphData(null);
        setLoading(false);
        return;
      }

      if (data.isPublic) {
        console.log("Shared graph data received:", data);
        setGraphData(data);
        setLoading(false);
        return;
      }

      setError("This graph is private and cannot be accessed via share link.");
      setGraphData(null);
      setLoading(false);
    } catch (err) {
      console.error("Error fetching shared graph:", err);
      setError("Error: " + err.message);
      setLoading(false);
    }
  };

  const copyShareLink = () => {
    const url = `${window.location.origin}/?share=${share}&type=${type || 'education'}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="shared-graph-container">
        <div className="loading-message">
          <div className="spinner"></div>
          <p>Loading graph...</p>
        </div>
      </div>
    );
  }

  if (error || !graphData) {
    return (
      <div className="shared-graph-container">
        <div className="error-message">
          <h2>Cannot Load Graph</h2>
          <p>{error || "Graph not found"}</p>
          <p style={{ fontSize: "0.9em", marginTop: "10px", opacity: 0.8 }}>
            Check the share link or contact the graph owner
          </p>
          <a href="/">Return to Home</a>
        </div>
      </div>
    );
  }

  const { graph } = graphData;

  // Debug: check what we received
  console.log("Graph structure:", {
    hasData: !!graph.data,
    hasDatasets: !!graph.datasets,
    dataType: typeof graph.data,
    datasetsType: typeof graph.datasets,
    dataLength: Array.isArray(graph.data) ? graph.data.length : "not array",
    datasetsLength: Array.isArray(graph.datasets)
      ? graph.datasets.length
      : "not array",
  });

  let datasets = [];

  // Try data field first (it's set by saveGraphData)
  if (Array.isArray(graph.data) && graph.data.length > 0) {
    console.log("Using graph.data as datasets");
    datasets = graph.data;
  }
  // Fall back to datasets field
  else if (Array.isArray(graph.datasets) && graph.datasets.length > 0) {
    console.log("Using graph.datasets as datasets");
    datasets = graph.datasets;
  } else {
    console.log("No valid datasets found", { data: graph.data, datasets: graph.datasets });
  }

  const chartData = {
    labels: graph.labels || [],
    datasets: datasets,
  };

  console.log("Final chartData for Graph component:", chartData);

  return (
    <div className="shared-graph-container">
      <div className="shared-graph-header">
        <h1>{graph.name}</h1>
        <p className="graph-meta">
          Created: {new Date(graph.createdAt).toLocaleDateString()}
          <span className="divider">•</span>
          Type: {graph.type.toUpperCase()}
        </p>
        <p className="read-only-badge">📖 Read-Only • This is a shared view</p>
      </div>

      <div className="shared-graph-display">
        {chartData.datasets && chartData.datasets.length > 0 ? (
          <Graph type={graph.type} title={graph.name} data={chartData} />
        ) : (
          <div style={{ padding: "20px", textAlign: "center", color: "#666" }}>
            <p>No data available for this graph</p>
          </div>
        )}
      </div>

      <div className="share-info">
        <button className="copy-link-btn" onClick={copyShareLink}>
          {copied ? "✓ Link Copied!" : "📋 Copy Share Link"}
        </button>
        <p className="share-note">
          You can only view this graph. To edit or delete, contact the graph
          owner.
        </p>
      </div>
    </div>
  );
}

export default SharedGraphView;
