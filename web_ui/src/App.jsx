import { useState, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Key,
  User,
  Activity,
  CheckCircle2,
  XCircle,
  RefreshCw,
  MessageSquare,
} from 'lucide-react';

/** Sneek API only — deploy at mobile.sneek.in or proxy dev → local Sneek */
const SNEEK_API_URL = (import.meta.env.VITE_SNEEK_API_URL || '/api').replace(/\/+$/, '');

const CORE_GATES = [
  { key: 'mobileToken', label: 'Client token check' },
  { key: 'decrypt', label: 'QR payload decode' },
  { key: 'hmac', label: 'Payload integrity check' },
  { key: 'kid', label: 'Client identity check' },
  { key: 'origin', label: 'Browser origin (allowlist)' },
  { key: 'ttl', label: 'Session TTL check' },
  { key: 'replay', label: 'Replay protection' },
  { key: 'callbackSignature', label: 'Session callback check' },
];

const CROSS_GATES = [
  { key: 'sessionCrossCheck', label: 'Session consistency check' },
  { key: 'payloadDigestMatch', label: 'Payload consistency check' },
  { key: 'blobDigestMatch', label: 'Blob consistency check' },
  { key: 'crossVerifySummary', label: 'Verification summary check' },
];

export default function App() {
  const [blob, setBlob] = useState('');
  const [mobileToken, setMobileToken] = useState('demo-mobile-token');
  const [username, setUsername] = useState('');
  const [verifierName, setVerifierName] = useState('');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const reset = useCallback(() => {
    setBlob('');
    setResult(null);
    setLoading(false);
    setUsername('');
    setVerifierName('');
    setVerificationMessage('');
    setMobileToken('demo-mobile-token');
  }, []);

  const verify = async () => {
    const trimmed = blob.trim();
    if (!trimmed) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch(`${SNEEK_API_URL}/sneek/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encryptedBlob: trimmed,
          mobileToken: mobileToken.trim() || undefined,
          username: username.trim() || undefined,
          verifierName: verifierName.trim() || undefined,
          verificationMessage: verificationMessage.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setResult({ ...data, _httpOk: res.ok, _status: res.status });
    } catch {
      setResult({
        ok: false,
        error: 'Network error — could not reach Sneek server.',
        _httpOk: false,
      });
    } finally {
      setLoading(false);
    }
  };

  const verification = result?.verification ?? null;
  const ok = result?.ok === true && result?._httpOk;

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
            <h1>Sneek</h1>
          </div>
          <p className="subtitle">Paste the QR blob — verification runs on the Sneek server only.</p>
        </header>

        <div className="grid-container">
          <section className="glass-panel input-panel">
            <div className="flow-section">
              <div className="input-group">
                <label htmlFor="blob">
                  <Key size={16} /> QR blob (base64)
                </label>
                <textarea
                  id="blob"
                  placeholder="Paste the blob from the scanned QR…"
                  value={blob}
                  onChange={(e) => setBlob(e.target.value)}
                  className="modern-textarea"
                  rows={8}
                  spellCheck={false}
                />
              </div>

              <div className="input-group">
                <label htmlFor="mobile-token">
                  <ShieldCheck size={16} /> Mobile token
                </label>
                <input
                  id="mobile-token"
                  type="text"
                  value={mobileToken}
                  onChange={(e) => setMobileToken(e.target.value)}
                  className="modern-input"
                  autoComplete="off"
                />
              </div>

              <div className="input-group">
                <label htmlFor="username">
                  <User size={16} /> Username / profile hint (optional)
                </label>
                <input
                  id="username"
                  type="text"
                  placeholder="Forwarded with verification payload"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="modern-input"
                />
              </div>

              <div className="input-group">
                <label htmlFor="verifier-name">
                  <User size={16} /> Verifying person (optional)
                </label>
                <input
                  id="verifier-name"
                  type="text"
                  value={verifierName}
                  onChange={(e) => setVerifierName(e.target.value)}
                  className="modern-input"
                />
              </div>

              <div className="input-group">
                <label htmlFor="verification-msg">
                  <MessageSquare size={16} /> Message for client callback (optional)
                </label>
                <input
                  id="verification-msg"
                  type="text"
                  value={verificationMessage}
                  onChange={(e) => setVerificationMessage(e.target.value)}
                  className="modern-input"
                />
              </div>

              <button
                type="button"
                className={`verify-button scan-btn ${loading ? 'pulsing' : ''}`}
                onClick={verify}
                disabled={loading || !blob.trim()}
              >
                {loading ? (
                  <>
                    <Activity className="spin" size={18} /> Verifying…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={18} /> Verify blob
                  </>
                )}
              </button>

              <button type="button" className="verify-button reset-btn" onClick={reset}>
                <RefreshCw size={18} /> Clear
              </button>
            </div>
          </section>

          <section className="glass-panel result-panel">
            <h2>Verification details</h2>

            {verification && (
              <div className="status-summary-bar">
                <StatusCount verification={verification} />
              </div>
            )}

            {verification && (
              <>
                <GateGrid title="Core verification gates" gates={CORE_GATES} verification={verification} />
                <GateGrid title="Cross-verification gates" gates={CROSS_GATES} verification={verification} />
              </>
            )}

            {!verification && !loading && !result && (
              <div className="empty-state">
                <div className="empty-icon-wrapper">
                  <ShieldAlert size={48} className="text-muted" />
                </div>
                <p>Backend progress will appear here after you verify a blob.</p>
                <p className="text-small">No client app or QR generation — Sneek only.</p>
              </div>
            )}

            {result && !ok && result.error && (
              <div className="result-content error-content">
                <div className="status-badge error">
                  <XCircle size={20} /> Verification rejected
                </div>
                <p className="error-message">{result.error}</p>
              </div>
            )}

            {ok && result?.userProfile && (
              <div className="result-content success-content fade-in">
                <div className="status-badge success">
                  <CheckCircle2 size={20} /> Verification succeeded
                </div>
                <UserCard profile={result.userProfile} />
                <VerificationNoteCard display={result.verificationDisplay} />
                {result.authenticatedClient && (
                  <p className="client-auth-badge">
                    Authenticated client:{' '}
                    <strong>{result.authenticatedClient.displayName}</strong>{' '}
                    <span className="text-muted">({result.authenticatedClient.client_id})</span>
                  </p>
                )}
                {result.sharedInfo && <SharedInfoCard info={result.sharedInfo} />}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function StatusCount({ verification }) {
  const vals = Object.values(verification);
  const passed = vals.filter((v) => v === 'passed').length;
  const failed = vals.filter((v) => v === 'failed').length;
  const pending = vals.filter((v) => v === 'pending').length;
  const skipped = vals.filter((v) => v === 'skipped').length;
  return (
    <div className="status-counts">
      <span className="count-passed">● Passed: {passed}</span>
      <span className="count-failed">● Failed: {failed}</span>
      <span className="count-pending">● Pending: {pending}</span>
      {skipped > 0 && <span className="text-muted">○ Skipped: {skipped}</span>}
    </div>
  );
}

function GateGrid({ title, gates, verification }) {
  const statuses = gates.map((g) => verification[g.key] || 'pending');
  const allPassed = statuses.every((s) => s === 'passed' || s === 'skipped');
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
        {status === 'skipped' && <Activity size={14} />}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    </div>
  );
}

function VerificationNoteCard({ display }) {
  if (!display || (!display.verifierName && !display.message)) return null;
  return (
    <div className="verification-note-card">
      <h4>Included in callback</h4>
      {display.verifierName && <p className="verifier-name">Verifier: {display.verifierName}</p>}
      {display.message && <p className="verifier-msg">{display.message}</p>}
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
      <h4>Shared metadata</h4>
      <ul className="info-list">
        <li>
          <strong>Verified at:</strong> {new Date(info.verifiedAt).toLocaleString()}
        </li>
        <li>
          <strong>Client app:</strong> {info.clientName}
        </li>
        <li>
          <strong>Granted permissions:</strong> {info.permissions?.join(', ')}
        </li>
      </ul>
    </div>
  );
}
