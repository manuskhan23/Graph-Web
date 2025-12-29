import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ref, onValue, remove } from "firebase/database";
import { Bar, Line, Pie } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";
import { surveyDatabase } from "./surveyFirebase";
import { getCurrentUser } from "../src/firebase";
import AdminManager from "./adminManager";
import "./admin.css";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Legend
);

function AdminDashboard({ onBack }) {
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dashboard"); // dashboard, responses, export
  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [currentUserRole, setCurrentUserRole] = useState(null);
  
  // UI/UX Improvements
  const [studentSearchTerm, setStudentSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("name"); // name, submissions, class
  const [expandedStudent, setExpandedStudent] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const responsesPerPage = 10;

  // Widget Customization
  const [visibleWidgets, setVisibleWidgets] = useState(() => {
    const saved = localStorage.getItem("adminWidgets");
    return saved
      ? JSON.parse(saved)
      : {
          platformBar: true,
          platformLine: true,
          platformPie: true,
          timeBar: true,
          timeLine: true,
          timePie: true,
        };
  });

  const mainAdminEmail = "anus2580@gmail.com";
  const currentUser = getCurrentUser();

  // Save widget preferences
  useEffect(() => {
    localStorage.setItem("adminWidgets", JSON.stringify(visibleWidgets));
  }, [visibleWidgets]);

  const toggleWidget = (widgetName) => {
    setVisibleWidgets((prev) => ({
      ...prev,
      [widgetName]: !prev[widgetName],
    }));
  };

  useEffect(() => {
    const surveysRef = ref(surveyDatabase, "surveys");
    const adminsRef = ref(surveyDatabase, "admins");

    const unsubscribeSurveys = onValue(
      surveysRef,
      (snapshot) => {
        const data = [];
        snapshot.forEach((childSnapshot) => {
          data.push({
            id: childSnapshot.key,
            ...childSnapshot.val(),
          });
        });
        setSurveys(data.reverse());
        setLoading(false);
      },
      (error) => {
        console.error("Error loading surveys:", error);
        setLoading(false);
      }
    );

    const unsubscribeAdmins = onValue(
      adminsRef,
      (snapshot) => {
        const adminsData = [];
        snapshot.forEach((childSnapshot) => {
          adminsData.push({
            id: childSnapshot.key,
            ...childSnapshot.val(),
          });
        });

        // Determine current user's role
        if (currentUser) {
          const userEmail = currentUser.email.toLowerCase();
          if (userEmail === mainAdminEmail.toLowerCase()) {
            setCurrentUserRole("main");
          } else {
            const userAdmin = adminsData.find(
              (a) => a.email.toLowerCase() === userEmail
            );
            setCurrentUserRole(userAdmin?.role || "added");
          }
        }
      },
      (error) => {
        console.error("Error loading admins:", error);
      }
    );

    return () => {
      unsubscribeSurveys();
      unsubscribeAdmins();
    };
  }, []);

  const handleDeleteResponse = async (id) => {
    if (window.confirm("Are you sure you want to delete this response?")) {
      try {
        setDeletingId(id);
        const surveyRef = ref(surveyDatabase, `surveys/${id}`);
        await remove(surveyRef);
        setSurveys((prev) => prev.filter((s) => s.id !== id));
        alert("Response deleted successfully");
      } catch (error) {
        console.error("Error deleting response:", error);
        alert("Failed to delete response");
      } finally {
        setDeletingId(null);
      }
    }
  };

  const handleExportCSV = () => {
    if (surveys.length === 0) {
      alert("No data to export");
      return;
    }

    // Create CSV header
    const headers = [
      "Name",
      "Father Name",
      "Class",
      "Section",
      "Social Media Platforms",
      "Platform Other",
      "Time Spent Daily",
      "Timestamp",
    ];
    const rows = surveys.map((survey) => [
      survey.name,
      survey.fatherName,
      survey.class,
      survey.section,
      Array.isArray(survey.platforms)
        ? survey.platforms.join(", ")
        : survey.platforms || "-",
      survey.platformOther || "-",
      survey.timeSpent,
      new Date(survey.timestamp).toLocaleString(),
    ]);

    // Create CSV content
    let csvContent = headers.join(",") + "\n";
    rows.forEach((row) => {
      csvContent += row.map((cell) => `"${cell}"`).join(",") + "\n";
    });

    // Download
    const element = document.createElement("a");
    element.setAttribute(
      "href",
      "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent)
    );
    element.setAttribute(
      "download",
      `survey_responses_${new Date().getTime()}.csv`
    );
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleExportJSON = () => {
    if (surveys.length === 0) {
      alert("No data to export");
      return;
    }

    const jsonData = JSON.stringify(surveys, null, 2);
    const element = document.createElement("a");
    element.setAttribute(
      "href",
      "data:application/json;charset=utf-8," + encodeURIComponent(jsonData)
    );
    element.setAttribute(
      "download",
      `survey_responses_${new Date().getTime()}.json`
    );
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const filteredSurveys = surveys.filter(
    (survey) =>
      survey.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      survey.fatherName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      survey.class.toLowerCase().includes(searchTerm.toLowerCase()) ||
      survey.section.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Platform color mapping
  const platformColors = {
    youtube: "#FF0000",
    instagram: "#E4405F",
    facebook: "#1877F2",
    linkedin: "#0A66C2",
    tiktok: "#000000",
    others: "#9C27B0",
  };

  const timeSpentColors = {
    "2hrs": "#4CAF50",
    "4hrs": "#8BC34A",
    "6hrs": "#FFC107",
    "8hrs": "#FF9800",
    "8plus": "#F44336",
  };

  // Get unique students with their latest data
  // Create composite key: name + fatherName + section + class
  const uniqueStudentsMap = new Map();
  surveys.forEach((survey) => {
    const studentKey = `${survey.name}|${survey.fatherName}|${survey.section}|${survey.class}`;
    if (!uniqueStudentsMap.has(studentKey)) {
      uniqueStudentsMap.set(studentKey, survey);
    }
  });

  const uniqueStudentsData = Array.from(uniqueStudentsMap.values());

  // Calculate stats based on UNIQUE STUDENTS only
  const stats = {
    totalResponses: surveys.length,
    uniqueStudents: uniqueStudentsData.length,
    platforms: {},
    timeSpent: {},
  };

  // Count platforms and time spent only for UNIQUE students (using latest data)
  uniqueStudentsData.forEach((survey) => {
    // Handle multiple platforms (array)
    if (Array.isArray(survey.platforms)) {
      survey.platforms.forEach((platform) => {
        stats.platforms[platform] = (stats.platforms[platform] || 0) + 1;
      });
    } else if (survey.platform) {
      stats.platforms[survey.platform] =
        (stats.platforms[survey.platform] || 0) + 1;
    }
    stats.timeSpent[survey.timeSpent] =
      (stats.timeSpent[survey.timeSpent] || 0) + 1;
  });

  if (loading) {
    return (
      <motion.div 
        className="admin-loading"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          style={{
            width: '50px',
            height: '50px',
            borderRadius: '50%',
            border: '4px solid #f0f0f0',
            borderTop: '4px solid #667eea',
            margin: '0 auto 20px'
          }}
        />
        <h2>Loading admin dashboard...</h2>
      </motion.div>
    );
  }

  return (
    <motion.div 
      className="admin-container"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <motion.div 
        className="admin-header"
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <h1>📊 Admin Dashboard</h1>
        <motion.button 
          className="btn-back" 
          onClick={onBack}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          ← Back
        </motion.button>
      </motion.div>

      <motion.div 
        className="admin-nav"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ staggerChildren: 0.1, delayChildren: 0.2 }}
      >
        <button
          className={`admin-nav-btn ${view === "dashboard" ? "active" : ""}`}
          onClick={() => setView("dashboard")}
        >
          Dashboard
        </button>
        <button
          className={`admin-nav-btn ${view === "unique-students" ? "active" : ""}`}
          onClick={() => setView("unique-students")}
        >
          Unique Students ({stats.uniqueStudents})
        </button>
        <button
          className={`admin-nav-btn ${view === "responses" ? "active" : ""}`}
          onClick={() => setView("responses")}
        >
          Responses ({surveys.length})
        </button>
        {(currentUserRole === "main" || currentUserRole === "second") && (
          <button
            className={`admin-nav-btn ${
              view === "manage-admins" ? "active" : ""
            }`}
            onClick={() => setView("manage-admins")}
          >
            Manage Admins
          </button>
        )}
      </motion.div>

      {/* Dashboard View */}
      {view === "dashboard" && (
        <motion.div 
          className="admin-dashboard"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          {/* Widget Customization Controls */}
          <div className="widget-customization">
            <h3>📊 Customize Dashboard</h3>
            <div className="widget-toggles">
              <label className="widget-toggle">
                <input
                  type="checkbox"
                  checked={visibleWidgets.platformBar}
                  onChange={() => toggleWidget("platformBar")}
                />
                Platform Bar Chart
              </label>
              <label className="widget-toggle">
                <input
                  type="checkbox"
                  checked={visibleWidgets.platformLine}
                  onChange={() => toggleWidget("platformLine")}
                />
                Platform Line Chart
              </label>
              <label className="widget-toggle">
                <input
                  type="checkbox"
                  checked={visibleWidgets.platformPie}
                  onChange={() => toggleWidget("platformPie")}
                />
                Platform Pie Chart
              </label>
              <label className="widget-toggle">
                <input
                  type="checkbox"
                  checked={visibleWidgets.timeBar}
                  onChange={() => toggleWidget("timeBar")}
                />
                Time Spent Bar Chart
              </label>
              <label className="widget-toggle">
                <input
                  type="checkbox"
                  checked={visibleWidgets.timeLine}
                  onChange={() => toggleWidget("timeLine")}
                />
                Time Spent Line Chart
              </label>
              <label className="widget-toggle">
                <input
                  type="checkbox"
                  checked={visibleWidgets.timePie}
                  onChange={() => toggleWidget("timePie")}
                />
                Time Spent Pie Chart
              </label>
            </div>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon">📝</div>
              <div className="stat-content">
                <div className="stat-label">Total Responses</div>
                <div className="stat-value">{stats.totalResponses}</div>
              </div>
            </div>

            <motion.div 
              className="stat-card"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              whileHover={{ scale: 1.05 }}
            >
              <div className="stat-icon">👥</div>
              <div className="stat-content">
                <div className="stat-label">Unique Students</div>
                <div className="stat-value">{stats.uniqueStudents}</div>
              </div>
            </motion.div>

            <motion.div 
              className="stat-card"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              whileHover={{ scale: 1.05 }}
            >
              <div className="stat-icon">📱</div>
              <div className="stat-content">
                <div className="stat-label">Most Used Platform</div>
                <div className="stat-value">
                  {Object.keys(stats.platforms).length > 0
                    ? Object.entries(stats.platforms).reduce((a, b) =>
                        a[1] > b[1] ? a : b
                      )[0]
                    : "N/A"}
                </div>
              </div>
            </motion.div>

            <motion.div 
              className="stat-card"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              whileHover={{ scale: 1.05 }}
            >
              <div className="stat-icon">⏱️</div>
              <div className="stat-content">
                <div className="stat-label">Avg Time Spent</div>
                <div className="stat-value">
                  {Object.keys(stats.timeSpent).length > 0
                    ? Object.entries(stats.timeSpent).reduce((a, b) =>
                        a[1] > b[1] ? a : b
                      )[0]
                    : "N/A"}
                </div>
              </div>
            </motion.div>
          </div>

          <motion.div 
            className="admin-breakdown"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            {/* Platform Usage Charts */}
            <div className="charts-container">
              {visibleWidgets.platformBar && (
              <div className="chart-section">
                <h3>Platform Usage - Bar Chart</h3>
                <Bar
                  data={{
                    labels: Object.keys(stats.platforms),
                    datasets: [
                      {
                        label: "Number of Users",
                        data: Object.values(stats.platforms),
                        backgroundColor: Object.keys(stats.platforms).map(
                          (platform) => platformColors[platform] || "#999"
                        ),
                        borderColor: Object.keys(stats.platforms).map(
                          (platform) => platformColors[platform] || "#999"
                        ),
                        borderWidth: 1,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                      legend: {
                        position: "top",
                      },
                      title: {
                        display: false,
                      },
                    },
                    scales: {
                      y: {
                        beginAtZero: true,
                      },
                    },
                  }}
                  />
                  </div>
                  )}

                  {visibleWidgets.platformLine && (
                  <div className="chart-section">
                  <h3>Platform Usage - Line Chart</h3>
                  <Line
                  data={{
                    labels: Object.keys(stats.platforms),
                    datasets: [
                      {
                        label: "Number of Users",
                        data: Object.values(stats.platforms),
                        borderColor: "#2196F3",
                        backgroundColor: "rgba(33, 150, 243, 0.1)",
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointBackgroundColor: Object.keys(stats.platforms).map(
                          (platform) => platformColors[platform] || "#999"
                        ),
                        pointBorderColor: Object.keys(stats.platforms).map(
                          (platform) => platformColors[platform] || "#999"
                        ),
                        pointRadius: 6,
                        pointHoverRadius: 8,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                      legend: {
                        position: "top",
                      },
                    },
                    scales: {
                      y: {
                        beginAtZero: true,
                      },
                    },
                  }}
                  />
                  </div>
                  )}

                  {visibleWidgets.platformPie && (
                  <div className="chart-section">
                  <h3>Platform Usage - Pie Chart</h3>
                  <Pie
                  data={{
                    labels: Object.keys(stats.platforms),
                    datasets: [
                      {
                        data: Object.values(stats.platforms),
                        backgroundColor: Object.keys(stats.platforms).map(
                          (platform) => platformColors[platform] || "#999"
                        ),
                        borderColor: "#fff",
                        borderWidth: 2,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                      legend: {
                        position: "right",
                      },
                    },
                  }}
                  />
                  </div>
                  )}
                  </div>

                  {/* Time Spent Charts */}
                  <div className="charts-container">
                  {visibleWidgets.timeBar && (
                  <div className="chart-section">
                  <h3>Daily Time Spent - Bar Chart</h3>
                  <Bar
                  data={{
                    labels: Object.keys(stats.timeSpent),
                    datasets: [
                      {
                        label: "Number of Users",
                        data: Object.values(stats.timeSpent),
                        backgroundColor: Object.keys(stats.timeSpent).map(
                          (time) => timeSpentColors[time] || "#999"
                        ),
                        borderColor: Object.keys(stats.timeSpent).map(
                          (time) => timeSpentColors[time] || "#999"
                        ),
                        borderWidth: 1,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                      legend: {
                        position: "top",
                      },
                    },
                    scales: {
                      y: {
                        beginAtZero: true,
                      },
                    },
                  }}
                  />
                  </div>
                  )}

                  {visibleWidgets.timeLine && (
                  <div className="chart-section">
                  <h3>Daily Time Spent - Line Chart</h3>
                  <Line
                  data={{
                    labels: Object.keys(stats.timeSpent),
                    datasets: [
                      {
                        label: "Number of Users",
                        data: Object.values(stats.timeSpent),
                        borderColor: "#4CAF50",
                        backgroundColor: "rgba(76, 175, 80, 0.1)",
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointBackgroundColor: Object.keys(stats.timeSpent).map(
                          (time) => timeSpentColors[time] || "#999"
                        ),
                        pointBorderColor: Object.keys(stats.timeSpent).map(
                          (time) => timeSpentColors[time] || "#999"
                        ),
                        pointRadius: 6,
                        pointHoverRadius: 8,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                      legend: {
                        position: "top",
                      },
                    },
                    scales: {
                      y: {
                        beginAtZero: true,
                      },
                    },
                  }}
                  />
                  </div>
                  )}

                  {visibleWidgets.timePie && (
                  <div className="chart-section">
                  <h3>Daily Time Spent - Pie Chart</h3>
                  <Pie
                  data={{
                    labels: Object.keys(stats.timeSpent),
                    datasets: [
                      {
                        data: Object.values(stats.timeSpent),
                        backgroundColor: Object.keys(stats.timeSpent).map(
                          (time) => timeSpentColors[time] || "#999"
                        ),
                        borderColor: "#fff",
                        borderWidth: 2,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                      legend: {
                        position: "right",
                      },
                    },
                  }}
                  />
                  </div>
                  )}
                  </div>
                  </motion.div>
        </motion.div>
        )}

      {/* Unique Students View */}
      {view === "unique-students" && (
        <motion.div 
          className="admin-unique-students"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <div className="unique-students-header">
            <h2>Unique Students List</h2>
            <p>Total: {stats.uniqueStudents} unique students</p>
          </div>

          {stats.uniqueStudents === 0 ? (
            <div className="no-data">
              <p>No students found</p>
            </div>
          ) : (
            <>
              {/* Search and Filter Controls */}
              <div className="students-controls">
                <div className="search-filter-group">
                  <input
                    type="text"
                    placeholder="Search students by name, class, section..."
                    className="search-input"
                    value={studentSearchTerm}
                    onChange={(e) => {
                      setStudentSearchTerm(e.target.value);
                      setCurrentPage(1);
                    }}
                  />
                  <select
                    className="sort-select"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                  >
                    <option value="name">Sort by Name (A-Z)</option>
                    <option value="submissions">Sort by Submissions (High to Low)</option>
                    <option value="class">Sort by Class</option>
                  </select>
                </div>
              </div>

              {/* Students List */}
              <div className="unique-students-list">
                {Array.from(uniqueStudentsMap.entries())
                  .map(([studentKey, firstSurvey]) => {
                    const studentSurveys = surveys.filter(
                      (s) => `${s.name}|${s.fatherName}|${s.section}|${s.class}` === studentKey
                    );
                    const submissionCount = studentSurveys.length;
                    const latestSubmission = studentSurveys[0];
                    return {
                      key: studentKey,
                      name: firstSurvey.name,
                      fatherName: firstSurvey.fatherName,
                      section: firstSurvey.section,
                      surveys: studentSurveys,
                      count: submissionCount,
                      latest: latestSubmission,
                      class: latestSubmission.class,
                    };
                  })
                  // Filter students
                  .filter((student) => {
                    const search = studentSearchTerm.toLowerCase();
                    return (
                      student.name.toLowerCase().includes(search) ||
                      student.fatherName.toLowerCase().includes(search) ||
                      student.class.toLowerCase().includes(search) ||
                      student.section.toLowerCase().includes(search)
                    );
                  })
                  // Sort students
                  .sort((a, b) => {
                    if (sortBy === "name") {
                      return a.name.localeCompare(b.name);
                    } else if (sortBy === "submissions") {
                      return b.count - a.count;
                    } else if (sortBy === "class") {
                      return a.class.localeCompare(b.class);
                    }
                    return 0;
                  })
                  .map((student) => (
                    <div key={student.key} className="student-card">
                      <div
                        className="student-card-header"
                        onClick={() =>
                          setExpandedStudent(expandedStudent === student.name ? null : student.name)
                        }
                        style={{ cursor: "pointer" }}
                      >
                        <div className="student-info">
                          <h3>{student.name}</h3>
                          <p className="student-meta">
                            Father Name: <span>{student.latest.fatherName}</span>
                          </p>
                          <p className="student-meta">
                            Class: <span>{student.class}</span> | Section: <span>{student.latest.section}</span>
                          </p>
                        </div>
                        <div className="student-card-actions">
                          <button
                            className="student-delete-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Delete all submissions for ${student.name}? This cannot be undone.`)) {
                                student.surveys.forEach((survey) => {
                                  const surveyRef = ref(surveyDatabase, `surveys/${survey.id}`);
                                  remove(surveyRef);
                                });
                              }
                            }}
                            title="Delete all submissions for this student"
                          >
                            Delete
                          </button>
                          <span className="expand-icon">
                            {expandedStudent === student.name ? "▼" : "▶"}
                          </span>
                        </div>
                      </div>
                      <div className="student-stats">
                        <div className="stat">
                          <span className="stat-label">Submissions:</span>
                          <span className="stat-val">{student.count}</span>
                        </div>
                        <div className="stat">
                          <span className="stat-label">Last Submitted:</span>
                          <span className="stat-val">
                            {new Date(student.latest.timestamp).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      {/* Student Detail View */}
                      {expandedStudent === student.name && (
                        <div className="student-detail">
                          <h4>All Submissions</h4>
                          <div className="submissions-list">
                            {student.surveys.map((submission, idx) => (
                              <div key={idx} className="submission-item">
                                <span className="submission-date">
                                  {new Date(submission.timestamp).toLocaleString()}
                                </span>
                                <span className="submission-platform">
                                  {Array.isArray(submission.platforms)
                                    ? submission.platforms.join(", ")
                                    : submission.platforms}
                                </span>
                                <span className="submission-time">{submission.timeSpent}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </>
            )}
            </motion.div>
            )}

            {/* Responses View */}
      {view === "responses" && (
        <motion.div 
          className="admin-responses"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <div className="responses-header">
            <input
              type="text"
              placeholder="Search by name, father name, class, or section..."
              className="search-input"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>

          {filteredSurveys.length === 0 ? (
            <div className="no-data">
              <p>No survey responses found</p>
            </div>
          ) : (
            <>
              <div className="responses-table-wrapper">
                <table className="responses-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Father Name</th>
                      <th>Class</th>
                      <th>Section</th>
                      <th>Platform</th>
                      <th>Time Spent</th>
                      <th>Submitted</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSurveys
                      .slice(
                        (currentPage - 1) * responsesPerPage,
                        currentPage * responsesPerPage
                      )
                      .map((survey) => (
                        <tr key={survey.id}>
                          <td>{survey.name}</td>
                          <td>{survey.fatherName}</td>
                          <td>{survey.class}</td>
                          <td>{survey.section}</td>
                          <td>
                            {Array.isArray(survey.platforms) ? (
                              <>
                                {survey.platforms.map((platform, idx) => (
                                  <span key={idx} className="platform-badge">
                                    {platform}
                                  </span>
                                ))}
                              </>
                            ) : (
                              <span className="platform-badge">
                                {survey.platform}
                              </span>
                            )}
                            {survey.platformOther && (
                              <span className="platform-badge-other">
                                {survey.platformOther}
                              </span>
                            )}
                          </td>
                          <td>{survey.timeSpent}</td>
                          <td className="timestamp">
                            {new Date(survey.timestamp).toLocaleDateString()}
                            <br />
                            <small>
                              {new Date(survey.timestamp).toLocaleTimeString()}
                            </small>
                          </td>
                          <td>
                            <button
                              className="btn-delete"
                              onClick={() => handleDeleteResponse(survey.id)}
                              disabled={deletingId === survey.id}
                            >
                              {deletingId === survey.id ? "Deleting..." : "Delete"}
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              <div className="pagination-controls">
                <button
                  className="btn-pagination"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                >
                  ← Previous
                </button>
                <span className="pagination-info">
                  Page {currentPage} of{" "}
                  {Math.ceil(filteredSurveys.length / responsesPerPage)}
                </span>
                <button
                  className="btn-pagination"
                  onClick={() =>
                    setCurrentPage((prev) =>
                      Math.min(
                        Math.ceil(filteredSurveys.length / responsesPerPage),
                        prev + 1
                      )
                    )
                  }
                  disabled={
                    currentPage ===
                    Math.ceil(filteredSurveys.length / responsesPerPage)
                  }
                >
                  Next →
                </button>
              </div>
            </>
          )}
        </motion.div>
      )}

      {/* Manage Admins View */}
      {view === "manage-admins" && (
        <AdminManager onBack={() => setView("dashboard")} />
      )}
    </motion.div>
  );
}

export default AdminDashboard;
