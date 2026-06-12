import React from 'react';

export default function LoginScreen({ onLogin, busy, error }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem' }}>
          <div className="logo">M</div>
        </div>
        <h1>Multi Drive</h1>
        <p>Sign in to your massive cloud storage pool.</p>
        
        {error && (
          <div style={{ 
            color: 'var(--danger)', 
            marginBottom: '1.5rem', 
            background: 'rgba(239, 68, 68, 0.1)', 
            padding: '0.75rem', 
            borderRadius: 'var(--radius)',
            border: '1px solid rgba(239, 68, 68, 0.2)' 
          }}>
            {error}
          </div>
        )}
        
        <button type="button" className="btn btn-primary" onClick={onLogin} disabled={busy} style={{ width: '100%', padding: '0.8rem', fontSize: '1rem' }}>
          {busy ? <span className="loader" /> : "Sign in with Google"}
        </button>
      </div>
    </div>
  );
}
