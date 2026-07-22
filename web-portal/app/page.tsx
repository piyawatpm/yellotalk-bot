'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { SlidersHorizontal, MessageSquare, Zap, ArrowRight, Users, Radio, Music, Power, MousePointerClick, X, Hand, PartyPopper, ChevronsUp, ThumbsUp, RotateCcw } from 'lucide-react'
import io from 'socket.io-client'
import { getApiUrl, resolveApiUrl } from '@/lib/api'
import { useToast } from '@/hooks/use-toast'
import { Panel, Label, Readout, StatusPill } from '@/components/console'
import { cn } from '@/lib/utils'

const WorldStage = dynamic(() => import('@/components/three/world-stage'), { ssr: false })

// Fun actions you can make a selected bot perform on the map.
const EMOTES = [
  { clip: 'Wave', label: 'Wave', icon: Hand },
  { clip: 'Dance', label: 'Dance', icon: PartyPopper },
  { clip: 'Jump', label: 'Jump', icon: ChevronsUp },
  { clip: 'ThumbsUp', label: 'Nice', icon: ThumbsUp },
] as const

function Equalizer() {
  return (
    <span className="inline-flex h-3.5 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="eqbar h-full" style={{ animationDelay: `${i * 0.14}s` }} />
      ))}
    </span>
  )
}

export default function OverviewPage() {
  const { toast } = useToast()
  const [botStates, setBotStates] = useState<Record<string, any>>({})
  const [bots, setBots] = useState<{ id: string; name: string }[]>([])
  const [music, setMusic] = useState<Record<string, { playing?: boolean }>>({})
  const [rooms, setRooms] = useState<{ id: string; topic: string; owner: string }[]>([])
  const [connected, setConnected] = useState<boolean | null>(null)
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null)
  // Manual "play" overrides per bot: a free walk point and/or an emote clip.
  const [manual, setManual] = useState<Record<string, { target?: [number, number]; emote?: string }>>({})
  const socketRef = useRef<ReturnType<typeof io> | null>(null)
  // Optimistic local update + emit to the server, which broadcasts the shared
  // world state back to every client, keeping all maps in sync.
  const moveBot = (botId: string, x: number, z: number) => {
    setManual((m) => ({ ...m, [botId]: { ...m[botId], target: [x, z] } }))
    socketRef.current?.emit('world-move', { botId, x, z })
  }
  const emoteBot = (botId: string, emote?: string) => {
    setManual((m) => ({ ...m, [botId]: { ...m[botId], emote } }))
    socketRef.current?.emit('world-emote', { botId, emote })
  }
  const resetBot = (botId: string) => {
    setManual((m) => {
      const n = { ...m }
      delete n[botId]
      return n
    })
    socketRef.current?.emit('world-reset', { botId })
  }

  // Socket
  useEffect(() => {
    let socket: ReturnType<typeof io> | undefined
    resolveApiUrl().then((url) => {
      socket = io(url)
      socketRef.current = socket
      socket.on('connect', () => setConnected(true))
      socket.on('connect_error', () => setConnected(false))
      socket.on('disconnect', () => setConnected(false))
      socket.on('all-bot-states', (s: Record<string, any>) => setBotStates(s || {}))
      socket.on('bot-state-update', ({ botId, state }: any) => setBotStates((p) => ({ ...p, [botId]: state })))
      socket.on('bot-state', (state: any) => setBotStates((p) => ({ ...p, [state?.botId || 'bot']: state })))
      // Shared fleet-map "play" state (walk targets + emotes) from the server
      socket.on('world-state', (ws: any) => setManual(ws || {}))
    })
    return () => {
      socketRef.current = null
      if (socket) socket.disconnect()
    }
  }, [])

  // Bots roster
  useEffect(() => {
    resolveApiUrl().then(() =>
      fetch(`${getApiUrl()}/api/bots`).then((r) => r.json()).then((d) => setBots(d.bots || [])).catch(() => {})
    )
  }, [])

  // Rooms (houses)
  useEffect(() => {
    let stopped = false
    const load = () =>
      fetch(`${getApiUrl()}/api/bot/rooms`)
        .then((r) => r.json())
        .then((d) => {
          if (stopped) return
          setRooms((d.rooms || []).map((r: any) => ({ id: r.id, topic: r.topic || 'Room', owner: r.owner?.pin_name || '' })))
        })
        .catch(() => {})
    resolveApiUrl().then(load)
    const t = setInterval(load, 12000)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [])

  // Music status per bot
  const botsKey = bots.map((b) => b.id).join(',')
  useEffect(() => {
    const ids = bots.map((b) => b.id)
    if (!ids.length) return
    let stopped = false
    const poll = async () => {
      const url = getApiUrl()
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            const r = await fetch(`${url}/api/music/status?botId=${id}`)
            return [id, await r.json()] as const
          } catch {
            return [id, {}] as const
          }
        })
      )
      if (!stopped) setMusic(Object.fromEntries(entries))
    }
    poll()
    const t = setInterval(poll, 4000)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [botsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const fleet = useMemo(() => {
    const ids = bots.length ? bots.map((b) => b.id) : Object.keys(botStates)
    return ids.map((id) => {
      const st = botStates[id] || {}
      return {
        id,
        name: bots.find((b) => b.id === id)?.name || st.name || id.slice(0, 8),
        status: (st.status as string) || 'stopped',
        roomTopic: st.currentRoom?.topic || null,
        participants: st.participants?.length || 0,
        playing: !!music[id]?.playing && st.status === 'running',
      }
    })
  }, [bots, botStates, music])

  const onAir = fleet.filter((f) => f.status === 'running' || f.status === 'waiting')
  const singing = fleet.filter((f) => f.playing)
  const listeners = fleet.reduce((n, f) => n + f.participants, 0)
  const activeRooms = fleet.filter((f) => f.roomTopic)
  const selectedBot = fleet.find((f) => f.id === selectedBotId) || null

  const assignRoom = async (botId: string, roomId: string) => {
    const room = rooms.find((r) => r.id === roomId)
    const bot = fleet.find((f) => f.id === botId)
    if (!room || !bot) return
    // optimistic: the bot heads to the house right away (clear any manual walk/emote)
    resetBot(botId)
    setBotStates((p) => ({ ...p, [botId]: { ...(p[botId] || {}), status: 'running', currentRoom: { topic: room.topic } } }))
    setSelectedBotId(null)
    toast({ title: `${bot.name} → ${room.topic}`, description: 'Walking over to join the room…' })
    try {
      await fetch(`${getApiUrl()}/api/bot/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'regular', roomId, botId }),
      })
    } catch {
      toast({ title: 'Could not start bot', description: 'Is the bot server running?', variant: 'destructive' })
    }
  }

  const quickLinks = [
    { href: '/control', code: 'CTL', title: 'Control', desc: 'Launch bots, rooms, speakers, chat.', icon: SlidersHorizontal },
    { href: '/greetings', code: 'GRT', title: 'Greetings', desc: 'Welcome each user by name.', icon: MessageSquare },
    { href: '/keywords', code: 'KEY', title: 'Keywords', desc: 'Auto-replies from trigger words.', icon: Zap },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Label code="//">Operations · Overview</Label>
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Live fleet</h1>
          <p className="mt-1 text-sm text-dim">Pick a bot, choose a room, and watch it walk over to join.</p>
        </div>
        <StatusPill state={connected === false ? 'err' : onAir.length ? 'live' : 'idle'}>
          {connected === false ? 'Server offline' : onAir.length ? `${onAir.length} on air` : 'Standby'}
        </StatusPill>
      </div>

      {/* Hero — interactive world */}
      <Panel className="overflow-hidden">
        <div className="relative h-[360px] sm:h-[440px] lg:h-[520px]">
          {fleet.length > 0 ? (
            <WorldStage
              bots={fleet}
              rooms={rooms}
              selectedBotId={selectedBotId}
              manual={manual}
              onSelectBot={setSelectedBotId}
              onAssignRoom={assignRoom}
              onMoveBot={moveBot}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-panel text-faint">
                <Power className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium text-ink">{connected === false ? 'Bot server offline' : 'No bots yet'}</p>
              <p className="max-w-xs text-xs text-dim">
                {connected === false ? 'Start bot-server.js to see your fleet.' : 'Add a bot in Control to populate the map.'}
              </p>
            </div>
          )}

          {/* Title + selection prompt */}
          <div className="pointer-events-none absolute left-4 top-4 sm:left-5 sm:top-5">
            <div className="microlabel">Fleet map</div>
            <div className="mt-1 font-display text-base font-semibold text-ink sm:text-lg">
              {fleet.length} bot{fleet.length === 1 ? '' : 's'}
              {singing.length > 0 && <span className="ml-2 text-glow">· {singing.length} singing</span>}
            </div>
          </div>

          {/* Action bar (when a bot is selected) / hint */}
          <div className="absolute inset-x-4 bottom-4 sm:inset-x-5">
            {selectedBot ? (
              <div className="flex flex-col items-start gap-1.5">
                <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1 rounded-xl glass px-2 py-1.5">
                  <span className="px-1.5 text-xs font-semibold text-gold">{selectedBot.name}</span>
                  {EMOTES.map((em) => {
                    const active = manual[selectedBot.id]?.emote === em.clip
                    const Icon = em.icon
                    return (
                      <button
                        key={em.clip}
                        onClick={() => emoteBot(selectedBot.id, active ? undefined : em.clip)}
                        className={cn(
                          'inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors',
                          active ? 'bg-brand' : 'text-dim hover:bg-panel hover:text-ink'
                        )}
                        style={active ? { color: 'rgb(var(--color-onaccent))' } : undefined}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {em.label}
                      </button>
                    )
                  })}
                  <span className="mx-0.5 h-4 w-px bg-line" />
                  <button
                    onClick={() => resetBot(selectedBot.id)}
                    className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-dim hover:bg-panel hover:text-ink"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Home
                  </button>
                  <button
                    onClick={() => setSelectedBotId(null)}
                    aria-label="Done"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-faint hover:bg-panel hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="rounded-lg glass px-2.5 py-1 text-[11px] text-faint">
                  Click the ground to walk it there · click a house to join a room
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="rounded-xl glass px-3.5 py-2 text-xs font-medium text-dim">
                  <span className="flex items-center gap-2">
                    <MousePointerClick className="h-3.5 w-3.5 text-gold" /> Click a bot to play with it
                  </span>
                </div>
                <div className="hidden flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl glass px-3.5 py-2 text-xs text-dim sm:flex">
                  <span className="inline-flex items-center gap-1.5"><span className="dot dot-live" /> On air</span>
                  <span className="inline-flex items-center gap-1.5"><span className="dot dot-wait" /> Waiting</span>
                  <span className="inline-flex items-center gap-1.5"><span className="dot dot-idle" /> Idle</span>
                  <span className="inline-flex items-center gap-1.5"><span className="dot dot-music" /> Music</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Telemetry */}
        <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
          <Readout label="Bots" value={fleet.length} className="bg-raised" />
          <Readout label="On air" value={onAir.length} tone={onAir.length ? 'ok' : 'ink'} className="bg-raised" />
          <Readout label="Singing" value={singing.length} tone={singing.length ? 'glow' : 'ink'} className="bg-raised" />
          <Readout label="Listeners" value={listeners} tone="side" className="bg-raised" />
        </div>
      </Panel>

      {/* Roster + rooms */}
      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div>
              <div className="microlabel mb-1">Roster</div>
              <h3 className="font-display text-base font-semibold tracking-tight text-ink">Bots</h3>
            </div>
            <Link href="/control" className="text-sm font-medium text-gold hover:underline">
              Manage
            </Link>
          </div>
          <div className="p-3">
            {fleet.length > 0 ? (
              <ul className="space-y-2">
                {fleet.map((b) => {
                  const running = b.status === 'running' || b.status === 'waiting'
                  const isSel = selectedBotId === b.id
                  return (
                    <li key={b.id}>
                      <button
                        onClick={() => setSelectedBotId(isSel ? null : b.id)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors',
                          isSel ? 'border-gold bg-gold/[0.06]' : 'border-line bg-raised hover:border-linehi'
                        )}
                      >
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white"
                          style={{
                            background: b.playing
                              ? 'linear-gradient(135deg, rgb(var(--color-glow)), rgb(var(--color-gold)))'
                              : running
                                ? 'rgb(var(--color-gold))'
                                : 'rgb(var(--color-faint))',
                          }}
                        >
                          {b.name.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-ink">{b.name}</span>
                            {b.playing && (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-glow/10 px-2 py-0.5 text-[11px] font-semibold text-glow">
                                <Equalizer /> Playing
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-dim">
                            {b.roomTopic ? (
                              <span className="inline-flex items-center gap-1">
                                <Radio className="h-3 w-3" /> {b.roomTopic}
                              </span>
                            ) : (
                              'Not in a room'
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <StatusPill state={b.status === 'running' ? 'live' : b.status === 'waiting' ? 'wait' : 'idle'}>
                            {b.status === 'running' ? 'On air' : b.status === 'waiting' ? 'Waiting' : 'Idle'}
                          </StatusPill>
                          <span className="inline-flex items-center gap-1 text-xs text-faint">
                            <Users className="h-3 w-3" /> {b.participants}
                          </span>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="px-4 py-10 text-center text-sm text-dim">No bots configured yet.</div>
            )}
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <div className="microlabel mb-1">Live rooms</div>
            <h3 className="font-display text-base font-semibold tracking-tight text-ink">Who's in a room</h3>
          </div>
          <div className="p-3">
            {activeRooms.length > 0 ? (
              <ul className="space-y-2">
                {activeRooms.map((b) => (
                  <li key={b.id} className="rounded-xl border border-line bg-raised p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-ink">{b.roomTopic}</div>
                        <div className="mt-0.5 text-xs text-dim">
                          via <span className="text-gold">{b.name}</span>
                        </div>
                      </div>
                      {b.playing ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-glow/10 px-2 py-0.5 text-[11px] font-semibold text-glow">
                          <Music className="h-3 w-3" /> Music
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-faint">
                          <Users className="h-3 w-3" /> {b.participants}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-panel text-faint">
                  <Radio className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium text-ink">No active rooms</p>
                <p className="text-xs text-dim">Send a bot to a house to fill one.</p>
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* Quick links */}
      <div>
        <Label className="mb-3 block">Console modules</Label>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {quickLinks.map((q) => {
            const Icon = q.icon
            return (
              <Link key={q.href} href={q.href} className="group">
                <Panel className="flex h-full items-start gap-4 p-5 transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold/10 text-gold">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-base font-semibold tracking-tight text-ink">{q.title}</h3>
                      <span className="text-[10px] font-semibold tracking-wide text-faint">{q.code}</span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-dim">{q.desc}</p>
                    <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-gold">
                      Open
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </Panel>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
