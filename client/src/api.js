const jsonHeaders = { "Content-Type": "application/json" }

async function request(url, options = {}) {
  const res = await fetch(url, { credentials: "include", ...options })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const message =
      (typeof data === "object" && data?.error) ||
      (typeof data === "object" && data?.message) ||
      (typeof data === "string" && data) ||
      `Request failed (${res.status})`
    throw new Error(message)
  }
  return data
}

export function getStorage() {
  return request("/storage")
}

export function exportSession() {
  return request("/session/export")
}

export function restoreSession(accounts) {
  return request("/session/restore", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ accounts })
  })
}

export function getFiles(parentId = "root", accountEmail = null) {
  const params = new URLSearchParams()
  params.append("parentId", parentId)
  if (accountEmail) params.append("accountEmail", accountEmail)
  return request(`/files?${params}`)
}

export function searchFiles(query, accountEmail = null) {
  const params = new URLSearchParams()
  params.append("q", query)
  if (accountEmail) params.append("accountEmail", accountEmail)
  return request(`/search?${params}`)
}

export function startGoogleAuth(clientId, clientSecret, redirectUri) {
  return request("/auth/google/start", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ clientId, clientSecret, redirectUri })
  })
}

export function logoutAccount(email) {
  return request("/logout", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email })
  })
}

export function createFolder(parentId, folderName, accountEmail) {
  return request("/create-folder", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ parentId, name: folderName, accountEmail })
  })
}

export function deleteItem(fileId, accountEmail) {
  return request("/delete-item", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ id: fileId, accountEmail })
  })
}

export async function uploadFile(parentId, accountEmail, file, onProgress) {
  const form = new FormData()
  form.append("parentId", parentId)
  if (accountEmail) form.append("accountEmail", accountEmail)
  form.append("file", file)

  return request("/upload-item", { method: "POST", body: form })
}

export function openFileUrl(fileId, accountEmail) {
  const params = new URLSearchParams({ id: fileId, accountEmail })
  return `/open-file?${params}`
}
