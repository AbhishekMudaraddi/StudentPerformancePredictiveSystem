import React, { useMemo, useState } from "react";
import Papa from "papaparse";

const API_URL = "https://32wic6l09j.execute-api.us-east-1.amazonaws.com/prod/predict";
const HISTORY_BASE_URL = API_URL.replace(/\/predict$/, "");

function coerceValue(value) {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();
  if (text === "") return null;

  const lowered = text.toLowerCase();
  if (lowered === "true") return true;
  if (lowered === "false") return false;

  if (text.startsWith("0") && text.length > 1 && text.replace(".", "").match(/^\d+$/)) {
    return text;
  }

  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^-?\d*\.\d+$/.test(text)) return Number.parseFloat(text);
  return text;
}

function formatScore(value, digits) {
  const num = Number(value);
  if (Number.isNaN(num)) return value ?? "-";
  return num.toFixed(digits);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function buildPolylinePoints(series, key, height, width, min, max) {
  if (!series.length) return "";
  const range = max - min || 1;
  return series
    .map((item, index) => {
      const x = series.length === 1 ? width / 2 : (index / (series.length - 1)) * width;
      const y = height - ((Number(item[key]) - min) / range) * height;
      return `${x},${Number.isFinite(y) ? y : height}`;
    })
    .join(" ");
}

export default function App() {
  const [selectedFileName, setSelectedFileName] = useState("");
  const [predictions, setPredictions] = useState([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyData, setHistoryData] = useState(null);

  const dedupedByStudent = useMemo(() => {
    const map = new Map();
    predictions.forEach((item) => {
      const studentId = item?.student?.student_id;
      if (studentId === null || studentId === undefined || studentId === "") return;
      if (!map.has(studentId)) map.set(studentId, item);
    });
    return Array.from(map.values());
  }, [predictions]);

  const uniqueStudentCount = useMemo(() => dedupedByStudent.length, [dedupedByStudent]);
  const passCount = useMemo(
    () =>
      dedupedByStudent.filter((item) => item?.prediction?.predicted_pass_fail === "Pass").length,
    [dedupedByStudent]
  );
  const failCount = useMemo(
    () =>
      dedupedByStudent.filter((item) => item?.prediction?.predicted_pass_fail === "Fail").length,
    [dedupedByStudent]
  );
  const passRatio = useMemo(() => {
    if (!uniqueStudentCount) return "0%";
    return `${((passCount / uniqueStudentCount) * 100).toFixed(1)}%`;
  }, [passCount, uniqueStudentCount]);
  const historyItems = useMemo(() => {
    if (!Array.isArray(historyData?.items)) return [];
    return [...historyData.items].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [historyData]);

  const studentProfile = useMemo(() => {
    if (!historyItems.length) return null;
    const latest = historyItems[0];
    return {
      studentId: latest.student_id ?? historyData?.student_id ?? "-",
      name: latest.student_name ?? "-",
      email: latest.email ?? "-",
      className: latest.class_name ?? "-",
      section: latest.section ?? "-",
    };
  }, [historyData, historyItems]);

  const historyMetrics = useMemo(() => {
    if (!historyItems.length) return null;
    const latest = historyItems[0];
    const first = historyItems[historyItems.length - 1];
    const latestScore = Number(latest.predicted_exam_score) || 0;
    const firstScore = Number(first.predicted_exam_score) || 0;
    const latestRisk = Number(latest.risk_score) || 0;
    const firstRisk = Number(first.risk_score) || 0;
    return {
      total: historyItems.length,
      scoreDelta: latestScore - firstScore,
      riskDelta: latestRisk - firstRisk,
      latestScore,
      latestRisk,
      latestTimestamp: latest.timestamp,
    };
  }, [historyItems]);

  const chartModel = useMemo(() => {
    if (!historyItems.length) return null;
    const scoreValues = historyItems.map((item) => Number(item.predicted_exam_score) || 0);
    const riskValues = historyItems.map((item) => Number(item.risk_score) || 0);
    const scoreMin = Math.min(...scoreValues);
    const scoreMax = Math.max(...scoreValues);
    const riskMin = Math.min(...riskValues);
    const riskMax = Math.max(...riskValues);
    return {
      scorePoints: buildPolylinePoints(historyItems, "predicted_exam_score", 190, 700, scoreMin, scoreMax),
      riskPoints: buildPolylinePoints(historyItems, "risk_score", 150, 700, riskMin, riskMax),
      scoreMin,
      scoreMax,
      riskMin,
      riskMax,
    };
  }, [historyItems]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    const formData = new FormData(event.currentTarget);
    const file = formData.get("csv_file");
    if (!file || !(file instanceof File) || file.size === 0) {
      setError("Please select a CSV file.");
      return;
    }

    setIsLoading(true);

    try {
      const text = await file.text();
      const parsed = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
      });

      if (parsed.errors.length > 0) {
        throw new Error(`CSV parsing error: ${parsed.errors[0].message}`);
      }

      const records = parsed.data
        .map((row) => {
          const out = {};
          Object.entries(row).forEach(([key, value]) => {
            if (key) out[key] = coerceValue(value);
          });
          return out;
        })
        .filter((row) => Object.values(row).some((value) => value !== null && value !== ""));

      if (!records.length) {
        throw new Error("CSV has no valid data rows.");
      }

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ records }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(`API request failed (${response.status}): ${message}`);
      }

      const data = await response.json();
      setPredictions(Array.isArray(data?.predictions) ? data.predictions : []);
    } catch (submitError) {
      setPredictions([]);
      setError(submitError.message || "Unexpected error while predicting.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRowClick(studentId) {
    if (studentId === null || studentId === undefined || studentId === "") return;

    setHistoryModalOpen(true);
    setHistoryLoading(true);
    setHistoryError("");
    setHistoryData(null);

    try {
      const url = `${HISTORY_BASE_URL}/predictions/history/${encodeURIComponent(String(studentId))}`;
      const response = await fetch(url, { method: "GET" });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(`History API failed (${response.status}): ${message}`);
      }

      const data = await response.json();
      setHistoryData(data);
    } catch (historyFetchError) {
      setHistoryError(historyFetchError.message || "Unable to load student history.");
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <main className="container">
      <section className="hero">
        <div className="hero-content">
          <h1>Student Performance Predictive System</h1>
          <p className="subtitle">
            Upload your CSV and generate instant AI-assisted score forecasts with pass/fail and risk
            insights. Built for a clean, analytics-first workflow.
          </p>
        </div>
      </section>

      <section className="card upload-card">
        <div className="upload-header">
          <h2>Upload Dataset</h2>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="upload-grid">
            <div>
              <input
                id="csv_file"
                className="file-input"
                type="file"
                name="csv_file"
                accept=".csv"
                required
                onChange={(event) => setSelectedFileName(event.target.files?.[0]?.name || "")}
              />
              <label htmlFor="csv_file" className="file-dropzone" aria-label="Upload CSV file">
                <span className="file-dropzone-text">
                  {selectedFileName || "Tap here to upload CSV file"}
                </span>
              </label>
            </div>
            <button type="submit" disabled={isLoading}>
              {isLoading ? "Predicting..." : "Predict Now"}
            </button>
          </div>
        </form>
        {error ? <p className="error">{error}</p> : null}
      </section>

      {predictions.length > 0 ? (
        <>
          <section className="card">
            <h2>Prediction Results</h2>
            <div className="stats">
              <div className="stat">
                <span className="label">Total Students</span>
                <span className="value">{uniqueStudentCount}</span>
              </div>
              <div className="stat">
                <span className="label">Pass Count</span>
                <span className="value">{passCount}</span>
              </div>
              <div className="stat">
                <span className="label">Fail Count</span>
                <span className="value">{failCount}</span>
              </div>
              <div className="stat">
                <span className="label">Pass Ratio</span>
                <span className="value">{passRatio}</span>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student ID</th>
                    <th>Name</th>
                    <th>Class</th>
                    <th>Section</th>
                    <th>Email</th>
                    <th>Predicted Score</th>
                    <th>Risk Score</th>
                    <th>Risk Level</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {predictions.map((item, index) => {
                    const risk = (item?.prediction?.risk_level || "").toLowerCase();
                    const result = item?.prediction?.predicted_pass_fail || "-";
                    const studentId = item?.student?.student_id ?? "";
                    return (
                      <tr
                        key={`${item?.student?.student_id || "student"}-${index}`}
                        className="clickable-row"
                        onClick={() => handleRowClick(studentId)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleRowClick(studentId);
                          }
                        }}
                      >
                        <td>{item?.student?.student_id ?? "-"}</td>
                        <td>
                          <strong>{item?.student?.student_name ?? "-"}</strong>
                        </td>
                        <td>{item?.student?.class_name ?? "-"}</td>
                        <td>{item?.student?.section ?? "-"}</td>
                        <td>{item?.student?.email ?? "-"}</td>
                        <td>{formatScore(item?.prediction?.predicted_exam_score, 2)}</td>
                        <td>{formatScore(item?.prediction?.risk_score, 3)}</td>
                        <td>
                          <span
                            className={`chip ${
                              risk === "low"
                                ? "chip-risk-low"
                                : risk === "medium"
                                  ? "chip-risk-medium"
                                  : "chip-risk-high"
                            }`}
                          >
                            {item?.prediction?.risk_level ?? "-"}
                          </span>
                        </td>
                        <td>
                          <span className={`chip ${result === "Pass" ? "chip-pass" : "chip-fail"}`}>
                            {result}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="card">
          <div className="empty-state">
            <span className="emoji">📊</span>
            <h3>Ready for your first prediction run</h3>
            <p>Upload a student CSV to see forecasted scores and risk-level analytics here.</p>
          </div>
        </section>
      )}

      <p className="footer-note">InsightPredict Local Console - Light Theme UI</p>

      {historyModalOpen ? (
        <div
          className="modal-overlay"
          onClick={() => setHistoryModalOpen(false)}
          role="presentation"
        >
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Student prediction history"
          >
            <div className="modal-header">
              <h3>Student Prediction History</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setHistoryModalOpen(false)}
              >
                Close
              </button>
            </div>

            {historyLoading ? <p className="modal-note">Loading history...</p> : null}
            {historyError ? <p className="error">{historyError}</p> : null}

            {!historyLoading && !historyError && historyData ? (
              <div className="modal-content">
                {historyItems.length > 0 && studentProfile && historyMetrics && chartModel ? (
                  <div className="history-layout">
                    <aside className="student-card">
                      <h4>Student Profile</h4>
                      <div className="student-profile-list">
                        <p>
                          <span>ID</span>
                          <strong>{studentProfile.studentId}</strong>
                        </p>
                        <p>
                          <span>Name</span>
                          <strong>{studentProfile.name}</strong>
                        </p>
                        <p>
                          <span>Email</span>
                          <strong>{studentProfile.email}</strong>
                        </p>
                        <p>
                          <span>Class</span>
                          <strong>{studentProfile.className}</strong>
                        </p>
                        <p>
                          <span>Year/Section</span>
                          <strong>{studentProfile.section}</strong>
                        </p>
                      </div>
                    </aside>

                    <section className="history-insights">
                      <div className="insight-stats">
                        <article className="insight-stat-card">
                          <span>History Records</span>
                          <strong>{historyMetrics.total}</strong>
                        </article>
                        <article className="insight-stat-card">
                          <span>Latest Predicted Score</span>
                          <strong>{formatScore(historyMetrics.latestScore, 2)}</strong>
                        </article>
                        <article className="insight-stat-card">
                          <span>Score Improvement</span>
                          <strong
                            className={
                              historyMetrics.scoreDelta >= 0 ? "trend-up-color" : "trend-down-color"
                            }
                          >
                            {historyMetrics.scoreDelta >= 0 ? "+" : ""}
                            {formatScore(historyMetrics.scoreDelta, 2)}
                          </strong>
                        </article>
                        <article className="insight-stat-card">
                          <span>Risk Movement</span>
                          <strong
                            className={
                              historyMetrics.riskDelta <= 0 ? "trend-up-color" : "trend-down-color"
                            }
                          >
                            {historyMetrics.riskDelta >= 0 ? "+" : ""}
                            {formatScore(historyMetrics.riskDelta, 3)}
                          </strong>
                        </article>
                      </div>

                      <div className="chart-card">
                        <div className="chart-header">
                          <h4>Predicted Score Trend</h4>
                          <p>Latest update: {formatDateTime(historyMetrics.latestTimestamp)}</p>
                        </div>
                        <svg className="trend-svg" viewBox="0 0 700 190" preserveAspectRatio="none">
                          <polyline
                            fill="none"
                            stroke="#e97834"
                            strokeWidth="3"
                            points={chartModel.scorePoints}
                          />
                        </svg>
                        <p className="chart-meta">
                          Min: {formatScore(chartModel.scoreMin, 2)} | Max:{" "}
                          {formatScore(chartModel.scoreMax, 2)}
                        </p>
                      </div>

                      <div className="chart-card">
                        <div className="chart-header">
                          <h4>Risk Score Trend</h4>
                          <p>Lower values indicate better stability</p>
                        </div>
                        <svg className="trend-svg risk-svg" viewBox="0 0 700 150" preserveAspectRatio="none">
                          <polyline
                            fill="none"
                            stroke="#e65c63"
                            strokeWidth="3"
                            points={chartModel.riskPoints}
                          />
                        </svg>
                        <p className="chart-meta">
                          Min: {formatScore(chartModel.riskMin, 3)} | Max:{" "}
                          {formatScore(chartModel.riskMax, 3)}
                        </p>
                      </div>

                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Record ID</th>
                              <th>Predicted Score</th>
                              <th>Pass/Fail</th>
                              <th>Risk Score</th>
                              <th>Risk Level</th>
                              <th>Timestamp</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historyItems.map((item, index) => (
                              <tr key={item.record_id || `${item.student_id}-${item.timestamp}-${index}`}>
                                <td>{index + 1}</td>
                                <td>{formatScore(item.predicted_exam_score, 2)}</td>
                                <td>{item.predicted_pass_fail ?? "-"}</td>
                                <td>{formatScore(item.risk_score, 3)}</td>
                                <td>{item.risk_level ?? "-"}</td>
                                <td>{formatDateTime(item.timestamp)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>
                ) : (
                  <p className="modal-note">No history records found for this student.</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
