import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { UploadPanel } from './UploadPanel'
import { PageSpinner } from './ui'
import { useAuth } from '../lib/auth'

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setDrawerOpen(false)
    const main = document.querySelector('.shell-main')
    main?.scrollTo({ top: 0 })
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!drawerOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

  return (
    <div className="shell">
      <Sidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      {drawerOpen && (
        <button
          type="button"
          className="drawer-scrim"
          aria-label="关闭菜单"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <div className="shell-main">
        <Topbar onOpenMenu={() => setDrawerOpen(true)} />
        <main className="page">
          <Outlet />
        </main>
      </div>
      <UploadPanel />
    </div>
  )
}

export function AuthLoadingScreen({ label = '正在连接云屿…' }: { label?: string }) {
  return (
    <div className="boot-screen">
      <div className="boot-logo">
        <span className="boot-glow" />
        <span className="boot-mark">屿</span>
      </div>
      <PageSpinner label={label} />
    </div>
  )
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, status } = useAuth()
  const location = useLocation()
  if (loading) return <AuthLoadingScreen />
  if (!status?.authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  return <>{children}</>
}
