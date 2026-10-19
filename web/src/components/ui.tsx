import { useEffect, useId, useRef, useState } from 'react'
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react'
import { avatarGradient, initials } from '../lib/format'

/* ---------------------------------- misc --------------------------------- */

export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <Loader2 className={`spinner ${className}`} size={size} aria-hidden="true" />
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  className?: string
}) {
  return <span className={`badge badge-${tone} ${className}`}>{children}</span>
}

export function Avatar({
  name,
  size = 36,
  className = '',
}: {
  name: string
  size?: number
  className?: string
}) {
  return (
    <span
      className={`avatar ${className}`}
      style={{
        width: size,
        height: size,
        background: avatarGradient(name || '云屿'),
        fontSize: Math.round(size * 0.38),
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  )
}

/* --------------------------------- modal --------------------------------- */

type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: ModalSize
  className?: string
  hideHeader?: boolean
  ariaLabel?: string
}

const FOCUSABLE =
  'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className = '',
  hideHeader = false,
  ariaLabel,
}: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const closeRef = useRef(onClose)

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    restoreFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const timer = window.setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      const target =
        panel.querySelector<HTMLElement>('[data-autofocus]') ??
        panel.querySelector<HTMLElement>(FOCUSABLE)
      target?.focus()
    }, 40)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      restoreFocus.current?.focus?.()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeRef.current()
      }}
    >
      <div
        ref={panelRef}
        className={`modal-panel modal-${size} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
      >
        {!hideHeader && (
          <div className="modal-head">
            <div className="modal-head-text">
              {title && (
                <h2 id={titleId} className="modal-title">
                  {title}
                </h2>
              )}
              {description && <p className="modal-desc">{description}</p>}
            </div>
            <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label="关闭">
              <X size={18} />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/* -------------------------------- dropdown -------------------------------- */

export interface DropdownItem {
  key: string
  label: ReactNode
  icon?: ReactNode
  onClick?: () => void
  danger?: boolean
  checked?: boolean
  disabled?: boolean
  separator?: boolean
}

interface DropdownProps {
  trigger: ReactNode
  items: DropdownItem[]
  align?: 'start' | 'end'
  direction?: 'down' | 'up'
  triggerClassName?: string
  ariaLabel?: string
  title?: string
  header?: ReactNode
  menuWidth?: number
}

export function Dropdown({
  trigger,
  items,
  align = 'end',
  direction = 'down',
  triggerClassName = 'icon-btn',
  ariaLabel,
  title,
  header,
  menuWidth,
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as globalThis.Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    const timer = window.setTimeout(() => {
      const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      first?.focus()
    }, 20)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.clearTimeout(timer)
    }
  }, [open])

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ??
        [],
    )
    if (buttons.length === 0) return
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      buttons[(index + 1) % buttons.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      buttons[(index - 1 + buttons.length) % buttons.length]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      buttons[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      buttons[buttons.length - 1]?.focus()
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div className={`dropdown ${open ? 'is-open' : ''}`} ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={menuRef}
          className={`dropdown-menu align-${align} dir-${direction}`}
          role="menu"
          style={menuWidth ? { minWidth: menuWidth } : undefined}
          onKeyDown={handleMenuKeyDown}
        >
          {header && <div className="dropdown-header">{header}</div>}
          {items.map((item) =>
            item.separator ? (
              <div key={item.key} className="dropdown-separator" role="separator" />
            ) : (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={`dropdown-item ${item.danger ? 'is-danger' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onClick?.()
                }}
              >
                {item.icon && <span className="dropdown-item-icon">{item.icon}</span>}
                <span className="dropdown-item-label">{item.label}</span>
                {item.checked && <Check size={15} className="dropdown-check" />}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}

/* -------------------------------- form bits ------------------------------- */

interface FieldProps {
  label?: ReactNode
  htmlFor?: string
  hint?: ReactNode
  error?: string | null
  children: ReactNode
  className?: string
}

export function Field({ label, htmlFor, hint, error, children, className = '' }: FieldProps) {
  return (
    <div className={`field ${className}`}>
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: string | null
  leading?: ReactNode
  trailing?: ReactNode
  containerClassName?: string
}

export function TextField({
  label,
  hint,
  error,
  leading,
  trailing,
  containerClassName = '',
  id,
  className = '',
  ...rest
}: TextFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  return (
    <Field
      label={label}
      htmlFor={inputId}
      hint={hint}
      error={error}
      className={containerClassName}
    >
      <span className={`input-shell ${leading ? 'has-leading' : ''} ${trailing ? 'has-trailing' : ''} ${error ? 'is-error' : ''}`}>
        {leading && <span className="input-affix">{leading}</span>}
        <input id={inputId} className={`input ${className}`} {...rest} />
        {trailing && <span className="input-affix">{trailing}</span>}
      </span>
    </Field>
  )
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: string | null
  options: Array<{ value: string; label: string }>
  containerClassName?: string
}

export function SelectField({
  label,
  hint,
  error,
  options,
  containerClassName = '',
  id,
  className = '',
  ...rest
}: SelectFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error} className={containerClassName}>
      <span className="select-shell">
        <select id={inputId} className={`select ${className}`} {...rest}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={16} className="select-chevron" aria-hidden="true" />
      </span>
    </Field>
  )
}

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: string | null
  containerClassName?: string
}

export function TextAreaField({
  label,
  hint,
  error,
  containerClassName = '',
  id,
  className = '',
  ...rest
}: TextAreaFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error} className={containerClassName}>
      <textarea id={inputId} className={`textarea ${className}`} {...rest} />
    </Field>
  )
}

/* ------------------------------- states ---------------------------------- */

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  compact?: boolean
}

export function EmptyState({ icon, title, description, action, compact = false }: EmptyStateProps) {
  return (
    <div className={`empty-state ${compact ? 'is-compact' : ''}`}>
      <div className="empty-orb">{icon}</div>
      <h3 className="empty-title">{title}</h3>
      {description && <p className="empty-desc">{description}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

export function ErrorState({
  title = '出了点问题',
  description,
  onRetry,
  retryLabel = '重新加载',
}: {
  title?: string
  description?: ReactNode
  onRetry?: () => void
  retryLabel?: string
}) {
  return (
    <div className="error-state">
      <div className="error-orb">
        <AlertTriangle size={26} />
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {onRetry && (
        <button type="button" className="btn btn-soft" onClick={onRetry}>
          <RefreshCw size={15} />
          {retryLabel}
        </button>
      )}
    </div>
  )
}

export function Skeleton({
  className = '',
  style,
}: {
  className?: string
  style?: CSSProperties
}) {
  return <span className={`skeleton ${className}`} style={style} aria-hidden="true" />
}

export function PageSpinner({ label = '加载中' }: { label?: string }) {
  return (
    <div className="page-spinner" role="status">
      <Spinner size={22} />
      <span>{label}</span>
    </div>
  )
}

/* ------------------------------ primary button ---------------------------- */

type ButtonVariant = 'primary' | 'ghost' | 'soft' | 'danger' | 'outline'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  loading?: boolean
  icon?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={15} /> : icon}
      {children && <span>{children}</span>}
    </button>
  )
}
