import React, { useState, useEffect } from "react";
import axios from "axios";
import { useAuth } from "../../context/useAuth";
import PoliceStationFinder from "../../components/PoliceStationFinder";
import "./CrimeAlerts.css";

const API_URL = "http://localhost:5000";
const ALERT_VISIBILITY_HOURS = 12; // Alerts will be visible for 12 hours

const CrimeAlerts = () => {
  const [activeAlert, setActiveAlert] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [countdowns, setCountdowns] = useState({});
  const [hasActiveTimers, setHasActiveTimers] = useState(false);
  const [validationStatus, setValidationStatus] = useState({});
  const [showPoliceStationFinder, setShowPoliceStationFinder] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState("");
  const { user, token } = useAuth();

  useEffect(() => {
    fetchAlerts();
  }, [user]);

  // Update countdown timers every second
  useEffect(() => {
    if (alerts.length === 0) return;

    // Initialize countdowns
    const initialCountdowns = {};
    let anyActiveTimer = false;

    alerts.forEach((alert) => {
      const createdTime = new Date(alert.created_at || alert.timestamp);
      const expiryTime = new Date(
        createdTime.getTime() + ALERT_VISIBILITY_HOURS * 60 * 60 * 1000
      );
      const timeRemaining = calculateTimeRemaining(expiryTime);
      initialCountdowns[alert.id] = timeRemaining;

      if (timeRemaining.total > 0) {
        anyActiveTimer = true;
      }
    });

    setCountdowns(initialCountdowns);
    setHasActiveTimers(anyActiveTimer);

    // Sync with navbar via window property
    window.hasActiveAlerts = anyActiveTimer;
    const event = new CustomEvent("alertsStatusChanged", {
      detail: { hasActiveAlerts: anyActiveTimer },
    });
    window.dispatchEvent(event);

    // Update countdowns every second
    const timer = setInterval(() => {
      setCountdowns((prevCountdowns) => {
        const updatedCountdowns = {};
        let allExpired = true;
        let anyTimerActive = false;

        alerts.forEach((alert) => {
          const createdTime = new Date(alert.created_at || alert.timestamp);
          const expiryTime = new Date(
            createdTime.getTime() + ALERT_VISIBILITY_HOURS * 60 * 60 * 1000
          );
          const remaining = calculateTimeRemaining(expiryTime);

          if (remaining.total > 0) {
            allExpired = false;
            anyTimerActive = true;
          }

          updatedCountdowns[alert.id] = remaining;
        });

        // Update active timers state
        setHasActiveTimers(anyTimerActive);

        // Sync with navbar via window property
        window.hasActiveAlerts = anyTimerActive;
        const event = new CustomEvent("alertsStatusChanged", {
          detail: { hasActiveAlerts: anyTimerActive },
        });
        window.dispatchEvent(event);

        // If all alerts have expired, refetch to get new ones
        if (alerts.length > 0 && allExpired) {
          fetchAlerts();
        }

        return updatedCountdowns;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [alerts]);

  const calculateTimeRemaining = (expiryTime) => {
    const total = expiryTime - new Date();

    if (total <= 0) {
      return { total: 0, hours: 0, minutes: 0, seconds: 0 };
    }

    const hours = Math.floor((total / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((total / 1000 / 60) % 60);
    const seconds = Math.floor((total / 1000) % 60);

    return { total, hours, minutes, seconds };
  };

  const formatCountdown = (timeObj) => {
    if (timeObj.total <= 0) {
      return "Expired";
    }

    return `${timeObj.hours.toString().padStart(2, "0")}:${timeObj.minutes
      .toString()
      .padStart(2, "0")}:${timeObj.seconds.toString().padStart(2, "0")}`;
  };

  const fetchAlerts = async () => {
    try {
      setLoading(true);
      setError(null);

      let url = `${API_URL}/api/crime-alerts`;

      // If the user is logged in, prioritize alerts in their area
      if (user && user.address) {
        // Extract location parts for more flexible matching
        const addressParts = user.address.split("-");
        let searchTerm = user.address;

        if (addressParts.length >= 2) {
          // For Dhaka, use the area name
          if (addressParts[0].trim().toLowerCase() === "dhaka") {
            searchTerm = addressParts[1].trim();
          } else {
            searchTerm = addressParts[0].trim(); // Use district otherwise
          }
        }

        url = `${API_URL}/api/crime-alerts/location?location=${encodeURIComponent(
          searchTerm
        )}`;
      }

      const response = await axios.get(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (response.data && response.data.success) {
        // Filter alerts that are less than 12 hours old
        const now = new Date();
        const validAlerts = response.data.data.filter((alert) => {
          const createdTime = new Date(alert.created_at || alert.timestamp);
          const expiryTime = new Date(
            createdTime.getTime() + ALERT_VISIBILITY_HOURS * 60 * 60 * 1000
          );
          return now < expiryTime;
        });

        setAlerts(validAlerts);

        // Initialize validation status for each alert
        const initialValidationStatus = {};
        validAlerts.forEach((alert) => {
          initialValidationStatus[alert.id] = {
            userValidated: false,
            userMarkedFalse: false,
          };
        });
        setValidationStatus(initialValidationStatus);
      } else {
        setError("Failed to load alerts");
      }
    } catch (err) {
      setError("Failed to load alerts. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return "Unknown time";

    const date = new Date(timestamp);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const openDetails = (alert) => {
    setActiveAlert(alert);
  };

  const closeDetails = () => {
    setActiveAlert(null);
  };

  const handleValidation = async (alertId, isValid) => {
    if (!user || !token) {
      alert("Please log in to validate this alert");
      return;
    }

    try {
      // Update UI immediately for better user experience
      setValidationStatus((prev) => ({
        ...prev,
        [alertId]: {
          userValidated: isValid,
          userMarkedFalse: !isValid,
        },
      }));

      // Send validation to server
      await axios.post(
        `${API_URL}/api/crime-alerts/${alertId}/validate`,
        {
          isValid,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
    } catch (err) {
      // Revert UI state on error
      setValidationStatus((prev) => ({
        ...prev,
        [alertId]: {
          userValidated: false,
          userMarkedFalse: false,
        },
      }));
      
      alert("Failed to validate alert. Please try again.");
    }
  };

  const openPoliceStationFinder = (location) => {
    setSelectedLocation(location);
    setShowPoliceStationFinder(true);
  };

  const closePoliceStationFinder = () => {
    setShowPoliceStationFinder(false);
  };

  return (
    <>
      <div className="crime-alerts-container">
        <header className="alerts-header">
          <h1>Crime Alert Notifications</h1>
          <p className="subtitle">
            Real-time updates on criminal activity in your area
          </p>
        </header>

        <div className="alerts-list">
          {loading ? (
            <div className="loading-container">
              <div className="loading-spinner"></div>
              <p>Loading alerts...</p>
            </div>
          ) : error ? (
            <div className="error-container">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
              >
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <h3>Error</h3>
              <p>{error}</p>
            </div>
          ) : alerts.length > 0 ? (
            alerts.map((alert) => (
              <div key={alert.id} className={`alert-card ${alert.status}`}>
                <div className="alert-header">
                  <span className={`alert-type ${alert.type.toLowerCase()}`}>
                    {alert.type}
                  </span>
                  <span className="alert-time">
                    {formatTime(alert.timestamp || alert.created_at)}
                  </span>
                  <span className={`alert-status ${alert.status}`}>
                    {alert.status === "active" ? "ACTIVE" : "RESOLVED"}
                  </span>
                </div>

                <div className="alert-body">
                  <h3 className="alert-location">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                    >
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                      <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                    {alert.location}
                  </h3>
                  <p className="alert-description">{alert.description}</p>
                  {countdowns[alert.id] && (
                    <div className="alert-countdown">
                      <span className="countdown-label">Expires in:</span>
                      <span className="countdown-timer">
                        {formatCountdown(countdowns[alert.id])}
                      </span>
                    </div>
                  )}
                </div>

                <div className="alert-footer">
                  <div className="validation-buttons">
                    <button
                      className={`validate-btn ${
                        validationStatus[alert.id]?.userValidated ? "active" : ""
                      }`}
                      onClick={() => handleValidation(alert.id, true)}
                      disabled={validationStatus[alert.id]?.userMarkedFalse}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                      >
                        <path d="M20 6L9 17l-5-5"></path>
                      </svg>
                      Validate
                    </button>
                    <button
                      className={`false-report-btn ${
                        validationStatus[alert.id]?.userMarkedFalse
                          ? "active"
                          : ""
                      }`}
                      onClick={() => handleValidation(alert.id, false)}
                      disabled={validationStatus[alert.id]?.userValidated}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                      >
                        <path d="M18 6L6 18M6 6l12 12"></path>
                      </svg>
                      False Report
                    </button>
                  </div>
                  <button
                    className="details-btn"
                    onClick={() => openDetails(alert)}
                  >
                    View Full Details
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                    >
                      <path d="M5 12h14M12 5l7 7-7 7"></path>
                    </svg>
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="no-alerts">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              <h3>No alerts found</h3>
              <p>There are currently no crime alerts in your area.</p>
            </div>
          )}
        </div>

        {/* Detailed Alert Modal */}
        {activeAlert && (
          <div className="alert-modal">
            <div className="modal-content">
              <button className="close-modal" onClick={closeDetails}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                >
                  <path d="M18 6L6 18M6 6l12 12"></path>
                </svg>
              </button>

              <div className="modal-header">
                <div className="modal-title">
                  <h2>{activeAlert.type} Incident Details</h2>
                  <span className={`modal-status ${activeAlert.status}`}>
                    {activeAlert.status === "active"
                      ? "ACTIVE ALERT"
                      : "RESOLVED CASE"}
                  </span>
                </div>
                <div className="alert-timer">
                  {countdowns[activeAlert.id] && (
                    <div className="alert-countdown">
                      <span className="countdown-label">Alert expires in:</span>
                      <span className="countdown-timer">
                        {formatCountdown(countdowns[activeAlert.id])}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-body">
                <div className="detail-group incident-overview">
                  <h3>Incident Overview</h3>
                  <div className="detail-item">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                      <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                    <div>
                      <strong>Location:</strong>
                      <p>{activeAlert.location}</p>
                    </div>
                  </div>
                  <div className="detail-item">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    <div>
                      <strong>Time:</strong>
                      <p>{formatTime(activeAlert.timestamp || activeAlert.created_at)}</p>
                    </div>
                  </div>
                  <div className="detail-item">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
                      <line x1="4" y1="22" x2="4" y2="15"></line>
                    </svg>
                    <div>
                      <strong>Crime Type:</strong>
                      <p>{activeAlert.type}</p>
                    </div>
                  </div>
                  <div className="detail-item">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="16" y1="13" x2="8" y2="13"></line>
                      <line x1="16" y1="17" x2="8" y2="17"></line>
                      <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                    <div>
                      <strong>Description:</strong>
                      <p>{activeAlert.description}</p>
                    </div>
                  </div>
                </div>

                {activeAlert.details && (
                  <>
                    <div className="detail-group">
                      <h3>Details</h3>
                      <div className="detail-grid">
                        {activeAlert.details.peopleInvolved && (
                          <div className="detail-item">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                              <circle cx="9" cy="7" r="4"></circle>
                              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                            <div>
                              <strong>People Involved:</strong>
                              <p>{activeAlert.details.peopleInvolved}</p>
                            </div>
                          </div>
                        )}
                        {activeAlert.details.victimDescription && (
                          <div className="detail-item">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                              <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                            <div>
                              <strong>Victim(s):</strong>
                              <p>{activeAlert.details.victimDescription}</p>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="detail-grid">
                        {activeAlert.details.weapons && (
                          <div className="detail-item">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                              <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"></path>
                            </svg>
                            <div>
                              <strong>Weapons:</strong>
                              <p>{activeAlert.details.weapons}</p>
                            </div>
                          </div>
                        )}
                        {activeAlert.details.suspectDescription && (
                          <div className="detail-item">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                              <circle cx="12" cy="7" r="4"></circle>
                              <line x1="12" y1="11" x2="12" y2="17"></line>
                              <line x1="9" y1="15" x2="15" y2="15"></line>
                            </svg>
                            <div>
                              <strong>Suspect Description:</strong>
                              <p>{activeAlert.details.suspectDescription}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="detail-group police-response-group">
                      <h3>Police Response</h3>
                      <div className="detail-grid">
                        {activeAlert.details.dangerLevel && (
                          <div className="detail-item">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                              <line x1="12" y1="9" x2="12" y2="13"></line>
                              <line x1="12" y1="17" x2="12.01" y2="17"></line>
                            </svg>
                            <div>
                              <strong>Danger Level:</strong>
                              <p className={`danger-level ${activeAlert.details.dangerLevel.toLowerCase()}`}>
                                {activeAlert.details.dangerLevel}
                              </p>
                            </div>
                          </div>
                        )}
                        {activeAlert.details.policeResponse && (
                          <div className="detail-item">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                            </svg>
                            <div>
                              <strong>Status:</strong>
                              <p>{activeAlert.details.policeResponse}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="modal-footer">
                <div className="validation-buttons">
                  <button
                    className={`validate-btn ${
                      validationStatus[activeAlert.id]?.userValidated
                        ? "active"
                        : ""
                    }`}
                    onClick={() => handleValidation(activeAlert.id, true)}
                    disabled={validationStatus[activeAlert.id]?.userMarkedFalse}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                    >
                      <path d="M20 6L9 17l-5-5"></path>
                    </svg>
                    Validate Report
                  </button>
                  <button
                    className={`false-report-btn ${
                      validationStatus[activeAlert.id]?.userMarkedFalse
                        ? "active"
                        : ""
                    }`}
                    onClick={() => handleValidation(activeAlert.id, false)}
                    disabled={validationStatus[activeAlert.id]?.userValidated}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                    >
                      <path d="M18 6L6 18M6 6l12 12"></path>
                    </svg>
                    Mark as False
                  </button>
                </div>
                <div className="action-buttons">
                  <button
                    className="action-btn primary contact-police-btn"
                    onClick={() => {
                      openPoliceStationFinder(activeAlert.location);
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                    >
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                    </svg>
                    Find Nearby Police Stations
                  </button>
                  <button className="action-btn secondary close-btn" onClick={closeDetails}>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                    >
                      <path d="M18 6L6 18M6 6l12 12"></path>
                    </svg>
                    Close Details
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Police Station Finder Modal - moved outside main container for better visibility */}
      {showPoliceStationFinder && (
        <PoliceStationFinder
          onClose={closePoliceStationFinder}
          location={selectedLocation}
        />
      )}
    </>
  );
};

export default CrimeAlerts;
