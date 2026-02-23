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
  Trash2,
  Eye,
  X,
  MapPin,
  GraduationCap,
  Database,
  Music,
  Pause,
  SkipForward,
  Volume1
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

  // Unavailable rooms tracking
  const [unavailableRooms, setUnavailableRooms] = useState<any[]>([])

  // Auto-join status tracking
  const [autoJoinStatus, setAutoJoinStatus] = useState<Record<string, any>>({})

  // Room users detail
  const [roomUsers, setRoomUsers] = useState<any[]>([])

  // Music bot state
  const [musicStatus, setMusicStatus] = useState<any>({ online: false })
  const [musicFile, setMusicFile] = useState('gme-music-bot/test-audio.mp3')
  const [musicLoop, setMusicLoop] = useState(true)
  const [musicVolume, setMusicVolume] = useState(100)
  const [musicLogs, setMusicLogs] = useState<string[]>([])
  const [musicLoading, setMusicLoading] = useState(false)
  const [loadingRoomUsers, setLoadingRoomUsers] = useState(false)
  const [selectedUserDetail, setSelectedUserDetail] = useState<any>(null)

  // All cached profiles
  const [allCachedProfiles, setAllCachedProfiles] = useState<any[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(false)
  const [profileSearch, setProfileSearch] = useState('')

  useEffect(() => {
    connectToServer()
    fetchRooms()
    fetchBots()
    fetchUnavailableRooms()
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

      // Listen for unavailable rooms updates
      newSocket.on('unavailable-rooms-update', (rooms) => {
        setUnavailableRooms(rooms)
      })

      // Listen for auto-join status updates
      newSocket.on('auto-join-status', (data) => {
        setAutoJoinStatus(prev => ({ ...prev, [data.botId]: data }))
      })

      // Listen for music bot log events (e.g., auto-connect GME)
      newSocket.on('music-log', (data: { type: string; message: string }) => {
        const ts = new Date().toLocaleTimeString()
        const prefix = data.type === 'error' ? 'ERROR' : data.type === 'info' ? 'INFO' : 'LOG'
        setMusicLogs(prev => [...prev.slice(-50), `[${ts}] [${prefix}] ${data.message}`])
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

  // Fetch detailed user profiles for room participants
  const fetchRoomUsers = async () => {
    setLoadingRoomUsers(true)
    try {
      const res = await fetch(`${getApiUrl()}/api/bot/room-users?botId=${selectedBotId}`)
      const data = await res.json()
      setRoomUsers(data.users || [])
    } catch (error) {
      console.error('Could not fetch room users')
    } finally {
      setLoadingRoomUsers(false)
    }
  }

  // Fetch unavailable rooms
  const fetchUnavailableRooms = async () => {
    try {
      const res = await fetch(`${getApiUrl()}/api/bot/unavailable-rooms`)
      const data = await res.json()
      setUnavailableRooms(data.rooms || [])
    } catch (error) {
      console.error('Could not fetch unavailable rooms')
    }
  }

  const fetchAllProfiles = async () => {
    setLoadingProfiles(true)
    try {
      const res = await fetch(`${getApiUrl()}/api/bot/all-profiles`)
      const data = await res.json()
      setAllCachedProfiles(data.profiles || [])
    } catch (error) {
      console.error('Could not fetch cached profiles')
    } finally {
      setLoadingProfiles(false)
    }
  }

  // Clear unavailable room
  const clearUnavailableRoom = async (roomId: string) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/bot/clear-unavailable-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId })
      })
      const data = await res.json()
      if (data.success) {
        toast({
          title: 'Room Cleared',
          description: 'Room removed from unavailable list'
        })
        fetchUnavailableRooms()
      }
    } catch (error) {
      console.error('Could not clear room')
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

  const joinSpeakerSlot = async (position?: number) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/bot/speaker/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position, botId: selectedBotId })
      })
      const data = await res.json()
      if (data.success) {
        toast({ title: 'Joined Slot', description: `Bot joined speaker slot ${(data.position ?? position ?? 0) + 2}` })
      } else {
        toast({ title: 'Join Failed', description: data.error, variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to join speaker slot', variant: 'destructive' })
    }
  }

  const leaveSpeakerSlot = async (position?: number) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/bot/speaker/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position, botId: selectedBotId })
      })
      const data = await res.json()
      if (data.success) {
        toast({ title: 'Left Slot', description: `Bot left speaker slot` })
      } else {
        toast({ title: 'Leave Failed', description: data.error, variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to leave speaker slot', variant: 'destructive' })
    }
  }

  // ==================== MUSIC BOT CONTROLS ====================
  const addMusicLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString()
    setMusicLogs(prev => [...prev.slice(-50), `[${ts}] ${msg}`])
  }

  const fetchMusicStatus = async () => {
    try {
      const res = await fetch(`${getApiUrl()}/api/music/status`)
      const data = await res.json()
      setMusicStatus(data)
      return data
    } catch {
      setMusicStatus({ online: false })
      return { online: false }
    }
  }

  const musicJoinRoom = async () => {
    setMusicLoading(true)
    addMusicLog('Joining GME voice room...')
    try {
      const res = await fetch(`${getApiUrl()}/api/music/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId: selectedBotId })
      })
      const data = await res.json()
      addMusicLog(`  Room ID: ${data.room_id || '?'}`)
      addMusicLog(`  Room Topic: ${data.room_topic || '?'}`)
      addMusicLog(`  GME Room ID: ${data.gme_room_id || '?'}`)
      addMusicLog(`  GME User ID: ${data.user || '?'} ${data.bot_gme_user_id ? '(numeric)' : '(UUID - may fail!)'}`)
      addMusicLog(`  UUID: ${data.user_uuid || '?'}`)
      if (data.debug) {
        addMusicLog(`  Raw gme_id: ${data.debug.rawGmeId} | gmeId: ${data.debug.rawGmeId2}`)
        if (data.debug.gmeStatusBefore) {
          const s = data.debug.gmeStatusBefore
          addMusicLog(`  GME Bot before: init=${s.initialized}, inRoom=${s.inRoom}, lastErr=${s.lastError || 'none'}`)
        }
      }
      if (data.lastError) addMusicLog(`  Last GME Error: ${data.lastError}`)
      if (data.inRoom !== undefined) addMusicLog(`  In Room: ${data.inRoom}`)
      if (data.audioEnabled !== undefined) addMusicLog(`  Audio Enabled: ${data.audioEnabled}`)

      if (data.success) {
        addMusicLog(`Joined GME room!`)
        toast({ title: 'GME Joined', description: `Joined voice room ${data.gme_room_id}` })
      } else {
        addMusicLog(`Join FAILED: ${data.error || data.lastError || 'unknown'}`)
        toast({ title: 'Join Failed', description: data.error || data.lastError, variant: 'destructive' })
      }
      await fetchMusicStatus()
    } catch (error: any) {
      addMusicLog(`Join error: ${error.message}`)
      toast({ title: 'Error', description: 'GME Music Bot not reachable', variant: 'destructive' })
    }
    setMusicLoading(false)
  }

  const musicLeaveRoom = async () => {
    addMusicLog('Leaving GME voice room...')
    try {
      const res = await fetch(`${getApiUrl()}/api/music/leave`, { method: 'POST' })
      const data = await res.json()
      addMusicLog(data.success ? 'Left GME room' : `Leave failed: ${data.error}`)
      await fetchMusicStatus()
    } catch (error: any) {
      addMusicLog(`Leave error: ${error.message}`)
    }
  }

  const musicPlay = async () => {
    if (!musicFile) {
      toast({ title: 'No file', description: 'Enter a music file path', variant: 'destructive' })
      return
    }
    setMusicLoading(true)
    addMusicLog(`Playing: ${musicFile} (loop=${musicLoop})`)
    try {
      const res = await fetch(`${getApiUrl()}/api/music/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: musicFile, loop: musicLoop })
      })
      const data = await res.json()
      if (data.success) {
        addMusicLog(`Playing!`)
        toast({ title: 'Playing', description: musicFile.split('/').pop() })
      } else {
        addMusicLog(`Play failed: ${data.error}`)
        toast({ title: 'Play Failed', description: data.error, variant: 'destructive' })
      }
      await fetchMusicStatus()
    } catch (error: any) {
      addMusicLog(`Play error: ${error.message}`)
      toast({ title: 'Error', description: 'Failed to play', variant: 'destructive' })
    }
    setMusicLoading(false)
  }

  const musicStop = async () => {
    addMusicLog('Stopping music...')
    try {
      await fetch(`${getApiUrl()}/api/music/stop`, { method: 'POST' })
      addMusicLog('Stopped')
      await fetchMusicStatus()
    } catch (error: any) {
      addMusicLog(`Stop error: ${error.message}`)
    }
  }

  const musicPause = async () => {
    try {
      await fetch(`${getApiUrl()}/api/music/pause`, { method: 'POST' })
      addMusicLog('Paused')
    } catch (error: any) {
      addMusicLog(`Pause error: ${error.message}`)
    }
  }

  const musicResume = async () => {
    try {
      await fetch(`${getApiUrl()}/api/music/resume`, { method: 'POST' })
      addMusicLog('Resumed')
    } catch (error: any) {
      addMusicLog(`Resume error: ${error.message}`)
    }
  }

  const musicSetVolume = async (vol: number) => {
    setMusicVolume(vol)
    try {
      await fetch(`${getApiUrl()}/api/music/volume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vol })
      })
      addMusicLog(`Volume: ${vol}%`)
    } catch (error: any) {
      addMusicLog(`Volume error: ${error.message}`)
    }
  }

  const musicAutoPlay = async () => {
    setMusicLoading(true)
    addMusicLog('Starting auto-play flow...')
    try {
      const res = await fetch(`${getApiUrl()}/api/music/auto-play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: musicFile || undefined, loop: musicLoop, botId: selectedBotId })
      })
      const data = await res.json()
      if (data.steps) {
        data.steps.forEach((s: any) => {
          const status = s.success ? (s.skipped ? 'SKIPPED' : 'OK') : 'FAIL'
          addMusicLog(`  [${status}] ${s.step}${s.error ? ': ' + s.error : ''}${s.note ? ' - ' + s.note : ''}`)
          if (s.data) {
            const d = s.data
            if (d.lastError) addMusicLog(`    lastError: ${d.lastError}`)
            if (d.inRoom !== undefined) addMusicLog(`    inRoom: ${d.inRoom}, initialized: ${d.initialized}, audioEnabled: ${d.audioEnabled}`)
          }
        })
      }
      if (data.success) {
        addMusicLog('Auto-play complete!')
        toast({ title: 'Auto-Play Started', description: 'Full pipeline executed' })
      } else {
        addMusicLog(`Auto-play failed: ${data.error}`)
        toast({ title: 'Auto-Play Failed', description: data.error, variant: 'destructive' })
      }
      await fetchMusicStatus()
    } catch (error: any) {
      addMusicLog(`Auto-play error: ${error.message}`)
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    }
    setMusicLoading(false)
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

                    {/* Auto-join status on bot card */}
                    {(() => {
                      const ajStatus = autoJoinStatus[bot.id]
                      if (!ajStatus || ajStatus.step === 'idle' || !thisBotState?.autoJoinRandomRoom) return null
                      if (thisBotRunning || thisBotWaiting) return null
                      return (
                        <div className="mt-2 p-2 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800">
                          <div className="flex items-center gap-1.5">
                            {ajStatus.step === 'countdown' ? (
                              <Clock className="h-3 w-3 text-purple-500 animate-pulse" />
                            ) : (
                              <Loader2 className="h-3 w-3 text-purple-500 animate-spin" />
                            )}
                            <span className="text-xs font-medium text-purple-600 dark:text-purple-400 truncate">
                              {ajStatus.step === 'countdown'
                                ? `Auto-join in ${ajStatus.remaining}s`
                                : ajStatus.step === 'searching' ? 'Searching rooms...'
                                : ajStatus.step === 'joining' ? `Joining ${ajStatus.room || '...'}`
                                : ajStatus.step === 'waiting' ? 'Waiting for rooms...'
                                : ajStatus.reason || 'Auto-joining...'}
                            </span>
                          </div>
                          {ajStatus.step === 'countdown' && ajStatus.remaining != null && (
                            <div className="w-full bg-purple-200 dark:bg-purple-800 rounded-full h-1 mt-1.5 overflow-hidden">
                              <div
                                className="bg-gradient-to-r from-purple-500 to-pink-500 h-full rounded-full transition-all duration-1000 ease-linear"
                                style={{ width: `${((ajStatus.total - ajStatus.remaining) / ajStatus.total) * 100}%` }}
                              />
                            </div>
                          )}
                        </div>
                      )
                    })()}

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
                            setBotStates((prev: any) => ({
                              ...prev,
                              [selectedBotId]: { ...(prev[selectedBotId] || {}), autoHijackRooms: checked }
                            }))
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
                            const res = await fetch(`${getApiUrl()}/api/bot/toggle-auto-join`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ enabled: checked, botId: selectedBotId })
                            })
                            const data = await res.json()
                            if (data.success) {
                              // Update local state immediately
                              setBotStates((prev: any) => ({
                                ...prev,
                                [selectedBotId]: {
                                  ...prev[selectedBotId],
                                  autoJoinRandomRoom: checked
                                }
                              }))
                              setBotState((prev: any) => prev ? ({ ...prev, autoJoinRandomRoom: checked }) : prev)
                            }
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

                    {/* Auto-Join Status Panel */}
                    {(() => {
                      const ajStatus = autoJoinStatus[selectedBotId]
                      if (!ajStatus || ajStatus.step === 'idle' || !currentBotState?.autoJoinRandomRoom) return null

                      return (
                        <div className="p-3 rounded-xl border-2 border-purple-200 bg-purple-50/50 dark:border-purple-800 dark:bg-purple-950/30 space-y-2">
                          <div className="flex items-center gap-2">
                            {ajStatus.step === 'countdown' ? (
                              <Clock className="h-4 w-4 text-purple-500 animate-pulse" />
                            ) : ajStatus.step === 'searching' ? (
                              <Loader2 className="h-4 w-4 text-purple-500 animate-spin" />
                            ) : ajStatus.step === 'joining' ? (
                              <Zap className="h-4 w-4 text-amber-500 animate-pulse" />
                            ) : ajStatus.step === 'joined' ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            ) : ajStatus.step === 'waiting' ? (
                              <Clock className="h-4 w-4 text-amber-500" />
                            ) : null}
                            <span className="text-sm font-semibold text-purple-700 dark:text-purple-300">
                              {ajStatus.step === 'countdown' ? 'Auto-Join Countdown' :
                               ajStatus.step === 'searching' ? 'Searching Rooms...' :
                               ajStatus.step === 'joining' ? 'Joining Room...' :
                               ajStatus.step === 'joined' ? 'Joined!' :
                               ajStatus.step === 'waiting' ? 'Waiting for Rooms' : 'Auto-Join'}
                            </span>
                          </div>
                          <p className="text-xs text-purple-600 dark:text-purple-400">{ajStatus.reason}</p>
                          {ajStatus.step === 'countdown' && ajStatus.remaining != null && (
                            <div className="space-y-1">
                              <div className="w-full bg-purple-200 dark:bg-purple-800 rounded-full h-2 overflow-hidden">
                                <div
                                  className="bg-gradient-to-r from-purple-500 to-pink-500 h-full rounded-full transition-all duration-1000 ease-linear"
                                  style={{ width: `${((ajStatus.total - ajStatus.remaining) / ajStatus.total) * 100}%` }}
                                />
                              </div>
                              <p className="text-xs text-center font-mono text-purple-500">{ajStatus.remaining}s</p>
                            </div>
                          )}
                          {ajStatus.room && ajStatus.step === 'joining' && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium truncate">
                              {ajStatus.room}
                            </p>
                          )}
                        </div>
                      )
                    })()}

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
                      currentBotState?.status === 'waiting'
                        ? "border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30"
                        : "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
                    }>
                      {currentBotState?.status === 'waiting' ? (
                        <Clock className="h-4 w-4 text-yellow-500 animate-pulse" />
                      ) : (
                        <Zap className="h-4 w-4 text-emerald-500" />
                      )}
                      <AlertDescription className="ml-2">
                        {currentBotState?.status === 'waiting' ? (
                          <>
                            <p className="font-semibold text-yellow-700 dark:text-yellow-300">
                              Waiting for {currentBotState?.followUser?.name || 'user'} to create a room...
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
                              {currentBotState?.mode === 'follow'
                                ? `Following: ${currentBotState?.followUser?.name || 'User'}`
                                : 'Bot is Running'
                              }
                            </p>
                            <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1 truncate">
                              {currentBotState?.currentRoom?.topic || 'Monitoring room'}
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

                    {/* Room health check indicator */}
                    {currentBotState?.status === 'running' && currentBotState?.currentRoom && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-500">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        <span>Room health check active (every 30s)</span>
                      </div>
                    )}

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
                <div className="flex items-center gap-2">
                  <Badge className="bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
                    {botState?.participants?.length || 0} online
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[350px] pr-4">
                {botState?.participants && botState.participants.length > 0 ? (
                  <div className="space-y-2">
                    {botState.participants.map((p: any, i: number) => {
                      const profile = p.profile
                      return (
                        <div
                          key={p.uuid || i}
                          className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors duration-200 cursor-pointer"
                          onClick={() => setSelectedUserDetail(p)}
                        >
                          <div className="relative flex-shrink-0">
                            {profile?.avatar_suit?.image_url ? (
                              <img src={profile.avatar_suit.image_url} alt="" className="w-10 h-10 rounded-xl object-cover shadow-lg shadow-rose-500/20" />
                            ) : (
                              <UserAvatar user={p} size="md" />
                            )}
                            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-gray-900" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-medium truncate">{p.pin_name}</p>
                              {profile?.yello_id && (
                                <span className="text-[10px] text-rose-500 font-medium">@{profile.yello_id}</span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {profile?.created_at
                                ? `${profile.group_shortname || ''} · Since ${new Date(profile.created_at).toLocaleDateString()}`
                                : p.campus || 'Active now'}
                            </p>
                          </div>
                          {profile && <Eye className="h-3.5 w-3.5 text-muted-foreground" />}
                        </div>
                      )
                    })}
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

          {/* Unavailable Rooms */}
          {unavailableRooms.length > 0 && !isRunning && (
            <Card className="border-0 shadow-lg bg-white dark:bg-gray-900">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <UserX className="h-5 w-5 text-red-500" />
                      Unavailable Rooms
                    </CardTitle>
                    <CardDescription>Rooms that bots cannot join (blocked users or duplicates)</CardDescription>
                  </div>
                  <Badge className="bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                    {unavailableRooms.length} blocked
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[200px] pr-4">
                  <div className="space-y-2">
                    {unavailableRooms.map((room) => (
                      <div
                        key={room.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-red-50/50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/30"
                      >
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-medium truncate">{room.roomTopic || 'Unknown Room'}</h4>
                          <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{room.reason}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Blocked: {new Date(room.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-700 hover:bg-red-100"
                          onClick={() => clearUnavailableRoom(room.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
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

                  {/* Speaker Slots (2 rows of 5) */}
                  {[[0, 1, 2, 3, 4], [5, 6, 7, 8, 9]].map((row, rowIdx) => (
                    <div key={rowIdx} className="grid grid-cols-5 gap-2">
                      {row.map((position) => {
                        const speaker = speakers[position] || botState?.speakers?.[position];
                        const isLocked = speaker?.locked || speaker?.role === 'locked';
                        const isBotHere = speaker?.uuid && speaker.uuid === botState?.user_uuid;

                        return (
                          <div key={position} className={`border rounded-lg p-2 shadow-sm ${
                            isBotHere
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                              : isLocked
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
                                    <div className={`font-medium truncate ${isBotHere ? 'text-blue-600' : ''}`}>{speaker.pin_name}{isBotHere ? ' (Bot)' : ''}</div>
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
                              {/* Bot join/leave slot */}
                              {!isLocked && !speaker?.uuid && (
                                <Button size="sm" className="h-6 text-xs w-full bg-blue-500 hover:bg-blue-600 text-white" onClick={() => joinSpeakerSlot(position)}>
                                  <Mic className="h-3 w-3 mr-1" />
                                  Join
                                </Button>
                              )}
                              {isBotHere && (
                                <Button size="sm" variant="outline" className="h-6 text-xs w-full border-blue-400 text-blue-600 hover:bg-blue-50" onClick={() => leaveSpeakerSlot(position)}>
                                  Leave
                                </Button>
                              )}
                              {speaker && !isLocked && speaker.uuid && !isBotHere && (
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
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ===== MUSIC BOT CONTROL ===== */}
          {isRunning && (
            <Card className="border-0 shadow-lg bg-white dark:bg-gray-900">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Music className="h-5 w-5 text-purple-500" />
                  Music Bot
                  {musicStatus.online ? (
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300 ml-2">
                      <div className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1 animate-pulse" />
                      Online
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="ml-2">Offline</Badge>
                  )}
                  {musicStatus.inRoom && (
                    <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
                      In Room
                    </Badge>
                  )}
                  {musicStatus.playing && (
                    <Badge className="bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300">
                      Playing
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>Play music in the voice room via GME</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Quick Actions Row */}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={fetchMusicStatus}>
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Refresh
                    </Button>

                    {!musicStatus.inRoom ? (
                      <Button size="sm" className="bg-purple-500 hover:bg-purple-600 text-white" onClick={musicJoinRoom} disabled={musicLoading}>
                        {musicLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Radio className="h-3 w-3 mr-1" />}
                        Join Voice Room
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="border-purple-300 text-purple-600" onClick={musicLeaveRoom}>
                        Leave Voice Room
                      </Button>
                    )}

                    <Button
                      size="sm"
                      className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
                      onClick={musicAutoPlay}
                      disabled={musicLoading}
                    >
                      {musicLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Zap className="h-3 w-3 mr-1" />}
                      Auto-Play (Full Pipeline)
                    </Button>
                  </div>

                  {/* File Input */}
                  <div className="flex gap-2">
                    <Input
                      value={musicFile}
                      onChange={(e) => setMusicFile(e.target.value)}
                      placeholder="Path to music file (mp3/wav/m4a)"
                      className="flex-1 text-sm"
                    />
                    <div className="flex items-center gap-2">
                      <Switch checked={musicLoop} onCheckedChange={setMusicLoop} />
                      <Label className="text-xs whitespace-nowrap">Loop</Label>
                    </div>
                  </div>

                  {/* Player Controls */}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="bg-green-500 hover:bg-green-600 text-white" onClick={musicPlay} disabled={musicLoading || !musicStatus.inRoom}>
                      <Play className="h-3 w-3 mr-1" />
                      Play
                    </Button>
                    <Button size="sm" variant="outline" onClick={musicPause}>
                      <Pause className="h-3 w-3 mr-1" />
                      Pause
                    </Button>
                    <Button size="sm" variant="outline" onClick={musicResume}>
                      <SkipForward className="h-3 w-3 mr-1" />
                      Resume
                    </Button>
                    <Button size="sm" variant="destructive" onClick={musicStop}>
                      <Square className="h-3 w-3 mr-1" />
                      Stop
                    </Button>
                  </div>

                  {/* Volume */}
                  <div className="flex items-center gap-3">
                    <Volume1 className="h-4 w-4 text-gray-500" />
                    <input
                      type="range"
                      min={0}
                      max={200}
                      value={musicVolume}
                      onChange={(e) => musicSetVolume(Number(e.target.value))}
                      className="flex-1 accent-purple-500"
                    />
                    <span className="text-xs font-mono w-10 text-right">{musicVolume}%</span>
                  </div>

                  {/* Debug Logs */}
                  <div className="border rounded-lg bg-gray-950 text-green-400 p-3 font-mono text-xs max-h-48 overflow-y-auto">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-gray-500">Debug Log</span>
                      <button className="text-gray-600 hover:text-gray-400 text-xs" onClick={() => setMusicLogs([])}>Clear</button>
                    </div>
                    {musicLogs.length === 0 ? (
                      <div className="text-gray-600">No logs yet. Click Refresh to check Music Bot status.</div>
                    ) : (
                      musicLogs.map((log, i) => (
                        <div key={i} className={log.includes('FAIL') || log.includes('error') || log.includes('failed') ? 'text-red-400' : log.includes('OK') || log.includes('success') || log.includes('Playing') || log.includes('Joined') ? 'text-green-400' : 'text-gray-400'}>
                          {log}
                        </div>
                      ))
                    )}
                  </div>

                  {/* Status Detail */}
                  {musicStatus.online && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
                        <div className="text-gray-500">In Room</div>
                        <div className="font-semibold">{musicStatus.inRoom ? 'Yes' : 'No'}</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
                        <div className="text-gray-500">Playing</div>
                        <div className="font-semibold">{musicStatus.playing ? 'Yes' : 'No'}</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
                        <div className="text-gray-500">Room</div>
                        <div className="font-semibold truncate">{musicStatus.room || '-'}</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
                        <div className="text-gray-500">File</div>
                        <div className="font-semibold truncate">{musicStatus.file?.split('/').pop() || '-'}</div>
                      </div>
                    </div>
                  )}
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

      {/* All Cached Users */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="mt-6"
      >
        <Card className="border-0 shadow-lg bg-white dark:bg-gray-900">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Database className="h-5 w-5 text-rose-500" />
                All Cached Users
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge className="bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
                  {allCachedProfiles.length} profiles
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={fetchAllProfiles}
                  disabled={loadingProfiles}
                  className="h-8"
                >
                  {loadingProfiles ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <div className="mt-2">
              <Input
                placeholder="Search by name, yello_id, campus..."
                value={profileSearch}
                onChange={(e) => setProfileSearch(e.target.value)}
                className="h-9 text-sm border-rose-200 focus:border-rose-400 focus:ring-rose-400/30"
              />
            </div>
          </CardHeader>
          <CardContent>
            {allCachedProfiles.length > 0 ? (() => {
              const searchLower = profileSearch.toLowerCase()
              const filtered = profileSearch
                ? allCachedProfiles.filter(entry => {
                    const u = entry.target_user
                    if (!u) return false
                    return (
                      (u.pin_name || '').toLowerCase().includes(searchLower) ||
                      (u.yello_id || '').toLowerCase().includes(searchLower) ||
                      (u.group_shortname || '').toLowerCase().includes(searchLower) ||
                      (u.uuid || '').toLowerCase().includes(searchLower)
                    )
                  })
                : allCachedProfiles

              return (
                <ScrollArea className="h-[400px] pr-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {filtered.map((entry: any, i: number) => {
                      const u = entry.target_user
                      if (!u) return null

                      const createdAt = u.created_at ? new Date(u.created_at) : null
                      const now = new Date()
                      let accountAge = ''
                      if (createdAt) {
                        const diff = now.getTime() - createdAt.getTime()
                        const days = Math.floor(diff / 86400000)
                        if (days >= 365) {
                          const years = Math.floor(days / 365)
                          const months = Math.floor((days % 365) / 30)
                          accountAge = months > 0 ? `${years}y${months}m` : `${years}y`
                        } else if (days >= 30) {
                          const months = Math.floor(days / 30)
                          accountAge = `${months}m`
                        } else {
                          accountAge = `${days}d`
                        }
                      }

                      return (
                        <div
                          key={u.uuid || i}
                          className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer border border-gray-100 dark:border-gray-800"
                          onClick={() => setSelectedUserDetail({ pin_name: u.pin_name, uuid: u.uuid, profile: u, followInfo: { is_blocked: entry.is_blocked, followed_at: entry.created_at } })}
                        >
                          <div className="flex-shrink-0">
                            {u.avatar_suit?.image_url ? (
                              <img src={u.avatar_suit.image_url} alt="" className="w-10 h-10 rounded-xl object-cover shadow-lg shadow-rose-500/20" />
                            ) : (
                              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center text-white font-bold shadow-lg shadow-rose-500/25">
                                {(u.pin_name || '?').charAt(0).toUpperCase()}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-medium truncate">{u.pin_name}</p>
                              {entry.is_blocked && <span className="text-[9px] bg-red-100 text-red-600 px-1 rounded">blocked</span>}
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              {u.yello_id && <span className="text-rose-500 font-medium">@{u.yello_id}</span>}
                              {u.group_shortname && u.group_shortname !== 'No Group' && (
                                <><span>·</span><span>{u.group_shortname}</span></>
                              )}
                              {accountAge && (
                                <><span>·</span><span>{accountAge}</span></>
                              )}
                            </div>
                          </div>
                          <Eye className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        </div>
                      )
                    })}
                  </div>
                  {filtered.length === 0 && (
                    <div className="text-center text-muted-foreground py-8 text-sm">
                      No profiles match "{profileSearch}"
                    </div>
                  )}
                </ScrollArea>
              )
            })() : (
              <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
                <div className="w-16 h-16 mb-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 flex items-center justify-center">
                  <Database className="h-8 w-8 text-rose-300" />
                </div>
                <p className="text-sm font-medium">No cached profiles</p>
                <p className="text-xs mb-3">Click refresh to load cached user profiles</p>
                <Button size="sm" variant="outline" onClick={fetchAllProfiles} disabled={loadingProfiles}>
                  {loadingProfiles ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                  Load Profiles
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* User Detail Modal */}
      <AnimatePresence>
        {selectedUserDetail && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedUserDetail(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold">User Profile</h3>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedUserDetail(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {(() => {
                  const data = selectedUserDetail
                  // Fallback: look up profile from cached profiles if not inline
                  let profile = data.profile
                  let followInfo = data.followInfo
                  if (!profile && data.uuid && allCachedProfiles.length > 0) {
                    const match = allCachedProfiles.find((e: any) => e.target_user?.uuid?.toLowerCase() === data.uuid?.toLowerCase())
                    if (match) {
                      profile = match.target_user
                      followInfo = followInfo || { is_blocked: match.is_blocked, followed_at: match.created_at }
                    }
                  }
                  return (
                    <div className="space-y-4">
                      {/* Avatar & Name */}
                      <div className="flex items-center gap-4">
                        {profile?.avatar_suit?.image_url ? (
                          <img src={profile.avatar_suit.image_url} alt="" className="w-14 h-14 rounded-xl object-cover shadow-lg" />
                        ) : (
                          <UserAvatar user={profile || data} size="lg" />
                        )}
                        <div>
                          <p className="text-xl font-bold">{profile?.pin_name || data.pin_name}</p>
                          {profile?.yello_id && (
                            <p className="text-sm text-rose-500 font-semibold">@{profile.yello_id}</p>
                          )}
                          {profile?.group_shortname && (
                            <p className="text-xs text-muted-foreground">{profile.group_shortname}</p>
                          )}
                        </div>
                      </div>

                      {/* Profile info grid */}
                      {profile && (
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          {profile.created_at && (
                            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800">
                              <Clock className="h-4 w-4 text-rose-400 flex-shrink-0" />
                              <div>
                                <p className="text-xs text-muted-foreground">Account Created</p>
                                <p className="font-medium text-xs">{new Date(profile.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                              </div>
                            </div>
                          )}
                          {profile.updated_at && (
                            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800">
                              <RefreshCw className="h-4 w-4 text-rose-400 flex-shrink-0" />
                              <div>
                                <p className="text-xs text-muted-foreground">Last Active</p>
                                <p className="font-medium text-xs">{new Date(profile.updated_at).toLocaleString('th-TH')}</p>
                              </div>
                            </div>
                          )}
                          {profile.group_shortname && (
                            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800">
                              <GraduationCap className="h-4 w-4 text-rose-400 flex-shrink-0" />
                              <div>
                                <p className="text-xs text-muted-foreground">Campus</p>
                                <p className="font-medium text-xs">{profile.group_shortname}</p>
                              </div>
                            </div>
                          )}
                          {profile.gme_user_id && (
                            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800">
                              <Zap className="h-4 w-4 text-rose-400 flex-shrink-0" />
                              <div>
                                <p className="text-xs text-muted-foreground">GME User ID</p>
                                <p className="font-medium text-xs">{profile.gme_user_id}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Quick info badges */}
                      <div className="flex flex-wrap gap-2">
                        {profile?.yello_id && <Badge className="text-xs bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">@{profile.yello_id}</Badge>}
                        {data.role && <Badge variant="outline" className="text-xs">Role: {data.role}</Badge>}
                        {data.position !== undefined && <Badge variant="outline" className="text-xs">Slot: {data.position}</Badge>}
                        {profile?.avatar_suit_id !== undefined && <Badge variant="outline" className="text-xs">Avatar: {profile.avatar_suit_id}</Badge>}
                        {followInfo?.is_blocked && <Badge className="text-xs bg-red-100 text-red-700">Blocked</Badge>}
                        {followInfo?.is_blocked === false && <Badge className="text-xs bg-emerald-100 text-emerald-700">Not Blocked</Badge>}
                      </div>

                      {data.joinTime && (
                        <p className="text-xs text-muted-foreground">
                          Joined room: {new Date(data.joinTime).toLocaleString()}
                        </p>
                      )}
                      {followInfo?.followed_at && (
                        <p className="text-xs text-muted-foreground">
                          Followed at: {followInfo.followed_at}
                        </p>
                      )}

                      <Separator />

                      {/* Full following entry JSON */}
                      {profile && (
                        <div>
                          <p className="text-sm font-semibold mb-2">Full Profile Data</p>
                          <pre className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-xs overflow-auto max-h-[400px] whitespace-pre-wrap break-all">
                            {JSON.stringify({
                              is_blocked: followInfo?.is_blocked,
                              target_user: profile,
                              followed_at: followInfo?.followed_at,
                              updated_at: followInfo?.updated_at,
                              id: followInfo?.id,
                              user_id: followInfo?.user_id
                            }, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
