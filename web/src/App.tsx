import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { AuthProvider, useAuth } from './lib/auth'
import { AppDataProvider } from './lib/appData'
import { ConfirmProvider } from './lib/confirm'
import { NodeActionsProvider } from './lib/nodeActions'
import { ThemeProvider } from './lib/theme'
import { ToastProvider } from './lib/toast'
import { UploadProvider } from './lib/upload'
import { AppShell, AuthLoadingScreen, RequireAuth } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Button } from './components/ui'
import { Logo } from './components/Logo'
import { AuthPage } from './pages/AuthPage'
import { DrivePage } from './pages/DrivePage'
import { RecentPage, SearchPage, StarredPage } from './pages/CollectionPages'
import { SharesPage } from './pages/SharesPage'
import { TrashPage } from './pages/TrashPage'
import { SettingsPage } from './pages/SettingsPage'
import { PublicSharePage } from './pages/PublicSharePage'
import { NotFoundPage } from './pages/NotFoundPage'

function BootErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="boot-error">
      <Logo size={42} />
      <div className="boot-error-icon">
        <AlertTriangle size={26} />
      </div>
      <h1>无法连接到服务器</h1>
      <p>{message}</p>
      <p className="boot-error-hint">
        请确认 Tern 服务已启动，并且正在监听 <code>18080</code> 端口。
      </p>
      <Button icon={<RefreshCw size={16} />} onClick={onRetry}>
        重试连接
      </Button>
    </div>
  )
}

function AppRoutes() {
  const { loading, bootError, retry } = useAuth()
  const location = useLocation()
  const isPublicShare = location.pathname.startsWith('/s/')

  if (loading) return <AuthLoadingScreen />
  if (bootError && !isPublicShare) {
    return <BootErrorScreen message={bootError} onRetry={() => void retry()} />
  }

  return (
    <Routes>
      <Route path="/s/:token" element={<PublicSharePage />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/setup" element={<AuthPage mode="setup" />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DrivePage />} />
        <Route path="recent" element={<RecentPage />} />
        <Route path="starred" element={<StarredPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="shares" element={<SharesPage />} />
        <Route path="trash" element={<TrashPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>
            <AuthProvider>
              <BrowserRouter>
                <AppDataProvider>
                  <UploadProvider>
                    <NodeActionsProvider>
                      <AppRoutes />
                    </NodeActionsProvider>
                  </UploadProvider>
                </AppDataProvider>
              </BrowserRouter>
            </AuthProvider>
          </ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
