# Multi-Drive Deployment Guide (Vercel + Render)

This guide walks you through deploying your React frontend on **Vercel** and your Node/Express backend on **Render**.

---

## 1. Backend Deployment (Render)

Deploy your backend as a **Web Service** on Render.

### Steps:
1. Log in to [Render](https://render.com/) and click **New > Web Service**.
2. Connect your GitHub repository containing the project.
3. Configure the service settings:
   - **Name**: `multi-drive-backend`
   - **Root Directory**: `.` (leave blank or select root)
   - **Language/Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Add the following **Environment Variables** in Render's **Env Groups** or **Environment** settings:
   
   | Key | Value | Description |
   | --- | --- | --- |
   | `FIREBASE_PROJECT_ID` | `ytplayer-474fa` | Firebase project identifier |
   | `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-fbsvc@ytplayer-474fa.iam.gserviceaccount.com` | Service account email |
   | `FIREBASE_PRIVATE_KEY` | *(Copy the private key from your local `.env` file)* | Service account private key |
   | `ENCRYPTION_KEY` | *(A secure 32-character string of your choice)* | Used to encrypt token secrets in Firestore |
   | `CLIENT_ID` | `YOUR_GOOGLE_CLIENT_ID` | Google OAuth Client ID |
   | `CLIENT_SECRET` | `YOUR_GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret |
   | `GOOGLE_REDIRECT_URI` | `https://YOUR-VERCEL-FRONTEND-URL.vercel.app/auth/google/callback` | OAuth callback (update once Vercel is live) |

5. Click **Deploy Web Service**. Render will generate a backend URL (e.g., `https://multi-drive-backend.onrender.com`).

---

## 2. Frontend Deployment (Vercel)

Deploy your frontend as a static SPA on Vercel.

### Steps:
1. Update both of your `vercel.json` files with your actual Render backend URL:
   * **Root vercel.json**: [vercel.json](file:///c:/Users/hp202/Downloads/shdesignmeld%20projects/projects/open/personl%20cloud/Multi-Drive/vercel.json)
   * **Client vercel.json**: [client/vercel.json](file:///c:/Users/hp202/Downloads/shdesignmeld%20projects/projects/open/personl%20cloud/Multi-Drive/client/vercel.json)
   
   Replace `https://YOUR-RENDER-BACKEND-URL.onrender.com` with your actual Render URL in both files.

2. Log in to [Vercel](https://vercel.com/) and click **Add New > Project**.
3. Import your GitHub repository.
4. If you deploy using the **client** subfolder as the Root Directory:
   - Set **Root Directory** to `client`.
   - Vercel will auto-detect Vite. Keep default build settings.
5. If you deploy from the **main root folder**:
   - Keep **Root Directory** as `.`
   - Set **Build Command** to: `npm run build`
   - Set **Output Directory** to: `client/dist`
6. Add the following **Environment Variables** in Vercel:
   
   | Key | Value |
   | --- | --- |
   | `VITE_FIREBASE_PROJECT_ID` | `ytplayer-474fa` |
   | `VITE_FIREBASE_AUTH_DOMAIN` | `ytplayer-474fa.firebaseapp.com` |
   | `VITE_FIREBASE_STORAGE_BUCKET` | `ytplayer-474fa.firebasestorage.app` |
   | `VITE_FIREBASE_API_KEY` | `AIzaSyAxuDeN76FpUiDKmF7Jnuwjr6FbR6rEePA` |
   | `VITE_FIREBASE_MESSAGING_SENDER_ID` | `744407543292` |
   | `VITE_FIREBASE_APP_ID` | `1:744407543292:android:3ea215b07faa38d7ac1679` |

7. Click **Deploy**. Vercel will generate your frontend URL (e.g., `https://multi-drive.vercel.app`).

### Step 3: Final Callback Update
Once your Vercel URL is live:
1. Go back to Render's **Environment** tab.
2. Update the `GOOGLE_REDIRECT_URI` variable to:
   `https://YOUR-VERCEL-FRONTEND-URL.vercel.app/auth/google/callback`
3. In the Google Cloud Console (APIs & Services > Credentials), add your Vercel frontend URL to:
   - **Authorized JavaScript origins**: `https://YOUR-VERCEL-FRONTEND-URL.vercel.app`
   - **Authorized redirect URIs**: `https://YOUR-VERCEL-FRONTEND-URL.vercel.app/auth/google/callback`
