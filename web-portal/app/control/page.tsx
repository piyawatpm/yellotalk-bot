'use client'

import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Play,
  Square,
  Users,
  Radio,
  MessageSquare,
  Clock,
  RefreshCw,
  Loader2,
  Send,
  Settings2,
  Zap,
  Wifi,
  WifiOff,
  CheckCircle2,
  Circle,
  Crown,
  Lock,
  Unlock,
  Volume2,
  VolumeX,
  Mic,
  UserX,
  Bot,
  Plus,
  Trash2
} from 'lucide-react'
import io from 'socket.io-client'
import { useToast } from '@/hooks/use-toast'

const getApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:5353'
  return `http://${window.location.hostname}:5353`
}

// Avatar component with fallback
function UserAvatar({ user, size = 'md' }: { user: any; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base'
  }

  const imageUrl = user?.head_image || user?.headImage || user?.avatar

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={user?.pin_name || 'User'}
        className={`${sizeClasses[size]} rounded-xl object-cover shadow-lg shadow-rose-500/20`}
        onError={(e) => {
          // Fallback to initial on error
          const target = e.target as HTMLImageElement
          target.style.display = 'none'
          target.nextElementSibling?.classList.remove('hidden')
        }}
      />
    )
  }

  return (
    <div className={`${sizeClasses[size]} rounded-xl bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center text-white font-bold shadow-lg shadow-rose-500/25`}>
      {(user?.pin_name || user?.name || '?').charAt(0).toUpperCase()}
    </div>
  )
}

export default function ControlPage() {
  const { toast } = useToast()
  const [botState, setBotState] = useState<any>(null)
  const [rooms, setRooms] = useState<any[]>([])
  const [selectedMode, setSelectedMode] = useState<'regular' | 'follow'>('regular')
  const [selectedRoom, setSelectedRoom] = useState('')
  const [selectedUser, setSelectedUser] = useState('')
  const [message, setMessage] = useState('')
  const [socket, setSocket] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [serverError, setServerError] = useState(false)
  const [pollCheck, setPollCheck] = useState<any>(null)
  const [speakers, setSpeakers] = useState<any[]>([])
  const chatEndRef = useRef<HTMLDivElement>(null)
  const startTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const startingBotIdRef = useRef<string | null>(null) // Track which bot we're starting
  const selectedBotIdRef = useRef<string>('') // Track currently selected bot for socket handlers

  // Multi-bot management state
  const [bots, setBots] = useState<any[]>([])
  const [botStates, setBotStates] = useState<Record<string, any>>({}) // State for each bot
  const [selectedBotId, setSelectedBotId] = useState<string>('')
  const [showAddBot, setShowAddBot] = useState(false)
  const [newBotName, setNewBotName] = useState('')
  const [newBotToken, setNewBotToken] = useState('')
  const [addingBot, setAddingBot] = useState(false)

  useEffect(() => {
    connectToServer()
    fetchRooms()
    fetchBots()
  }, [])

  // Keep selectedBotIdRef in sync with selectedBotId state
  useEffect(() => {
    selectedBotIdRef.current = selectedBotId
  }, [selectedBotId])

  // Sync botState when selectedBotId or botStates changes
  useEffect(() => {
    if (selectedBotId && botStates[selectedBotId]) {
      setBotState(botStates[selectedBotId])
      if (botStates[selectedBotId].speakers?.length > 0) {
        setSpeakers(botStates[selectedBotId].speakers)
      }
    }
  }, [selectedBotId, botStates])

  const connectToServer = () => {
    try {
      const newSocket = io(getApiUrl(), {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5
      })

      newSocket.on('connect', () => {
        setServerError(false)
        setLoading(false)
        toast({ title: 'Connected!', description: 'Connected to bot control server' })
      })

      // Handle all bot states (multi-bot support)
      newSocket.on('all-bot-states', (states) => {
        setBotStates(states)

        // For backward compatibility, set botState to selected bot's state using ref
        const currentSelectedId = selectedBotIdRef.current
        if (currentSelectedId && states[currentSelectedId]) {
          setBotState(states[currentSelectedId])
          if (states[currentSelectedId].speakers?.length > 0) {
            setSpeakers(states[currentSelectedId].speakers)
          }
        }
      })

      // Handle individual bot state update
      newSocket.on('bot-state-update', ({ botId, state }) => {
        setBotStates((prev: any) => ({ ...prev, [botId]: state }))

        // Update main botState if this is the bot we're starting OR currently selected
        const isStartingBot = botId === startingBotIdRef.current
        const isSelectedBot = botId === selectedBotIdRef.current

        if (isStartingBot || isSelectedBot) {
          setBotState(state)
          if (state.speakers?.length > 0) {
            setSpeakers(state.speakers)
          }
        }

        // Reset loading state if this is the bot we're starting
        if (botId === startingBotIdRef.current) {
          if (startTimeoutRef.current) {
            clearTimeout(startTimeoutRef.current)
            startTimeoutRef.current = null
          }

          if (state.status === 'running') {
            toast({
              title: `${state.name || 'Bot'} Started!`,
              description: `Now monitoring: ${state.currentRoom?.topic || 'room'}`
            })
            setStarting(false)
            startingBotIdRef.current = null
          } else if (state.status === 'error' || state.status === 'stopped') {
            setStarting(false)
            startingBotIdRef.current = null
          }
        }
      })

      // Legacy bot-state event (backward compatibility)
      newSocket.on('bot-state', (state) => {
        setBotState(state)
        if (state.speakers?.length > 0) {
          setSpeakers(state.speakers)
        }
      })

      newSocket.on('new-message', (msg) => {
        // Update the specific bot's messages using ref for current selection
        const targetBotId = msg.botId || selectedBotIdRef.current
        if (targetBotId) {
          setBotStates((prev: any) => {
            if (!prev[targetBotId]) return prev
            return {
              ...prev,
              [targetBotId]: {
                ...prev[targetBotId],
                messages: [...(prev[targetBotId].messages || []), msg]
              }
            }
          })
        }
        // Only update legacy botState if message is for the selected bot
        if (targetBotId === selectedBotIdRef.current) {
          setBotState((prev: any) => prev ? ({
            ...prev,
            messages: [...(prev.messages || []), msg]
          }) : prev)
        }
      })

      newSocket.on('speakers-update', (speakersData) => {
        console.log('🎤 Speakers update received:', speakersData)
        setSpeakers(speakersData)
        setBotState((prev: any) => prev ? ({
          ...prev,
          speakers: speakersData
        }) : prev)
      })

      newSocket.on('poll-check', (data) => {
        setPollCheck(data)
        // Auto-clear after 3 seconds
        setTimeout(() => setPollCheck(null), 3000)
      })

      newSocket.on('connect_error', () => {
        setServerError(true)
        setLoading(false)
        toast({
          title: 'Connection Error',
          description: 'Cannot connect to bot server. Is bot-server.js running?',
          variant: 'destructive'
        })
      })

      newSocket.on('disconnect', () => {
        toast({ title: 'Disconnected', description: 'Lost connection to bot server' })
      })

      newSocket.on('greetings-reloaded', (config) => {
        toast({
          title: 'Greetings Updated',
          description: 'Greetings configuration has been reloaded',
          duration: 3000
        })
      })

      newSocket.on('room-ended', (data) => {
        toast({
          title: '🔚 Room Ended',
          description: data.description || 'The room has been closed',
          variant: 'destructive',
          duration: 5000
        })
      })

      setSocket(newSocket)
    } catch (error) {
      setServerError(true)
      setLoading(false)
    }
  }

  const fetchRooms = async () => {
    try {
      const res = await fetch(`${getApiUrl()}/api/bot/rooms`)
      const data = await res.json()
      setRooms(data.rooms || [])
    } catch (error) {
      console.error('Could not fetch rooms')
    }
  }

  // Fetch available bots
  const fetchBots = async () => {
    try {
      const res = await fetch(`${getApiUrl()}/api/bots`)
      const data = await res.json()
      setBots(data.bots || [])
      if (data.selectedBotId) {
        setSelectedBotId(data.selectedBotId)
      }
    } catch (error) {
      console.error('Could not fetch bots')
    }
  }

  // Add new bot
  const addBot = async () => {
    if (!newBotToken.trim()) {
      toast({
        title: 'Token Required',
        description: 'Please enter a JWT token for the bot',
        variant: 'destructive'
      })
      return
    }

    setAddingBot(true)
    try {
      const res = await fetch(`${getApiUrl()}/api/bots/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newBotName.trim() || undefined,
          jwt_token: newBotToken.trim()
        })
      })
      const data = await res.json()

      if (data.success) {
        toast({
          title: 'Bot Added',
          description: `Successfully added ${data.bot.name}`
        })
        setNewBotName('')
        setNewBotToken('')
        setShowAddBot(false)
        fetchBots()
        fetchRooms() // Refresh rooms with new bot
      } else {
        toast({
          title: 'Failed to Add Bot',
          description: data.error || 'Invalid token or server error',
          variant: 'destructive'
        })
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to add bot',
        variant: 'destructive'
      })
    } finally {
      setAddingBot(false)
    }
  }

  // Select active bot
  const selectBot = async (botId: string) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/bots/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId })
      })
      const data = await res.json()

      if (data.success) {
        setSelectedBotId(botId)
        setSelectedRoom('') // Reset room selection when changing bots
        setSelectedUser('') // Reset user selection (for follow mode) when changing bots
        // Update botState to show selected bot's state
        if (botStates[botId]) {
          setBotState(botStates[botId])
          if (botStates[botId].speakers?.length > 0) {
            setSpeakers(botStates[botId].speakers)
          }
        } else {
          // Reset to default state for non-running bot
          setBotState({
            status: 'stopped',
            mode: null,
            currentRoom: null,
            messages: [],
            participants: [],
            speakers: [],
            messageCount: 0
          })
          setSpeakers([])
        }
        toast({
          title: 'Bot Selected',
          description: `Now using ${data.selectedBot.name}`
        })
        fetchRooms() // Refresh rooms with selected bot's token
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to select bot',
        variant: 'destructive'
      })
    }
  }

  // Delete bot
  const deleteBot = async (botId: string, botName: string) => {
    if (!confirm(`Are you sure you want to delete ${botName}?`)) return

    try {
      const res = await fetch(`${getApiUrl()}/api/bots/${botId}`, {
        method: 'DELETE'
      })
      const data = await res.json()

      if (data.success) {
        toast({
          title: 'Bot Deleted',
          description: `Removed ${data.deletedBot.name}`
        })
        fetchBots()
      } else {
        toast({
          title: 'Delete Failed',
          description: data.error,
          variant: 'destructive'
        })
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete bot',
        variant: 'destructive'
      })
    }
  }

  const startBot = async () => {
    if (selectedMode === 'regular' && !selectedRoom) {
      toast({
        title: 'Select a Room',
        description: 'Please choose a room before starting',
        variant: 'destructive'
      })
      return
    }

    setStarting(true)
    startingBotIdRef.current = selectedBotId // Track which bot we're starting

    // Safety timeout - reset starting after 10 seconds no matter what
    startTimeoutRef.current = setTimeout(() => {
      console.log('Starting timeout - resetting state')
      setStarting(false)
      startingBotIdRef.current = null
      toast({
        title: 'Timeout',
        description: 'Bot took too long to start. Please try again.',
        variant: 'destructive'
      })
    }, 10000)

    try {
      const res = await fetch(`${getApiUrl()}/api/bot/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: selectedMode,
          roomId: selectedRoom,
          userUuid: selectedUser,
          botId: selectedBotId // Include selected bot ID
        })
      })

      if (!res.ok) {
        if (startTimeoutRef.current) {
          clearTimeout(startTimeoutRef.current)
          startTimeoutRef.current = null
        }
        throw new Error('Failed to start')
      }

      // If fetch succeeds, wait for bot-state event (timeout will clear if needed)
    } catch (error) {
      if (startTimeoutRef.current) {
        clearTimeout(startTimeoutRef.current)
        startTimeoutRef.current = null
      }
      startingBotIdRef.current = null
      toast({
        title: 'Start Failed',
        description: 'Could not start bot. Check if bot-server.js is running',
        variant: 'destructive'
      })
      setStarting(false)
    }
  }

  const stopBot = async (botIdToStop?: string) => {
    try {
      await fetch(`${getApiUrl()}/api/bot/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId: botIdToStop || selectedBotId })
      })
      toast({ title: 'Bot Stopped', description: 'Bot has been disconnected' })
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to stop bot', variant: 'destructive' })
    }
  }

  const reloadGreetings = async () => {
    try {
      const res = await fetch(`${getApiUrl()}/api/bot/reload-greetings`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        toast({
          title: 'Greetings Reloaded',
          description: 'Successfully reloaded greetings.json configuration'
        })
      } else {
        toast({
          title: 'Reload Failed',
          description: data.error || 'Could not reload greetings',
          variant: 'destructive'
        })
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to reload greetings', variant: 'destructive' })
    }
  }

  // Speaker control handlers - all include botId for multi-bot support
  const lockSlot = async (position: number) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/bot/speaker/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position, botId: selectedBotId })
      })
      const data = await res.json()
      if (data.success) {
        toast({ title: 'Locked', description: `Speaker slot ${position + 1} locked` })
      } else {
        toast({ title: 'Lock Failed', description: data.error, variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to lock speaker', variant: 'destructive' })
    }
  }

  const unlockSlot = async (position: number) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/bot/speaker/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position, botId: selectedBotId })
      })
      const data = await res.json()
      if (data.success) {
        toast({ title: 'Unlocked', description: `Speaker slot ${position + 1} unlocked` })
      } else {
        toast({ title: 'Unlock Failed', description: data.error, variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to unlock speaker', variant: 'destructive' })
    }
  }

  const muteSlot = async (position: number) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/bot/speaker/mute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position, botId: selectedBotId })
      })
      const data = await res.json()
      if (data.success) {
        toast({ title: 'Muted', description: `Speaker slot ${position + 1} muted` })
      } else {
        toast({ title: 'Mute Failed', description: data.error, variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to mute speaker', variant: 'destructive' })
    }
  }

  const unmuteSlot = async (position: number) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/bot/speaker/unmute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position, botId: selectedBotId })
      })
      const data = await res.json()
      if (data.success) {
        toast({ title: 'Unmuted', description: `Speaker slot ${position + 1} unmuted` })
      } else {
        toast({ title: 'Unmute Failed', description: data.error, variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to unmute speaker', variant: 'destructive' })
    }
  }

  const kickSlot = async (position: number) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/bot/speaker/kick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position, botId: selectedBotId })
      })
      const data = await res.json()
      if (data.success) {
        toast({ title: 'Kicked', description: `Removed speaker from slot ${position + 1}` })
      } else {
        toast({ title: 'Kick Failed', description: data.error, variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to kick speaker', variant: 'destructive' })
    }
  }

  const kickFromRoom = async (uuid: string, name: string) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/bot/room/kick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid, botId: selectedBotId })
      })
      const data = await res.json()
      if (data.success) {
        toast({ title: 'Kicked from Room', description: `${name} has been removed from the room` })
      } else {
        toast({ title: 'Kick Failed', description: data.error, variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to kick from room', variant: 'destructive' })
    }
  }

  const toggleWelcomeMessage = async (enabled: boolean) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/bot/toggle-welcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, botId: selectedBotId })
      })
      const data = await res.json()
      if (data.success) {
        toast({
          title: enabled ? 'Welcome Message Enabled' : 'Welcome Message Disabled',
          description: enabled ? 'Bot will send welcome message on room join' : 'Bot will not send welcome message'
        })
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to toggle welcome message', variant: 'destructive' })
    }
  }

  const sendMsg = () => {
    if (!message.trim() || !socket || currentBotState?.status !== 'running') return
    socket.emit('send-message', { botId: selectedBotId, message: message.trim() })
    setMessage('')
  }

  // Auto-scroll disabled per user request
  // useEffect(() => {
  //   chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  // }, [botState?.messages])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-24 w-full shimmer rounded-2xl" />
        <div className="h-12 w-64 shimmer rounded-lg" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="h-96 shimmer rounded-2xl" />
          <div className="h-96 lg:col-span-2 shimmer rounded-2xl" />
        </div>
      </div>
    )
  }

  if (serverError) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-center min-h-[600px]"
      >
        <Card className="max-w-md border-0 shadow-2xl bg-white dark:bg-gray-900">
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="p-4 rounded-2xl bg-rose-100 dark:bg-rose-900/30">
                <WifiOff className="h-8 w-8 text-rose-500" />
              </div>
              <div>
                <CardTitle className="text-xl">Cannot Connect</CardTitle>
                <CardDescription>Bot control server is not running</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30">
              <AlertDescription>
                <p className="font-medium mb-2">Start the bot server first:</p>
                <code className="block p-3 bg-gray-900 text-rose-400 rounded-lg text-sm font-mono">
                  node bot-server.js
                </code>
              </AlertDescription>
            </Alert>
            <Button
              onClick={() => window.location.reload()}
              className="w-full bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white shadow-lg shadow-rose-500/25 transition-all duration-300"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry Connection
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    )
  }

  // Use selected bot's state from botStates for accurate status
  const currentBotState = botStates[selectedBotId] || botState
  const isRunning = currentBotState?.status === 'running'
  const isWaiting = currentBotState?.status === 'waiting'
  const isFollowMode = currentBotState?.mode === 'follow'
  const uptime = currentBotState?.startTime ? Math.floor((Date.now() - currentBotState.startTime) / 1000) : 0
  const minutes = Math.floor(uptime / 60)
  const seconds = uptime % 60
  const uptimeStr = uptime > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : '--:--'

  // Get unique owners for follow mode
  const uniqueOwners = Array.from(
    new Map(rooms.map(r => [r.owner?.uuid, r.owner])).values()
  ).filter(Boolean)

  // Helper to get uptime string for any bot
  const getUptimeStr = (startTime: number | null) => {
    if (!startTime) return '--:--'
    const uptime = Math.floor((Date.now() - startTime) / 1000)
    const mins = Math.floor(uptime / 60)
    const secs = uptime % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Count running bots
  const runningBots = bots.filter(b => {
    const state = botStates[b.id]
    return state?.status === 'running' || state?.status === 'waiting'
  })

  return (
    <div className="space-y-6">
      {/* ===== MULTI-BOT OVERVIEW HEADER ===== */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Title Bar */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-rose-500 to-pink-500 shadow-lg shadow-rose-500/25">
              <Bot className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold bg-gradient-to-r from-rose-500 via-pink-500 to-rose-600 bg-clip-text text-transparent">
                Multi-Bot Control Center
              </h1>
              <p className="text-sm text-muted-foreground">
                {runningBots.length > 0
                  ? `${runningBots.length} bot${runningBots.length > 1 ? 's' : ''} running`
                  : 'All bots stopped'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddBot(!showAddBot)}
              className="border-blue-200 hover:bg-blue-50"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Bot
            </Button>
            <Button
              onClick={fetchRooms}
              variant="outline"
              size="sm"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Add Bot Form (Collapsible) */}
        <AnimatePresence>
          {showAddBot && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4"
            >
              <Card className="border-2 border-dashed border-blue-300 bg-blue-50/50 dark:bg-blue-950/20">
                <CardContent className="p-4">
                  <div className="flex gap-3 items-end">
                    <div className="flex-1">
                      <Label className="text-xs text-blue-600 mb-1">Bot Name (optional)</Label>
                      <Input
                        placeholder="e.g. Siri, Gemini"
                        value={newBotName}
                        onChange={(e) => setNewBotName(e.target.value)}
                        className="border-blue-200 h-9"
                      />
                    </div>
                    <div className="flex-[2]">
                      <Label className="text-xs text-blue-600 mb-1">JWT Token (required)</Label>
                      <Input
                        placeholder="Paste JWT token here..."
                        value={newBotToken}
                        onChange={(e) => setNewBotToken(e.target.value)}
                        className="border-blue-200 font-mono text-xs h-9"
                      />
                    </div>
                    <Button
                      onClick={addBot}
                      disabled={addingBot || !newBotToken.trim()}
                      className="bg-blue-500 hover:bg-blue-600 h-9"
                    >
                      {addingBot ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setShowAddBot(false); setNewBotName(''); setNewBotToken(''); }}
                      className="h-9"
                    >
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bot Cards Grid - Shows ALL bots at a glance */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {bots.map((bot) => {
            const thisBotState = botStates[bot.id] || {}
            const thisBotRunning = thisBotState.status === 'running'
            const thisBotWaiting = thisBotState.status === 'waiting'
            const isSelected = selectedBotId === bot.id
            const thisBotUptime = getUptimeStr(thisBotState.startTime)

            return (
              <motion.div
                key={bot.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Card
                  className={`cursor-pointer transition-all border-2 ${
                    isSelected
                      ? 'border-blue-500 shadow-lg shadow-blue-500/20'
                      : thisBotRunning
                      ? 'border-emerald-400 shadow-md'
                      : thisBotWaiting
                      ? 'border-amber-400 shadow-md'
                      : 'border-transparent hover:border-gray-300'
                  } ${
                    thisBotRunning
                      ? 'bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30'
                      : thisBotWaiting
                      ? 'bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/30'
                      : 'bg-white dark:bg-gray-900'
                  }`}
                  onClick={() => selectBot(bot.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`relative w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-lg ${
                          thisBotRunning
                            ? 'bg-gradient-to-br from-emerald-500 to-teal-500'
                            : thisBotWaiting
                            ? 'bg-gradient-to-br from-amber-500 to-yellow-500'
                            : 'bg-gradient-to-br from-gray-400 to-gray-500'
                        }`}>
                          {bot.name.charAt(0).toUpperCase()}
                          {(thisBotRunning || thisBotWaiting) && (
                            <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full animate-pulse ${
                              thisBotRunning ? 'bg-emerald-400' : 'bg-amber-400'
                            }`} />
                          )}
                        </div>
                        <div>
                          <p className="font-semibold text-sm">{bot.name}</p>
                          <p className={`text-xs ${
                            thisBotRunning ? 'text-emerald-600' : thisBotWaiting ? 'text-amber-600' : 'text-gray-500'
                          }`}>
                            {thisBotRunning ? '🟢 Running' : thisBotWaiting ? '🟡 Waiting' : '⚪ Stopped'}
                          </p>
                        </div>
                      </div>
                      {isSelected && (
                        <Badge className="bg-blue-500 text-white text-xs">Selected</Badge>
                      )}
                    </div>

                    {/* Room info if running */}
                    {(thisBotRunning || thisBotWaiting) && (
                      <div className="mt-2 p-2 rounded-lg bg-white/60 dark:bg-black/20">
                        <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                          📍 {thisBotState.currentRoom?.topic || 'Waiting for room...'}
                        </p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {thisBotState.participants?.length || 0}
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />
                            {thisBotState.messageCount || 0}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {thisBotUptime}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Quick action buttons */}
                    <div className="mt-3 flex gap-2">
                      {(thisBotRunning || thisBotWaiting) ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="flex-1 h-8 text-xs"
                          onClick={(e) => { e.stopPropagation(); stopBot(bot.id); }}
                        >
                          <Square className="h-3 w-3 mr-1" />
                          Stop
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="flex-1 h-8 text-xs bg-emerald-500 hover:bg-emerald-600"
                          onClick={(e) => { e.stopPropagation(); selectBot(bot.id); }}
                        >
                          <Play className="h-3 w-3 mr-1" />
                          Select to Start
                        </Button>
                      )}
                      {bots.length > 1 && !(thisBotRunning || thisBotWaiting) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={(e) => { e.stopPropagation(); deleteBot(bot.id, bot.name); }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}

          {/* Empty state if no bots */}
          {bots.length === 0 && (
            <Card className="col-span-full border-2 border-dashed">
              <CardContent className="p-8 text-center">
                <Bot className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p className="text-gray-500">No bots configured</p>
                <p className="text-sm text-gray-400">Click "Add Bot" to get started</p>
              </CardContent>
            </Card>
          )}
        </div>
      </motion.div>

      {/* ===== CONTEXT INDICATOR ===== */}
      {selectedBotId && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800"
        >
          <Bot className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
            Currently controlling: <strong>{bots.find(b => b.id === selectedBotId)?.name || 'Unknown'}</strong>
          </span>
          {(isRunning || isWaiting) && (
            <Badge className={isRunning ? 'bg-emerald-500' : 'bg-amber-500'}>
              {isRunning ? 'Running' : 'Waiting'}
            </Badge>
          )}
          {currentBotState?.currentRoom && (
            <span className="text-xs text-gray-500 ml-2">
              in "{currentBotState.currentRoom.topic}"
            </span>
          )}
        </motion.div>
      )}

      {/* ===== MAIN CONTENT GRID ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Controls */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="space-y-6"
        >
          {/* Bot Control Card */}
          <Card className="border-0 shadow-lg bg-white dark:bg-gray-900">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {(isRunning || isWaiting) ? <Square className="h-5 w-5 text-rose-500" /> : <Play className="h-5 w-5 text-emerald-500" />}
                Bot Control
              </CardTitle>
              <CardDescription>
                {(isRunning || isWaiting)
                  ? isFollowMode
                    ? `Following ${botState?.followUser?.name || 'user'} - Click below to stop`
                    : `Bot "${botState?.activeBotName || bots.find(b => b.id === selectedBotId)?.name || 'Unknown'}" is running`
                  : 'Select a mode and room to start'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <AnimatePresence mode="wait">
                {!(isRunning || isWaiting) ? (
                  <motion.div
                    key="controls"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-4"
                  >
                    <Tabs value={selectedMode} onValueChange={(v: any) => setSelectedMode(v)}>
                      <TabsList className="grid w-full grid-cols-2 bg-rose-50 dark:bg-rose-950/30">
                        <TabsTrigger value="regular" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800">
                          <Radio className="mr-2 h-4 w-4" />
                          Regular
                        </TabsTrigger>
                        <TabsTrigger value="follow" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800">
                          <Users className="mr-2 h-4 w-4" />
                          Follow
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="regular" className="mt-4">
                        <p className="text-sm text-muted-foreground mb-3">
                          Select a room from the grid below to start monitoring
                        </p>
                      </TabsContent>

                      <TabsContent value="follow" className="space-y-4 mt-4">
                        <p className="text-sm text-muted-foreground mb-3">
                          Select a user to follow. Bot will auto-join their rooms.
                        </p>
                        <ScrollArea className="h-[200px]">
                          <div className="space-y-2">
                            {uniqueOwners.map((owner: any) => (
                              <div
                                key={owner.uuid}
                                onClick={() => setSelectedUser(owner.uuid)}
                                className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 ${
                                  selectedUser === owner.uuid
                                    ? 'bg-rose-100 dark:bg-rose-900/40 ring-2 ring-rose-500'
                                    : 'hover:bg-rose-50 dark:hover:bg-rose-950/30'
                                }`}
                              >
                                <UserAvatar user={owner} size="md" />
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium truncate">{owner.pin_name}</p>
                                  <p className="text-xs text-muted-foreground">Click to select</p>
                                </div>
                                {selectedUser === owner.uuid && (
                                  <CheckCircle2 className="h-5 w-5 text-rose-500" />
                                )}
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </TabsContent>
                    </Tabs>

                    {/* Welcome Message Toggle - Available Before Starting */}
                    <div className="flex items-center justify-between p-3 border-2 border-purple-500/50 rounded-xl bg-purple-50/50 dark:bg-purple-950/20">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-purple-500" />
                        <Label htmlFor="welcome-toggle-main" className="text-sm font-medium cursor-pointer">
                          Send Welcome Message on Join
                        </Label>
                      </div>
                      <Switch
                        id="welcome-toggle-main"
                        checked={currentBotState?.enableWelcomeMessage ?? true}
                        onCheckedChange={toggleWelcomeMessage}
                      />
                    </div>

                    {/* Auto-Hijack Toggle */}
                    <div className="flex items-center justify-between p-3 border-2 border-rose-500/50 rounded-xl bg-rose-50/50 dark:bg-rose-950/20">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <Zap className="h-4 w-4 text-rose-500" />
                          <Label htmlFor="hijack-toggle" className="text-sm font-medium cursor-pointer">
                            Auto-Hijack Rooms (Exploit)
                          </Label>
                        </div>
                        <p className="text-xs text-gray-500 pl-6">Use create_room exploit to control speaker slots</p>
                        <p className="text-xs text-rose-600 pl-6 font-semibold">⚠️ Beta version - use at your own risk, some times it might cause issues with the room</p>
                      </div>
                      <Switch
                        id="hijack-toggle"
                        checked={currentBotState?.autoHijackRooms ?? false}
                        onCheckedChange={async (checked) => {
                          try {
                            await fetch(`${getApiUrl()}/api/bot/toggle-hijack`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ enabled: checked, botId: selectedBotId })
                            })
                            toast({
                              title: checked ? 'Auto-Hijack Enabled' : 'Auto-Hijack Disabled',
                              description: checked ? 'Bot will join as room owner' : 'Bot joins normally'
                            })
                          } catch (error) {
                            toast({ title: 'Error', description: 'Failed to toggle hijack', variant: 'destructive' })
                          }
                        }}
                      />
                    </div>

                    {/* Auto-Join Random Room Toggle */}
                    <div className="flex items-center justify-between p-3 bg-purple-50 dark:bg-purple-950/30 rounded-xl">
                      <div className="space-y-1">
                        <Label htmlFor="autojoin-toggle" className="text-sm font-semibold flex items-center gap-2">
                          <RefreshCw className="h-4 w-4 text-purple-500" />
                          Auto-Join Random Room
                        </Label>
                        <p className="text-xs text-gray-500 pl-6">Automatically join a random room when bot is free</p>
                      </div>
                      <Switch
                        id="autojoin-toggle"
                        checked={currentBotState?.autoJoinRandomRoom ?? false}
                        onCheckedChange={async (checked) => {
                          try {
                            await fetch(`${getApiUrl()}/api/bot/toggle-auto-join`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ enabled: checked, botId: selectedBotId })
                            })
                            toast({
                              title: checked ? 'Auto-Join Enabled' : 'Auto-Join Disabled',
                              description: checked ? 'Bot will auto-join random rooms when free' : 'Bot stays idle when free'
                            })
                          } catch (error) {
                            toast({ title: 'Error', description: 'Failed to toggle auto-join', variant: 'destructive' })
                          }
                        }}
                      />
                    </div>

                    <Button
                      onClick={startBot}
                      className="w-full h-12 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-lg shadow-emerald-500/25 transition-all duration-300"
                      disabled={starting || (selectedMode === 'regular' && !selectedRoom) || (selectedMode === 'follow' && !selectedUser)}
                    >
                      {starting ? (
                        <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Starting...</>
                      ) : (
                        <><Play className="mr-2 h-5 w-5" /> Start Bot</>
                      )}
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="running"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-4"
                  >
                    <Alert className={
                      botState.status === 'waiting'
                        ? "border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30"
                        : "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
                    }>
                      {botState.status === 'waiting' ? (
                        <Clock className="h-4 w-4 text-yellow-500 animate-pulse" />
                      ) : (
                        <Zap className="h-4 w-4 text-emerald-500" />
                      )}
                      <AlertDescription className="ml-2">
                        {botState.status === 'waiting' ? (
                          <>
                            <p className="font-semibold text-yellow-700 dark:text-yellow-300">
                              Waiting for {botState.followUser?.name || 'user'} to create a room...
                            </p>
                            <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-1">
                              {pollCheck ? (
                                <span className="animate-pulse">🔍 Check #{pollCheck.checkCount} in progress...</span>
                              ) : (
                                'Checking every 5 seconds'
                              )}
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                              {botState.mode === 'follow'
                                ? `Following: ${botState.followUser?.name || 'User'}`
                                : 'Bot is Running'
                              }
                            </p>
                            <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1 truncate">
                              {botState.currentRoom?.topic || 'Monitoring room'}
                            </p>
                          </>
                        )}
                      </AlertDescription>
                    </Alert>
                    <Button
                      onClick={() => stopBot()}
                      className="w-full h-12 bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white shadow-lg shadow-rose-500/25 transition-all duration-300"
                    >
                      <Square className="mr-2 h-5 w-5" />
                      {isFollowMode ? 'Stop Following' : 'Stop Bot'}
                    </Button>

                    <Button
                      onClick={reloadGreetings}
                      variant="outline"
                      className="w-full h-10 border-2 border-blue-500/50 hover:bg-blue-500/10 hover:border-blue-500 transition-all duration-300"
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Reload Greetings
                    </Button>

                    {/* Additional info for follow mode */}
                    {isFollowMode && (
                      <p className="text-xs text-center text-muted-foreground">
                        {isWaiting
                          ? 'Bot will stop waiting for the user'
                          : 'Bot will leave the room and stop following'}
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>

          {/* Participants */}
          <Card className="border-0 shadow-lg bg-white dark:bg-gray-900">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5 text-rose-500" />
                  Participants
                </CardTitle>
                <Badge className="bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
                  {botState?.participants?.length || 0} online
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[250px] pr-4">
                {botState?.participants && botState.participants.length > 0 ? (
                  <div className="space-y-2">
                    {botState.participants.map((p: any, i: number) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors duration-200"
                      >
                        <div className="relative flex-shrink-0">
                          <UserAvatar user={p} size="md" />
                          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-gray-900" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{p.pin_name}</p>
                          <p className="text-xs text-muted-foreground">Active now</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
                    <div className="w-16 h-16 mb-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 flex items-center justify-center">
                      <Users className="h-8 w-8 text-rose-300" />
                    </div>
                    <p className="text-sm font-medium">No participants</p>
                    <p className="text-xs">Start bot to see users</p>
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </motion.div>

        {/* Right: Room Grid & Chat */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="lg:col-span-2 space-y-6"
        >
          {/* Room Selection Grid */}
          {!isRunning && selectedMode === 'regular' && (
            <Card className="border-0 shadow-lg bg-white dark:bg-gray-900">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Radio className="h-5 w-5 text-rose-500" />
                      Available Rooms
                    </CardTitle>
                    <CardDescription>Click on a room to select it for monitoring</CardDescription>
                  </div>
                  <Badge className="bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
                    {rooms.length} rooms
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px] pr-4">
                  {rooms.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {rooms.map((room) => (
                        <div
                          key={room.id}
                          onClick={() => setSelectedRoom(room.id)}
                          className={`relative p-4 rounded-xl cursor-pointer transition-all duration-200 ${
                            selectedRoom === room.id
                              ? 'bg-gradient-to-br from-rose-100 to-pink-100 dark:from-rose-900/40 dark:to-pink-900/40 ring-2 ring-rose-500 shadow-lg'
                              : 'bg-rose-50/50 dark:bg-rose-950/20 hover:bg-rose-100/50 dark:hover:bg-rose-950/30 hover:shadow-md'
                          }`}
                        >
                          {selectedRoom === room.id && (
                            <div className="absolute top-2 right-2">
                              <CheckCircle2 className="h-5 w-5 text-rose-500" />
                            </div>
                          )}
                          <div className="flex items-start gap-3">
                            <UserAvatar user={room.owner} size="lg" />
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-sm truncate pr-6">{room.topic}</h3>
                              <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                                <Crown className="h-3 w-3" />
                                <span className="truncate">{room.owner?.pin_name || 'Unknown'}</span>
                              </div>
                              <div className="flex items-center gap-3 mt-2">
                                <span className="inline-flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400">
                                  <Users className="h-3 w-3" />
                                  {room.participants_count || 0}
                                </span>
                                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                  <Circle className="h-2 w-2 fill-emerald-500 text-emerald-500" />
                                  Live
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
                      <div className="w-16 h-16 mb-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 flex items-center justify-center">
                        <Radio className="h-8 w-8 text-rose-300" />
                      </div>
                      <p className="text-sm font-medium">No rooms available</p>
                      <p className="text-xs">Click refresh to check again</p>
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* Speaker Control Panel */}
          {isRunning && (
            <Card className="border-0 shadow-lg bg-white dark:bg-gray-900">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Mic className="h-5 w-5 text-rose-500" />
                  Speaker Control
                  <Badge variant="destructive" className="ml-2">Auto-Hijacked</Badge>
                </CardTitle>
                <CardDescription>Control speaker slots (powered by room hijack exploit)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Owner Slot (Slot 1) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {(() => {
                      const ownerSpeaker = botState?.currentRoom?.owner;
                      const ownerPosition = -1; // Special position for owner (maps to YelloTalk position 0)

                      return (
                        <div className="border-2 border-amber-500 rounded-lg p-3 shadow-md bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/30 col-span-1 sm:col-span-2 lg:col-span-3">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <Crown className="h-5 w-5 text-amber-500" />
                              <div className="font-bold text-amber-700 dark:text-amber-400">Slot 1 - Room Owner</div>
                            </div>
                            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                              {ownerSpeaker?.pin_name || 'Unknown'}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" className="h-8 text-xs border-amber-300 hover:bg-amber-100" onClick={() => muteSlot(ownerPosition)}>
                              <VolumeX className="h-3 w-3 mr-1" />
                              Mute Owner
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-xs border-amber-300 hover:bg-amber-100" onClick={() => unmuteSlot(ownerPosition)}>
                              <Volume2 className="h-3 w-3 mr-1" />
                              Unmute Owner
                            </Button>
                            <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={() => kickSlot(ownerPosition)}>
                              <UserX className="h-3 w-3 mr-1" />
                              Kick Owner
                            </Button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Row 1: Slots 2-6 (indices 0-4) */}
                  <div className="grid grid-cols-5 gap-2">
                    {[0, 1, 2, 3, 4].map((position) => {
                      const speaker = speakers[position] || botState?.speakers?.[position];
                      const isLocked = speaker?.locked || speaker?.role === 'locked';

                      return (
                        <div key={position} className={`border rounded-lg p-2 shadow-sm ${
                          isLocked
                            ? 'border-red-500 bg-red-50 dark:bg-red-950/30'
                            : 'border-gray-200 bg-white dark:bg-gray-800 dark:border-gray-700'
                        }`}>
                          <div className="text-center mb-2">
                            <div className="font-semibold text-sm">Slot {position + 2}</div>
                            <div className="text-xs mt-1 h-10">
                              {isLocked ? (
                                <div className="text-red-600 font-semibold">🔒 Locked</div>
                              ) : speaker?.uuid ? (
                                <>
                                  <div className="font-medium truncate">{speaker.pin_name}</div>
                                  <div className="flex items-center justify-center gap-1 mt-0.5">
                                    {speaker.mic_muted ? (
                                      <><VolumeX className="h-3 w-3 text-red-500" /><span className="text-red-500 text-xs">Muted</span></>
                                    ) : (
                                      <><Volume2 className="h-3 w-3 text-green-500" /><span className="text-green-500 text-xs">Live</span></>
                                    )}
                                  </div>
                                </>
                              ) : (
                                <div className="text-gray-400 text-xs">Empty</div>
                              )}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="grid grid-cols-2 gap-1">
                              <Button size="sm" variant="outline" className="h-6 text-xs p-0" onClick={() => lockSlot(position)} title="Lock">
                                <Lock className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="outline" className="h-6 text-xs p-0" onClick={() => unlockSlot(position)} title="Unlock">
                                <Unlock className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="outline" className="h-6 text-xs p-0" onClick={() => muteSlot(position)} title="Mute">
                                <VolumeX className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="outline" className="h-6 text-xs p-0" onClick={() => unmuteSlot(position)} title="Unmute">
                                <Volume2 className="h-3 w-3" />
                              </Button>
                            </div>
                            {speaker && !isLocked && speaker.uuid && (
                              <Button size="sm" variant="destructive" className="h-6 text-xs w-full" onClick={() => kickSlot(position)}>
                                <UserX className="h-3 w-3 mr-1" />
                                Kick
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Row 2: Slots 7-11 (indices 5-9) */}
                  <div className="grid grid-cols-5 gap-2">
                    {[5, 6, 7, 8, 9].map((position) => {
                      const speaker = speakers[position] || botState?.speakers?.[position];
                      const isLocked = speaker?.locked || speaker?.role === 'locked';

                      return (
                        <div key={position} className={`border rounded-lg p-2 shadow-sm ${
                          isLocked
                            ? 'border-red-500 bg-red-50 dark:bg-red-950/30'
                            : 'border-gray-200 bg-white dark:bg-gray-800 dark:border-gray-700'
                        }`}>
                          <div className="text-center mb-2">
                            <div className="font-semibold text-sm">Slot {position + 2}</div>
                            <div className="text-xs mt-1 h-10">
                              {isLocked ? (
                                <div className="text-red-600 font-semibold">🔒 Locked</div>
                              ) : speaker?.uuid ? (
                                <>
                                  <div className="font-medium truncate">{speaker.pin_name}</div>
                                  <div className="flex items-center justify-center gap-1 mt-0.5">
                                    {speaker.mic_muted ? (
                                      <><VolumeX className="h-3 w-3 text-red-500" /><span className="text-red-500 text-xs">Muted</span></>
                                    ) : (
                                      <><Volume2 className="h-3 w-3 text-green-500" /><span className="text-green-500 text-xs">Live</span></>
                                    )}
                                  </div>
                                </>
                              ) : (
                                <div className="text-gray-400 text-xs">Empty</div>
                              )}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="grid grid-cols-2 gap-1">
                              <Button size="sm" variant="outline" className="h-6 text-xs p-0" onClick={() => lockSlot(position)} title="Lock">
                                <Lock className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="outline" className="h-6 text-xs p-0" onClick={() => unlockSlot(position)} title="Unlock">
                                <Unlock className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="outline" className="h-6 text-xs p-0" onClick={() => muteSlot(position)} title="Mute">
                                <VolumeX className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="outline" className="h-6 text-xs p-0" onClick={() => unmuteSlot(position)} title="Unmute">
                                <Volume2 className="h-3 w-3" />
                              </Button>
                            </div>
                            {speaker && !isLocked && speaker.uuid && (
                              <Button size="sm" variant="destructive" className="h-6 text-xs w-full" onClick={() => kickSlot(position)}>
                                <UserX className="h-3 w-3 mr-1" />
                                Kick
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Participants List with Kick Buttons */}
          {isRunning && (
            <Card className="border-0 shadow-lg bg-white dark:bg-gray-900">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5 text-rose-500" />
                  Room Participants
                  <Badge variant="secondary" className="ml-2">{botState?.participants?.length || 0}</Badge>
                </CardTitle>
                <CardDescription>Kick users from the room</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2">
                    {botState?.participants?.length === 0 ? (
                      <div className="text-center text-gray-500 py-8">No participants yet</div>
                    ) : (
                      botState?.participants?.map((participant: any, index: number) => (
                        <div key={participant.uuid || index} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                          <div className="flex items-center gap-3">
                            <UserAvatar user={participant} size="sm" />
                            <div>
                              <div className="font-semibold">{participant.pin_name || 'Unknown'}</div>
                              <div className="text-xs text-gray-500">{participant.uuid?.substring(0, 8)}...</div>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => kickFromRoom(participant.uuid, participant.pin_name || 'User')}
                            disabled={participant.uuid === botState?.currentRoom?.owner?.uuid}
                          >
                            <UserX className="h-4 w-4 mr-1" />
                            Kick from Room
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* Chat Feed */}
          <Card className={`flex flex-col border-0 shadow-lg bg-white dark:bg-gray-900 overflow-hidden ${!isRunning && selectedMode === 'regular' ? 'h-[400px]' : 'h-[600px] lg:h-[700px]'}`}>
            <CardHeader className="border-b border-rose-100 dark:border-rose-900/30 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-rose-500" />
                    Live Chat Feed
                  </CardTitle>
                  <CardDescription>Real-time messages from the room</CardDescription>
                </div>
                {isRunning && (
                  <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1.5 rounded-full">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-sm font-medium">Live</span>
                  </div>
                )}
              </div>
            </CardHeader>

            <CardContent className="flex-1 flex flex-col p-4 lg:p-6 min-h-0 overflow-hidden">
              <ScrollArea className="flex-1 pr-4 -mr-4">
                <div className="space-y-4">
                  {botState?.messages && botState.messages.length > 0 ? (
                    <>
                      {botState.messages.map((msg: any, i: number) => (
                        <div key={i} className="flex items-start gap-3">
                          <div className="flex-shrink-0">
                            <UserAvatar user={{ pin_name: msg.sender, head_image: msg.senderAvatar }} size="md" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="bg-rose-50 dark:bg-rose-950/30 p-3 rounded-xl rounded-tl-none shadow-sm">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-semibold">{msg.sender}</span>
                                <span className="text-xs text-muted-foreground font-mono">{msg.time}</span>
                              </div>
                              <p className="text-sm leading-relaxed break-words">{msg.message}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                      <div ref={chatEndRef} />
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full min-h-[200px]">
                      <div className="w-20 h-20 mb-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 flex items-center justify-center">
                        <MessageSquare className="h-10 w-10 text-rose-300" />
                      </div>
                      <p className="text-lg font-semibold mb-2">No messages yet</p>
                      <p className="text-sm text-muted-foreground text-center max-w-sm">
                        Start the bot and select a room to see live chat messages appear here
                      </p>
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="pt-4 mt-auto">
                <Separator className="mb-4 bg-rose-100 dark:bg-rose-900/30" />
                <div className="flex gap-2">
                  <Input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && sendMsg()}
                    placeholder={isRunning ? "Type a message..." : "Start bot to send messages"}
                    disabled={!isRunning}
                    className="flex-1 h-12 border-rose-200 focus:border-rose-400 focus:ring-rose-400/30"
                  />
                  <Button
                    onClick={sendMsg}
                    disabled={!isRunning || !message.trim()}
                    size="lg"
                    className="h-12 px-6 bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white shadow-lg shadow-rose-500/25 transition-all duration-300"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
                {isRunning && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Press <kbd className="px-1.5 py-0.5 bg-rose-100 dark:bg-rose-900/30 rounded text-rose-600 font-mono text-xs">Enter</kbd> to send
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}
