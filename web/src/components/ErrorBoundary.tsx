import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Logo } from './Logo'

interface ErrorBoundaryState {
  hasError: boolean
  message: string
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : '未知错误',
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Tern] 界面异常', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="crash-screen">
          <Logo size={44} />
          <div className="crash-icon">
            <AlertTriangle size={28} />
          </div>
          <h1>界面遇到了问题</h1>
          <p>刷新页面通常可以恢复。如果问题持续出现，请查看浏览器控制台。</p>
          <p className="crash-detail">{this.state.message}</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            <RefreshCw size={16} />
            <span>重新加载</span>
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
