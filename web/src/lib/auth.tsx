import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, errorMessage } from './api'
import type { AuthStatus, User } from './types'

interface AuthContextValue {
  status: AuthStatus | null
  user: User | null
  loading: boolean
  bootError: string | null
  serverName: string
  version: string
  allowRegistration: boolean
  maxUploadBytes: number
  retry: () => Promise<void>
  login: (username: string, password: string, remember: boolean) => Promise<User>
  setup: (input: { username: string; password: string; displayName?: string }) => Promise<User>
  register: (input: { username: string; password: string; displayName?: string }) => Promise<User>
  logout: () => Promise<void>
  setUser: (user: User) => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const FALLBACK: AuthStatus = {
  authenticated: false,
  setupRequired: false,
  serverName: 'Tern',
  version: '1.2.0',
  allowRegistration: false,
  maxUploadBytes: 0,
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [bootError, setBootError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setBootError(null)
    try {
      const next = await api.auth.status()
      setStatus(next)
    } catch (error) {
      setStatus(null)
      setBootError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const login = useCallback(async (username: string, password: string, remember: boolean) => {
    const { user } = await api.auth.login({ username, password, remember })
    setStatus((prev) => ({
      ...(prev ?? FALLBACK),
      authenticated: true,
      setupRequired: false,
      user,
    }))
    return user
  }, [])

  const setup = useCallback(
    async (input: { username: string; password: string; displayName?: string }) => {
      const { user } = await api.auth.setup(input)
      setStatus((prev) => ({
        ...(prev ?? FALLBACK),
        authenticated: true,
        setupRequired: false,
        user,
      }))
      return user
    },
    [],
  )

  const register = useCallback(
    async (input: { username: string; password: string; displayName?: string }) => {
      const { user } = await api.auth.register(input)
      setStatus((prev) => ({
        ...(prev ?? FALLBACK),
        authenticated: true,
        setupRequired: false,
        user,
      }))
      return user
    },
    [],
  )

  const logout = useCallback(async () => {
    try {
      await api.auth.logout()
    } catch {
      // even if the network fails the local session state should be cleared
    }
    setStatus((prev) => ({
      ...(prev ?? FALLBACK),
      authenticated: false,
      user: undefined,
    }))
  }, [])

  const setUser = useCallback((user: User) => {
    setStatus((prev) => (prev ? { ...prev, user } : prev))
  }, [])

  const refreshUser = useCallback(async () => {
    try {
      const { user } = await api.auth.me()
      setStatus((prev) => (prev ? { ...prev, authenticated: true, user } : prev))
    } catch {
      // ignore transient failures; next boot will reconcile
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: status?.user ?? null,
      loading,
      bootError,
      serverName: status?.serverName || FALLBACK.serverName,
      version: status?.version || FALLBACK.version,
      allowRegistration: status?.allowRegistration ?? false,
      maxUploadBytes: status?.maxUploadBytes ?? 0,
      retry: load,
      login,
      setup,
      register,
      logout,
      setUser,
      refreshUser,
    }),
    [
      status,
      loading,
      bootError,
      load,
      login,
      setup,
      register,
      logout,
      setUser,
      refreshUser,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
