import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import { errorMessage } from './api'
import { useAuth } from './auth'
import type { StorageInfo } from './types'

interface AppDataContextValue {
  version: number
  refresh: () => void
  storage: StorageInfo | null
  storageLoading: boolean
  refreshStorage: () => Promise<void>
}

const AppDataContext = createContext<AppDataContextValue | null>(null)

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const authenticated = Boolean(status?.authenticated)
  const [version, setVersion] = useState(0)
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [storageLoading, setStorageLoading] = useState(true)
  const latestRequest = useRef(0)

  const refresh = useCallback(() => setVersion((value) => value + 1), [])

  const refreshStorage = useCallback(async () => {
    const requestId = ++latestRequest.current
    setStorageLoading(true)
    try {
      const info = await api.storage()
      if (requestId === latestRequest.current) setStorage(info)
    } catch {
      // non-critical; the meter falls back to an unknown state
    } finally {
      if (requestId === latestRequest.current) setStorageLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authenticated) return
    void refreshStorage()
  }, [refreshStorage, version, authenticated])

  const value = useMemo<AppDataContextValue>(
    () => ({ version, refresh, storage, storageLoading, refreshStorage }),
    [version, refresh, storage, storageLoading, refreshStorage],
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData must be used inside AppDataProvider')
  return ctx
}

/** Re-run `callback` on focus / visibility and on a gentle interval. */
export function useAutoRefresh(callback: () => void, intervalMs = 25_000, enabled = true): void {
  const saved = useRef(callback)
  useEffect(() => {
    saved.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled) return
    const maybeRefresh = () => {
      if (document.visibilityState === 'visible') saved.current()
    }
    const timer = window.setInterval(maybeRefresh, intervalMs)
    window.addEventListener('focus', maybeRefresh)
    document.addEventListener('visibilitychange', maybeRefresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', maybeRefresh)
      document.removeEventListener('visibilitychange', maybeRefresh)
    }
  }, [intervalMs, enabled])
}

interface SelectionApi {
  selected: Set<string>
  toggle: (nodeId: string) => void
  clear: () => void
  selectAll: (ids: string[]) => void
  isSelected: (id: string) => boolean
  retain: (ids: string[]) => void
}

export function useSelection(): SelectionApi {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const toggle = useCallback((nodeId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }, [])

  const clear = useCallback(() => setSelected(new Set()), [])

  const selectAll = useCallback((ids: string[]) => {
    setSelected(new Set(ids))
  }, [])

  const isSelected = useCallback((id: string) => selected.has(id), [selected])

  const retain = useCallback((ids: string[]) => {
    const allowed = new Set(ids)
    setSelected((prev) => {
      const next = new Set(Array.from(prev).filter((id) => allowed.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [])

  return useMemo(
    () => ({ selected, toggle, clear, selectAll, isSelected, retain }),
    [selected, toggle, clear, selectAll, isSelected, retain],
  )
}

export function errorToMessage(error: unknown): string {
  return errorMessage(error)
}
