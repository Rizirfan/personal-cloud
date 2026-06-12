import React, { useState } from 'react';

// Clean, professional SVG icons
const PaletteIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', verticalAlign: 'middle' }}><circle cx="12" cy="12" r="10"/><path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="12" cy="13" r="1"/></svg>
);

const BookIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', verticalAlign: 'middle' }}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
);

const CodeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', verticalAlign: 'middle' }}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
);

export default function SettingsModal({ onClose, theme, setTheme }) {
  const [activeTab, setActiveTab] = useState("theme");

  const themes = [
    { id: "dark", name: "Sleek Dark", color: "#1e293b" },
    { id: "light", name: "Frosted Light", color: "#e2e8f0" },
    { id: "purple", name: "Midnight Purple", color: "#8b5cf6" },
    { id: "ocean", name: "Ocean Breeze", color: "#06b6d4" }
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: '650px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Settings & Info</h3>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--glass-border)', marginBottom: '1.5rem' }}>
          <button 
            type="button" 
            className={`btn ${activeTab === 'theme' ? 'btn-primary' : 'btn-ghost'}`} 
            onClick={() => setActiveTab("theme")}
            style={{ padding: '0.6rem 1.2rem', borderRadius: '8px 8px 0 0', borderBottom: 'none' }}
          >
            <PaletteIcon /> Themes
          </button>
          <button 
            type="button" 
            className={`btn ${activeTab === 'docs' ? 'btn-primary' : 'btn-ghost'}`} 
            onClick={() => setActiveTab("docs")}
            style={{ padding: '0.6rem 1.2rem', borderRadius: '8px 8px 0 0', borderBottom: 'none' }}
          >
            <BookIcon /> Documentation
          </button>
          <button 
            type="button" 
            className={`btn ${activeTab === 'dev' ? 'btn-primary' : 'btn-ghost'}`} 
            onClick={() => setActiveTab("dev")}
            style={{ padding: '0.6rem 1.2rem', borderRadius: '8px 8px 0 0', borderBottom: 'none' }}
          >
            <CodeIcon /> Developer Details
          </button>
        </div>

        <div style={{ minHeight: '280px', display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'theme' && (
            <div>
              <h4 style={{ marginBottom: '1rem', color: 'var(--text-main)' }}>Customize Appearance</h4>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                Select a visual theme to personalize your Multi-Drive interface. Visual highlights and backgrounds will update dynamically.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
                {themes.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    className={`btn ${theme === t.id ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setTheme(t.id)}
                    style={{ 
                      justifyContent: 'flex-start', 
                      padding: '1rem', 
                      borderRadius: 'var(--radius)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      width: '100%'
                    }}
                  >
                    <span style={{ 
                      width: '16px', 
                      height: '16px', 
                      borderRadius: '50%', 
                      background: t.color, 
                      display: 'inline-block',
                      border: '1px solid rgba(255,255,255,0.1)'
                    }} />
                    <span>{t.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'docs' && (
            <div style={{ maxHeight: '280px', overflowY: 'auto', paddingRight: '0.5rem' }}>
              <h4 style={{ marginBottom: '0.75rem', color: 'var(--text-main)', fontSize: '1.1rem' }}>Multi-Drive User Guide</h4>
              
              <h5 style={{ color: 'var(--primary-hover)', marginTop: '1rem', marginBottom: '0.25rem', fontSize: '0.95rem' }}>1. Unified Storage</h5>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: '1.5' }}>
                Multi-Drive connects multiple Google Drive accounts. The "Unified Drive" view merges file systems from all accounts. Creating folders or uploading files at the root automatically chooses the account with the most available space.
              </p>

              <h5 style={{ color: 'var(--primary-hover)', marginTop: '1rem', marginBottom: '0.25rem', fontSize: '0.95rem' }}>2. Filtering by Account</h5>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: '1.5' }}>
                Switching between "Unified Drive" and specific account folders dynamically filters file browser lists, search queries, and Storage Dashboard capacity indicators for that individual target drive.
              </p>

              <h5 style={{ color: 'var(--primary-hover)', marginTop: '1rem', marginBottom: '0.25rem', fontSize: '0.95rem' }}>3. Advanced Security</h5>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: '1.5' }}>
                Sensitive credentials, client secrets, and access tokens are secured on the backend using AES-256-GCM encryption before storing in Firebase Firestore session storage. They are decrypted in memory only.
              </p>
            </div>
          )}

          {activeTab === 'dev' && (
            <div>
              <h4 style={{ marginBottom: '1rem', color: 'var(--text-main)', fontSize: '1.1rem' }}>Developer & System Details</h4>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Application Name</span>
                  <span style={{ fontWeight: 500 }}>Multi-Drive Cloud Hub</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Version</span>
                  <span style={{ fontWeight: 500 }}>v1.1.0</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Core Stack</span>
                  <span style={{ fontWeight: 500 }}>React 18, Vite, Node, Express, Firebase, Google API</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Security Architecture</span>
                  <span style={{ fontWeight: 500 }}>AES-256-GCM Encrypted Token Storage</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Developer</span>
                  <span style={{ fontWeight: 500, color: 'var(--primary-hover)' }}>Advanced Agentic AI & paired Developer</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
