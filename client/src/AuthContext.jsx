import React, { createContext, useContext, useEffect, useState } from "react"
import {
  auth,
  googleProvider,
  isFirebaseConfigured,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "./firebase"
import { clearStoredAccounts } from "./sessionStore"

const AuthContext = createContext(null)

const localGuestUser = {
  uid: "local",
  displayName: "Guest",
  email: null,
  photoURL: null
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(isFirebaseConfigured ? null : localGuestUser)
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured)
  const [authError, setAuthError] = useState("")

  useEffect(() => {
    if (!isFirebaseConfigured) return

    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setAuthReady(true)
    })
  }, [])

  const login = async () => {
    setAuthError("")
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (err) {
      setAuthError(err.message || "Google sign-in failed")
      throw err
    }
  }

  const logout = async () => {
    clearStoredAccounts()
    if (isFirebaseConfigured) {
      await signOut(auth)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        authError,
        login,
        logout,
        isFirebaseConfigured
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
