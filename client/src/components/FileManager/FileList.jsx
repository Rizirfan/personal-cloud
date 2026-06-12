import React from 'react';
import { useDrive } from '../../context/DriveContext';

const FOLDER_MIME = "application/vnd.google-apps.folder";

function isFolder(item) {
  return item?.mimeType === FOLDER_MIME || item?.isSharedDriveRoot;
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function FileIcon({ item }) {
  if (isFolder(item)) {
    return (
      <div className="file-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      </div>
    );
  }
  return (
    <div className="file-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    </div>
  );
}

export default function FileList({ onOpen, onDelete }) {
  const { files, loadingFiles } = useDrive();

  if (loadingFiles) {
    return (
      <div className="empty-state">
        <span className="loader" style={{ borderColor: 'var(--text-muted)', borderTopColor: 'var(--primary)' }}/> 
        <div style={{ marginTop: '1rem' }}>Loading files...</div>
      </div>
    );
  }

  if (!files.length) {
    return (
      <div className="empty-state">
        <div style={{ marginBottom: '1rem', opacity: 0.35 }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div style={{ fontWeight: 500, fontSize: '1.2rem', marginBottom: '0.5rem', color: 'var(--text-main)' }}>This folder is empty</div>
        <div>Upload files to see them here.</div>
      </div>
    );
  }

  return (
    <div className="file-list">
      {files.map((item) => (
        <div
          key={`${item.accountEmail}-${item.id}`}
          className="file-item glass"
          onDoubleClick={() => onOpen(item)}
        >
          <FileIcon item={item} />
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
            <div className="file-name" title={item.name}>{item.name}</div>
            <div className="file-meta">
              {isFolder(item) ? "Folder" : formatBytes(item.size)} • {formatDate(item.modifiedTime)}
            </div>
          </div>
          <div className="file-provider" title={item.accountEmail}>
            {item.accountEmail}
          </div>
          {!isFolder(item) && (
            <button
              type="button"
              className="file-delete"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(item);
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
