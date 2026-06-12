import React, { useState } from 'react';
import { useDrive } from '../../context/DriveContext';
import { startGoogleAuth, logoutAccount } from '../../api';

export default function AccountManager({ onClose, onDisconnect, user }) {
  const { accounts } = useDrive();
  const [googleClientId, setGoogleClientId] = useState(() => localStorage.getItem("last_google_client_id") || "");
  const [googleClientSecret, setGoogleClientSecret] = useState(() => localStorage.getItem("last_google_client_secret") || "");
  const [googleRedirectUri, setGoogleRedirectUri] = useState(() => localStorage.getItem("last_google_redirect_uri") || `${window.location.origin}/auth/google/callback`);
  const [busy, setBusy] = useState(false);

  const handleConnect = async () => {
    if (!googleClientId || !googleClientSecret || !googleRedirectUri) {
      alert("Please enter Client ID, Client Secret, and Redirect URI.");
      return;
    }
    localStorage.setItem("last_google_client_id", googleClientId.trim());
    localStorage.setItem("last_google_client_secret", googleClientSecret.trim());
    localStorage.setItem("last_google_redirect_uri", googleRedirectUri.trim());

    setBusy(true);
    try {
      const { url } = await startGoogleAuth(googleClientId.trim(), googleClientSecret.trim(), googleRedirectUri.trim());
      window.location.href = url;
    } catch (err) {
      alert(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Manage Connected Accounts</h3>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        
        <div style={{ marginBottom: '2rem' }}>
          <h4 style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>Connected Google Drives</h4>
          {accounts.length === 0 ? (
            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: 'var(--radius)', color: 'var(--text-muted)' }}>
              No accounts connected yet.
            </div>
          ) : (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {accounts.map(acc => (
                <li key={acc.email} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: 'var(--radius)' }}>
                  <span style={{ fontWeight: 500 }}>{acc.email}</span>
                  <button type="button" className="btn btn-danger" onClick={() => onDisconnect(acc.email)} disabled={busy}>
                    Disconnect
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '2rem 0' }} />

        <div>
          <h4 style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>Add New Account</h4>
          <div className="form-group">
            <label>Google Client ID</label>
            <input type="text" value={googleClientId} onChange={e => setGoogleClientId(e.target.value)} placeholder="e.g. 1234...apps.googleusercontent.com" />
          </div>
          <div className="form-group">
            <label>Google Client Secret</label>
            <input type="password" value={googleClientSecret} onChange={e => setGoogleClientSecret(e.target.value)} placeholder="e.g. GOCSPX-..." />
          </div>
          <div className="form-group">
            <label>Redirect URI</label>
            <input type="text" value={googleRedirectUri} onChange={e => setGoogleRedirectUri(e.target.value)} placeholder="e.g. http://localhost:5173/auth/google/callback" />
          </div>
          <button type="button" className="btn btn-primary" onClick={handleConnect} disabled={busy} style={{ width: '100%' }}>
            {busy ? <span className="loader" /> : "Connect Account"}
          </button>
        </div>
      </div>
    </div>
  );
}
