import React from "react"
import { createRoot } from "react-dom/client"
import { AuthProvider } from "./AuthContext"
import App from "./App"
import "./index.css"

const root = createRoot(document.getElementById("root"))
root.render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
)
