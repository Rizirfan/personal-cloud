const axios = require("axios")

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_PROFILE_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"
const DRIVE_ABOUT_URL = "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName,photoLink),storageQuota"
const DRIVE_FILES_FIELDS = "nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, iconLink, thumbnailLink, parents, driveId)"
const FOLDER_MIME = "application/vnd.google-apps.folder"

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` }
}

async function getFreshAccessToken(account, req) {
  if (!account) return null

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

module.exports = {
  getFreshAccessToken,
  fetchGoogleAccountInfo,
  listChildrenInFolder,
  authHeaders,
  escapeDriveQueryId,
  FOLDER_MIME,
  DRIVE_FILES_URL,
  DRIVE_FILES_FIELDS,
  GOOGLE_TOKEN_URL,
  GOOGLE_PROFILE_URL
}
