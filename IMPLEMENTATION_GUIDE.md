# YelloTalk Bot Dashboard - Implementation Guide

## Overview

This guide provides a step-by-step roadmap for implementing the YelloTalk bot control dashboard based on the design system outlined in DASHBOARD_DESIGN.md.

---

## Prerequisites

You already have:
- ✅ Next.js 16 (canary) installed
- ✅ shadcn/ui components configured
- ✅ Tailwind CSS set up
- ✅ Bot server (bot-server.js) running on port 3002
- ✅ Basic project structure

---

## Phase 1: Foundation (Days 1-2)

### 1.1 Update Color System

Add bot-specific colors to `app/globals.css`:

```css
@layer base {
  :root {
    /* Add after existing colors */
    --bot-running: 142 71% 45%;
    --bot-stopped: 220 9% 46%;
    --bot-starting: 38 92% 50%;
    --bot-error: 0 84% 60%;

    --chat-bg: 0 0% 98%;
    --chat-message-self: 221 83% 53%;
    --chat-message-other: 0 0% 96.1%;
    --chat-timestamp: 0 0% 63.9%;
  }

  .dark {
    --chat-bg: 0 0% 7%;
    --chat-message-self: 221 83% 43%;
    --chat-message-other: 0 0% 14.9%;
  }
}
```

### 1.2 Create Component Directory Structure

```bash
cd web-portal

# Create component directories
mkdir -p components/dashboard
mkdir -p components/control
mkdir -p components/common
mkdir -p hooks
mkdir -p lib/types
```

### 1.3 Create Type Definitions

Create `lib/types/bot.ts`:

```typescript
export type BotStatus = 'running' | 'stopped' | 'starting' | 'error' | 'disconnected'
export type BotMode = 'regular' | 'follow'

export interface Room {
  id: string
  name: string
  participants: number
  campus?: string
  owner?: {
    group_shortname: string
  }
  gme_id?: number
}

export interface Message {
  id: string
  sender: string
  message: string
  time: string
  isBot?: boolean
}

export interface Participant {
  id: string
  pin_name: string
  is_speaker?: boolean
  role?: string
  avatar_id?: number
}

export interface BotState {
  status: BotStatus
  mode: BotMode
  currentRoom: Room | null
  followUser: string | null
  messageCount: number
  participants: Participant[]
  messages: Message[]
  connected: boolean
  startTime: number | null
}

export interface Greeting {
  user: string
  message: string
}

export interface Keyword {
  keyword: string
  response: string
}
```

---

## Phase 2: Core Components (Days 3-5)

### 2.1 Implement Status Components

Copy from COMPONENT_LIBRARY.md:
- `components/common/status-badge.tsx`
- `components/common/connection-indicator.tsx`

### 2.2 Implement Metric Components

Copy from COMPONENT_LIBRARY.md:
- `components/dashboard/metric-card.tsx`
- `components/dashboard/stat-card.tsx`

### 2.3 Implement Utility Hooks

Copy from COMPONENT_LIBRARY.md:
- `hooks/use-websocket.ts`
- `hooks/use-format-uptime.ts`

### 2.4 Test Core Components

Create `app/test/page.tsx` to preview components:

```tsx
import { StatusBadge } from '@/components/common/status-badge'
import { MetricCard } from '@/components/dashboard/metric-card'
import { Activity, MessageSquare, Clock, Users } from 'lucide-react'

export default function TestPage() {
  return (
    <div className="space-y-8 p-8">
      <h1 className="text-2xl font-bold">Component Preview</h1>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Status Badges</h2>
        <div className="flex gap-4">
          <StatusBadge status="running" />
          <StatusBadge status="stopped" />
          <StatusBadge status="starting" />
          <StatusBadge status="error" />
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Metric Cards</h2>
        <div className="grid grid-cols-4 gap-4">
          <MetricCard
            title="Bot Status"
            value="Running"
            icon={<Activity className="w-4 h-4" />}
            badge={{ label: 'Active', variant: 'default' }}
          />
          <MetricCard
            title="Uptime"
            value="2h 34m"
            icon={<Clock className="w-4 h-4" />}
          />
          <MetricCard
            title="Messages"
            value={127}
            icon={<MessageSquare className="w-4 h-4" />}
            trend={{ value: 12, direction: 'up', label: 'from last hour' }}
          />
          <MetricCard
            title="Active Room"
            value="Tech Talk"
            icon={<Users className="w-4 h-4" />}
          />
        </div>
      </div>
    </div>
  )
}
```

---

## Phase 3: Dashboard Page (Days 6-7)

### 3.1 Create Dashboard Page

Create `app/page.tsx`:

```tsx
'use client'

import { useState, useEffect } from 'react'
import { PageHeader } from '@/components/common/page-header'
import { MetricCard } from '@/components/dashboard/metric-card'
import { StatCard } from '@/components/dashboard/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Activity, MessageSquare, Clock, Users, Play, Settings } from 'lucide-react'
import { useWebSocket } from '@/hooks/use-websocket'
import { useFormatUptime } from '@/hooks/use-format-uptime'
import { BotState } from '@/lib/types/bot'
import Link from 'next/link'

export default function DashboardPage() {
  const [botState, setBotState] = useState<BotState>({
    status: 'stopped',
    mode: 'regular',
    currentRoom: null,
    followUser: null,
    messageCount: 0,
    participants: [],
    messages: [],
    connected: false,
    startTime: null
  })

  const { isConnected, on } = useWebSocket({
    url: 'http://localhost:3002'
  })

  const uptime = useFormatUptime(botState.startTime)

  useEffect(() => {
    on('bot-state', (state: BotState) => {
      setBotState(state)
    })

    // Load initial state
    fetch('http://localhost:3002/api/bot/status')
      .then(res => res.json())
      .then(data => setBotState(data))
      .catch(console.error)
  }, [on])

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Monitor your YelloTalk bot at a glance"
        action={
          <div className="flex gap-2">
            <Link href="/control">
              <Button>
                <Play className="mr-2 w-4 h-4" />
                Control Bot
              </Button>
            </Link>
            <Link href="/greetings">
              <Button variant="outline">
                <Settings className="mr-2 w-4 h-4" />
                Settings
              </Button>
            </Link>
          </div>
        }
      />

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Bot Status"
          value={botState.status.charAt(0).toUpperCase() + botState.status.slice(1)}
          icon={<Activity className="w-4 h-4" />}
          badge={{
            label: botState.connected ? 'Connected' : 'Disconnected',
            variant: botState.connected ? 'default' : 'secondary'
          }}
        />

        <MetricCard
          title="Uptime"
          value={uptime || 'Not running'}
          icon={<Clock className="w-4 h-4" />}
          description={botState.startTime ? 'Running smoothly' : 'Start bot to begin'}
        />

        <MetricCard
          title="Messages Sent"
          value={botState.messageCount}
          icon={<MessageSquare className="w-4 h-4" />}
          trend={{
            value: 12,
            direction: 'up',
            label: 'from last hour'
          }}
        />

        <MetricCard
          title="Active Room"
          value={botState.currentRoom?.name || 'None'}
          icon={<Users className="w-4 h-4" />}
          description={
            botState.currentRoom
              ? `${botState.participants.length} participants`
              : 'No active room'
          }
        />
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {botState.messages.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No messages yet. Start the bot to see activity.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Sender</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {botState.messages.slice(-10).reverse().map((msg, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="text-muted-foreground">
                      {msg.time}
                    </TableCell>
                    <TableCell className="font-medium">
                      {msg.sender}
                    </TableCell>
                    <TableCell className="truncate max-w-md">
                      {msg.message}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

### 3.2 Create Common Components

Create `components/common/page-header.tsx` (copy from COMPONENT_LIBRARY.md)

---

## Phase 4: Control Page (Days 8-11)

### 4.1 Implement Chat Components

Copy from COMPONENT_LIBRARY.md:
- `components/control/chat-message.tsx`
- `components/control/chat-feed.tsx`
- `components/control/message-input.tsx`

### 4.2 Implement Control Components

Copy from COMPONENT_LIBRARY.md:
- `components/control/bot-control-panel.tsx`
- `components/control/participants-list.tsx`

### 4.3 Create Control Page

Create `app/control/page.tsx` (copy complete example from COMPONENT_LIBRARY.md)

### 4.4 Test Real-time Features

1. Start bot-server.js in one terminal
2. Start web portal in another terminal
3. Test:
   - Start/stop bot
   - Select different rooms
   - Send messages
   - Watch live chat updates
   - Monitor participant changes

---

## Phase 5: Settings Pages (Days 12-14)

### 5.1 Create Greetings Page

Create `app/greetings/page.tsx`:

```tsx
'use client'

import { useState, useEffect } from 'react'
import { PageHeader } from '@/components/common/page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Plus, Edit, Trash } from 'lucide-react'
import { Greeting } from '@/lib/types/bot'
import { useToast } from '@/hooks/use-toast'

export default function GreetingsPage() {
  const { toast } = useToast()
  const [greetings, setGreetings] = useState<Greeting[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingGreeting, setEditingGreeting] = useState<Greeting | null>(null)
  const [formData, setFormData] = useState({ user: '', message: '' })

  useEffect(() => {
    loadGreetings()
  }, [])

  const loadGreetings = async () => {
    try {
      const res = await fetch('/api/greetings')
      const data = await res.json()
      setGreetings(data.greetings || [])
    } catch (error) {
      console.error('Failed to load greetings:', error)
    }
  }

  const handleSave = async () => {
    try {
      const res = await fetch('/api/greetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })

      if (res.ok) {
        toast({
          title: "Greeting Saved",
          description: `Greeting for ${formData.user} has been saved`
        })
        loadGreetings()
        setDialogOpen(false)
        setFormData({ user: '', message: '' })
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save greeting",
        variant: "destructive"
      })
    }
  }

  const handleDelete = async (user: string) => {
    if (user === 'DEFAULT') return

    try {
      const res = await fetch(`/api/greetings?user=${user}`, {
        method: 'DELETE'
      })

      if (res.ok) {
        toast({
          title: "Greeting Deleted",
          description: `Greeting for ${user} has been removed`
        })
        loadGreetings()
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete greeting",
        variant: "destructive"
      })
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Greetings"
        description="Configure custom greetings for specific users"
        action={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 w-4 h-4" />
            Add Greeting
          </Button>
        }
      />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User Name</TableHead>
              <TableHead>Greeting Message</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {greetings.map((greeting) => (
              <TableRow key={greeting.user}>
                <TableCell className="font-medium">
                  {greeting.user}
                  {greeting.user === 'DEFAULT' && (
                    <Badge variant="outline" className="ml-2">Default</Badge>
                  )}
                </TableCell>
                <TableCell>{greeting.message}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setFormData(greeting)
                        setEditingGreeting(greeting)
                        setDialogOpen(true)
                      }}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    {greeting.user !== 'DEFAULT' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(greeting.user)}
                      >
                        <Trash className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingGreeting ? 'Edit Greeting' : 'Add Greeting'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>User Name</Label>
              <Input
                value={formData.user}
                onChange={(e) => setFormData({ ...formData, user: e.target.value })}
                placeholder="Enter username..."
                disabled={editingGreeting?.user === 'DEFAULT'}
              />
            </div>

            <div>
              <Label>Greeting Message</Label>
              <Input
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                placeholder="Enter greeting message..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false)
                setFormData({ user: '', message: '' })
                setEditingGreeting(null)
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleSave}>
              Save Greeting
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

### 5.2 Create Keywords Page

Create `app/keywords/page.tsx` (similar structure to greetings page)

---

## Phase 6: Navigation & Layout (Day 15)

### 6.1 Update Navigation

Update `app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { NavLink } from '@/components/common/nav-link'
import { Bot } from 'lucide-react'

export const metadata: Metadata = {
  title: 'YelloTalk Bot Portal',
  description: 'Professional bot control dashboard',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16 items-center">
              <div className="flex items-center space-x-8">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center shadow-lg">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                  <h1 className="text-xl font-bold">YelloTalk Bot</h1>
                </div>

                <nav className="flex space-x-1">
                  <NavLink href="/">Dashboard</NavLink>
                  <NavLink href="/control">Control</NavLink>
                  <NavLink href="/greetings">Greetings</NavLink>
                  <NavLink href="/keywords">Keywords</NavLink>
                </nav>
              </div>
            </div>
          </div>
        </nav>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>

        <Toaster />
      </body>
    </html>
  )
}
```

---

## Phase 7: Polish & Testing (Days 16-17)

### 7.1 Add Loading States

Create `app/control/loading.tsx`:

```tsx
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[400px] w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
```

### 7.2 Add Error Boundaries

Create `app/error.tsx`:

```tsx
'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertCircle } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Application error:', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
      <AlertCircle className="w-12 h-12 text-destructive" />
      <h2 className="text-2xl font-bold">Something went wrong!</h2>
      <p className="text-muted-foreground">{error.message}</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  )
}
```

### 7.3 Mobile Responsiveness Testing

Test on various screen sizes:
- Mobile (375px)
- Tablet (768px)
- Desktop (1024px+)

### 7.4 Accessibility Audit

- [ ] Keyboard navigation works
- [ ] All buttons have aria-labels
- [ ] Color contrast meets WCAG AA
- [ ] Screen reader compatible
- [ ] Focus indicators visible

---

## Phase 8: Deployment Preparation (Day 18)

### 8.1 Environment Variables

Create `.env.local`:

```bash
NEXT_PUBLIC_BOT_SERVER_URL=http://localhost:3002
NEXT_PUBLIC_WS_URL=http://localhost:3002
```

### 8.2 Build & Test

```bash
npm run build
npm run start
```

### 8.3 Performance Optimization

- Lazy load heavy components
- Optimize images
- Enable React strict mode
- Add meta tags for SEO

---

## Testing Checklist

### Functionality
- [ ] Bot starts successfully
- [ ] Bot stops successfully
- [ ] Room selection works
- [ ] Messages send correctly
- [ ] Live chat updates in real-time
- [ ] Participant list updates
- [ ] Greetings CRUD operations
- [ ] Keywords CRUD operations
- [ ] Navigation between pages works
- [ ] Toast notifications appear

### UI/UX
- [ ] All pages load without errors
- [ ] Loading states show appropriately
- [ ] Buttons have proper disabled states
- [ ] Forms validate correctly
- [ ] Responsive on mobile/tablet/desktop
- [ ] Dark mode works (if implemented)
- [ ] Animations smooth and not jarring
- [ ] Typography readable and consistent

### Performance
- [ ] Page load < 2 seconds
- [ ] WebSocket connects quickly
- [ ] Chat scrolls smoothly
- [ ] No memory leaks
- [ ] No console errors

---

## Common Issues & Solutions

### Issue: WebSocket Won't Connect

**Solution**: Ensure bot-server.js is running on port 3002 and CORS is properly configured.

```javascript
// bot-server.js
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5252',
    credentials: true
  }
});
```

### Issue: Messages Not Displaying

**Solution**: Check that message IDs are unique and properly formatted.

```typescript
const messageWithId = {
  ...message,
  id: `${Date.now()}-${Math.random()}`
}
```

### Issue: Status Not Updating

**Solution**: Verify WebSocket event listeners are set up before bot state changes.

```typescript
useEffect(() => {
  on('bot-state', (state) => {
    setBotState(state)
  })
}, [on])
```

---

## Maintenance & Updates

### Regular Tasks
- Monitor WebSocket connections
- Review and update greetings
- Add new keyword responses
- Check bot uptime and performance
- Update dependencies monthly

### Future Enhancements
- Analytics dashboard with charts
- Bot behavior customization
- Multiple bot instances
- Scheduled messages
- Admin user management
- Export chat logs
- Custom themes

---

## Resources

### Documentation
- [Next.js Docs](https://nextjs.org/docs)
- [shadcn/ui Components](https://ui.shadcn.com)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Socket.IO Client](https://socket.io/docs/v4/client-api/)

### Design References
- DASHBOARD_DESIGN.md - Complete design system
- WIREFRAMES.md - Visual layouts
- COMPONENT_LIBRARY.md - Code examples

---

## Support

For questions or issues:
1. Check this implementation guide
2. Review component library examples
3. Verify bot-server.js is running correctly
4. Check browser console for errors
5. Test WebSocket connection manually

---

**Happy Building!** 🚀

Your YelloTalk bot dashboard will be a professional, modern interface that makes bot management effortless.
