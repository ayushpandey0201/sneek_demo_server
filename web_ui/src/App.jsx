import { useState } from 'react';
import { ShieldCheck, ShieldAlert, Key, User, Activity, CheckCircle2, XCircle } from 'lucide-react';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');

export default function App() {
  const [blob, setBlob] = useState('');
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState('idle'); // idle, verifying, success, error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleVerify = async (e) => {
    e.preventDefault();
    if (!blob) return;

    setStatus('verifying');
    setResult(null);
    setErrorMsg('');

    try {
      const response = await fetch(`${API_BASE_URL}/sneek/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          encryptedBlob: blob,
          username: username.trim() || undefined
        }),
      });

      const data = await response.json();

      if (response.ok && data.ok) {
        setStatus('success');
        setResult(data);
      } else {
        setStatus('error');
        setErrorMsg(data.error || 'Verification failed');
        setResult(data);
      }
    } catch (err) {
      setStatus('error');
      setErrorMsg('Network error connecting to Sneek Server');
    }
  };

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
          {/* Input Panel */}
          <section className="glass-panel input-panel">
            <h2>Authentication Payload</h2>
            <form onSubmit={handleVerify}>
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

              <div className="input-group">
                <label htmlFor="blob">
                  <Key size={16} /> Encryption Blob
                </label>
                <textarea
                  id="blob"
                  placeholder="Paste the base64 encryption blob from the client QR here..."
                  value={blob}
                  onChange={(e) => setBlob(e.target.value)}
                  className="modern-textarea"
                  rows={6}
                  required
                />
              </div>

              <button 
                type="submit" 
                className={`verify-button ${status === 'verifying' ? 'pulsing' : ''}`}
                disabled={!blob || status === 'verifying'}
              >
                {status === 'verifying' ? (
                  <><Activity className="spin" size={18} /> Verifying...</>
                ) : (
                  <><ShieldCheck size={18} /> Verify Client</>
                )}
              </button>
            </form>
          </section>

          {/* Result Panel */}
          <section className="glass-panel result-panel">
            <h2>Verification Status</h2>
            
            {status === 'idle' && (
              <div className="empty-state">
                <div className="empty-icon-wrapper">
                  <ShieldAlert size={48} className="text-muted" />
                </div>
                <p>Awaiting blob verification.</p>
                <p className="text-small">Paste a payload and click Verify.</p>
              </div>
            )}

            {status === 'verifying' && (
              <div className="empty-state loading-state">
                <Activity size={48} className="spin text-primary" />
                <p>Analyzing cryptographic gates...</p>
              </div>
            )}

            {status === 'error' && (
              <div className="result-content error-content">
                <div className="status-badge error">
                  <XCircle size={20} /> Authentication Rejected
                </div>
                <p className="error-message">{errorMsg}</p>
                
                {result?.verification && (
                  <div className="gates-list">
                    <h3>Security Gates</h3>
                    <GateItem name="Payload Decryption" status={result.verification.decrypt} />
                    <GateItem name="HMAC Integrity" status={result.verification.hmac} />
                    <GateItem name="KID / Origin Match" status={result.verification.kid} />
                  </div>
                )}
              </div>
            )}

            {status === 'success' && result && (
              <div className="result-content success-content fade-in">
                <div className="status-badge success">
                  <CheckCircle2 size={20} /> Authentication Successful
                </div>

                <div className="user-card">
                  <div className="avatar">{result.userProfile.name.charAt(0)}</div>
                  <div className="user-details">
                    <h3>{result.userProfile.name}</h3>
                    <p>{result.userProfile.email}</p>
                    <span className="user-id">ID: {result.userProfile.userId}</span>
                  </div>
                </div>

                <div className="shared-info-card">
                  <h4>Information Shared with Client</h4>
                  <ul className="info-list">
                    <li><strong>Verified At:</strong> {new Date(result.sharedInfo.verifiedAt).toLocaleString()}</li>
                    <li><strong>Client App:</strong> {result.sharedInfo.clientName}</li>
                    <li><strong>Granted Permissions:</strong> {result.sharedInfo.permissions.join(', ')}</li>
                  </ul>
                </div>

                <div className="gates-list compact">
                  <h4>Passed Gates</h4>
                  <GateItem name="Payload Decryption" status={result.verification.decrypt} />
                  <GateItem name="HMAC Integrity" status={result.verification.hmac} />
                  <GateItem name="KID Origin Match" status={result.verification.kid} />
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function GateItem({ name, status }) {
  const isPassed = status === 'passed';
  const isFailed = status === 'failed';
  
  return (
    <div className={`gate-item ${status}`}>
      <span className="gate-name">{name}</span>
      <span className="gate-status">
        {isPassed && <CheckCircle2 size={16} />}
        {isFailed && <XCircle size={16} />}
        {status === 'pending' && <Activity size={16} />}
        {status.toUpperCase()}
      </span>
    </div>
  );
}
