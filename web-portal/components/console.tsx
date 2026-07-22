'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/** Original playful bot mascot — a cheerful yellow character with headphones. */
export function BrandMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn('inline-flex shrink-0', className)}
      style={{ width: size, height: size, filter: 'drop-shadow(0 3px 5px rgba(230,150,0,0.32))' }}
    >
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
        <defs>
          <linearGradient id="ytFace" x1="24" y1="8" x2="24" y2="42" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFD64F" />
            <stop offset="1" stopColor="#F4B000" />
          </linearGradient>
        </defs>
        {/* antenna */}
        <path d="M24 9V5" stroke="#EDA800" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="24" cy="3.4" r="2.5" fill="#FF5C8A" />
        {/* headphone cups (behind head) */}
        <rect x="3.5" y="20" width="5" height="9" rx="2.5" fill="#F0AE00" />
        <rect x="39.5" y="20" width="5" height="9" rx="2.5" fill="#F0AE00" />
        {/* head */}
        <rect x="6" y="8" width="36" height="33" rx="13" fill="url(#ytFace)" stroke="#E09E00" strokeWidth="1.3" />
        {/* cheeks */}
        <ellipse cx="14.5" cy="30.5" rx="3.3" ry="2.1" fill="#FF7BA5" opacity="0.5" />
        <ellipse cx="33.5" cy="30.5" rx="3.3" ry="2.1" fill="#FF7BA5" opacity="0.5" />
        {/* eyes */}
        <ellipse cx="18" cy="24" rx="4.3" ry="5.1" fill="#FFFFFF" />
        <ellipse cx="30" cy="24" rx="4.3" ry="5.1" fill="#FFFFFF" />
        <circle cx="19" cy="24.6" r="2.4" fill="#2A2113" />
        <circle cx="31" cy="24.6" r="2.4" fill="#2A2113" />
        <circle cx="18.1" cy="23.4" r="0.9" fill="#FFFFFF" />
        <circle cx="30.1" cy="23.4" r="0.9" fill="#FFFFFF" />
        {/* grin */}
        <path d="M19.5 32.4C21.6 35.2 26.4 35.2 28.5 32.4" stroke="#2A2113" strokeWidth="2.1" strokeLinecap="round" />
      </svg>
    </span>
  )
}

/** Uppercase eyebrow label, optionally with a leading accent code. */
export function Label({
  children,
  code,
  className,
}: {
  children: React.ReactNode
  code?: string
  className?: string
}) {
  return (
    <span className={cn('microlabel inline-flex items-center gap-2', className)}>
      {code && <span className="text-gold">{code}</span>}
      {children}
    </span>
  )
}

/** Clean card surface. */
export function Panel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('panel', className)} {...props}>
      {children}
    </div>
  )
}

/** Panel header: eyebrow + title, optional description and right slot. */
export function PanelHead({
  label,
  title,
  desc,
  right,
  className,
}: {
  label?: string
  title: React.ReactNode
  desc?: React.ReactNode
  right?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-line px-5 py-4', className)}>
      <div className="min-w-0">
        {label && <div className="microlabel mb-1.5">{label}</div>}
        <h3 className="font-display text-base font-semibold tracking-tight text-ink">{title}</h3>
        {desc && <p className="mt-0.5 text-sm text-dim">{desc}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  )
}

/** Big value over a small label. */
export function Readout({
  label,
  value,
  unit,
  tone = 'ink',
  className,
}: {
  label: string
  value: React.ReactNode
  unit?: string
  tone?: 'ink' | 'gold' | 'ok' | 'warn' | 'err' | 'side' | 'glow'
  className?: string
}) {
  const toneClass = {
    ink: 'text-ink',
    gold: 'text-gold',
    ok: 'text-ok',
    warn: 'text-warn',
    err: 'text-err',
    side: 'text-side',
    glow: 'text-glow',
  }[tone]
  return (
    <div className={cn('px-5 py-4', className)}>
      <div className="microlabel mb-2">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className={cn('font-display text-3xl font-semibold leading-none tracking-tight tabular-nums', toneClass)}>
          {value}
        </span>
        {unit && <span className="text-xs font-medium text-faint">{unit}</span>}
      </div>
    </div>
  )
}

type PillState = 'live' | 'wait' | 'idle' | 'err' | 'music'

/** Soft status pill with a haloed dot. */
export function StatusPill({
  state,
  children,
  className,
}: {
  state: PillState
  children: React.ReactNode
  className?: string
}) {
  const tint: Record<PillState, string> = {
    live: 'bg-ok/10 text-ok',
    wait: 'bg-warn/10 text-warn',
    idle: 'bg-panel text-dim',
    err: 'bg-err/10 text-err',
    music: 'bg-glow/10 text-glow',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold',
        tint[state],
        className
      )}
    >
      <span className={cn('dot', `dot-${state}`)} />
      {children}
    </span>
  )
}
