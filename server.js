const express = require("express")
const axios = require("axios")
const cors = require("cors")
const path = require("path")
const fs = require("fs")
const multer = require("multer")
const busboy = require("busboy")
const crypto = require("crypto")
const {
  isFirebaseAdminConfigured,
  verifyFirebaseToken,
  loadFirestoreSession,
  saveFirestoreSession
} = require("./firebaseAdmin")
const { encryptText, decryptText } = require("./server/services/encryptionService")
require("dotenv").config()

const app = express()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
})

app.use(cors({
  origin: true,
  credentials: true
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(async (req, res, next) => {
  try {
    await getOrCreateSession(req, res)
    res.on("finish", () => {
      if (typeof req.saveUserSession === "function") {
        req.saveUserSession().catch(() => { })
      }
    })
    next()
  } catch (err) {
    next(err)
  }
})

app.use((req, res, next) => {
  if (req.path === "/upload-item-stream" || req.path === "/upload-item") {
    req.setTimeout(2 * 60 * 60 * 1000)
    res.setTimeout(2 * 60 * 60 * 1000)
  }
  next()
})
const clientDist = path.join(__dirname, "dist")

if (fs.existsSync(path.join(__dirname, "images"))) {
  app.use("/images", express.static(path.join(__dirname, "images")))
}

const CLIENT_ID = process.env.CLIENT_ID
const CLIENT_SECRET = process.env.CLIENT_SECRET
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "https://multi-drives.vercel.app/auth/google/callback"
const GOOGLE_OAUTH_SCOPE = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive"].join(" ")

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_PROFILE_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"
const DRIVE_DRIVES_URL = "https://www.googleapis.com/drive/v3/drives"
const DRIVE_ABOUT_URL = "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName,photoLink),storageQuota"
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"
const FOLDER_MIME = "application/vnd.google-apps.folder"
const DRIVE_FILES_FIELDS = "nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, iconLink, thumbnailLink, parents, driveId)"

const uploadProgress = new Map()
const sessions = new Map()
const SESSION_COOKIE_NAME = "md_sid"
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_CLEANUP_MS = 60 * 60 * 1000
const UPSTASH_REDIS_REST_URL = String(process.env.UPSTASH_REDIS_REST_URL || "").trim()
const UPSTASH_REDIS_REST_TOKEN = String(process.env.UPSTASH_REDIS_REST_TOKEN || "").trim()
const HAS_UPSTASH = !!(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN)
const SESSION_KEY_PREFIX = "multidrive:sess:"

function parseCookies(header) {
  const out = {}
  const raw = String(header || "")
  if (!raw) return out
  raw.split(";").forEach((part) => {
    const i = part.indexOf("=")
    if (i <= 0) return
    const key = part.slice(0, i).trim()
    const val = part.slice(i + 1).trim()
    if (!key) return
    out[key] = decodeURIComponent(val)
  })
  return out
}

function makeSessionId() {
  return crypto.randomBytes(24).toString("base64url")
}

function createEmptySession(sid) {
  return {
    id: sid,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    accounts: [],
    oauthStates: {}
  }
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase()
}

function sanitizeAccountForStore(account) {
  if (!account || typeof account !== "object") return null
  const base = {
    provider: "google",
    email: normalizeEmail(account.email)
  }
  if (!base.email) return null
  return {
    ...base,
    token: typeof account.token === "string" ? account.token : "",
    refreshToken: typeof account.refreshToken === "string" ? account.refreshToken : "",
    clientId: typeof account.clientId === "string" ? account.clientId : "",
    clientSecret: typeof account.clientSecret === "string" ? account.clientSecret : "",
    expiresAt: typeof account.expiresAt === "number" ? account.expiresAt : 0
  }
}

function sanitizeSessionForStore(session) {
  const source = session || {}
  const oauthStates = source.oauthStates && typeof source.oauthStates === "object" ? source.oauthStates : {}
  const nextOauthStates = {}
  for (const key of Object.keys(oauthStates)) {
    const item = oauthStates[key]
    if (!item || typeof item !== "object") continue
    const clientId = String(item.clientId || "").trim()
    const clientSecret = String(item.clientSecret || "").trim()
    const redirectUri = String(item.redirectUri || "").trim()
    const createdAt = Number(item.createdAt || 0)
    if (!clientId || !clientSecret || !redirectUri || !createdAt) continue
    nextOauthStates[key] = { clientId, clientSecret, redirectUri, createdAt }
  }

  const safeAccounts = (Array.isArray(source.accounts) ? source.accounts : [])
    .map(acc => {
      const safe = sanitizeAccountForStore(acc)
      if (!safe) return null
      return {
        ...safe,
        clientSecret: encryptText(safe.clientSecret),
        refreshToken: encryptText(safe.refreshToken)
      }
    })
    .filter(Boolean)

  return {
    id: String(source.id || ""),
    createdAt: Number(source.createdAt || Date.now()),
    lastSeenAt: Number(source.lastSeenAt || Date.now()),
    accounts: safeAccounts,
    oauthStates: nextOauthStates
  }
}

async function redisSetJson(key, value, ttlSec) {
  const url = `${UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}`
  await axios.post(url, value, {
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json"
    },
    params: { EX: String(ttlSec) }
  })
}

async function redisGetJson(key) {
  const url = `${UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` }
  })
  const value = response?.data?.result
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch (e) {
    return null
  }
}

async function loadSessionById(sid) {
  if (!sid) return null
  let payload = null;
  if (!HAS_UPSTASH) {
    payload = sessions.get(sid) || null;
  } else {
    payload = await redisGetJson(SESSION_KEY_PREFIX + sid);
  }
  if (!payload || typeof payload !== "object") return null
  
  const session = sanitizeSessionForStore(payload)
  
  // Decrypt the secrets for in-memory use
  session.accounts = session.accounts.map(acc => ({
    ...acc,
    clientSecret: decryptText(acc.clientSecret),
    refreshToken: decryptText(acc.refreshToken)
  }))
  
  return session
}

async function saveSession(session) {
  if (!session || !session.id) return
  const safe = sanitizeSessionForStore(session)
  if (!HAS_UPSTASH) {
    sessions.set(safe.id, safe)
    return
  }
  await redisSetJson(SESSION_KEY_PREFIX + safe.id, safe, Math.floor(SESSION_TTL_MS / 1000))
}

async function getOrCreateSession(req, res) {
  const cookies = parseCookies(req.headers?.cookie)
  let sid = String(cookies[SESSION_COOKIE_NAME] || "").trim()
  let session = sid ? await loadSessionById(sid) : null

  if (!session) {
    sid = makeSessionId()
    session = createEmptySession(sid)
    const cookieParts = [
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(sid)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
    ]
    if ((req.headers["x-forwarded-proto"] || req.protocol) === "https") {
      cookieParts.push("Secure")
    }
    res.setHeader("Set-Cookie", cookieParts.join("; "))
  }
  session.lastSeenAt = Date.now()

  req.sessionId = sid
  req.userSession = session
  req.saveUserSession = async () => {
    req.userSession.lastSeenAt = Date.now()
    await saveSession(req.userSession)
  }
}

function cleanupSessions() {
  if (HAS_UPSTASH) return
  const now = Date.now()
  for (const [sid, session] of sessions.entries()) {
    if (!session || now - Number(session.lastSeenAt || 0) > SESSION_TTL_MS) {
      sessions.delete(sid)
    }
  }
}

setInterval(cleanupSessions, SESSION_CLEANUP_MS).unref()

function getAccountByEmail(session, email) {
  if (!session) return null
  const target = normalizeEmail(email)
  const accounts = Array.isArray(session.accounts) ? session.accounts : []
  return accounts.find((account) => normalizeEmail(account.email) === target)
}

function upsertAccount(session, account) {
  if (!session) return
  const current = Array.isArray(session.accounts) ? session.accounts : []
  const existing = current.find((item) => normalizeEmail(item.email) === normalizeEmail(account.email))
  
  const updatedAccount = {
    ...account,
    refreshToken: account.refreshToken || existing?.refreshToken || "",
    clientId: account.clientId || existing?.clientId || "",
    clientSecret: account.clientSecret || existing?.clientSecret || "",
    expiresAt: account.expiresAt !== undefined ? account.expiresAt : (existing?.expiresAt || 0)
  }
  
  session.accounts = current.filter((item) => normalizeEmail(item.email) !== normalizeEmail(account.email))
  session.accounts.push(updatedAccount)
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` }
}

async function getFreshAccessToken(account, req) {
  if (!account) return null

  // If there's no expiration or it has expired (or is close to expiring in 5 minutes)
  const isExpired = !account.expiresAt || Date.now() >= (account.expiresAt - 5 * 60 * 1000)
  
  if (isExpired && account.refreshToken && account.clientId && account.clientSecret) {
    try {
      console.log(`Refreshing access token for ${account.email}...`)
      const response = await axios.post(GOOGLE_TOKEN_URL, new URLSearchParams({
        client_id: account.clientId,
        client_secret: account.clientSecret,
        refresh_token: account.refreshToken,
        grant_type: "refresh_token"
      }).toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      })
      
      const newAccessToken = response.data.access_token
      const expiresIn = response.data.expires_in || 3600
      
      account.token = newAccessToken
      account.expiresAt = Date.now() + expiresIn * 1000
      
      // Save session explicitly to ensure the new token is written
      if (req && typeof req.saveUserSession === "function") {
        await req.saveUserSession()
      }
    } catch (err) {
      console.error(`Error refreshing token for ${account.email}:`, err.response?.data || err.message)
    }
  }
  
  return account.token
}

async function fetchGoogleAccountInfo(account) {
  const [driveResponse, profileResponse] = await Promise.all([
    axios.get(DRIVE_ABOUT_URL, { headers: authHeaders(account.token) }),
    axios.get(GOOGLE_PROFILE_URL, { headers: authHeaders(account.token) })
  ])

  const driveUser = driveResponse.data.user || {}
  const profile = profileResponse.data || {}
  const email = driveUser.emailAddress || profile.email

  return {
    provider: "google",
    ...driveResponse.data,
    user: {
      ...driveUser,
      emailAddress: email,
      displayName: driveUser.displayName || profile.name || "",
      photoLink: driveUser.photoLink || profile.picture
    }
  }
}

function escapeDriveQueryId(id) {
  return String(id).replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function buildListParams(parentId, q, pageToken) {
  const params = {
    q,
    pageSize: 1000,
    fields: DRIVE_FILES_FIELDS,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "user"
  }
  params.orderBy = "folder,name_natural"
  if (pageToken) params.pageToken = pageToken
  return params
}

async function listChildrenInFolder(accessToken, parentId) {
  const escaped = parentId === "root" ? "root" : escapeDriveQueryId(parentId)
  const q = `'${escaped}' in parents and trashed=false`

  const all = []
  let pageToken = null

  do {
    const params = buildListParams(parentId, q, pageToken)
    const response = await axios.get(DRIVE_FILES_URL, {
      headers: authHeaders(accessToken),
      params
    })
    all.push(...(response.data.files || []))
    pageToken = response.data.nextPageToken || null
  } while (pageToken)

  return all
}

app.post("/auth/google/start", async (req, res) => {
  const { clientId, clientSecret, redirectUri: reqRedirectUri } = req.body
  const actualClientId = (clientId || CLIENT_ID || "").trim()
  const actualClientSecret = (clientSecret || CLIENT_SECRET || "").trim()

  if (!actualClientId || !actualClientSecret) {
    return res.status(400).json({ error: "Missing Google OAuth credentials" })
  }

  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http"
  const host = req.headers["x-forwarded-host"] || req.get("host")
  const redirectUri = reqRedirectUri || REDIRECT_URI || `${proto}://${host}/auth/google/callback`

  const stateToken = "g_" + Date.now() + "_" + Math.random().toString(36).slice(2)
  req.userSession.oauthStates = req.userSession.oauthStates || {}
  req.userSession.oauthStates[stateToken] = {
    clientId: actualClientId,
    clientSecret: actualClientSecret,
    redirectUri,
    createdAt: Date.now()
  }

  const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: actualClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: stateToken
  }).toString()

  res.json({ url: authUrl })
})

app.get("/auth/google/callback", async (req, res) => {
  const { code, state, error } = req.query
  if (error || !code || !state) return res.redirect("/?error=auth_failed")

  const oauthState = req.userSession?.oauthStates?.[state]
  if (!oauthState) return res.redirect("/?error=invalid_state")

  try {
    const tokenResponse = await axios.post(GOOGLE_TOKEN_URL, new URLSearchParams({
      client_id: oauthState.clientId,
      client_secret: oauthState.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: oauthState.redirectUri
    }).toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    })

    const accessToken = tokenResponse.data.access_token
    const refreshToken = tokenResponse.data.refresh_token || ""
    const expiresIn = tokenResponse.data.expires_in || 3600
    const infoResponse = await axios.get(GOOGLE_PROFILE_URL, { headers: authHeaders(accessToken) })
    const email = infoResponse.data.email

    upsertAccount(req.userSession, {
      provider: "google",
      email,
      token: accessToken,
      refreshToken: refreshToken,
      clientId: oauthState.clientId,
      clientSecret: oauthState.clientSecret,
      expiresAt: Date.now() + expiresIn * 1000
    })
    delete req.userSession.oauthStates[state]
    res.redirect("/")
  } catch (err) {
    console.error(err)
    res.redirect("/?error=token_failed")
  }
})

app.get("/storage", async (req, res) => {
  const accounts = Array.isArray(req.userSession?.accounts) ? req.userSession.accounts : []
  let totalUsage = 0
  let totalLimit = 0
  const accountStats = []

  await Promise.all(accounts.map(async (acc) => {
    try {
      await getFreshAccessToken(acc, req)
      const info = await fetchGoogleAccountInfo(acc)
      const usage = Number(info.storageQuota?.usage || 0)
      const limit = Number(info.storageQuota?.limit || 0)
      totalUsage += usage
      totalLimit += limit
      accountStats.push({ email: acc.email, usage, limit, error: null, info })
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message
      accountStats.push({ email: acc.email, usage: 0, limit: 0, error: msg, info: null })
    }
  }))

  res.json({ totalUsage, totalLimit, accounts: accountStats })
})

app.post("/logout", (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: "Missing email" })
  
  const current = Array.isArray(req.userSession.accounts) ? req.userSession.accounts : []
  req.userSession.accounts = current.filter(a => normalizeEmail(a.email) !== normalizeEmail(email))
  res.json({ success: true })
})

app.get("/files", async (req, res) => {
  const parentId = req.query.parentId || "root"
  const accountEmail = req.query.accountEmail
  const accounts = Array.isArray(req.userSession?.accounts) ? req.userSession.accounts : []
  
  try {
    let allFiles = []
    
    if (parentId === "root" && !accountEmail) {
      // Combined View: Fetch from all accounts
      await Promise.all(accounts.map(async (acc) => {
        try {
          const token = await getFreshAccessToken(acc, req)
          const files = await listChildrenInFolder(token, "root")
          const mapped = files.map(f => ({ ...f, accountEmail: acc.email, provider: "google" }))
          allFiles.push(...mapped)
        } catch (e) {
          console.error(`Failed to fetch root for ${acc.email}`, e.message)
        }
      }))
    } else {
      // Fetch from specific account
      if (!accountEmail) return res.status(400).json({ error: "accountEmail is required when navigating into a folder or specific account" })
      const acc = getAccountByEmail(req.userSession, accountEmail)
      if (!acc) return res.status(404).json({ error: "Account not found" })
      
      const token = await getFreshAccessToken(acc, req)
      const files = await listChildrenInFolder(token, parentId)
      allFiles = files.map(f => ({ ...f, accountEmail: acc.email, provider: "google" }))
    }
    
    res.json({ items: allFiles })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post("/create-folder", async (req, res) => {
  const { parentId, name, accountEmail } = req.body
  if (!name) return res.status(400).json({ error: "Folder name required" })
  
  let targetAccount = null
  const accounts = Array.isArray(req.userSession?.accounts) ? req.userSession.accounts : []
  
  if ((parentId === "root" || !parentId) && !accountEmail) {
    let bestAcc = null
    let maxFree = -1
    
    await Promise.all(accounts.map(async (acc) => {
      try {
        await getFreshAccessToken(acc, req)
        const info = await fetchGoogleAccountInfo(acc)
        const free = Number(info.storageQuota?.limit || 0) - Number(info.storageQuota?.usage || 0)
        if (free > maxFree) {
          maxFree = free
          bestAcc = acc
        }
      } catch (e) {}
    }))
    
    targetAccount = bestAcc
  } else {
    targetAccount = getAccountByEmail(req.userSession, accountEmail)
  }
  
  if (!targetAccount) return res.status(400).json({ error: "Could not determine target account" })
  
  try {
    const token = await getFreshAccessToken(targetAccount, req)
    const response = await axios.post(DRIVE_FILES_URL, {
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId || "root"]
    }, {
      headers: authHeaders(token),
      params: { supportsAllDrives: true }
    })
    res.json(response.data)
  } catch (err) {
    const status = err.response?.status || 500
    const msg = err.response?.data?.error?.message || err.message
    res.status(status).json({ error: msg })
  }
})

app.post("/upload-item", upload.single("file"), async (req, res) => {
  const file = req.file
  const parentId = req.body.parentId || "root"
  const accountEmail = req.body.accountEmail
  
  if (!file) return res.status(400).json({ error: "No file uploaded" })
  
  let targetAccount = null
  const accounts = Array.isArray(req.userSession?.accounts) ? req.userSession.accounts : []
  
  if (parentId === "root" && !accountEmail) {
    let bestAcc = null
    let maxFree = -1
    await Promise.all(accounts.map(async (acc) => {
      try {
        await getFreshAccessToken(acc, req)
        const info = await fetchGoogleAccountInfo(acc)
        const free = Number(info.storageQuota?.limit || 0) - Number(info.storageQuota?.usage || 0)
        if (free > maxFree) {
          maxFree = free
          bestAcc = acc
        }
      } catch (e) {}
    }))
    targetAccount = bestAcc
  } else {
    targetAccount = getAccountByEmail(req.userSession, accountEmail)
  }
  
  if (!targetAccount) return res.status(400).json({ error: "Could not determine target account" })
  
  try {
    const token = await getFreshAccessToken(targetAccount, req)
    const metadata = { name: file.originalname, parents: [parentId] }
    const boundary = "-------314159265358979323846"
    const delimiter = "\r\n--" + boundary + "\r\n"
    const close_delim = "\r\n--" + boundary + "--"

    const metadataPart = "Content-Type: application/json\r\n\r\n" + JSON.stringify(metadata)
    const mediaPart = "Content-Type: " + (file.mimetype || "application/octet-stream") + "\r\n\r\n"

    const bodyBuffer = Buffer.concat([
      Buffer.from("--" + boundary + "\r\n" + metadataPart + "\r\n--" + boundary + "\r\n" + mediaPart, "utf-8"),
      file.buffer,
      Buffer.from(close_delim, "utf-8")
    ])

    const response = await axios.post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true", bodyBuffer, {
      headers: {
        ...authHeaders(token),
        "Content-Type": `multipart/related; boundary=${boundary}`
      }
    })
    
    res.json(response.data)
  } catch (err) {
    const status = err.response?.status || 500
    const msg = err.response?.data?.error?.message || err.message
    res.status(status).json({ error: msg })
  }
})

app.post("/delete-item", async (req, res) => {
  const { id, accountEmail } = req.body
  if (!id || !accountEmail) return res.status(400).json({ error: "id and accountEmail required" })
  
  const acc = getAccountByEmail(req.userSession, accountEmail)
  if (!acc) return res.status(404).json({ error: "Account not found" })
  
  try {
    const token = await getFreshAccessToken(acc, req)
    await axios.delete(`${DRIVE_FILES_URL}/${encodeURIComponent(id)}`, {
      headers: authHeaders(token),
      params: { supportsAllDrives: true }
    })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get("/search", async (req, res) => {
  const q = req.query.q
  if (!q) return res.json({ results: [] })
  
  const accountEmail = req.query.accountEmail
  const accounts = Array.isArray(req.userSession?.accounts) ? req.userSession.accounts : []
  const allResults = []
  
  const escaped = escapeDriveQueryId(q)
  const queryStr = `name contains '${escaped}' and trashed=false`
  
  let targetAccounts = accounts
  if (accountEmail) {
    targetAccounts = accounts.filter(acc => normalizeEmail(acc.email) === normalizeEmail(accountEmail))
  }
  
  await Promise.all(targetAccounts.map(async (acc) => {
    try {
      const token = await getFreshAccessToken(acc, req)
      const response = await axios.get(DRIVE_FILES_URL, {
        headers: authHeaders(token),
        params: {
          q: queryStr,
          pageSize: 100,
          fields: DRIVE_FILES_FIELDS,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          corpora: "user"
        }
      })
      const mapped = (response.data.files || []).map(f => ({ ...f, accountEmail: acc.email, provider: "google" }))
      allResults.push(...mapped)
    } catch (e) {
      console.error(e.message)
    }
  }))
  
  res.json({ results: allResults })
})

app.get("/open-file", async (req, res) => {
  const { id, accountEmail } = req.query
  if (!id || !accountEmail) return res.status(400).send("Missing id or accountEmail")
  
  const acc = getAccountByEmail(req.userSession, accountEmail)
  if (!acc) return res.status(404).send("Account not found")
  
  try {
    const token = await getFreshAccessToken(acc, req)
    const response = await axios.get(`${DRIVE_FILES_URL}/${encodeURIComponent(id)}`, {
      headers: authHeaders(token),
      params: { fields: "webViewLink", supportsAllDrives: true }
    })
    if (response.data.webViewLink) {
      res.redirect(response.data.webViewLink)
    } else {
      res.status(404).send("Link not available")
    }
  } catch (err) {
    res.status(500).send(err.message)
  }
})

// Firebase endpoints
app.get("/firebase/session", async (req, res) => {
  const userRecord = await verifyFirebaseToken(req)
  if (!userRecord) return res.status(401).json({ error: "Unauthorized" })

  const firestoreAccounts = await loadFirestoreSession(userRecord.uid)
  res.json({ accounts: firestoreAccounts })
})

app.post("/firebase/session", async (req, res) => {
  const userRecord = await verifyFirebaseToken(req)
  if (!userRecord) return res.status(401).json({ error: "Unauthorized" })

  const accounts = Array.isArray(req.body?.accounts) ? req.body.accounts : []
  const safeAccounts = accounts.map(sanitizeAccountForStore).filter(Boolean)

  await saveFirestoreSession(userRecord.uid, safeAccounts)
  res.json({ success: true })
})

app.get("/session/export", (req, res) => {
  const list = Array.isArray(req.userSession?.accounts) ? req.userSession.accounts : []
  const safeList = list.map(sanitizeAccountForStore).filter(Boolean)
  res.json({ accounts: safeList })
})

app.post("/session/restore", async (req, res) => {
  const accounts = Array.isArray(req.body?.accounts) ? req.body.accounts : []
  const safeAccounts = accounts.map(sanitizeAccountForStore).filter(Boolean)
  
  req.userSession.accounts = safeAccounts
  await req.saveUserSession()
  res.json({ success: true })
})

app.use(express.static(clientDist))
app.use((req, res, next) => {
  if (req.method !== 'GET') return next()
  if (fs.existsSync(path.join(clientDist, "index.html"))) {
    res.sendFile(path.join(clientDist, "index.html"))
  } else {
    res.status(404).send("Client not built. Run npm run build")
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}/`))
