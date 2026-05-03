import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Key,
  User,
  Activity,
  CheckCircle2,
  XCircle,
  QrCode,
  Scan,
  Clock,
  RefreshCw,
} from 'lucide-react';

// Calls to the Client Server (QR generation, session polling) → md.sneek.in
const CLIENT_API_URL = (import.meta.env.VITE_CLIENT_API_URL || '/api').replace(/\/+$/, '');
// Calls to the Sneek Server (scan + verification) → api.sneek.in
const SNEEK_API_URL = (import.meta.env.VITE_SNEEK_API_URL || '/api').replace(/\/+$/, '');

// ── Gate display names ──────────────────────────────────────────
const CORE_GATES = [
  { key: 'mobileToken', label: 'Client Token Check' },
  { key: 'decrypt',     label: 'QR Payload Decode' },
  { key: 'hmac',        label: 'Payload Integrity (HMAC)' },
  { key: 'kid',         label: 'Client Identity (KID)' },
  { key: 'ttl',         label: 'Session TTL Check' },
  { key: 'replay',      label: 'Replay Protection' },
  { key: 'callbackSignature', label: 'Session Callback Check' },
];

const CROSS_GATES = [
  { key: 'sessionCrossCheck',  label: 'Session Consistency' },
  { key: 'payloadDigestMatch', label: 'Payload Consistency' },
  { key: 'blobDigestMatch',    label: 'Blob Consistency' },
  { key: 'crossVerifySummary', label: 'Verification Summary' },
];

export default function App() {
  // ── State ─────────────────────────────────────────────────────
  const [phase, setPhase] = useState('idle');
  // idle → qr_ready → scanning → verified / error
  const [sessionId, setSessionId] = useState('');
  const [blob, setBlob] = useState('');
  const [payload, setPayload] = useState(null);
  const [expiresAt, setExpiresAt] = useState('');
  const [ttlSeconds, setTtlSeconds] = useState(0);
  const [scanResult, setScanResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [sessionStatus, setSessionStatus] = useState(null);
  const [username, setUsername] = useState('');
  const [eventLog, setEventLog] = useState([]);
  const pollRef = useRef(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualBlob, setManualBlob] = useState('');

  // ── Helpers ───────────────────────────────────────────────────
  const addLog = useCallback((gate, message, status) => {
    setEventLog((prev) => [
      { gate, message, status, time: new Date().toLocaleTimeString() },
      ...prev,
    ]);
  }, []);

  const resetState = useCallback(() => {
    setPhase('idle');
    setSessionId('');
    setBlob('');
    setPayload(null);
    setExpiresAt('');
    setTtlSeconds(0);
    setScanResult(null);
    setErrorMsg('');
    setSessionStatus(null);
    setEventLog([]);
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  // ── 1) Generate QR ───────────────────────────────────────────
  const handleGenerateQr = async () => {
    resetState();
    try {
      const res = await fetch(`${CLIENT_API_URL}/generate-qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setPhase('error');
        setErrorMsg(data.error || 'Failed to generate QR.');
        return;
      }

      setSessionId(data.session_id);
      setBlob(data.encryptedBlob);
      setPayload(data.payload);
      setExpiresAt(data.expiresAt);
      setTtlSeconds(data.ttlSeconds || 120);
      setPhase('qr_ready');

      addLog('session_start', 'User clicked "Generate Login QR" on the client website.', 'passed');
      addLog('session_create', `Client backend generated session ${data.session_id} with a ${data.ttlSeconds || 120} second TTL.`, 'passed');
      addLog('integrity_signature', `Client backend derived HMAC-SHA256(client_id, K1) without exposing K1 to the frontend.`, 'passed');
      addLog('payload_encode', 'Payload was base64-encoded and encoded into a QR code.', 'passed');

      // Start polling
      startPolling(data.session_id);
    } catch (err) {
      setPhase('error');
      setErrorMsg('Network error calling /generate-qr');
    }
  };

  // ── 2) Polling ────────────────────────────────────────────────
  const startPolling = (sid) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${CLIENT_API_URL}/session-status?session_id=${sid}`);
        const data = await res.json();
        setSessionStatus(data);

        if (data.status === 'authenticated') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setPhase('verified');
          addLog('authenticated', `Session ${sid} authenticated successfully.`, 'passed');
        }
        if (data.status === 'expired') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          addLog('session_ttl', 'Session expired before authentication completed.', 'failed');
        }
      } catch (_) {
        // Polling error — silently retry
      }
    }, 1500);
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── 3) Simulate Scan ─────────────────────────────────────────
  const handleSimulateScan = async () => {
    const blobToScan = manualMode ? manualBlob.trim() : blob;
    if (!blobToScan) return;

    setPhase('scanning');
    setScanResult(null);
    setErrorMsg('');
    addLog('scan_request', 'Simulating mobile scan — sending blob to Sneek server.', 'pending');

    try {
      const res = await fetch(`${SNEEK_API_URL}/sneek/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encryptedBlob: blobToScan,
          mobileToken: 'demo-mobile-token',
          username: username.trim() || undefined,
        }),
      });
      const data = await res.json();
      setScanResult(data);

      if (res.ok && data.ok) {
        addLog('scan_complete', 'Sneek verified the QR blob successfully.', 'passed');
        // Polling will pick up the authenticated state
      } else {
        setPhase('error');
        setErrorMsg(data.error || 'Verification failed');
        addLog('scan_failed', data.error || 'Verification failed.', 'failed');
      }
    } catch (err) {
      setPhase('error');
      setErrorMsg('Network error connecting to Sneek Server');
      addLog('scan_failed', 'Network error connecting to Sneek Server.', 'failed');
    }
  };

  // ── Time remaining ────────────────────────────────────────────
  const [timeRemaining, setTimeRemaining] = useState(null);
  useEffect(() => {
    if (!expiresAt || (phase !== 'qr_ready' && phase !== 'scanning')) {
      setTimeRemaining(null);
      return;
    }
    const tick = () => {
      const ms = Date.parse(expiresAt) - Date.now();
      setTimeRemaining(ms > 0 ? Math.ceil(ms / 1000) : 0);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [expiresAt, phase]);

  // ── Derived verification ──────────────────────────────────────
  const verification = scanResult?.verification || sessionStatus?.verification || null;

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="app-container">
      <div className="background-shapes">
        <div className="shape shape-1"></div>
        <div className="shape shape-2"></div>
      </div>

      <main className="main-content">
        <header className="header">
          <div className="logo-container">
            <ShieldCheck className="logo-icon" size={32} />
            <h1>Sneek Auth</h1>
          </div>
          <p className="subtitle">Secure QR Blob Verification Engine</p>
        </header>

        <div className="grid-container">
          {/* ─── LEFT PANEL ─── */}
          <section className="glass-panel input-panel">
            {/* Mode toggle */}
            <div className="mode-toggle">
              <button
                className={`toggle-btn ${!manualMode ? 'active' : ''}`}
                onClick={() => setManualMode(false)}
              >
                <QrCode size={16} /> Full Flow
              </button>
              <button
                className={`toggle-btn ${manualMode ? 'active' : ''}`}
                onClick={() => setManualMode(true)}
              >
                <Key size={16} /> Manual Blob
              </button>
            </div>

            {!manualMode ? (
              /* ── Full flow mode ── */
              <div className="flow-section">
                <div className="input-group">
                  <label htmlFor="username">
                    <User size={16} /> Custom Username (Optional)
                  </label>
                  <input
                    id="username"
                    type="text"
                    placeholder="e.g. alice_wonder"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="modern-input"
                  />
                </div>

                {phase === 'idle' && (
                  <button className="verify-button generate-btn" onClick={handleGenerateQr}>
                    <QrCode size={18} /> Login with Sneek
                  </button>
                )}

                {(phase === 'qr_ready' || phase === 'scanning') && (
                  <>
                    {/* Debug payload */}
                    <div className="debug-payload">
                      <h3 className="debug-title">
                        <span className="debug-label">DEBUG PAYLOAD</span>
                        What the client backend created
                      </h3>

                      <div className="debug-field">
                        <div className="debug-field-header">
                          <span>HMAC</span>
                          <button className="copy-btn" onClick={() => navigator.clipboard.writeText(payload?.hmac || '')}>Copy</button>
                        </div>
                        <code className="debug-value">{payload?.hmac}</code>
                      </div>

                      <div className="debug-field">
                        <div className="debug-field-header">
                          <span>QR Blob</span>
                          <button className="copy-btn" onClick={() => navigator.clipboard.writeText(blob)}>Copy</button>
                        </div>
                        <code className="debug-value blob-value">{blob}</code>
                      </div>

                      <div className="debug-field">
                        <div className="debug-field-header">
                          <span>Payload preview</span>
                        </div>
                        <pre className="debug-json">{JSON.stringify(payload, null, 2)}</pre>
                      </div>
                    </div>

                    {/* Timer */}
                    {timeRemaining !== null && (
                      <div className={`ttl-bar ${timeRemaining <= 10 ? 'critical' : ''}`}>
                        <Clock size={16} />
                        <span>Session expires in <strong>{timeRemaining}s</strong></span>
                        <div className="ttl-progress">
                          <div
                            className="ttl-fill"
                            style={{ width: `${Math.max(0, (timeRemaining / ttlSeconds) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <button
                      className={`verify-button scan-btn ${phase === 'scanning' ? 'pulsing' : ''}`}
                      onClick={handleSimulateScan}
                      disabled={phase === 'scanning'}
                    >
                      {phase === 'scanning' ? (
                        <><Activity className="spin" size={18} /> Scanning...</>
                      ) : (
                        <><Scan size={18} /> Simulate Scan</>
                      )}
                    </button>
                  </>
                )}

                {(phase === 'verified' || phase === 'error') && (
                  <button className="verify-button reset-btn" onClick={resetState}>
                    <RefreshCw size={18} /> Start Over
                  </button>
                )}
              </div>
            ) : (
              /* ── Manual blob mode ── */
              <div className="flow-section">
                <div className="input-group">
                  <label htmlFor="username-manual">
                    <User size={16} /> Custom Username (Optional)
                  </label>
                  <input
                    id="username-manual"
                    type="text"
                    placeholder="e.g. alice_wonder"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="modern-input"
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="manual-blob">
                    <Key size={16} /> Encryption Blob
                  </label>
                  <textarea
                    id="manual-blob"
                    placeholder="Paste the base64 encryption blob from the client QR here..."
                    value={manualBlob}
                    onChange={(e) => setManualBlob(e.target.value)}
                    className="modern-textarea"
                    rows={6}
                  />
                </div>
                <button
                  className={`verify-button scan-btn ${phase === 'scanning' ? 'pulsing' : ''}`}
                  onClick={handleSimulateScan}
                  disabled={!manualBlob.trim() || phase === 'scanning'}
                >
                  {phase === 'scanning' ? (
                    <><Activity className="spin" size={18} /> Verifying...</>
                  ) : (
                    <><ShieldCheck size={18} /> Verify Client</>
                  )}
                </button>
                {(phase === 'verified' || phase === 'error') && (
                  <button className="verify-button reset-btn" onClick={resetState}>
                    <RefreshCw size={18} /> Start Over
                  </button>
                )}
              </div>
            )}
          </section>

          {/* ─── RIGHT PANEL ─── */}
          <section className="glass-panel result-panel">
            <h2>Verification Details</h2>

            {/* Status bar */}
            {verification && (
              <div className="status-summary-bar">
                <StatusCount verification={verification} />
              </div>
            )}

            {/* Gate grids */}
            {verification && (
              <>
                <GateGrid title="Core Verification Gates" gates={CORE_GATES} verification={verification} />
                <GateGrid title="Cross-Verification Gates" gates={CROSS_GATES} verification={verification} />
              </>
            )}

            {/* Idle state */}
            {phase === 'idle' && !verification && (
              <div className="empty-state">
                <div className="empty-icon-wrapper">
                  <ShieldAlert size={48} className="text-muted" />
                </div>
                <p>Awaiting authentication flow.</p>
                <p className="text-small">Click "Login with Sneek" to start.</p>
              </div>
            )}

            {/* Error message */}
            {phase === 'error' && errorMsg && (
              <div className="result-content error-content">
                <div className="status-badge error">
                  <XCircle size={20} /> Authentication Rejected
                </div>
                <p className="error-message">{errorMsg}</p>
              </div>
            )}

            {/* Authenticated state */}
            {phase === 'verified' && (sessionStatus?.userProfile || scanResult?.userProfile) && (
              <div className="result-content success-content fade-in">
                <div className="status-badge success">
                  <CheckCircle2 size={20} /> Authentication Successful
                </div>
                <UserCard profile={sessionStatus?.userProfile || scanResult?.userProfile} />
                {(sessionStatus?.sharedInfo || scanResult?.sharedInfo) && (
                  <SharedInfoCard info={sessionStatus?.sharedInfo || scanResult?.sharedInfo} />
                )}
              </div>
            )}

            {/* Event log */}
            {eventLog.length > 0 && (
              <div className="event-log">
                {eventLog.map((ev, i) => (
                  <div key={i} className={`log-entry ${ev.status}`}>
                    <span className={`log-dot ${ev.status}`} />
                    <div className="log-body">
                      <strong>{ev.gate}</strong>
                      <span className={`log-status ${ev.status}`}>{ev.status}</span>
                      <p>{ev.message}</p>
                      <span className="log-time">{ev.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function StatusCount({ verification }) {
  const vals = Object.values(verification);
  const passed = vals.filter((v) => v === 'passed').length;
  const failed = vals.filter((v) => v === 'failed').length;
  const pending = vals.filter((v) => v === 'pending').length;
  return (
    <div className="status-counts">
      <span className="count-passed">● Passed: {passed}</span>
      <span className="count-failed">● Failed: {failed}</span>
      <span className="count-pending">● Pending: {pending}</span>
    </div>
  );
}

function GateGrid({ title, gates, verification }) {
  const statuses = gates.map((g) => verification[g.key] || 'pending');
  const allPassed = statuses.every((s) => s === 'passed');
  const anyFailed = statuses.some((s) => s === 'failed');
  const icon = allPassed ? '✓' : anyFailed ? '✗' : '○';
  const badgeClass = allPassed ? 'badge-passed' : anyFailed ? 'badge-failed' : 'badge-pending';

  return (
    <div className="gate-grid-section">
      <div className="gate-grid-header">
        <span className={`gate-badge ${badgeClass}`}>{icon}</span>
        <h3>{title}</h3>
      </div>
      <div className="gate-grid">
        {gates.map((g) => (
          <GateCard key={g.key} label={g.label} status={verification[g.key] || 'pending'} />
        ))}
      </div>
    </div>
  );
}

function GateCard({ label, status }) {
  return (
    <div className={`gate-card ${status}`}>
      <span className="gate-card-label">{label}</span>
      <span className={`gate-card-status ${status}`}>
        {status === 'passed' && <CheckCircle2 size={14} />}
        {status === 'failed' && <XCircle size={14} />}
        {status === 'pending' && <Activity size={14} />}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    </div>
  );
}

function UserCard({ profile }) {
  if (!profile) return null;
  return (
    <div className="user-card">
      <div className="avatar">{(profile.name || 'U').charAt(0)}</div>
      <div className="user-details">
        <h3>{profile.name}</h3>
        <p>{profile.email}</p>
        <span className="user-id">ID: {profile.userId}</span>
      </div>
    </div>
  );
}

function SharedInfoCard({ info }) {
  if (!info) return null;
  return (
    <div className="shared-info-card">
      <h4>Information Shared with Client</h4>
      <ul className="info-list">
        <li><strong>Verified At:</strong> {new Date(info.verifiedAt).toLocaleString()}</li>
        <li><strong>Client App:</strong> {info.clientName}</li>
        <li><strong>Granted Permissions:</strong> {info.permissions?.join(', ')}</li>
      </ul>
    </div>
  );
}
