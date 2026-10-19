import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Menu, Moon, Search, Sun, X } from 'lucide-react'
import { useTheme } from '../lib/theme'
import { isTypingTarget } from '../lib/format'
import { Kbd } from './ui'

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { resolved, setMode } = useTheme()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    setQuery(params.get('q') ?? '')
  }, [location.search])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (event.key === '/' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = query.trim()
    if (!value) {
      navigate('/search')
      return
    }
    navigate(`/search?q=${encodeURIComponent(value)}`)
  }

  return (
    <header className="topbar">
      <button type="button" className="icon-btn menu-btn" onClick={onOpenMenu} aria-label="打开菜单">
        <Menu size={20} />
      </button>

      <form className="global-search" role="search" onSubmit={submit}>
        <Search size={17} className="global-search-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索文件和文件夹"
          aria-label="搜索文件和文件夹"
          autoComplete="off"
          spellCheck={false}
        />
        {query ? (
          <button
            type="button"
            className="global-search-clear"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            aria-label="清除搜索"
          >
            <X size={14} />
          </button>
        ) : (
          <span className="global-search-hint" aria-hidden="true">
            <Kbd>/</Kbd>
          </span>
        )}
      </form>

      <div className="topbar-actions">
        <button
          type="button"
          className="icon-btn theme-toggle"
          onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')}
          aria-label={resolved === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          title={resolved === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
        >
          {resolved === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  )
}
