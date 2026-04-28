const express = require("express")
const axios = require("axios")
const cors = require("cors")
const path = require("path")
const multer = require("multer")
const mega = require("megajs")
require("dotenv").config()

const app = express()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
})

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, "public")))
app.use("/images", express.static(path.join(__dirname, "images")))

const CLIENT_ID = process.env.CLIENT_ID
const CLIENT_SECRET = process.env.CLIENT_SECRET
const REDIRECT_URI = "http://localhost:3000/auth/google/callback"
const MEGA_SESSION_TOKEN = process.env.MEGA_SESSION_TOKEN || ""
const MEGA_ACCOUNT_EMAIL = process.env.MEGA_ACCOUNT_EMAIL || ""

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_PROFILE_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"
const DRIVE_DRIVES_URL = "https://www.googleapis.com/drive/v3/drives"
const DRIVE_ABOUT_URL = "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName,photoLink),storageQuota"
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"
const FOLDER_MIME = "application/vnd.google-apps.folder"
const DRIVE_FILES_FIELDS = "nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, iconLink, thumbnailLink, parents, driveId)"

let accounts = []
let megaStorage = null

function normalizeProvider(value) {
  return String(value || "").trim().toLowerCase()
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase()
}

function makeAccountKey(provider, email) {
  return normalizeProvider(provider) + "::" + normalizeEmail(email)
}

function upsertAccount(account) {
  const key = makeAccountKey(account.provider, account.email)
  accounts = accounts.filter((item) => makeAccountKey(item.provider, item.email) !== key)
  accounts.push(account)
}

function parseMegaSessionToken(raw) {
  if (!raw || typeof raw !== "string") return null

  const text = raw.trim()
  if (!text) return null

  const attempts = [text]
  try {
    attempts.push(Buffer.from(text, "base64").toString("utf8"))
  } catch (e) {}

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === "object" && parsed.sid && parsed.key) {
        return parsed
      }
    } catch (e) {}
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

function getAccountByEmail(email, provider) {
  const target = normalizeEmail(email)
  const targetProvider = normalizeProvider(provider)

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

async function connectMegaAccount() {
  const storage = await getMegaStorage()
  const email = buildMegaEmail(storage)
  upsertAccount({ provider: "mega", email, storage })
  return email
}

async function connectMegaAccountWithCredentials({ email, password, secondFactorCode }) {
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
  upsertAccount({ provider: "mega", email: accountEmail, storage })
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
  if (!parentNode || !parentNode.directory) return []

  const children = Array.isArray(parentNode.children) ? parentNode.children : []
  return children.map((node) => normalizeMegaNode(node, parentNode.nodeId || "root"))
}

app.get("/auth/google", (req, res) => {
  const scope = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive"].join(" ")
  const url =
    `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`
  res.redirect(url)
})

app.get("/auth/mega", (req, res) => {
  res.redirect("/mega-login.html")
})

app.post("/auth/mega/login", async (req, res) => {
  try {
    const email = getBodyTrimmed(req, "email")
    const password = getBodyRaw(req, "password")
    const secondFactorCode = getBodyTrimmed(req, "secondFactorCode")
    await connectMegaAccountWithCredentials({ email, password, secondFactorCode })
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
    const accountEmail = await connectMegaAccountWithCredentials({ email, password, secondFactorCode })
    return res.json({ success: true, email: accountEmail })
  } catch (err) {
    const msg = err && err.message ? err.message : "Unable to login to MEGA"
    return res.status(400).json({ error: msg })
  }
})

app.post("/auth/mega/token", (req, res) => {
  connectMegaAccount()
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
    const email = await connectMegaAccount()
    return res.json({ success: true, email })
  } catch (err) {
    const msg = err && err.message ? err.message : "Unable to connect MEGA token"
    return res.status(400).json({ error: msg })
  }
})

app.get("/auth/google/callback", async (req, res) => {
  try {
    const code = req.query.code

    const tokenResponse = await axios.post(GOOGLE_TOKEN_URL, {
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code"
    })

    const accessToken = tokenResponse.data.access_token
    const profileResponse = await axios.get(GOOGLE_PROFILE_URL, {
      headers: authHeaders(accessToken)
    })

    upsertAccount({
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

    for (const account of accounts) {
      if (account.provider === "mega") {
        const storage = account.storage || (await getMegaStorage())
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

  const previousLength = accounts.length
  accounts = accounts.filter((account) => {
    const sameEmail = normalizeEmail(account.email) === normalizeEmail(email)
    if (!sameEmail) return true
    if (provider) return normalizeProvider(account.provider) !== provider
    return false
  })

  if (accounts.length === previousLength) {
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
    const account = getAccountByEmail(email, provider)
    if (!account) {
      return res.status(404).json({ error: "Account not found" })
    }

    if (account.provider === "mega") {
      const items = await listMegaChildren(account.storage || (await getMegaStorage()), parentId)
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

    const account = getAccountByEmail(email, provider)
    if (!account) {
      return res.status(404).json({ error: "Account not found" })
    }

    if (account.provider === "mega") {
      const storage = account.storage || (await getMegaStorage())
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

    if (accounts.length === 0) {
      return res.json({ query, results: [] })
    }

    const escapedQuery = escapeDriveContains(query)
    const driveQuery = `name contains '${escapedQuery}' and trashed=false`

    const tasks = accounts.map(async (account) => {
      if (account.provider === "mega") {
        const storage = account.storage || (await getMegaStorage())
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

    const account = getAccountByEmail(email, provider)
    if (!account) {
      return res.status(404).json({ error: "Account not found" })
    }

    if (account.provider === "mega") {
      const storage = account.storage || (await getMegaStorage())
      await storage.reload(true)
      const node = getMegaNodeById(storage, fileId)
      if (!node) {
        return res.status(404).json({ error: "File not found" })
      }
      await node.delete(true)
      return res.json({ success: true })
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

    const account = getAccountByEmail(email, provider)
    if (!account) {
      return res.status(404).json({ error: "Account not found" })
    }

    if (account.provider === "mega") {
      const storage = account.storage || (await getMegaStorage())
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

    const account = getAccountByEmail(email, provider)
    if (!account) {
      return res.status(404).json({ error: "Account not found" })
    }

    if (account.provider === "mega") {
      const storage = account.storage || (await getMegaStorage())
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

app.post("/upload-item", upload.single("file"), async (req, res) => {
  try {
    const email = getBodyTrimmed(req, "email")
    const provider = getBodyTrimmed(req, "provider")
    const parentId = getBodyTrimmed(req, "parentId")
    const file = req.file

    if (!email || !parentId || !file) {
      return res.status(400).json({ error: "email, parentId and file are required" })
    }

    const account = getAccountByEmail(email, provider)
    if (!account) {
      return res.status(404).json({ error: "Account not found" })
    }

    if (account.provider === "mega") {
      const storage = account.storage || (await getMegaStorage())
      await storage.reload(true)
      const targetFolder = parentId === "root" ? storage.root : getMegaNodeById(storage, parentId)
      if (!targetFolder || !targetFolder.directory) {
        return res.status(404).json({ error: "Destination folder not found" })
      }

      const uploadStream = targetFolder.upload({ name: file.originalname || "upload.bin" }, file.buffer)
      await uploadStream.complete
      return res.json({ success: true })
    }

    const boundary = "multidrive_boundary_" + Date.now()
    const metadata = {
      name: file.originalname || "upload.bin",
      parents: [parentId]
    }

    const prefix =
      `--${boundary}\r\n` +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\n` +
      `Content-Type: ${file.mimetype || "application/octet-stream"}\r\n\r\n`

    const suffix = `\r\n--${boundary}--`
    const body = Buffer.concat([Buffer.from(prefix, "utf8"), file.buffer, Buffer.from(suffix, "utf8")])

    const response = await axios.post(DRIVE_UPLOAD_URL, body, {
      headers: {
        ...authHeaders(account.token),
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      params: {
        uploadType: "multipart",
        supportsAllDrives: true,
        fields: "id,name,mimeType,size,modifiedTime,webViewLink,parents,driveId"
      }
    })

    res.json({ success: true, item: response.data })
  } catch (err) {
    sendErrorJson(res, err, "Error uploading file")
  }
})

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000")
})
