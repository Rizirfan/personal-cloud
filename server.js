const express = require("express")
const axios = require("axios")
const cors = require("cors")
const path = require("path")
const multer = require("multer")
const busboy = require("busboy")
const mega = require("megajs")
const crypto = require("crypto")
require("dotenv").config()

const app = express()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
})

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use((req, res, next) => {
  getOrCreateSession(req, res)
  next()
})

app.use((req, res, next) => {
  if (req.path === "/upload-item-stream" || req.path === "/upload-item") {
    req.setTimeout(2 * 60 * 60 * 1000)
    res.setTimeout(2 * 60 * 60 * 1000)
  }
  next()
})
app.use(express.static(path.join(__dirname, "public")))
app.use("/images", express.static(path.join(__dirname, "images")))
//this is credenstial value you can set via .env file or enviroment varialable
const CLIENT_ID = process.env.CLIENT_ID
const CLIENT_SECRET = process.env.CLIENT_SECRET
//this is redirect uri change this if you are self deploying
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "https://multi-drives.vercel.app/auth/google/callback"
const MEGA_SESSION_TOKEN = process.env.MEGA_SESSION_TOKEN || ""
const MEGA_ACCOUNT_EMAIL = process.env.MEGA_ACCOUNT_EMAIL || ""
const GOOGLE_OAUTH_SCOPE = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive"].join(" ")

//all the Google Drive API endpoints we will be using
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_PROFILE_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"
const DRIVE_DRIVES_URL = "https://www.googleapis.com/drive/v3/drives"
const DRIVE_ABOUT_URL = "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName,photoLink),storageQuota"
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"
const FOLDER_MIME = "application/vnd.google-apps.folder"
const DRIVE_FILES_FIELDS = "nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, iconLink, thumbnailLink, parents, driveId)"


let megaStorage = null
const uploadProgress = new Map()
const sessions = new Map()
const SESSION_COOKIE_NAME = "md_sid"
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_CLEANUP_MS = 60 * 60 * 1000

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

function getOrCreateSession(req, res) {
  const cookies = parseCookies(req.headers?.cookie)
  let sid = String(cookies[SESSION_COOKIE_NAME] || "").trim()
  let session = sid ? sessions.get(sid) : null

  if (!session) {
    sid = makeSessionId()
    session = {
      id: sid,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      accounts: [],
      oauthStates: new Map()
    }
    sessions.set(sid, session)
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
  } else {
    session.lastSeenAt = Date.now()
  }

  req.sessionId = sid
  req.userSession = session
}

function cleanupSessions() {
  const now = Date.now()
  for (const [sid, session] of sessions.entries()) {
    if (!session || now - Number(session.lastSeenAt || 0) > SESSION_TTL_MS) {
      sessions.delete(sid)
    }
  }
}

setInterval(cleanupSessions, SESSION_CLEANUP_MS).unref()

function setUploadProgress(id, patch) {
  if (!id) return
  const now = Date.now()
  const prev = uploadProgress.get(id) || {}
  const next = {
    ...prev,
    ...patch,
    updatedAt: now
  }

  if (!next.startedAt) {
    next.startedAt = now
  }

  const uploaded = Number(next.bytesUploaded || 0)
  const total = Number(next.bytesTotal || 0)
  const elapsedSec = Math.max(0.001, (now - Number(next.startedAt || now)) / 1000)
  const avgBps = uploaded > 0 ? (uploaded / elapsedSec) : 0
  next.avgBps = Number.isFinite(avgBps) ? avgBps : 0
  next.etaSec = avgBps > 0 && total > uploaded ? Math.ceil((total - uploaded) / avgBps) : 0

  uploadProgress.set(id, {
    ...next
  })
}

function cleanupUploadProgress(id, delayMs = 5 * 60 * 1000) {
  if (!id) return
  setTimeout(() => {
    uploadProgress.delete(id)
  }, delayMs)
}


function normalizeProvider(value) {
  return String(value || "").trim().toLowerCase()
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase()
}

function makeAccountKey(provider, email) {
  return normalizeProvider(provider) + "::" + normalizeEmail(email)
}
// Upsert account by provider and email

function upsertAccount(session, account) {
  if (!session) return
  const key = makeAccountKey(account.provider, account.email)
  const current = Array.isArray(session.accounts) ? session.accounts : []
  session.accounts = current.filter((item) => makeAccountKey(item.provider, item.email) !== key)
  session.accounts.push(account)
}

function parseMegaSessionToken(raw) {
  if (!raw || typeof raw !== "string") return null

  const text = raw.trim()
  if (!text) return null

  const attempts = [text]
  try {
    attempts.push(Buffer.from(text, "base64").toString("utf8"))
  } catch (e) { }

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === "object" && parsed.sid && parsed.key) {
        return parsed
      }
    } catch (e) { }
  }

  return null
}

function buildMegaEmail(storage) {
  if (typeof MEGA_ACCOUNT_EMAIL === "string" && MEGA_ACCOUNT_EMAIL.trim()) {
    return MEGA_ACCOUNT_EMAIL.trim()
  }
  if (storage && storage.options && typeof storage.options.email === "string" && storage.options.email.trim()) {
    return storage.options.email.trim()
  }
  if (storage && typeof storage.user === "string" && storage.user.trim()) {
    return "mega:" + storage.user.trim()
  }
  return "mega-account"
}

function getFirstNameFromEmail(email) {
  const raw = normalizeEmail(email)
  if (!raw || !raw.includes("@")) return ""

  const local = raw.split("@")[0].replace(/[._+\-]+/g, " ").trim()
  if (!local) return ""

  const token = local.split(/\s+/).find(Boolean) || ""
  if (!token) return ""

  return token.charAt(0).toUpperCase() + token.slice(1)
}

function getFirstNameFromDisplayName(name) {
  const raw = String(name || "").trim()
  if (!raw) return ""

  const first = raw.split(/\s+/).find(Boolean) || ""
  const normalized = first.toLowerCase()
  if (normalized === "mega" || normalized === "google" || normalized === "drive") {
    return ""
  }
  return first
}

function normalizeMegaNode(node, parentId) {
  const isFolder = !!node.directory
  const timestampMs = Number.isFinite(node.timestamp) ? Number(node.timestamp) * 1000 : null
  return {
    id: String(node.nodeId || ""),
    name: node.name || "(unnamed)",
    mimeType: isFolder ? FOLDER_MIME : "application/octet-stream",
    size: isFolder ? null : Number(node.size || 0),
    modifiedTime: timestampMs ? new Date(timestampMs).toISOString() : null,
    webViewLink: null,
    iconLink: null,
    thumbnailLink: null,
    parents: parentId ? [parentId] : [],
    driveId: null
  }
}

function getBodyTrimmed(req, key) {
  const value = req.body?.[key]
  return typeof value === "string" ? value.trim() : ""
}

function getBodyRaw(req, key) {
  const value = req.body?.[key]
  return typeof value === "string" ? value : ""
}

function getQueryTrimmed(req, key) {
  const value = req.query?.[key]
  return typeof value === "string" ? value.trim() : ""
}

function resolveRedirectUri(req) {
  if (REDIRECT_URI) return REDIRECT_URI
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http"
  const host = req.headers["x-forwarded-host"] || req.get("host")
  return `${proto}://${host}/auth/google/callback`
}

function makeOAuthStateToken() {
  return "g_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10)
}

function cleanupOAuthStates(session) {
  if (!session || !session.oauthStates) return
  const now = Date.now()
  for (const [key, value] of session.oauthStates.entries()) {
    if (!value || now - Number(value.createdAt || 0) > 15 * 60 * 1000) {
      session.oauthStates.delete(key)
    }
  }
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` }
}

function logError(err) {
  console.log(err.response?.data || err.message)
}

function sendErrorJson(res, err, fallbackMessage) {
  logError(err)
  const status = err.response?.status || 500
  const message = err.response?.data?.error?.message || fallbackMessage
  res.status(status).json({ error: message })
}

function getAccountByEmail(session, email, provider) {
  if (!session) return null
  const target = normalizeEmail(email)
  const targetProvider = normalizeProvider(provider)
  const accounts = Array.isArray(session.accounts) ? session.accounts : []

  return accounts.find((account) => {
    const sameEmail = normalizeEmail(account.email) === target
    if (!sameEmail) return false
    if (!targetProvider) return true
    return normalizeProvider(account.provider) === targetProvider
  })
}

function getMegaNodeById(storage, nodeId) {
  if (!storage || !storage.files || !nodeId) return null
  return storage.files[nodeId] || null
}

async function ensureMegaStorageForAccount(account) {
  if (!account || normalizeProvider(account.provider) !== "mega") {
    throw new Error("Invalid MEGA account")
  }

  const tryReload = async (storage) => {
    if (!storage) return null
    await storage.reload(true)
    storage.status = "ready"
    return storage
  }

  try {
    const live = await tryReload(account.storage)
    if (live) {
      account.storage = live
      return live
    }
  } catch (e) {
    account.storage = null
  }

  const rawSession = account.megaSessionToken
  const parsed = typeof rawSession === "string" ? parseMegaSessionToken(rawSession) : null
  if (parsed) {
    const restored = mega.Storage.fromJSON(parsed)
    await restored.reload(true)
    restored.status = "ready"
    account.storage = restored
    return restored
  }

  if (MEGA_SESSION_TOKEN) {
    const fallback = await getMegaStorage()
    account.storage = fallback
    return fallback
  }

  throw new Error("MEGA session expired. Reconnect the account.")
}

function escapeDriveQueryId(id) {
  return String(id).replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function escapeDriveContains(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

async function getMegaStorage() {
  if (megaStorage) {
    try {
      if (megaStorage.status === "ready") return megaStorage
      await megaStorage.reload(true)
      megaStorage.status = "ready"
      return megaStorage
    } catch (e) {
      megaStorage = null
    }
  }

  const parsed = parseMegaSessionToken(MEGA_SESSION_TOKEN)
  if (!parsed) {
    throw new Error("MEGA_SESSION_TOKEN is missing or invalid. Use JSON from storage.toJSON() or its base64.")
  }

  const storage = mega.Storage.fromJSON(parsed)
  await storage.reload(true)
  storage.status = "ready"
  megaStorage = storage
  return storage
}

async function connectMegaAccount(session) {
  const storage = await getMegaStorage()
  const email = buildMegaEmail(storage)
  const snapshot = storage.toJSON ? storage.toJSON() : null
  upsertAccount(session, {
    provider: "mega",
    email,
    storage,
    megaSessionToken: snapshot ? JSON.stringify(snapshot) : MEGA_SESSION_TOKEN
  })
  return email
}

async function connectMegaAccountWithCredentials(session, { email, password, secondFactorCode }) {
  if (!email || !password) {
    throw new Error("MEGA email and password are required")
  }

  const storage = new mega.Storage({
    email: String(email).trim(),
    password: String(password),
    secondFactorCode: secondFactorCode ? String(secondFactorCode).trim() : undefined,
    autoload: true,
    autologin: true
  })

  await storage.ready
  const accountEmail = normalizeEmail(email)
  const snapshot = storage.toJSON ? storage.toJSON() : null
  upsertAccount(session, {
    provider: "mega",
    email: accountEmail,
    storage,
    megaSessionToken: snapshot ? JSON.stringify(snapshot) : ""
  })
  return accountEmail
}

async function getParentDriveId(accessToken, parentId) {
  if (parentId === "root") return null

  try {
    const response = await axios.get(`${DRIVE_FILES_URL}/${encodeURIComponent(parentId)}`, {
      headers: authHeaders(accessToken),
      params: { fields: "driveId", supportsAllDrives: true }
    })

    const id = response.data.driveId
    return id ? String(id) : null
  } catch (err) {
    logError(err)
    return null
  }
}

function buildListParams(parentId, q, pageToken, driveId, rootMinimal) {
  const params = {
    q,
    pageSize: 1000,
    fields: DRIVE_FILES_FIELDS,
    supportsAllDrives: true
  }

  if (rootMinimal) {
    params.corpora = "user"
    params.includeItemsFromAllDrives = false
  } else {
    params.includeItemsFromAllDrives = true

    if (parentId === "root") {
      params.corpora = "user"
    } else if (driveId) {
      params.corpora = "drive"
      params.driveId = driveId
    } else {
      params.corpora = "user"
    }
  }

  params.orderBy = "folder,name_natural"
  if (pageToken) params.pageToken = pageToken
  return params
}

async function listChildrenInFolder(accessToken, parentId) {
  const escaped = parentId === "root" ? "root" : escapeDriveQueryId(parentId)
  const q = `'${escaped}' in parents and trashed=false`
  const driveId = parentId === "root" ? null : await getParentDriveId(accessToken, parentId)

  async function fetchAllPages(rootMinimal) {
    const all = []
    let pageToken = null

    do {
      const params = buildListParams(parentId, q, pageToken, driveId, rootMinimal)
      const response = await axios.get(DRIVE_FILES_URL, {
        headers: authHeaders(accessToken),
        params
      })
      all.push(...(response.data.files || []))
      pageToken = response.data.nextPageToken || null
    } while (pageToken)

    return all
  }

  try {
    const all = await fetchAllPages(false)
    if (all.length > 0 || parentId !== "root") return all
    return await fetchAllPages(true)
  } catch (err) {
    if (parentId !== "root") throw err
    logError(err)
    return await fetchAllPages(true)
  }
}

async function listSharedDrives(accessToken) {
  const drives = []
  let pageToken = null

  do {
    const params = {
      pageSize: 100,
      fields: "nextPageToken, drives(id, name)"
    }
    if (pageToken) params.pageToken = pageToken

    const response = await axios.get(DRIVE_DRIVES_URL, {
      headers: authHeaders(accessToken),
      params
    })


    drives.push(...(response.data.drives || []))
    pageToken = response.data.nextPageToken || null
  } while (pageToken)

  return drives.map((drive) => ({
    id: drive.id,
    name: drive.name || "Shared drive",
    mimeType: FOLDER_MIME,
    size: null,
    modifiedTime: null,
    webViewLink: null,
    parents: [],
    driveId: drive.id,
    isSharedDriveRoot: true
  }))
}

async function listMegaChildren(storage, parentId) {
  await storage.reload(true)

  const parentNode = parentId === "root" ? storage.root : getMegaNodeById(storage, parentId)
  if (!parentNode || !parentNode.directory) {
    const err = new Error("Destination folder not found")
    err.statusCode = 404
    throw err
  }

  const children = Array.isArray(parentNode.children) ? parentNode.children : []
  return children.map((node) => normalizeMegaNode(node, parentNode.nodeId || "root"))
}

app.get("/auth/google", (req, res) => {
  return res.status(400).send("Use /auth/google/start with custom Google OAuth credentials.")
})

app.post("/auth/google/start", (req, res) => {
  try {
    cleanupOAuthStates(req.userSession)
    const customClientId = getBodyTrimmed(req, "clientId")
    const customClientSecret = getBodyTrimmed(req, "clientSecret")
    if (!customClientId || !customClientSecret) {
      return res.status(400).json({ error: "Both Client ID and Client Secret are required." })
    }
    const clientId = customClientId
    const clientSecret = customClientSecret

    const redirectUri = resolveRedirectUri(req)
    const state = makeOAuthStateToken()
    req.userSession.oauthStates.set(state, {
      clientId,
      clientSecret,
      redirectUri,
      createdAt: Date.now()
    })

    const url =
      `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(GOOGLE_OAUTH_SCOPE)}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`
    return res.json({ url })
  } catch (err) {
    logError(err)
    return res.status(500).json({ error: "Unable to start Google login." })
  }
})

app.get("/auth/mega", (req, res) => {
  res.redirect("/mega-login.html")
})

app.post("/auth/mega/login", async (req, res) => {
  try {
    const email = getBodyTrimmed(req, "email")
    const password = getBodyRaw(req, "password")
    const secondFactorCode = getBodyTrimmed(req, "secondFactorCode")
    await connectMegaAccountWithCredentials(req.userSession, { email, password, secondFactorCode })
    res.redirect("/")
  } catch (err) {
    const msg = err && err.message ? err.message : "Unable to login to MEGA"
    res.redirect("/mega-login.html?error=" + encodeURIComponent(msg))
  }
})

app.post("/auth/mega/login-json", async (req, res) => {
  try {
    const email = getBodyTrimmed(req, "email")
    const password = getBodyRaw(req, "password")
    const secondFactorCode = getBodyTrimmed(req, "secondFactorCode")
    const accountEmail = await connectMegaAccountWithCredentials(req.userSession, { email, password, secondFactorCode })
    return res.json({ success: true, email: accountEmail })
  } catch (err) {
    const msg = err && err.message ? err.message : "Unable to login to MEGA"
    return res.status(400).json({ error: msg })
  }
})

app.post("/auth/mega/token", (req, res) => {
  connectMegaAccount(req.userSession)
    .then(() => {
      res.redirect("/")
    })
    .catch((err) => {
      const msg = encodeURIComponent(err && err.message ? err.message : "Unable to connect MEGA token")
      res.redirect("/mega-login.html?error=" + msg)
    })
})

app.post("/auth/mega/token-json", async (req, res) => {
  try {
    const email = await connectMegaAccount(req.userSession)
    return res.json({ success: true, email })
  } catch (err) {
    const msg = err && err.message ? err.message : "Unable to connect MEGA token"
    return res.status(400).json({ error: msg })
  }
})

app.get("/auth/google/callback", async (req, res) => {
  try {
    const code = req.query.code
    const state = getQueryTrimmed(req, "state")
    cleanupOAuthStates(req.userSession)

    if (!state || !req.userSession.oauthStates.has(state)) {
      return res.status(400).send("OAuth session expired. Start Google sign-in again.")
    }
    const stateData = req.userSession.oauthStates.get(state)
    req.userSession.oauthStates.delete(state)
    const oauthClientId = stateData.clientId
    const oauthClientSecret = stateData.clientSecret
    const oauthRedirectUri = stateData.redirectUri || resolveRedirectUri(req)

    const tokenResponse = await axios.post(GOOGLE_TOKEN_URL, {
      code,
      client_id: oauthClientId,
      client_secret: oauthClientSecret,
      redirect_uri: oauthRedirectUri,
      grant_type: "authorization_code"
    })

    const accessToken = tokenResponse.data.access_token
    const profileResponse = await axios.get(GOOGLE_PROFILE_URL, {
      headers: authHeaders(accessToken)
    })

    upsertAccount(req.userSession, {
      provider: "google",
      email: profileResponse.data.email,
      token: accessToken
    })

    console.log("Google account connected")
    res.redirect("/")
  } catch (err) {
    logError(err)
    res.send("OAuth Error")
  }
})

app.get("/storage", async (req, res) => {
  try {
    const results = []

    const sessionAccounts = Array.isArray(req.userSession.accounts) ? req.userSession.accounts : []
    for (const account of sessionAccounts) {
      if (account.provider === "mega") {
        const storage = await ensureMegaStorageForAccount(account)
        const info = await storage.getAccountInfo()
        const email = account.email || buildMegaEmail(storage)
        const givenName = getFirstNameFromEmail(email)

        results.push({
          provider: "mega",
          user: {
            emailAddress: email,
            displayName: givenName || "MEGA",
            givenName,
            photoLink: ""
          },
          storageQuota: {
            usage: Number(info.spaceUsed || 0),
            limit: Number(info.spaceTotal || 0),
            usageInDrive: Number(info.spaceUsed || 0),
            usageInDriveTrash: 0
          }
        })
        continue
      }

      const [driveResponse, profileResponse] = await Promise.all([
        axios.get(DRIVE_ABOUT_URL, { headers: authHeaders(account.token) }),
        axios.get(GOOGLE_PROFILE_URL, { headers: authHeaders(account.token) })
      ])

      const driveUser = driveResponse.data.user || {}
      const profile = profileResponse.data || {}
      const email = driveUser.emailAddress || profile.email
      const displayName = driveUser.displayName || profile.name || ""

      results.push({
        provider: "google",
        ...driveResponse.data,
        user: {
          ...driveUser,
          emailAddress: email,
          displayName,
          givenName: profile.given_name || getFirstNameFromDisplayName(displayName) || getFirstNameFromEmail(email),
          photoLink: driveUser.photoLink || profile.picture
        }
      })
    }

    res.json(results)
  } catch (err) {
    logError(err)
    res.send("Error fetching storage info")
  }
})

app.post("/logout", (req, res) => {
  const email = req.body?.email
  const provider = normalizeProvider(req.body?.provider)

  if (!email) {
    return res.status(400).json({ error: "Email is required" })
  }

  const sessionAccounts = Array.isArray(req.userSession.accounts) ? req.userSession.accounts : []
  const previousLength = sessionAccounts.length
  req.userSession.accounts = sessionAccounts.filter((account) => {
    const sameEmail = normalizeEmail(account.email) === normalizeEmail(email)
    if (!sameEmail) return true
    if (provider) return normalizeProvider(account.provider) !== provider
    return false
  })

  if (req.userSession.accounts.length === previousLength) {
    return res.status(404).json({ error: "Account not found" })
  }

  res.json({ success: true })
})

app.get("/files", async (req, res) => {
  try {
    const email = getQueryTrimmed(req, "email")
    const provider = getQueryTrimmed(req, "provider")

    if (!email) {
      return res.status(400).json({ error: "Query parameter email is required" })
    }

    const parentId = getQueryTrimmed(req, "parentId") || "root"
    const account = getAccountByEmail(req.userSession, email, provider)
    if (!account) {
      return res.status(404).json({ error: "Account not found" })
    }

    if (account.provider === "mega") {
      const items = await listMegaChildren(await ensureMegaStorageForAccount(account), parentId)
      return res.json({ parentId, items })
    }

    if (parentId === "__shared_drives__") {
      const items = await listSharedDrives(account.token)
      return res.json({ parentId, items })
    }

    const items = await listChildrenInFolder(account.token, parentId)
    res.json({ parentId, items })
  } catch (err) {
    sendErrorJson(res, err, "Error fetching files")
  }
})

app.get("/open-file", async (req, res) => {
  try {
    const email = getQueryTrimmed(req, "email")
    const provider = getQueryTrimmed(req, "provider")
    const fileId = getQueryTrimmed(req, "fileId")

    if (!email || !fileId) {
      return res.status(400).json({ error: "Query parameters email and fileId are required" })
    }

    const account = getAccountByEmail(req.userSession, email, provider)
    if (!account) {
      return res.status(404).json({ error: "Account not found" })
    }

    if (account.provider === "mega") {
      const storage = await ensureMegaStorageForAccount(account)
      await storage.reload(true)
      const node = getMegaNodeById(storage, fileId)
      if (!node) {
        return res.status(404).json({ error: "File not found" })
      }
      if (node.directory) {
        return res.status(400).json({ error: "Cannot open a folder link from this endpoint" })
      }

      const megaUrl = await node.link(false)
      return res.redirect(megaUrl)
    }

    const response = await axios.get(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`, {
      headers: authHeaders(account.token),
      params: {
        fields: "id, webViewLink, webContentLink, mimeType",
        supportsAllDrives: true
      }
    })
    const openUrl = response.data?.webViewLink || response.data?.webContentLink
    if (!openUrl) {
      return res.status(404).json({ error: "No open link available for this file" })
    }
    return res.redirect(openUrl)
  } catch (err) {
    sendErrorJson(res, err, "Error opening file")
  }
})

app.get("/search", async (req, res) => {
  try {
    const query = getQueryTrimmed(req, "q")
    if (!query) {
      return res.status(400).json({ error: "Query parameter q is required" })
    }

    const sessionAccounts = Array.isArray(req.userSession.accounts) ? req.userSession.accounts : []
    if (sessionAccounts.length === 0) {
      return res.json({ query, results: [] })
    }

    const escapedQuery = escapeDriveContains(query)
    const driveQuery = `name contains '${escapedQuery}' and trashed=false`

    const tasks = sessionAccounts.map(async (account) => {
      if (account.provider === "mega") {
        const storage = await ensureMegaStorageForAccount(account)
        await storage.reload(true)
        const needle = query.toLowerCase()

        return (storage.filter(() => true, true) || [])
          .filter((node) => node && node.name && String(node.name).toLowerCase().includes(needle))
          .slice(0, 100)
          .map((node) => ({
            ...normalizeMegaNode(node, node.parent ? node.parent.nodeId : "root"),
            accountEmail: account.email,
            accountProvider: account.provider
          }))
      }

      const response = await axios.get(DRIVE_FILES_URL, {
        headers: authHeaders(account.token),
        params: {
          q: driveQuery,
          pageSize: 100,
          fields: "files(id, name, mimeType, size, modifiedTime, webViewLink, driveId, parents)",
          orderBy: "modifiedTime desc",
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          corpora: "allDrives"
        }
      })

      return (response.data.files || []).map((file) => ({
        ...file,
        accountEmail: account.email,
        accountProvider: account.provider
      }))
    })

    const perAccountResults = await Promise.all(tasks)
    res.json({ query, results: perAccountResults.flat() })
  } catch (err) {
    sendErrorJson(res, err, "Error searching files")
  }
})

app.post("/delete-item", async (req, res) => {
  try {
    const email = getBodyTrimmed(req, "email")
    const provider = getBodyTrimmed(req, "provider")
    const fileId = getBodyTrimmed(req, "fileId")

    if (!email || !fileId) {
      return res.status(400).json({ error: "email and fileId are required" })
    }

    const account = getAccountByEmail(req.userSession, email, provider)
    if (!account) {
      return res.status(404).json({ error: "Account not found" })
    }

    if (account.provider === "mega") {
      return res.status(403).json({ error: "Delete feature is only available in Google Drive account for now. i am working on it, stay tuned!" })
    }

    await axios.delete(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`, {
      headers: authHeaders(account.token),
      params: { supportsAllDrives: true }
    })

    res.json({ success: true })
  } catch (err) {
    sendErrorJson(res, err, "Error deleting file")
  }
})

app.post("/copy-item", async (req, res) => {
  try {
    const email = getBodyTrimmed(req, "email")
    const provider = getBodyTrimmed(req, "provider")
    const fileId = getBodyTrimmed(req, "fileId")
    const destinationFolderId = getBodyTrimmed(req, "destinationFolderId")

    if (!email || !fileId || !destinationFolderId) {
      return res.status(400).json({ error: "email, fileId and destinationFolderId are required" })
    }

    const account = getAccountByEmail(req.userSession, email, provider)
    if (!account) {
      return res.status(404).json({ error: "Account not found" })
    }

    if (account.provider === "mega") {
      const storage = await ensureMegaStorageForAccount(account)
      await storage.reload(true)
      const source = getMegaNodeById(storage, fileId)
      const target = destinationFolderId === "root" ? storage.root : getMegaNodeById(storage, destinationFolderId)
      if (!source || !target || !target.directory) {
        return res.status(404).json({ error: "Source or destination not found" })
      }
      await source.copyTo(target)
      return res.json({ success: true })
    }

    await axios.post(
      `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/copy`,
      { parents: [destinationFolderId] },
      {
        headers: {
          ...authHeaders(account.token),
          "Content-Type": "application/json"
        },
        params: { supportsAllDrives: true }
      }
    )

    res.json({ success: true })
  } catch (err) {
    sendErrorJson(res, err, "Error copying file")
  }
})

app.post("/move-item", async (req, res) => {
  try {
    const email = getBodyTrimmed(req, "email")
    const provider = getBodyTrimmed(req, "provider")
    const fileId = getBodyTrimmed(req, "fileId")
    const destinationFolderId = getBodyTrimmed(req, "destinationFolderId")

    if (!email || !fileId || !destinationFolderId) {
      return res.status(400).json({ error: "email, fileId and destinationFolderId are required" })
    }

    const account = getAccountByEmail(req.userSession, email, provider)
    if (!account) {
      return res.status(404).json({ error: "Account not found" })
    }

    if (account.provider === "mega") {
      const storage = await ensureMegaStorageForAccount(account)
      await storage.reload(true)
      const source = getMegaNodeById(storage, fileId)
      const target = destinationFolderId === "root" ? storage.root : getMegaNodeById(storage, destinationFolderId)
      if (!source || !target || !target.directory) {
        return res.status(404).json({ error: "Source or destination not found" })
      }
      await source.moveTo(target)
      return res.json({ success: true })
    }

    const currentFile = await axios.get(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`, {
      headers: authHeaders(account.token),
      params: { fields: "parents", supportsAllDrives: true }
    })

    const existingParents = Array.isArray(currentFile.data?.parents) ? currentFile.data.parents.filter(Boolean) : []
    const removeParents = existingParents.join(",")
    const params = { addParents: destinationFolderId, supportsAllDrives: true }
    if (removeParents) params.removeParents = removeParents

    await axios.patch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`, null, {
      headers: authHeaders(account.token),
      params
    })

    res.json({ success: true })
  } catch (err) {
    sendErrorJson(res, err, "Error moving file")
  }
})

app.post("/create-folder", async (req, res) => {
  try {
    const email = getBodyTrimmed(req, "email")
    const provider = getBodyTrimmed(req, "provider")
    const parentId = getBodyTrimmed(req, "parentId") || "root"
    const folderName = getBodyTrimmed(req, "folderName")

    if (!email || !folderName) {
      return res.status(400).json({ error: "email and folderName are required" })
    }

    if (parentId === "__shared_drives__") {
      return res.status(400).json({ error: "Open a destination folder first" })
    }

    const account = getAccountByEmail(req.userSession, email, provider)
    if (!account) {
      return res.status(404).json({ error: "Account not found" })
    }

    if (account.provider === "mega") {
      const storage = await ensureMegaStorageForAccount(account)
      await storage.reload(true)
      const targetFolder = parentId === "root" ? storage.root : getMegaNodeById(storage, parentId)
      if (!targetFolder || !targetFolder.directory) {
        return res.status(404).json({ error: "Destination folder not found" })
      }
      const created = await targetFolder.mkdir(folderName)
      await storage.reload(true)
      return res.json({ success: true, item: normalizeMegaNode(created, targetFolder.nodeId || "root") })
    }

    const response = await axios.post(
      DRIVE_FILES_URL,
      {
        name: folderName,
        mimeType: FOLDER_MIME,
        parents: [parentId]
      },
      {
        headers: {
          ...authHeaders(account.token),
          "Content-Type": "application/json"
        },
        params: {
          fields: "id,name,mimeType,size,modifiedTime,webViewLink,parents,driveId",
          supportsAllDrives: true
        }
      }
    )

    return res.json({ success: true, item: response.data })
  } catch (err) {
    sendErrorJson(res, err, "Error creating folder")
  }
})


app.post("/upload-item-stream", async (req, res) => {
  const bb = busboy({
    headers: req.headers,
    limits: { fileSize: 10 * 1024 * 1024 * 1024 }
  })

  const fields = {}
  let responded = false

  function safeRespond(status, body) {
    if (responded) return
    responded = true
    res.status(status).json(body)
  }

  bb.on("field", (name, val) => {
    fields[name] = String(val).trim()
  })

  bb.on("file", async (_fieldname, fileStream, info) => {
    const email = fields.email || getQueryTrimmed({ query: req.headers }, "x-upload-email")
    const provider = fields.provider || getQueryTrimmed({ query: req.headers }, "x-upload-provider")
    const parentId = fields.parentId || getQueryTrimmed({ query: req.headers }, "x-upload-parent-id")
    const uploadId = fields.uploadId || getQueryTrimmed({ query: req.headers }, "x-upload-id")
    const fileName = info.filename || "upload.bin"
    const fileMime = info.mimeType || "application/octet-stream"
    const fileSize = parseInt(req.headers["x-file-size"] || "0", 10) || 0

    if (!email || !parentId) {
      fileStream.resume()
      return safeRespond(400, { error: "email and parentId are required" })
    }

    const account = getAccountByEmail(req.userSession, email, provider)
    if (!account) {
      fileStream.resume()
      return safeRespond(404, { error: "Account not found" })
    }

    setUploadProgress(uploadId, {
      sessionId: req.sessionId,
      status: "uploading",
      phase: "initiating",
      provider: normalizeProvider(account.provider),
      fileName,
      bytesUploaded: 0,
      bytesTotal: fileSize,
      message: "Preparing upload"
    })

    if (account.provider === "mega") {
      try {
        const storage = await ensureMegaStorageForAccount(account)
        await storage.reload(true)

        const targetFolder =
          parentId === "root" ? storage.root : getMegaNodeById(storage, parentId)

        if (!targetFolder || !targetFolder.directory) {
          fileStream.resume()
          return safeRespond(404, { error: "Destination folder not found" })
        }

        if (!fileSize || fileSize <= 0) {
          fileStream.resume()
          return safeRespond(400, { error: "x-file-size header is required for MEGA stream upload" })
        }

        setUploadProgress(uploadId, {
          status: "uploading",
          phase: "mega",
          bytesUploaded: 0,
          bytesTotal: fileSize,
          message: "Uploading to MEGA"
        })

        const uploadStream = targetFolder.upload(
          { name: fileName, size: fileSize, allowUploadBuffering: false },
          fileStream
        )
        uploadStream.on("progress", (p) => {
          const megaUploaded = Number(p?.bytesUploaded || 0)
          const megaTotal = Number(p?.bytesTotal || fileSize)
          setUploadProgress(uploadId, {
            status: "uploading",
            phase: "mega",
            bytesUploaded: Math.max(0, Math.min(fileSize, megaUploaded)),
            bytesTotal: Math.max(fileSize, megaTotal),
            message: "Uploading to MEGA"
          })
        })

        uploadStream.on("error", (err) => {
          setUploadProgress(uploadId, {
            status: "error",
            phase: "error",
            message: err && err.message ? err.message : "MEGA upload stream error"
          })
        })

        await uploadStream.complete

        setUploadProgress(uploadId, {
          status: "done",
          phase: "done",
          bytesUploaded: fileSize,
          bytesTotal: fileSize,
          message: "Upload complete"
        })
        cleanupUploadProgress(uploadId)
        return safeRespond(200, { success: true })
      } catch (err) {
        setUploadProgress(uploadId, { status: "error", phase: "error", message: err.message })
        cleanupUploadProgress(uploadId, 60000)
        logError(err)
        return safeRespond(500, { error: err.message || "MEGA upload failed" })
      }
    }

    try {
      const metadata = { name: fileName, parents: [parentId] }

      const startRes = await axios.post(DRIVE_UPLOAD_URL, metadata, {
        headers: {
          ...authHeaders(account.token),
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": fileMime,
          ...(fileSize ? { "X-Upload-Content-Length": String(fileSize) } : {})
        },
        params: {
          uploadType: "resumable",
          supportsAllDrives: true,
          fields: "id,name,mimeType,size,modifiedTime,webViewLink,parents,driveId"
        }
      })

      const resumableUrl = startRes.headers.location || startRes.headers.Location
      if (!resumableUrl) {
        fileStream.resume()
        return safeRespond(500, { error: "Could not start Google upload session" })
      }

      setUploadProgress(uploadId, {
        status: "uploading",
        phase: "google",
        bytesUploaded: 0,
        bytesTotal: fileSize,
        message: "Streaming to Google Drive"
      })

      let bytesUploaded = 0
      fileStream.on("data", (chunk) => {
        bytesUploaded += chunk.length
        setUploadProgress(uploadId, {
          bytesUploaded,
          bytesTotal: fileSize || bytesUploaded,
          message: "Streaming to Google Drive"
        })
      })

      const uploadRes = await axios.put(resumableUrl, fileStream, {
        headers: {
          "Content-Type": fileMime,
          ...(fileSize
            ? { "Content-Length": String(fileSize) }
            : { "Transfer-Encoding": "chunked" })
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      })

      const doneBytes = Math.max(bytesUploaded, fileSize, 0)
      setUploadProgress(uploadId, {
        status: "done",
        phase: "done",
        bytesUploaded: doneBytes,
        bytesTotal: fileSize || doneBytes,
        message: "Upload complete"
      })
      cleanupUploadProgress(uploadId)
      return safeRespond(200, { success: true, item: uploadRes.data })
    } catch (err) {
      setUploadProgress(uploadId, { status: "error", phase: "error", message: err.message })
      cleanupUploadProgress(uploadId, 60000)
      logError(err)
      return safeRespond(500, { error: err.message || "Google Drive upload failed" })
    }
  })

  bb.on("error", (err) => {
    logError(err)
    if (!responded) {
      responded = true
      res.status(500).json({ error: "Multipart parse error: " + err.message })
    }
  })

  req.pipe(bb)
})

app.post("/upload-item", upload.single("file"), async (req, res) => {
  try {
    const email = getBodyTrimmed(req, "email")
    const provider = getBodyTrimmed(req, "provider")
    const parentId = getBodyTrimmed(req, "parentId")
    const uploadId = getBodyTrimmed(req, "uploadId")
    const file = req.file

    if (!email || !parentId || !file) {
      return res.status(400).json({ error: "email, parentId and file are required" })
    }

    setUploadProgress(uploadId, {
      sessionId: req.sessionId,
      status: "received",
      phase: "server",
      provider: normalizeProvider(provider),
      fileName: file.originalname || "upload.bin",
      bytesUploaded: 0,
      bytesTotal: Number(file.size || 0),
      message: "File received by server"
    })

    const account = getAccountByEmail(req.userSession, email, provider)
    if (!account) {
      return res.status(404).json({ error: "Account not found" })
    }

    if (account.provider === "mega") {
      const storage = await ensureMegaStorageForAccount(account)
      await storage.reload(true)
      const targetFolder = parentId === "root" ? storage.root : getMegaNodeById(storage, parentId)
      if (!targetFolder || !targetFolder.directory) {
        return res.status(404).json({ error: "Destination folder not found" })
      }

      const uploadStream = targetFolder.upload({ name: file.originalname || "upload.bin" }, file.buffer)
      setUploadProgress(uploadId, {
        status: "uploading",
        phase: "mega",
        bytesUploaded: 0,
        bytesTotal: Number(file.size || 0),
        message: "Uploading to MEGA"
      })
      uploadStream.on("progress", (p) => {
        const up = Number(p && p.bytesUploaded ? p.bytesUploaded : 0)
        const total = Number(p && p.bytesTotal ? p.bytesTotal : file.size || 0)
        setUploadProgress(uploadId, {
          status: "uploading",
          phase: "mega",
          bytesUploaded: up,
          bytesTotal: total,
          message: "Uploading to MEGA"
        })
      })
      await uploadStream.complete
      setUploadProgress(uploadId, {
        status: "done",
        phase: "done",
        bytesUploaded: Number(file.size || 0),
        bytesTotal: Number(file.size || 0),
        message: "Upload complete"
      })
      cleanupUploadProgress(uploadId)
      return res.json({ success: true })
    }

    const metadata = {
      name: file.originalname || "upload.bin",
      parents: [parentId]
    }

    // Google upload path: initiate resumable session, then stream media bytes to Drive.
    // This avoids local disk storage and sends bytes directly to Google.
    const startRes = await axios.post(DRIVE_UPLOAD_URL, metadata, {
      headers: {
        ...authHeaders(account.token),
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": file.mimetype || "application/octet-stream",
        "X-Upload-Content-Length": String(Number(file.size || 0))
      },
      params: {
        uploadType: "resumable",
        supportsAllDrives: true,
        fields: "id,name,mimeType,size,modifiedTime,webViewLink,parents,driveId"
      }
    })
    const resumableUrl = startRes.headers && (startRes.headers.location || startRes.headers.Location)
    if (!resumableUrl) {
      return res.status(500).json({ error: "Could not start Google upload session" })
    }

    setUploadProgress(uploadId, {
      status: "uploading",
      phase: "google",
      bytesUploaded: 0,
      bytesTotal: Number(file.size || 0),
      message: "Uploading to Google Drive"
    })

    const response = await axios.put(resumableUrl, file.buffer, {
      headers: {
        "Content-Type": file.mimetype || "application/octet-stream",
        "Content-Length": String(Number(file.size || 0))
      },
      onUploadProgress: (ev) => {
        const loaded = Number(ev && ev.loaded ? ev.loaded : 0)
        const total = Number(ev && ev.total ? ev.total : file.size || 0)
        setUploadProgress(uploadId, {
          status: "uploading",
          phase: "google",
          bytesUploaded: loaded,
          bytesTotal: total,
          message: "Uploading to Google Drive"
        })
      }
    })

    setUploadProgress(uploadId, {
      status: "done",
      phase: "done",
      bytesUploaded: Number(file.size || 0),
      bytesTotal: Number(file.size || 0),
      message: "Upload complete"
    })
    cleanupUploadProgress(uploadId)
    res.json({ success: true, item: response.data })
  } catch (err) {
    const uploadId = getBodyTrimmed(req, "uploadId")
    setUploadProgress(uploadId, {
      status: "error",
      phase: "error",
      message: err && err.message ? err.message : "Upload failed"
    })
    cleanupUploadProgress(uploadId, 60 * 1000)
    sendErrorJson(res, err, "Error uploading file")
  }
})

app.get("/upload-progress", (req, res) => {
  const uploadId = getQueryTrimmed(req, "uploadId")
  if (!uploadId) {
    return res.status(400).json({ error: "uploadId is required" })
  }
  const state = uploadProgress.get(uploadId)
  if (!state || String(state.sessionId || "") !== String(req.sessionId || "")) {
    return res.json({ status: "unknown" })
  }
  res.json(state)
})

app.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File too large. Max upload size is 1 GB." })
  }
  if (err) {
    return res.status(500).json({ error: err.message || "Server error" })
  }
  next()
})

const PORT = Number(process.env.PORT || 3000)

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on https://multi-drives.vercel.app`)
  })
}

module.exports = app

