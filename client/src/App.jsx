import React, { useEffect, useRef, useState } from "react"
import { useAuth } from "./AuthContext"
import { DriveProvider, useDrive } from "./context/DriveContext"
import { createFolder, deleteItem, openFileUrl, uploadFile, restoreSession, exportSession, logoutAccount } from "./api"
import { loadStoredAccounts, saveStoredAccounts, mergeAccounts } from "./sessionStore"

import StorageDashboard from "./components/StorageDashboard"
import FileList from "./components/FileManager/FileList"
import LoginScreen from "./components/Auth/LoginScreen"
import AccountManager from "./components/Auth/AccountManager"
import SettingsModal from "./components/SettingsModal"

const GlobeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
)

const DriveIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
)

const SettingsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
)

const LogOutIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
)

function Breadcrumbs({ crumbs, onNavigate }) {
  if (!crumbs.length) return null
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {crumbs.map((crumb, i) => (
        <React.Fragment key={crumb.id}>
          {i > 0 && <span className="crumb-sep">/</span>}
          <button
            type="button"
            className={`crumb-btn ${i === crumbs.length - 1 ? "active" : ""}`}
            onClick={() => onNavigate(i)}
            disabled={i === crumbs.length - 1}
          >
            {crumb.name}
          </button>
        </React.Fragment>
      ))}
    </nav>
  )
}

function MainApp({ theme, setTheme }) {
  const { user, logout } = useAuth()
  const { 
    accounts, setAccounts, crumbs, currentFolder,
    searchQuery, setSearchQuery, loadStorage, loadFiles, refreshFiles, 
    navigateToFolder, navigateToCrumb, handleSearch,
    selectedAccountEmail, selectAccount
  } = useDrive()

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showManageModal, setShowManageModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const fileInputRef = useRef(null)
  const lastSyncedUidRef = useRef(null)

  const parentId = currentFolder?.id || "root"
  const accountEmail = currentFolder?.accountEmail || null

  useEffect(() => {
    if (!user) return
    const currentUid = user.uid || "local"
    if (lastSyncedUidRef.current === currentUid) return
    lastSyncedUidRef.current = currentUid

    let cancelled = false
    ;(async () => {
      console.log("Starting session sync...");
      setLoading(true)
      try {
        console.log("Exporting session...");
        const backendData = await exportSession()
        console.log("Exported session:", backendData);
        const backendAccounts = Array.isArray(backendData?.accounts) ? backendData.accounts : []
        console.log("Loading stored accounts...");
        const storedAccounts = await loadStoredAccounts(user)
        console.log("Loaded stored accounts:", storedAccounts);
        const merged = mergeAccounts(storedAccounts, backendAccounts)
        
        console.log("Saving stored accounts...");
        await saveStoredAccounts(user, merged)
        console.log("Restoring session...");
        await restoreSession(merged)
        console.log("Session restored.");
      } catch (err) {
        console.error("Session sync failed:", err)
      }
      console.log("Loading storage...");
      await loadStorage()
      console.log("Storage loaded. Cancelling loader.");
      if (!cancelled) setLoading(false)
    })()

    return () => { 
      cancelled = true 
      lastSyncedUidRef.current = null
    }
  }, [user, loadStorage])

  useEffect(() => {
    if (searchQuery || loading) return
    loadFiles(parentId, accountEmail)
  }, [loadFiles, searchQuery, loading, parentId, accountEmail])

  const handleOpen = (item) => {
    if (item.mimeType === "application/vnd.google-apps.folder" || item.isSharedDriveRoot) {
      setSearchQuery("")
      navigateToFolder({ id: item.id, name: item.name, accountEmail: item.accountEmail })
      return
    }
    window.open(openFileUrl(item.id, item.accountEmail), "_blank", "noopener")
  }

  const handleCreateFolder = async () => {
    const folderName = window.prompt("Folder name")
    if (!folderName?.trim()) return
    setBusy(true)
    try {
      await createFolder(parentId, folderName.trim(), accountEmail)
      refreshFiles()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleFileChosen = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setBusy(true)
    try {
      await uploadFile(parentId, accountEmail, file)
      refreshFiles()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete "${item.name}"?`)) return
    setBusy(true)
    try {
      await deleteItem(item.id, item.accountEmail)
      refreshFiles()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnect = async (email) => {
    if (!window.confirm(`Disconnect ${email}?`)) return
    setBusy(true)
    try {
      await logoutAccount(email)
      const backendData = await exportSession()
      const backendAccounts = Array.isArray(backendData?.accounts) ? backendData.accounts : []
      await saveStoredAccounts(user, backendAccounts)
      await loadStorage()
      
      if (parentId !== "root") {
        navigateToCrumb(0)
      } else {
        loadFiles(parentId, accountEmail)
      }
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleSignOut = async () => {
    if (!window.confirm("Sign out of Multi Drive?")) return
    setBusy(true)
    try {
      await logout()
      setAccounts([])
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <span className="loader" style={{ width: '48px', height: '48px', borderWidth: '4px' }} />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">M</div>
          <div>
            <h1>Multi Drive</h1>
            <div className="brand-sub">Massive Unified Cloud</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
          <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {busy ? <span className="loader" /> : "Upload File"}
          </button>
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChosen} />
          
          <button className="btn btn-ghost" onClick={handleCreateFolder} disabled={busy}>
            New Folder
          </button>
        </div>

        <div className="nav-section" style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto', flex: 1, paddingRight: '0.25rem' }}>
          <div className="nav-section-title" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600, paddingLeft: '0.5rem', marginBottom: '0.25rem' }}>
            Drives
          </div>
          
          <button 
            type="button"
            className={`nav-item ${!selectedAccountEmail ? 'active' : ''}`}
            onClick={() => selectAccount(null)}
          >
            <span className="nav-icon" style={{ display: 'inline-flex', alignItems: 'center' }}><GlobeIcon /></span>
            <span className="nav-label">Unified Drive</span>
          </button>

          {accounts.map(acc => (
            <button 
              type="button"
              key={acc.email}
              className={`nav-item ${selectedAccountEmail === acc.email ? 'active' : ''}`}
              onClick={() => selectAccount(acc.email)}
              title={acc.email}
            >
              <span className="nav-icon" style={{ display: 'inline-flex', alignItems: 'center' }}><DriveIcon /></span>
              <span className="nav-label" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {acc.email}
              </span>
            </button>
          ))}
        </div>

        <div style={{ marginTop: 'auto', paddingTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <button type="button" className="btn btn-ghost" onClick={() => setShowSettingsModal(true)} disabled={busy} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <SettingsIcon /> Settings & Info
          </button>
          <button type="button" className="btn btn-ghost" onClick={handleSignOut} disabled={busy} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <LogOutIcon /> Sign Out
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <form className="search" onSubmit={handleSearch}>
            <input 
              type="text" 
              placeholder={selectedAccountEmail ? `Search in ${selectedAccountEmail}...` : "Search across all drives..."} 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </form>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{user.email}</span>
          </div>
        </header>

        <section className="content">
          <StorageDashboard onManageAccounts={() => setShowManageModal(true)} />
          
          <div className="glass" style={{ padding: '2rem', borderRadius: 'var(--radius-lg)' }}>
            <Breadcrumbs crumbs={crumbs} onNavigate={navigateToCrumb} />
            <FileList onOpen={handleOpen} onDelete={handleDelete} />
          </div>
        </section>
      </main>

      {showManageModal && (
        <AccountManager 
          user={user}
          onClose={() => setShowManageModal(false)}
          onDisconnect={handleDisconnect}
        />
      )}

      {showSettingsModal && (
        <SettingsModal 
          theme={theme}
          setTheme={setTheme}
          onClose={() => setShowSettingsModal(false)}
        />
      )}
    </div>
  )
}

export default function App() {
  const { authReady, authError, user, login, isFirebaseConfigured } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [theme, setTheme] = useState(() => localStorage.getItem("app_theme") || "dark")

  useEffect(() => {
    if (authError) setError(authError)
  }, [authError])

  useEffect(() => {
    document.body.setAttribute("data-theme", theme)
    localStorage.setItem("app_theme", theme)
  }, [theme])

  const handleLogin = async () => {
    setError("")
    setBusy(true)
    try {
      await login()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!authReady) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <span className="loader" style={{ width: '48px', height: '48px', borderWidth: '4px' }} />
      </div>
    )
  }

  if (!isFirebaseConfigured) {
    return (
      <div style={{ padding: '2rem', color: 'var(--danger)' }}>
        <h2>Firebase not configured!</h2>
        <p>Please copy .env.example to .env and restart.</p>
      </div>
    )
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} busy={busy} error={error} />
  }

  return (
    <DriveProvider>
      <MainApp theme={theme} setTheme={setTheme} />
    </DriveProvider>
  )
}
