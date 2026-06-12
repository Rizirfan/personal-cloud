import { doc, getDoc, setDoc } from "firebase/firestore"
import { db, isFirebaseConfigured } from "./firebase"

const LOCAL_KEY = "multidrive_drive_accounts"

export function mergeAccounts(...lists) {
  const map = new Map()
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const account of list) {
      if (!account?.provider || !account?.email) continue
      const key = `${account.provider}::${account.email}`
      map.set(key, account)
    }
  }
  return [...map.values()]
}

async function loadFromServer(user) {
  if (!user?.getIdToken) return null
  try {
    const token = await user.getIdToken()
    const res = await fetch("/firebase/session", {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "include"
    })
    if (!res.ok) return null
    const data = await res.json()
    return Array.isArray(data?.accounts) ? data.accounts : []
  } catch {
    return null
  }
}

async function saveToServer(user, accounts) {
  if (!user?.getIdToken) return false
  try {
    const token = await user.getIdToken()
    const res = await fetch("/firebase/session", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify({ accounts })
    })
    return res.ok
  } catch {
    return false
  }
}

export async function loadStoredAccounts(user) {
  const userId = typeof user === "string" ? user : user?.uid

  const fromServer = await loadFromServer(user)
  if (fromServer !== null) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ accounts: fromServer, updatedAt: Date.now() }))
    return fromServer
  }

  if (isFirebaseConfigured && userId && userId !== "local") {
    try {
      const snap = await Promise.race([
        getDoc(doc(db, "users", userId, "session", "data")),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000))
      ])
      if (snap.exists()) {
        const accounts = Array.isArray(snap.data()?.accounts) ? snap.data().accounts : []
        localStorage.setItem(LOCAL_KEY, JSON.stringify({ accounts, updatedAt: Date.now() }))
        return accounts
      }
    } catch {
      /* fall through to localStorage */
    }
  }

  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.accounts) ? parsed.accounts : []
  } catch {
    return []
  }
}

export async function saveStoredAccounts(user, accounts) {
  const userId = typeof user === "string" ? user : user?.uid
  const payload = {
    accounts: Array.isArray(accounts) ? accounts : [],
    updatedAt: Date.now()
  }

  await saveToServer(user, payload.accounts)

  if (isFirebaseConfigured && userId && userId !== "local") {
    try {
      await Promise.race([
        setDoc(doc(db, "users", userId, "session", "data"), payload),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000))
      ])
    } catch {
      /* server or localStorage still used */
    }
  }

  localStorage.setItem(LOCAL_KEY, JSON.stringify(payload))
}

export function clearStoredAccounts() {
  localStorage.removeItem(LOCAL_KEY)
}
