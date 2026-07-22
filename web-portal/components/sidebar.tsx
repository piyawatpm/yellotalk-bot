'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, SlidersHorizontal, MessageSquare, Zap, Menu, X, Sun, Moon } from 'lucide-react'
import io from 'socket.io-client'
import { cn } from '@/lib/utils'
import { resolveApiUrl } from '@/lib/api'
import { BrandMark } from '@/components/console'

const NAV = [
  { href: '/', label: 'Overview', code: 'OPS', icon: LayoutDashboard },
  { href: '/control', label: 'Control', code: 'CTL', icon: SlidersHorizontal },
  { href: '/greetings', label: 'Greetings', code: 'GRT', icon: MessageSquare },
  { href: '/keywords', label: 'Keywords', code: 'KEY', icon: Zap },
] as const

function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const saved = (typeof document !== 'undefined' && document.documentElement.dataset.theme) as
      | 'light'
      | 'dark'
      | undefined
    setTheme(saved === 'dark' ? 'dark' : 'light')
  }, [])

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('yt-theme', next)
    } catch {}
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      className="inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-raised px-3 text-xs font-medium text-dim transition-colors hover:border-linehi hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
    >
      {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}

function LinkStatus() {
  const [connected, setConnected] = useState<boolean | null>(null)

  useEffect(() => {
    let socket: ReturnType<typeof io> | undefined
    resolveApiUrl().then((url) => {
      socket = io(url, { reconnection: true, reconnectionDelay: 2000 })
      socket.on('connect', () => setConnected(true))
      socket.on('disconnect', () => setConnected(false))
      socket.on('connect_error', () => setConnected(false))
    })
    return () => {
      if (socket) socket.disconnect()
    }
  }, [])

  const state = connected === null ? 'idle' : connected ? 'live' : 'err'
  const text = connected === null ? 'Standby' : connected ? 'Linked' : 'No link'

  return (
    <div className="flex items-center justify-between rounded-lg border border-line bg-base px-3 py-2">
      <span className="text-xs font-medium text-faint">Bot server</span>
      <span className="inline-flex items-center gap-2">
        <span className={cn('dot', `dot-${state === 'err' ? 'err' : state === 'live' ? 'live' : 'idle'}`)} />
        <span className="text-xs font-semibold text-ink">{text}</span>
      </span>
    </div>
  )
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="space-y-1">
      {NAV.map((item) => {
        const Icon = item.icon
        const active = pathname === item.href
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors',
              active ? 'bg-gold/10 text-gold' : 'text-dim hover:bg-panel hover:text-ink'
            )}
          >
            <Icon className={cn('h-[18px] w-[18px]', active ? 'text-gold' : 'text-faint group-hover:text-dim')} />
            <span className="flex-1 text-sm font-medium">{item.label}</span>
            <span className={cn('text-[10px] font-semibold tracking-wide', active ? 'text-gold/70' : 'text-faint')}>
              {item.code}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}

function Wordmark() {
  return (
    <div className="flex items-center gap-3">
      <BrandMark size={34} />
      <div className="leading-tight">
        <div className="font-display text-[15px] font-bold tracking-tight text-ink">YelloTalk</div>
        <div className="text-[11px] font-medium text-faint">Signal Ops</div>
      </div>
    </div>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <>
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-raised lg:flex">
        <div className="flex h-16 items-center px-5">
          <Wordmark />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <div className="microlabel px-3 pb-2 text-[10px]">Console</div>
          <NavList pathname={pathname} />
        </div>
        <div className="space-y-2 border-t border-line p-3">
          <LinkStatus />
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-medium text-faint">v2.0</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-raised/80 px-4 backdrop-blur-md lg:hidden">
        <Wordmark />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-raised text-dim"
        >
          {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-line bg-raised">
            <div className="flex h-14 items-center justify-between border-b border-line px-4">
              <Wordmark />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-raised text-dim"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4">
              <div className="microlabel px-3 pb-2 text-[10px]">Console</div>
              <NavList pathname={pathname} onNavigate={() => setOpen(false)} />
            </div>
            <div className="space-y-2 border-t border-line p-3">
              <LinkStatus />
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-medium text-faint">v2.0</span>
                <ThemeToggle />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
