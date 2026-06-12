import React from 'react';
import { useDrive } from '../context/DriveContext';

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function StorageDashboard({ onManageAccounts }) {
  const { accounts, totalUsage, totalLimit, selectedAccountEmail } = useDrive();
  
  const selectedAccount = selectedAccountEmail 
    ? accounts.find(a => a.email.toLowerCase() === selectedAccountEmail.toLowerCase()) 
    : null;
    
  const usage = selectedAccount ? selectedAccount.usage : totalUsage;
  const limit = selectedAccount ? selectedAccount.limit : totalLimit;
  
  const pct = limit > 0 ? Math.min(100, (usage / limit) * 100) : 0;
  const free = Math.max(0, limit - usage);

  if (selectedAccount && selectedAccount.error) {
    return (
      <div className="dashboard-card glass" style={{ border: '1px solid rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.03)', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 className="dashboard-title" style={{ color: 'var(--danger)' }}>{selectedAccount.email}</h2>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
              Connection Error: {selectedAccount.error}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
              Please reconnect the account using the settings panel.
            </div>
          </div>
          <button className="btn btn-ghost btn-danger" onClick={onManageAccounts}>
            Manage Accounts
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-card glass">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 className="dashboard-title">{selectedAccount ? selectedAccount.email : "Unified Storage"}</h2>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            {selectedAccount 
              ? "Single Drive Storage Metrics" 
              : `Pooled from ${accounts.length} connected Google Drive account${accounts.length !== 1 ? 's' : ''}`}
          </div>
        </div>
        <button className="btn btn-ghost" onClick={onManageAccounts}>
          Manage Accounts
        </button>
      </div>

      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-label">Used Storage</div>
          <div className="stat-value">{formatBytes(usage)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Capacity</div>
          <div className="stat-value">{formatBytes(limit)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Available</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>{formatBytes(free)}</div>
        </div>
      </div>

      <div className="storage-bar-wrap">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem', fontWeight: 500 }}>
          <span>Storage Fullness</span>
          <span>{pct.toFixed(1)}%</span>
        </div>
        <div className="storage-bar">
          <div className="storage-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
