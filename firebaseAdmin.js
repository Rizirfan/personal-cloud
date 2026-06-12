const { initializeApp, getApps, cert } = require("firebase-admin/app")
const { getAuth } = require("firebase-admin/auth")
const { getFirestore } = require("firebase-admin/firestore")

let initialized = false

function parsePrivateKey(raw) {
  if (!raw) return ""
  return String(raw).trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n")
}

function initFirebaseAdmin() {
  if (initialized && getApps().length) return true

  const projectId = String(process.env.FIREBASE_PROJECT_ID || "").trim()
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim()
  const privateKey = parsePrivateKey(process.env.FIREBASE_PRIVATE_KEY)

  if (!projectId || !clientEmail || !privateKey) return false

  try {
    if (!getApps().length) {
      initializeApp({
        credential: cert({ projectId, clientEmail, privateKey })
      })
    }
    initialized = true
    return true
  } catch (err) {
    console.error("Firebase Admin init failed:", err.message)
    return false
  }
}

function isFirebaseAdminConfigured() {
  return initFirebaseAdmin()
}

async function verifyFirebaseToken(req) {
  if (!initFirebaseAdmin()) return null

  const header = String(req.headers.authorization || "")
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : ""
  if (!token) return null

  try {
    return await getAuth().verifyIdToken(token)
  } catch {
    return null
  }
}

const { encryptText, decryptText } = require("./server/services/encryptionService")

async function loadFirestoreSession(uid) {
  if (!initFirebaseAdmin() || !uid) return []

  const snap = await getFirestore().doc(`users/${uid}/session/data`).get()
  if (!snap.exists) return []
  const accounts = snap.data()?.accounts
  const arr = Array.isArray(accounts) ? accounts : []
  
  return arr.map(acc => ({
    ...acc,
    clientSecret: decryptText(acc.clientSecret),
    refreshToken: decryptText(acc.refreshToken)
  }))
}

async function saveFirestoreSession(uid, accounts) {
  if (!initFirebaseAdmin() || !uid) return false

  const arr = Array.isArray(accounts) ? accounts : []
  const safeAccounts = arr.map(acc => ({
    ...acc,
    clientSecret: encryptText(acc.clientSecret),
    refreshToken: encryptText(acc.refreshToken)
  }))

  await getFirestore().doc(`users/${uid}/session/data`).set({
    accounts: safeAccounts,
    updatedAt: Date.now()
  })
  return true
}

module.exports = {
  isFirebaseAdminConfigured,
  verifyFirebaseToken,
  loadFirestoreSession,
  saveFirestoreSession
}
