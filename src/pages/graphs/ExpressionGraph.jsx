import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Swal from "sweetalert2";
import {
  getUserGraphs,
  saveGraphData,
  updateGraphData,
  graphNameExists,
  database,
  set,
  ref,
  shareGraph,
  getGraphShareCodes,
  revokeShareCode,
} from "../../firebase";
import { remove } from "firebase/database";
import Graph from "../../components/Graph";

function ExpressionGraph({ user, onBack }) {
  const [graphs, setGraphs] = useState({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [graphName, setGraphName] = useState("");
  const [expression, setExpression] = useState("");
  const [variables, setVariables] = useState("");
  const [xMin, setXMin] = useState("-10");
  const [xMax, setXMax] = useState("10");
  const [chartType, setChartType] = useState("line");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [viewGraphId, setViewGraphId] = useState(null);
  const [editGraphId, setEditGraphId] = useState(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [currentShareGraphId, setCurrentShareGraphId] = useState(null);
  const [shareCodes, setShareCodes] = useState([]);
  const [loadingShares, setLoadingShares] = useState(false);
  const [step, setStep] = useState(1); // 1: simple, 2: advanced

  useEffect(() => {
    fetchGraphs();
    setViewGraphId(null);
    setShowForm(false);
  }, [user]);

  // Scroll to preview when it appears
  useEffect(() => {
    if (preview) {
      setTimeout(() => {
        const previewElement = document.getElementById("preview-section");
        if (previewElement) {
          previewElement.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 100);
    }
  }, [preview]);

  const fetchGraphs = async () => {
    try {
      const data = await getUserGraphs(user.uid, "expression");
      setGraphs(data || {});
    } catch (err) {
      console.error("Error fetching graphs:", err);
    } finally {
      setLoading(false);
    }
  };

  // Safe math evaluation with allowed functions and variables
  const evaluateExpression = (expr, x, vars = "") => {
    try {
      // Parse variables from variable declarations
      const variableScope = {};
      if (vars.trim()) {
        const lines = vars.split("\n").filter((line) => line.trim());
        for (const line of lines) {
          const match = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([^;]+)/);
          if (match) {
            const varName = match[1];
            const varValue = match[2].trim();
            try {
              variableScope[varName] = parseFloat(varValue);
            } catch {
              // Skip invalid variable declarations
            }
          }
        }
      }

      // Create safe math context with variables
      const mathScope = {
        sin: Math.sin,
        cos: Math.cos,
        tan: Math.tan,
        sqrt: Math.sqrt,
        abs: Math.abs,
        pow: Math.pow,
        exp: Math.exp,
        log: Math.log,
        log10: Math.log10,
        ceil: Math.ceil,
        floor: Math.floor,
        round: Math.round,
        PI: Math.PI,
        E: Math.E,
        x: x,
        ...variableScope,
      };

      // Replace ^ with ** (exponentiation)
      let safExpr = expr.replace(/\^/g, "**");

      // Replace x with the actual value (but not in function names)
      // Match x that is not preceded by a letter (to avoid matching "exp", "sin", etc.)
      safExpr = safExpr.replace(
        /([^a-zA-Z])x(?=[^a-zA-Z]|$)/g,
        "$1(" + x + ")"
      );
      // Handle x at the start
      safExpr = safExpr.replace(/^x(?=[^a-zA-Z]|$)/, "(" + x + ")");

      // Create function with safe scope
      const funcStr = `
        with (mathScope) {
          return ${safExpr};
        }
      `;

      const result = new Function("mathScope", funcStr)(mathScope);

      // Return NaN for invalid results (Infinity, null, undefined, etc)
      if (!isFinite(result)) {
        return NaN;
      }

      return result;
    } catch (err) {
      return NaN;
    }
  };

  const handlePreview = () => {
    if (!graphName.trim()) {
      setError("⚠️ Please enter graph name");
      return;
    }

    if (!expression.trim()) {
      setError("⚠️ Please enter an expression (e.g., x^2, sin(x), sqrt(x))");
      return;
    }

    try {
      const min = parseFloat(xMin);
      const max = parseFloat(xMax);

      if (isNaN(min) || isNaN(max)) {
        setError("⚠️ Please enter valid numbers for X range");
        return;
      }

      if (min >= max) {
        setError("⚠️ Min X must be less than Max X");
        return;
      }

      // Generate points
      const points = [];
      const step = (max - min) / 100; // 100 points

      for (let x = min; x <= max; x += step) {
        const y = evaluateExpression(expression, x, variables);
        if (!isNaN(y) && isFinite(y)) {
          points.push({
            x: parseFloat(x.toFixed(2)),
            y: parseFloat(y.toFixed(2)),
          });
        }
      }

      if (points.length < 2) {
        setError("⚠️ Could not generate graph. Check your expression");
        return;
      }

      const previewData = {
        labels: points.map((p) => p.x.toFixed(2)),
        datasets: [
          {
            label: expression,
            data: points.map((p) => p.y),
            borderColor: "#4F46E5",
            backgroundColor: "rgba(79, 70, 229, 0.1)",
            fill: true,
            tension: 0.3,
          },
        ],
      };

      setPreview(previewData);
      setError("");
    } catch (err) {
      setError(`❌ ${err.message}`);
    }
  };

  const handleSave = async () => {
    if (!preview) {
      setError("⚠️ Please preview first");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const graphData = {
        expression: expression,
        variables: variables,
        xMin: parseFloat(xMin),
        xMax: parseFloat(xMax),
        labels: preview.labels || [],
        data: preview.datasets,
        type: chartType,
      };

      if (!Array.isArray(graphData.labels) || !Array.isArray(graphData.data)) {
        throw new Error("Invalid data format");
      }

      if (graphData.labels.length === 0 || graphData.data.length === 0) {
        throw new Error("No data to save");
      }

      if (editGraphId) {
        // Update existing graph
        await updateGraphData(
          user.uid,
          "expression",
          editGraphId,
          graphName,
          graphData
        );
        Swal.fire({
          icon: "success",
          title: "Updated!",
          text: "Expression graph updated successfully",
          timer: 1500,
          showConfirmButton: false,
        });
        setEditGraphId(null);
      } else {
        // Check if graph name already exists (only for new graphs)
        const nameExists = await graphNameExists(
          user.uid,
          "expression",
          graphName
        );
        if (nameExists) {
          setError(
            `⚠️ A graph with the name "${graphName}" already exists. Please choose a different name.`
          );
          setSaving(false);
          return;
        }

        // Save new graph
        await saveGraphData(user.uid, "expression", graphName, graphData);
        Swal.fire({
          icon: "success",
          title: "Saved!",
          text: "Expression graph saved successfully",
          timer: 1500,
          showConfirmButton: false,
        });
      }

      // Reset form
      setGraphName("");
      setExpression("");
      setVariables("");
      setXMin("-10");
      setXMax("10");
      setPreview(null);
      setShowForm(false);
      setStep(1);
      fetchGraphs();
    } catch (err) {
      setError(`❌ Error: ${err.message}`);
      console.error("Save error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (graphId) => {
    const result = await Swal.fire({
      title: "Delete Graph?",
      text: "This action cannot be undone",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#d33",
      cancelButtonColor: "#3085d6",
      confirmButtonText: "Yes, delete it!",
      cancelButtonText: "Cancel",
    });

    if (!result.isConfirmed) return;

    try {
      await remove(ref(database, `graphs/${user.uid}/expression/${graphId}`));
      setGraphs((prev) => {
        const updated = { ...prev };
        delete updated[graphId];
        return updated;
      });
      Swal.fire({
        icon: "success",
        title: "Deleted!",
        text: "Graph deleted successfully",
        timer: 1500,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Error!",
        text: "Failed to delete graph: " + err.message,
      });
    }
  };

  const handleEdit = (graphId, graphData) => {
    try {
      if (!graphData) {
        setError("❌ Graph data not found");
        return;
      }

      // Safely extract values with defaults
      const name = graphData.name || "";
      const expr = graphData.expression || "";
      const vars = graphData.variables || "";
      const minX =
        graphData.xMin !== undefined ? graphData.xMin.toString() : "-10";
      const maxX =
        graphData.xMax !== undefined ? graphData.xMax.toString() : "10";
      const chartT = graphData.type || "line";

      // Set all states
      setEditGraphId(graphId);
      setGraphName(name);
      setExpression(expr);
      setVariables(vars);
      setXMin(minX);
      setXMax(maxX);
      setChartType(chartT);
      setPreview(null);
      setError("");
      setShowForm(true);
      setStep(1);

      console.log("Edit loaded:", {
        id: graphId,
        name,
        expr,
        vars,
        minX,
        maxX,
        chartT,
      });
    } catch (err) {
      console.error("Error in handleEdit:", err);
      setError("❌ Failed to load graph for editing");
    }
  };

  const handleViewGraph = (graphId) => {
    setViewGraphId(graphId);
  };

  const handleOpenShareModal = async (graphId) => {
    setCurrentShareGraphId(graphId);
    setShareModalOpen(true);
    setLoadingShares(true);

    try {
      const codes = await getGraphShareCodes(user.uid, "expression", graphId);
      setShareCodes(codes || []);
    } catch (err) {
      console.error("Error loading share codes:", err);
      setShareCodes([]);
    } finally {
      setLoadingShares(false);
    }
  };

  const handleCreateShare = async (isPublic) => {
    if (!currentShareGraphId) return;

    try {
      const shareCode = await shareGraph(
        user.uid,
        "expression",
        currentShareGraphId,
        isPublic
      );
      Swal.fire({
        icon: "success",
        title: "Shared!",
        text: "Share link created successfully",
        timer: 1500,
        showConfirmButton: false,
      });

      // Reload share codes
      const codes = await getGraphShareCodes(
        user.uid,
        "expression",
        currentShareGraphId
      );
      setShareCodes(codes || []);
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Error!",
        text: "Failed to create share link: " + err.message,
      });
    }
  };

  const handleRevokeShare = async (shareCode) => {
    try {
      await revokeShareCode(shareCode);
      Swal.fire({
        icon: "success",
        title: "Revoked!",
        text: "Share link revoked successfully",
        timer: 1500,
        showConfirmButton: false,
      });

      // Reload share codes
      const codes = await getGraphShareCodes(
        user.uid,
        "expression",
        currentShareGraphId
      );
      setShareCodes(codes || []);
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Error!",
        text: "Failed to revoke share link: " + err.message,
      });
    }
  };

  const graphCount = Object.keys(graphs).length;

  if (viewGraphId && graphs[viewGraphId]) {
    const graph = graphs[viewGraphId];
    const chartData = {
      labels: graph.labels,
      datasets: graph.data,
    };

    return (
      <div className="category-page-container">
        <button className="back-btn" onClick={() => setViewGraphId(null)}>
          ← Back
        </button>

        <h1>{graph.name}</h1>
        <p>📅 Created: {new Date(graph.createdAt).toLocaleDateString()}</p>
        <p>
          🔢 Expression: <code>{graph.expression}</code>
        </p>
        <p>
          📊 Range: {graph.xMin} to {graph.xMax}
        </p>

        <div className="graph-actions">
          <button
            className="share-btn"
            onClick={() => handleOpenShareModal(viewGraphId)}
          >
            Share
          </button>
          <button
            className="edit-btn"
            onClick={() => {
              handleEdit(viewGraphId, graph);
              setViewGraphId(null);
            }}
          >
            ✏️ Edit
          </button>
          <button
            className="delete-btn"
            onClick={() => {
              handleDelete(viewGraphId);
              setViewGraphId(null);
            }}
          >
            🗑️ Delete
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
      <button className="back-btn" onClick={onBack}>
        ← Back to Home
      </button>

      <div
        className="category-header"
        style={{ borderLeft: "5px solid #4F46E5" }}
      >
        <h1>Expression Graphs</h1>
        <p>Visualize mathematical functions and expressions</p>
      </div>

      <button className="create-btn" onClick={() => setShowForm(!showForm)}>
        {showForm ? "Close Form" : "Create New Graph"}
      </button>

      {showForm && (
        <div className="form-section">
          {editGraphId && (
            <div
              style={{
                background: "#e3f2fd",
                padding: "12px",
                borderRadius: "6px",
                marginBottom: "20px",
                borderLeft: "4px solid #2196F3",
                color: "#1565c0",
              }}
            >
              ✏️ <strong>Editing Mode:</strong> Modify the expression and click
              Preview to see changes, then Save.
            </div>
          )}
          <div className="form-group">
            <label>Graph Name *</label>
            <input
              type="text"
              value={graphName}
              onChange={(e) => setGraphName(e.target.value)}
              placeholder="e.g., Sine Wave, Parabola"
            />
          </div>

          {step === 1 ? (
            <>
              <div className="form-group">
                <label>Expression *</label>
                <input
                  type="text"
                  value={expression}
                  onChange={(e) => setExpression(e.target.value)}
                  placeholder="e.g., x^2, sin(x), sqrt(abs(x)), cos(x)*2"
                />
                <small
                  style={{ color: "#666", display: "block", marginTop: "5px" }}
                >
                  Simple mode: Use x as variable. Supports: +, -, *, /,
                  ^(power), sin, cos, tan, sqrt, abs, etc.
                </small>
                <small
                  style={{ color: "#999", display: "block", marginTop: "3px" }}
                >
                  Examples: x^2, x^3, sin(x), sqrt(x), cos(x)*2, exp(x),
                  log(abs(x)+1)
                </small>
              </div>

              <div className="form-group">
                <label>X Range Start *</label>
                <input
                  type="number"
                  value={xMin}
                  onChange={(e) => setXMin(e.target.value)}
                  placeholder="-10"
                />
              </div>

              <div className="form-group">
                <label>X Range End *</label>
                <input
                  type="number"
                  value={xMax}
                  onChange={(e) => setXMax(e.target.value)}
                  placeholder="10"
                />
              </div>

              <div className="form-group">
                <label>Chart Type *</label>
                <select
                  value={chartType}
                  onChange={(e) => setChartType(e.target.value)}
                >
                  <option value="line">Line Chart</option>
                  <option value="bar">Bar Chart</option>
                  <option value="scatter">Scatter Plot</option>
                </select>
              </div>

              <div className="form-buttons">
                <button className="preview-btn" onClick={handlePreview}>
                  👁️ Preview
                </button>
                <button
                  className="next-btn"
                  onClick={() => setStep(2)}
                  style={{ backgroundColor: "#4F46E5" }}
                >
                  Advanced ➜
                </button>
                {editGraphId && (
                  <button
                    className="cancel-btn"
                    onClick={() => {
                      setEditGraphId(null);
                      setGraphName("");
                      setExpression("");
                      setVariables("");
                      setXMin("-10");
                      setXMax("10");
                      setPreview(null);
                      setShowForm(false);
                      setError("");
                      setStep(1);
                    }}
                    style={{ backgroundColor: "#888" }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="advanced-section">
                <h3>Advanced Expression Builder</h3>
                <p>
                  <strong>Available functions:</strong> sin, cos, tan, sqrt,
                  abs, pow, exp, log, log10, ceil, floor, round
                </p>
                <p>
                  <strong>Constants:</strong> PI, E
                </p>
                <p>
                  <strong>Operators:</strong> +, -, *, /, ^
                  (power/exponentiation), ** (alternative power)
                </p>
                <p style={{ color: "#e74c3c", marginTop: "15px" }}>
                  💡 <strong>Tips:</strong> Use abs() for negative numbers in
                  sqrt. Use PI for trigonometric functions.
                </p>

                <div className="form-group">
                  <label>Variables (Optional)</label>
                  <textarea
                    value={variables}
                    onChange={(e) => setVariables(e.target.value)}
                    placeholder="e.g., amplitude = 2&#10;frequency = 0.5"
                    rows="2"
                  />
                  <small style={{ color: "#666", display: "block", marginTop: "5px" }}>
                    Declare variables (one per line): <code>t = 4.7</code>, <code>a = 2</code>, etc.
                    Use them in expression: <code>a * sin(frequency * x)</code>
                  </small>
                </div>

                <div className="form-group">
                  <label>Expression *</label>
                  <textarea
                    value={expression}
                    onChange={(e) => setExpression(e.target.value)}
                    placeholder="e.g., sin(x) * cos(x), sqrt(abs(x)), amplitude * sin(x), pow(x, 3) - 2*x"
                    rows="4"
                  />
                </div>

                <div className="form-group">
                  <label>X Range Start *</label>
                  <input
                    type="number"
                    value={xMin}
                    onChange={(e) => setXMin(e.target.value)}
                    placeholder="-10"
                  />
                </div>

                <div className="form-group">
                  <label>X Range End *</label>
                  <input
                    type="number"
                    value={xMax}
                    onChange={(e) => setXMax(e.target.value)}
                    placeholder="10"
                  />
                </div>

                <div className="form-group">
                  <label>Chart Type *</label>
                  <select
                    value={chartType}
                    onChange={(e) => setChartType(e.target.value)}
                  >
                    <option value="line">Line Chart</option>
                    <option value="bar">Bar Chart</option>
                    <option value="scatter">Scatter Plot</option>
                  </select>
                </div>

                <div className="form-buttons">
                  <button
                    className="back-step-btn"
                    onClick={() => setStep(1)}
                    style={{ backgroundColor: "#888" }}
                  >
                    ➜ Simple
                  </button>
                  <button className="preview-btn" onClick={handlePreview}>
                    👁️ Preview
                  </button>
                  {editGraphId && (
                    <button
                      className="cancel-btn"
                      onClick={() => {
                        setEditGraphId(null);
                        setGraphName("");
                        setExpression("");
                        setXMin("-10");
                        setXMax("10");
                        setPreview(null);
                        setShowForm(false);
                        setError("");
                        setStep(1);
                      }}
                      style={{ backgroundColor: "#888" }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {error && <div className="error">{error}</div>}

          {preview && (
            <div className="form-buttons" style={{ marginTop: "20px" }}>
              <button
                className="save-btn"
                onClick={handleSave}
                disabled={!preview || saving}
              >
                {saving ? "⏳ Saving..." : "💾 Save"}
              </button>
            </div>
          )}
        </div>
      )}

      {preview && (
        <div className="preview-section" id="preview-section">
          <h2>Preview</h2>
          <div className="graph-display">
            <Graph type={chartType} title={graphName} data={preview} />
          </div>
        </div>
      )}

      {!showForm && (
        <div className="graphs-list">
          {loading ? (
            <p style={{ textAlign: "center" }}>Loading graphs...</p>
          ) : graphCount === 0 ? (
            <div className="no-graphs">
              <p>📭 No expression graphs yet!</p>
            </div>
          ) : (
            Object.entries(graphs).map(([id, graph]) => (
              <div key={id} className="graph-item-card">
                <div className="graph-item-content">
                  <h3>{graph.name}</h3>
                  <p>
                    📅 Created: {new Date(graph.createdAt).toLocaleDateString()}
                  </p>
                  <p className="graph-type">
                    Expression: <code>{graph.expression}</code>
                  </p>
                </div>
                <div className="graph-item-actions">
                  <button
                    className="preview-btn"
                    onClick={() => handleViewGraph(id)}
                  >
                    👁️ Preview
                  </button>
                  <button
                    className="share-btn"
                    onClick={() => handleOpenShareModal(id)}
                  >
                    Share
                  </button>
                  <button
                    className="edit-btn"
                    onClick={() => handleEdit(id, graph)}
                  >
                    ✏️ Edit
                  </button>
                  <button
                    className="delete-btn"
                    onClick={() => handleDelete(id)}
                  >
                    🗑️ Delete
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
            <button
              className="modal-close"
              onClick={() => setShareModalOpen(false)}
            >
              ×
            </button>
            <h2>Share Graph</h2>

            <div className="share-buttons">
              <button
                className="public-share-btn"
                onClick={() => handleCreateShare(true)}
              >
                🌐 Create Public Link
              </button>
              <p className="share-desc">
                Anyone with the link can view (read-only)
              </p>
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
                      <span
                        className={`visibility-badge ${
                          share.isPublic ? "public" : "private"
                        }`}
                      >
                        {share.isPublic ? "🌐 PUBLIC" : "🔒 PRIVATE"}
                      </span>
                      <code>{share.shareCode.substring(0, 12)}...</code>
                      <small>
                        {new Date(share.createdAt).toLocaleDateString()}
                      </small>
                    </div>
                    <div className="share-code-actions">
                      <button
                        className="copy-btn"
                        onClick={() => {
                          const url = `${window.location.origin}/?share=${share.shareCode}&type=expression`;
                          navigator.clipboard.writeText(url);
                          Swal.fire({
                            icon: "success",
                            title: "Copied!",
                            text: "Share link copied to clipboard",
                            timer: 1500,
                            showConfirmButton: false,
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

export default ExpressionGraph;
