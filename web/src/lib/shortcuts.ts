import { useEffect, useRef } from 'react'
import { isTypingTarget } from './format'

/** Delete / Backspace to move the current selection to the trash. */
export function useDeleteShortcut(enabled: boolean, onDelete: () => void): void {
  const saved = useRef(onDelete)

  useEffect(() => {
    saved.current = onDelete
  }, [onDelete])

  useEffect(() => {
    if (!enabled) return
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      if (document.querySelector('.modal-overlay, .preview-overlay, .context-menu, .dropdown-menu'))
        return
      event.preventDefault()
      saved.current()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled])
}
