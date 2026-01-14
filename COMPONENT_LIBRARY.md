# YelloTalk Bot Dashboard - Component Library

## Overview
This document provides ready-to-use React/TypeScript components for the YelloTalk bot dashboard using shadcn/ui and Tailwind CSS.

---

## Table of Contents
1. [Status Components](#status-components)
2. [Metric Components](#metric-components)
3. [Chat Components](#chat-components)
4. [Control Components](#control-components)
5. [Layout Components](#layout-components)
6. [Utility Hooks](#utility-hooks)

---

## Status Components

### 1. StatusBadge

**Purpose**: Display bot status with appropriate color coding

**File**: `components/status-badge.tsx`

```tsx
import { Badge } from '@/components/ui/badge'
import { CheckCircle, Circle, Loader2, AlertCircle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

type BotStatus = 'running' | 'stopped' | 'starting' | 'error' | 'disconnected'

interface StatusBadgeProps {
  status: BotStatus
  className?: string
  showIcon?: boolean
}

export function StatusBadge({ status, className, showIcon = true }: StatusBadgeProps) {
  const statusConfig = {
    running: {
      label: 'Running',
      icon: CheckCircle,
      className: 'bg-green-500 hover:bg-green-600 text-white',
      iconClassName: 'w-3 h-3'
    },
    stopped: {
      label: 'Stopped',
      icon: Circle,
      className: 'bg-gray-400 hover:bg-gray-500 text-white',
      iconClassName: 'w-3 h-3'
    },
    starting: {
      label: 'Starting...',
      icon: Loader2,
      className: 'bg-yellow-500 hover:bg-yellow-600 text-white animate-pulse',
      iconClassName: 'w-3 h-3 animate-spin'
    },
    error: {
      label: 'Error',
      icon: AlertCircle,
      className: 'bg-red-500 hover:bg-red-600 text-white',
      iconClassName: 'w-3 h-3'
    },
    disconnected: {
      label: 'Disconnected',
      icon: XCircle,
      className: 'bg-red-400 hover:bg-red-500 text-white',
      iconClassName: 'w-3 h-3'
    }
  }

  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <Badge className={cn(config.className, className)}>
      {showIcon && <Icon className={config.iconClassName} />}
      <span className="ml-1.5">{config.label}</span>
    </Badge>
  )
}
```

**Usage**:
```tsx
<StatusBadge status="running" />
<StatusBadge status="stopped" showIcon={false} />
<StatusBadge status="error" className="text-lg" />
```

---

### 2. ConnectionIndicator

**Purpose**: Show live connection status with animated pulse

**File**: `components/connection-indicator.tsx`

```tsx
import { cn } from '@/lib/utils'

interface ConnectionIndicatorProps {
  isConnected: boolean
  label?: string
  className?: string
}

export function ConnectionIndicator({
  isConnected,
  label = 'Connected',
  className
}: ConnectionIndicatorProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className={cn(
        "w-2 h-2 rounded-full",
        isConnected
          ? "bg-green-500 animate-pulse"
          : "bg-gray-400"
      )} />
      <span className={cn(
        "text-sm font-medium",
        isConnected ? "text-green-600" : "text-gray-500"
      )}>
        {isConnected ? label : 'Disconnected'}
      </span>
    </div>
  )
}
```

**Usage**:
```tsx
<ConnectionIndicator isConnected={botState.connected} />
<ConnectionIndicator isConnected={false} label="WebSocket" />
```

---

## Metric Components

### 3. MetricCard

**Purpose**: Display key metrics with icons and optional trends

**File**: `components/metric-card.tsx`

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MetricCardProps {
  title: string
  value: string | number
  icon: React.ReactNode
  description?: string
  trend?: {
    value: number
    direction: 'up' | 'down'
    label?: string
  }
  badge?: {
    label: string
    variant?: 'default' | 'secondary' | 'destructive' | 'outline'
  }
  className?: string
}

export function MetricCard({
  title,
  value,
  icon,
  description,
  trend,
  badge,
  className
}: MetricCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div className="text-muted-foreground">
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>

        {description && (
          <p className="text-xs text-muted-foreground mt-1">
            {description}
          </p>
        )}

        {trend && (
          <div className={cn(
            "flex items-center gap-1 mt-2 text-xs font-medium",
            trend.direction === 'up' ? "text-green-600" : "text-red-600"
          )}>
            {trend.direction === 'up' ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            <span>{trend.value}%</span>
            {trend.label && (
              <span className="text-muted-foreground ml-1">{trend.label}</span>
            )}
          </div>
        )}

        {badge && (
          <div className="mt-2">
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

**Usage**:
```tsx
<MetricCard
  title="Messages Sent"
  value={127}
  icon={<MessageSquare className="w-4 h-4" />}
  trend={{ value: 12, direction: 'up', label: 'from last hour' }}
/>

<MetricCard
  title="Bot Status"
  value="Running"
  icon={<Activity className="w-4 h-4" />}
  badge={{ label: 'Active', variant: 'default' }}
/>
```

---

### 4. StatCard

**Purpose**: Simplified metric card without trends

**File**: `components/stat-card.tsx`

```tsx
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string | number
  icon?: React.ReactNode
  color?: 'default' | 'success' | 'warning' | 'error'
  className?: string
}

export function StatCard({ label, value, icon, color = 'default', className }: StatCardProps) {
  const colorClasses = {
    default: 'border-l-blue-500',
    success: 'border-l-green-500',
    warning: 'border-l-yellow-500',
    error: 'border-l-red-500'
  }

  return (
    <Card className={cn('border-l-4', colorClasses[color], className)}>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-sm text-muted-foreground font-medium">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
          </div>
          {icon && (
            <div className="text-muted-foreground">
              {icon}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
```

**Usage**:
```tsx
<StatCard label="Active Room" value="Tech Talk" color="success" />
<StatCard label="Uptime" value="2h 34m" icon={<Clock />} />
```

---

## Chat Components

### 5. ChatMessage

**Purpose**: Display individual chat messages with sender info

**File**: `components/chat-message.tsx`

```tsx
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

interface ChatMessageProps {
  sender: string
  message: string
  time: string
  isBot?: boolean
  avatar?: string
}

export function ChatMessage({ sender, message, time, isBot = false, avatar }: ChatMessageProps) {
  return (
    <div className={cn(
      "flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200",
      isBot && "flex-row-reverse"
    )}>
      <Avatar className="w-8 h-8 flex-shrink-0">
        <AvatarFallback className={cn(
          "text-sm font-medium",
          isBot ? "bg-primary text-primary-foreground" : "bg-muted"
        )}>
          {sender[0]?.toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className={cn(
        "flex-1 space-y-1 max-w-[80%]",
        isBot && "text-right"
      )}>
        <div className={cn(
          "flex items-center gap-2 text-xs",
          isBot && "flex-row-reverse"
        )}>
          <span className="font-medium text-foreground">{sender}</span>
          <span className="text-muted-foreground">{time}</span>
        </div>

        <div className={cn(
          "inline-block px-4 py-2 rounded-lg text-sm break-words",
          isBot
            ? "bg-primary text-primary-foreground rounded-tr-none"
            : "bg-muted rounded-tl-none"
        )}>
          {message}
        </div>
      </div>
    </div>
  )
}
```

**Usage**:
```tsx
<ChatMessage
  sender="Alice"
  message="Hello everyone!"
  time="14:32"
/>

<ChatMessage
  sender="YelloBot"
  message="Welcome Alice!"
  time="14:32"
  isBot={true}
/>
```

---

### 6. ChatFeed

**Purpose**: Scrollable chat feed with auto-scroll

**File**: `components/chat-feed.tsx`

```tsx
'use client'

import { useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { MessageSquare } from 'lucide-react'
import { ChatMessage } from './chat-message'

interface Message {
  id: string
  sender: string
  message: string
  time: string
  isBot?: boolean
}

interface ChatFeedProps {
  messages: Message[]
  isConnected: boolean
  botName?: string
}

export function ChatFeed({ messages, isConnected, botName = 'YelloBot' }: ChatFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  return (
    <Card className="h-[600px] flex flex-col">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            <span>Live Chat</span>
          </div>
          <Badge variant="outline" className="gap-1.5">
            <div className={cn(
              "w-2 h-2 rounded-full",
              isConnected ? "bg-green-500 animate-pulse" : "bg-gray-400"
            )} />
            {messages.length} messages
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 p-0">
        <ScrollArea className="h-full p-4">
          <div className="space-y-4">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <p className="text-sm">No messages yet. Start the bot to see live chat.</p>
              </div>
            ) : (
              messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  sender={msg.sender}
                  message={msg.message}
                  time={msg.time}
                  isBot={msg.sender === botName}
                />
              ))
            )}
            <div ref={scrollRef} />
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
```

**Usage**:
```tsx
const messages = [
  { id: '1', sender: 'Alice', message: 'Hello!', time: '14:32' },
  { id: '2', sender: 'YelloBot', message: 'Welcome!', time: '14:32' }
]

<ChatFeed messages={messages} isConnected={true} botName="YelloBot" />
```

---

### 7. MessageInput

**Purpose**: Input field for sending messages

**File**: `components/message-input.tsx`

```tsx
'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Send } from 'lucide-react'

interface MessageInputProps {
  onSend: (message: string) => void
  disabled?: boolean
  placeholder?: string
}

export function MessageInput({
  onSend,
  disabled = false,
  placeholder = "Type a message..."
}: MessageInputProps) {
  const [message, setMessage] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (message.trim()) {
      onSend(message.trim())
      setMessage('')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1"
      />
      <Button
        type="submit"
        disabled={disabled || !message.trim()}
        size="icon"
      >
        <Send className="w-4 h-4" />
      </Button>
    </form>
  )
}
```

**Usage**:
```tsx
<MessageInput
  onSend={(msg) => sendMessage(msg)}
  disabled={botStatus !== 'running'}
/>
```

---

## Control Components

### 8. BotControlPanel

**Purpose**: Main control panel for bot operations

**File**: `components/bot-control-panel.tsx`

```tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Settings, Play, Square, MessageCircle, UserPlus, MapPin, Users } from 'lucide-react'
import { StatusBadge } from './status-badge'

type BotMode = 'regular' | 'follow'
type BotStatus = 'running' | 'stopped' | 'starting' | 'error'

interface Room {
  id: string
  name: string
  participants: number
  campus?: string
}

interface BotControlPanelProps {
  status: BotStatus
  mode: BotMode
  selectedRoom: string | null
  rooms: Room[]
  uptime?: string
  currentRoom?: Room
  participantCount?: number
  onModeChange: (mode: BotMode) => void
  onRoomChange: (roomId: string) => void
  onStart: () => void
  onStop: () => void
}

export function BotControlPanel({
  status,
  mode,
  selectedRoom,
  rooms,
  uptime,
  currentRoom,
  participantCount = 0,
  onModeChange,
  onRoomChange,
  onStart,
  onStop
}: BotControlPanelProps) {
  const isRunning = status === 'running'
  const isStarting = status === 'starting'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Bot Controls
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Status Display */}
        <div className="p-4 rounded-lg bg-muted/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Status</span>
            <StatusBadge status={status} />
          </div>
          <div className="text-xs text-muted-foreground">
            {uptime ? `Running for ${uptime}` : 'Not running'}
          </div>
        </div>

        <Separator />

        {/* Mode Selection */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Bot Mode</Label>
          <RadioGroup
            value={mode}
            onValueChange={(value) => onModeChange(value as BotMode)}
            disabled={isRunning}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="regular" id="regular" />
              <Label
                htmlFor="regular"
                className="flex items-center gap-2 cursor-pointer"
              >
                <MessageCircle className="w-4 h-4" />
                Regular Room
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="follow" id="follow" />
              <Label
                htmlFor="follow"
                className="flex items-center gap-2 cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                Follow User
              </Label>
            </div>
          </RadioGroup>
        </div>

        <Separator />

        {/* Room Selection */}
        {mode === 'regular' && (
          <div className="space-y-3">
            <Label className="text-sm font-medium">Select Room</Label>
            <Select
              value={selectedRoom || ''}
              onValueChange={onRoomChange}
              disabled={isRunning}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a room..." />
              </SelectTrigger>
              <SelectContent>
                {rooms.map(room => (
                  <SelectItem key={room.id} value={room.id}>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      <span>{room.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        ({room.participants} users)
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Separator />

        {/* Action Buttons */}
        <div className="space-y-2">
          {!isRunning ? (
            <Button
              className="w-full"
              size="lg"
              onClick={onStart}
              disabled={!selectedRoom || isStarting}
            >
              <Play className="mr-2 w-4 h-4" />
              {isStarting ? 'Starting...' : 'Start Bot'}
            </Button>
          ) : (
            <Button
              className="w-full"
              size="lg"
              variant="destructive"
              onClick={onStop}
            >
              <Square className="mr-2 w-4 h-4" />
              Stop Bot
            </Button>
          )}
        </div>

        {/* Room Info (when running) */}
        {isRunning && currentRoom && (
          <>
            <Separator />
            <div className="space-y-2 text-sm">
              <div className="font-medium text-foreground mb-2">Room Information</div>
              {currentRoom.campus && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="w-4 h-4" />
                  <span>Campus: {currentRoom.campus}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="w-4 h-4" />
                <span>{participantCount} participants</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
```

**Usage**:
```tsx
<BotControlPanel
  status={botStatus}
  mode={mode}
  selectedRoom={selectedRoomId}
  rooms={availableRooms}
  uptime="2h 34m"
  currentRoom={currentRoom}
  participantCount={8}
  onModeChange={setMode}
  onRoomChange={setSelectedRoomId}
  onStart={handleStart}
  onStop={handleStop}
/>
```

---

### 9. ParticipantsList

**Purpose**: Display room participants with roles

**File**: `components/participants-list.tsx`

```tsx
'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Users, ChevronDown, ChevronUp, Mic, MicOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Participant {
  id: string
  pin_name: string
  is_speaker?: boolean
  role?: string
}

interface ParticipantsListProps {
  participants: Participant[]
  className?: string
  defaultOpen?: boolean
}

export function ParticipantsList({
  participants,
  className,
  defaultOpen = true
}: ParticipantsListProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <Card className={className}>
      <CardHeader
        className="cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            <span>Participants ({participants.length})</span>
          </div>
          {isOpen ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </CardTitle>
      </CardHeader>

      {isOpen && (
        <CardContent>
          <div className="space-y-2">
            {participants.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No participants yet
              </p>
            ) : (
              participants.map((participant) => (
                <div
                  key={participant.id}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="w-9 h-9">
                      <AvatarFallback className="text-sm font-medium">
                        {participant.pin_name[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-medium text-sm">
                        {participant.pin_name}
                      </div>
                      {participant.role && (
                        <div className="text-xs text-muted-foreground">
                          {participant.role}
                        </div>
                      )}
                    </div>
                  </div>

                  <Badge
                    variant={participant.is_speaker ? "default" : "secondary"}
                    className="gap-1.5"
                  >
                    {participant.is_speaker ? (
                      <>
                        <Mic className="w-3 h-3" />
                        Speaking
                      </>
                    ) : (
                      <>
                        <MicOff className="w-3 h-3" />
                        Listening
                      </>
                    )}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}
```

**Usage**:
```tsx
const participants = [
  { id: '1', pin_name: 'Alice', is_speaker: true },
  { id: '2', pin_name: 'Bob', is_speaker: false, role: 'Moderator' }
]

<ParticipantsList participants={participants} />
```

---

## Layout Components

### 10. PageHeader

**Purpose**: Consistent page headers with title and description

**File**: `components/page-header.tsx`

```tsx
interface PageHeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}
```

**Usage**:
```tsx
<PageHeader
  title="Bot Control"
  description="Manage your YelloTalk bot in real-time"
  action={<Button>Start Bot</Button>}
/>
```

---

### 11. NavLink

**Purpose**: Active-state aware navigation links

**File**: `components/nav-link.tsx`

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface NavLinkProps {
  href: string
  children: React.ReactNode
  className?: string
}

export function NavLink({ href, children, className }: NavLinkProps) {
  const pathname = usePathname()
  const isActive = pathname === href

  return (
    <Link
      href={href}
      className={cn(
        "px-3 py-2 text-sm font-medium rounded-md transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 text-muted-foreground hover:text-foreground",
        className
      )}
    >
      {children}
    </Link>
  )
}
```

**Usage**:
```tsx
<NavLink href="/">Dashboard</NavLink>
<NavLink href="/control">Control</NavLink>
```

---

## Utility Hooks

### 12. useWebSocket

**Purpose**: WebSocket connection management

**File**: `hooks/use-websocket.ts`

```tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'

interface UseWebSocketOptions {
  url: string
  autoConnect?: boolean
}

export function useWebSocket({ url, autoConnect = true }: UseWebSocketOptions) {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!autoConnect) return

    const socketInstance = io(url, {
      transports: ['websocket']
    })

    socketInstance.on('connect', () => {
      setIsConnected(true)
      setError(null)
    })

    socketInstance.on('disconnect', () => {
      setIsConnected(false)
    })

    socketInstance.on('connect_error', (err) => {
      setError(err)
      setIsConnected(false)
    })

    setSocket(socketInstance)

    return () => {
      socketInstance.disconnect()
    }
  }, [url, autoConnect])

  const emit = useCallback((event: string, data: any) => {
    if (socket) {
      socket.emit(event, data)
    }
  }, [socket])

  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    if (socket) {
      socket.on(event, handler)
    }
  }, [socket])

  const off = useCallback((event: string, handler?: (...args: any[]) => void) => {
    if (socket) {
      socket.off(event, handler)
    }
  }, [socket])

  return {
    socket,
    isConnected,
    error,
    emit,
    on,
    off
  }
}
```

**Usage**:
```tsx
const { isConnected, emit, on } = useWebSocket({
  url: 'http://localhost:3002'
})

useEffect(() => {
  on('bot-state', (state) => {
    setBotState(state)
  })
}, [on])

const sendMessage = (message: string) => {
  emit('send-message', { message })
}
```

---

### 13. useFormatUptime

**Purpose**: Format uptime duration

**File**: `hooks/use-format-uptime.ts`

```tsx
import { useEffect, useState } from 'react'

export function useFormatUptime(startTime: number | null) {
  const [uptime, setUptime] = useState<string>('')

  useEffect(() => {
    if (!startTime) {
      setUptime('')
      return
    }

    const updateUptime = () => {
      const now = Date.now()
      const diff = now - startTime

      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((diff % (1000 * 60)) / 1000)

      if (hours > 0) {
        setUptime(`${hours}h ${minutes}m`)
      } else if (minutes > 0) {
        setUptime(`${minutes}m ${seconds}s`)
      } else {
        setUptime(`${seconds}s`)
      }
    }

    updateUptime()
    const interval = setInterval(updateUptime, 1000)

    return () => clearInterval(interval)
  }, [startTime])

  return uptime
}
```

**Usage**:
```tsx
const uptime = useFormatUptime(botState.startTime)
// Returns: "2h 34m" or "45m 12s" or "30s"
```

---

## Complete Example: Control Page

**File**: `app/control/page.tsx`

```tsx
'use client'

import { useState, useEffect } from 'react'
import { PageHeader } from '@/components/page-header'
import { BotControlPanel } from '@/components/bot-control-panel'
import { ChatFeed } from '@/components/chat-feed'
import { ParticipantsList } from '@/components/participants-list'
import { MessageInput } from '@/components/message-input'
import { useWebSocket } from '@/hooks/use-websocket'
import { useFormatUptime } from '@/hooks/use-format-uptime'
import { useToast } from '@/hooks/use-toast'

export default function ControlPage() {
  const { toast } = useToast()
  const { isConnected, emit, on } = useWebSocket({
    url: 'http://localhost:3002'
  })

  const [botState, setBotState] = useState({
    status: 'stopped',
    mode: 'regular',
    currentRoom: null,
    messageCount: 0,
    participants: [],
    messages: [],
    startTime: null
  })

  const [selectedRoom, setSelectedRoom] = useState<string | null>(null)
  const [rooms, setRooms] = useState([])

  const uptime = useFormatUptime(botState.startTime)

  // Load rooms
  useEffect(() => {
    fetch('http://localhost:3002/api/bot/rooms')
      .then(res => res.json())
      .then(data => setRooms(data.rooms || []))
      .catch(console.error)
  }, [])

  // Listen to WebSocket events
  useEffect(() => {
    on('bot-state', (state) => {
      setBotState(state)
    })

    on('new-message', (message) => {
      setBotState(prev => ({
        ...prev,
        messages: [...prev.messages, message]
      }))
    })
  }, [on])

  const handleStart = async () => {
    try {
      const res = await fetch('http://localhost:3002/api/bot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: botState.mode,
          roomId: selectedRoom
        })
      })

      if (res.ok) {
        toast({
          title: "Bot Started",
          description: "Successfully connected to room"
        })
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to start bot",
        variant: "destructive"
      })
    }
  }

  const handleStop = async () => {
    try {
      await fetch('http://localhost:3002/api/bot/stop', {
        method: 'POST'
      })

      toast({
        title: "Bot Stopped",
        description: "Bot has been disconnected"
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to stop bot",
        variant: "destructive"
      })
    }
  }

  const handleSendMessage = (message: string) => {
    emit('send-message', { message })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bot Control"
        description="Manage your YelloTalk bot in real-time"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Controls */}
        <div className="lg:col-span-1">
          <BotControlPanel
            status={botState.status}
            mode={botState.mode}
            selectedRoom={selectedRoom}
            rooms={rooms}
            uptime={uptime}
            currentRoom={botState.currentRoom}
            participantCount={botState.participants.length}
            onModeChange={(mode) => setBotState(prev => ({ ...prev, mode }))}
            onRoomChange={setSelectedRoom}
            onStart={handleStart}
            onStop={handleStop}
          />
        </div>

        {/* Right Column - Chat & Participants */}
        <div className="lg:col-span-2 space-y-6">
          <div className="space-y-4">
            <ChatFeed
              messages={botState.messages}
              isConnected={isConnected}
              botName="YelloBot"
            />

            <MessageInput
              onSend={handleSendMessage}
              disabled={botState.status !== 'running'}
            />
          </div>

          <ParticipantsList participants={botState.participants} />
        </div>
      </div>
    </div>
  )
}
```

---

This component library provides all the building blocks needed to create a professional, modern bot control dashboard. All components are:

- Fully typed with TypeScript
- Built with shadcn/ui components
- Styled with Tailwind CSS
- Responsive and accessible
- Production-ready

Copy these components into your project and customize as needed!
