# Multi Drive

**Multi Drive** is a single web interface that lets you connect multiple cloud accounts and browse/search files across them. It supports:
---

## Quick Preview

![Multi Drive UI Banner](./images/banner.png)

---

## Features

- **Unified Drive view** (combined browsing across connected Google accounts)
- **Per-account view** (choose an account from the sidebar)
- **Folder navigation** with breadcrumbs
- **Search**:
  - Root search can query across accounts (depending on your selection)
  - Folder/file listing uses Google Drive `trashed=false`
- **Upload file** (select target folder)
- **Create new folder**
- **Delete** (Google Drive delete works)
- **Storage usage** shown per connected account
- **Session management**:
  - Backend session stored in server memory (or optional Upstash Redis)
  - Optional export/restore connected accounts using Firebase-auth sessions

---

## Important Notes / Limitations

- If connected accounts do not show up, try **clearing your cache** and re-login.
- Use **localhost** for best results (hosted deployments can enforce storage/time limits).
- **MEGA delete is currently disabled**. Google Drive delete works.

---

## Architecture (High Level)

- **Frontend**: React + Vite (found in `client/`)
- **Backend**: Node + Express (`server.js`)
- **Auth / Accounts storage**:
  - Firebase Admin SDK validates user JWT and loads/stores the saved connected-account session.
- **Security**:
  - Google OAuth tokens are stored in session.
  - Secrets are encrypted before saving to Firebase/Firestore.

---

## Tech Stack

- React, Vite, JavaScript
- Node.js, Express
- Firebase Admin (for session + storage)
- Google Drive API

---

## Local Development

### 1) Install dependencies
From the repo root (Multi-Drive):

```bash
npm install
npm --prefix client install
```

### 2) Configure environment variables
Create a `.env` file in `Multi-Drive/`.

> You already have `.env` and `.env.example` in the repo. Do **not** commit secrets.

Required values used by the backend:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `ENCRYPTION_KEY` (used to encrypt tokens before saving)
- `CLIENT_ID` and `CLIENT_SECRET` (Google OAuth)
- `GOOGLE_REDIRECT_URI` (callback URL; defaults to `https://multi-drives.vercel.app/auth/google/callback`)

Optional (for Upstash Redis caching/session storage):

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

### 3) Run the app

Run both server + client (root script):

```bash
npm start
```

Or manually:

- Backend: `npm start`
- Frontend (Vite): `npm --prefix client run dev`

Then open:

- http://localhost:3000

---

## Google OAuth Setup (Required)

1. Go to **Google Cloud Console** → your project.
2. Enable **Google Drive API**.
3. Create OAuth credentials and capture:
   - **Client ID**
   - **Client Secret**
4. Configure OAuth consent & redirect URIs:
   - Add your redirect URI in Google Cloud credentials
   - Backend uses `/auth/google/callback`

UI/setup images included in this repo:

- `./images/google drive setup.png`
- `./images/google drive api enable.png`
- `./images/Create oauth id set.png`
- `./images/enable api and servies.png`
- `./images/Create oauth id set.png`

---

## Deployment

See the full deployment steps here:

- `deployment_guide.md`

Summary:

- **Backend**: Render (Node)
- **Frontend**: Vercel (Vite/React)

Key step after Vercel deploy:
- Update `GOOGLE_REDIRECT_URI` on Render
- Update Google OAuth “Authorized redirect URIs” with your Vercel callback URL

---

## API (Backend Endpoints) — What the UI calls

Common endpoints inside `server.js`:

- `POST /auth/google/start`
  - returns `{ url }` to send the user to Google OAuth
- `GET /auth/google/callback`
  - exchanges code for tokens and stores the connected account in session
- `GET /storage`
  - returns aggregated + per-account storage usage
- `GET /files?parentId=...&accountEmail=...`
  - lists items in a folder, optionally combined across accounts
- `POST /create-folder`
  - body: `{ parentId, name, accountEmail }`
- `POST /upload-item`
  - body multipart: `{ file, parentId, accountEmail }`
- `POST /delete-item`
  - body: `{ id, accountEmail }`
- `GET /search?q=...&accountEmail=...`
- `GET /open-file?id=...&accountEmail=...`
  - redirects to Google file `webViewLink`

Firebase-backed session endpoints:

- `GET /firebase/session` (loads saved accounts)
- `POST /firebase/session` (saves encrypted account tokens)
- `GET /session/export` and `POST /session/restore` (export/restore accounts stored in backend session)

---

## Docker

This repo includes a `Dockerfile`.

Build:

```bash
docker build -t multi-drive .
```

Run:

```bash
docker run -p 3000:3000 --env-file .env multi-drive
```

---

## Screenshots / Images

Additional images in `Multi-Drive/images/`:

- `./images/homepage.webp`
- `./images/opening menu.png`
- `./images/select-project.png`
- `./images/selecting api and service from menu.png`
- `./images/credential created.png`
- `./images/nothing_here__.png`

Example UI shot:

![Homepage](./images/homepage.webp)

---

## Troubleshooting

- **Accounts not showing**: clear cache, re-login, and hard refresh.
- **OAuth errors**: ensure redirect URI matches exactly, including protocol and path.
- **“Client not built”**: run `npm --prefix client run build` (or simply use `npm start` from root).

---

## License

Check repository license (if present).

