import React, { createContext, useContext, useState, useCallback } from 'react';
import { getFiles, getStorage, createFolder, uploadFile, deleteItem, openFileUrl, searchFiles } from '../api';

const DriveContext = createContext(null);

export function DriveProvider({ children }) {
  const [accounts, setAccounts] = useState([]);
  const [totalUsage, setTotalUsage] = useState(0);
  const [totalLimit, setTotalLimit] = useState(0);
  const [crumbs, setCrumbs] = useState([{ id: "root", name: "My Unified Drive", accountEmail: null }]);
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAccountEmail, setSelectedAccountEmail] = useState(null);

  const currentFolder = crumbs[crumbs.length - 1];

  const selectAccount = useCallback((email) => {
    setSelectedAccountEmail(email);
    setSearchQuery("");
    setCrumbs([{ 
      id: "root", 
      name: email ? email : "My Unified Drive", 
      accountEmail: email 
    }]);
  }, [setSearchQuery]);

  React.useEffect(() => {
    if (selectedAccountEmail && !accounts.some(acc => acc.email.toLowerCase() === selectedAccountEmail.toLowerCase())) {
      setSelectedAccountEmail(null);
      setCrumbs([{ id: "root", name: "My Unified Drive", accountEmail: null }]);
    }
  }, [accounts, selectedAccountEmail]);

  const loadStorage = useCallback(async () => {
    try {
      const res = await getStorage();
      if (res) {
        setAccounts(Array.isArray(res.accounts) ? res.accounts : []);
        setTotalUsage(res.totalUsage || 0);
        setTotalLimit(res.totalLimit || 0);
      }
    } catch (err) {
      console.error("Failed to load storage", err);
    }
  }, []);

  const loadFiles = useCallback(async (parentId = "root", accountEmail = null) => {
    setLoadingFiles(true);
    try {
      const res = await getFiles(parentId, accountEmail);
      if (res && res.items) {
        setFiles(res.items);
      }
    } catch (err) {
      console.error("Failed to fetch files", err);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  const refreshFiles = useCallback(() => {
    loadFiles(currentFolder.id, currentFolder.accountEmail);
    loadStorage();
  }, [currentFolder, loadFiles, loadStorage]);

  const navigateToFolder = useCallback((folderInfo) => {
    setCrumbs(prev => [...prev, folderInfo]);
    loadFiles(folderInfo.id, folderInfo.accountEmail);
  }, [loadFiles]);

  const navigateToCrumb = useCallback((index) => {
    const nextCrumbs = crumbs.slice(0, index + 1);
    setCrumbs(nextCrumbs);
    const target = nextCrumbs[nextCrumbs.length - 1];
    loadFiles(target.id, target.accountEmail);
  }, [crumbs, loadFiles]);

  const handleSearch = useCallback(async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      refreshFiles();
      return;
    }
    setLoadingFiles(true);
    try {
      const res = await searchFiles(searchQuery, selectedAccountEmail);
      if (res && res.results) {
        setFiles(res.results);
      }
    } catch (err) {
      console.error("Search failed", err);
    } finally {
      setLoadingFiles(false);
    }
  }, [searchQuery, selectedAccountEmail, refreshFiles]);

  const value = {
    accounts,
    setAccounts,
    totalUsage,
    totalLimit,
    crumbs,
    currentFolder,
    files,
    loadingFiles,
    searchQuery,
    setSearchQuery,
    loadStorage,
    loadFiles,
    refreshFiles,
    navigateToFolder,
    navigateToCrumb,
    handleSearch,
    selectedAccountEmail,
    selectAccount
  };

  return (
    <DriveContext.Provider value={value}>
      {children}
    </DriveContext.Provider>
  );
}

export function useDrive() {
  const context = useContext(DriveContext);
  if (!context) {
    throw new Error("useDrive must be used within a DriveProvider");
  }
  return context;
}
