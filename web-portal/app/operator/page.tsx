'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Bot, Play, Square, Loader2, Users, DoorOpen, Megaphone, Info, MessageSquare, Radio, ArrowRightCircle } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

const getApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:5353'
  const h = window.location.hostname
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:5353'
  return `http://${h}:5353`
}

type BotItem = { id: string; name: string }
type Summonable = { id: string; name: string; available: boolean; currentRoomId: string | null }
type Summon = { bot: string; roomTopic: string; roomId: string; by: string | null; type: 'chat' | 'topic'; ts: number }
type Status = {
  running: boolean
  operatorBotId: string | null
  operatorRoomId: string | null
  room: { id: string; topic: string } | null
  activeSessions: number
  marker: string
  summonable: Summonable[]
  recentSummons: Summon[]
}
type FeedMsg = { from: string; text: string; self: boolean; ts: number }

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export default function OperatorPage() {
  const { toast } = useToast()
  const [bots, setBots] = useState<BotItem[]>([])
  const [status, setStatus] = useState<Status | null>(null)
  const [feed, setFeed] = useState<FeedMsg[]>([])
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)
  const api = getApiUrl()

  const loadBots = useCallback(async () => {
    try { const r = await fetch(`${api}/api/bots`); const j = await r.json(); setBots(j.bots || []) } catch {}
  }, [api])
  const loadStatus = useCallback(async () => {
    try { const r = await fetch(`${api}/api/operator/status`); setStatus(await r.json()) } catch {}
  }, [api])

  // initial load + slow poll fallback
  useEffect(() => { loadBots(); loadStatus(); const t = setInterval(loadStatus, 8000); return () => clearInterval(t) }, [loadBots, loadStatus])

  // live socket updates
  useEffect(() => {
    const socket: Socket = io(api, { transports: ['websocket', 'polling'] })
    socket.on('connect', () => setLive(true))
    socket.on('disconnect', () => setLive(false))
    socket.on('operator-status', () => loadStatus())
    socket.on('operator-summon', () => loadStatus())
    socket.on('operator-message', (m: FeedMsg) => setFeed((f) => [...f, m].slice(-60)))
    return () => { socket.disconnect() }
  }, [api, loadStatus])

  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight }) }, [feed])

  const selectOperator = async (botId: string) => {
    setBusy(true)
    try {
      await fetch(`${api}/api/operator/select`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ botId }) })
      toast({ title: 'Operator set', description: bots.find((b) => b.id === botId)?.name || botId })
      await loadStatus()
    } finally { setBusy(false) }
  }
  const startStop = async (action: 'start' | 'stop') => {
    setBusy(true)
    try {
      const r = await fetch(`${api}/api/operator/${action}`, { method: 'POST' })
      const j = await r.json()
      if (j.error) toast({ title: 'Error', description: j.error, variant: 'destructive' })
      else toast({ title: action === 'start' ? 'Operator started' : 'Operator stopped' })
      await loadStatus()
    } catch (e: any) { toast({ title: 'Error', description: e?.message || 'failed', variant: 'destructive' }) }
    finally { setBusy(false) }
  }

  const running = status?.running
  const operatorBotId = status?.operatorBotId || null
  const summonable = bots.filter((b) => b.id !== operatorBotId)
  const marker = status?.marker || '@bot'

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10"><Megaphone className="h-6 w-6 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-bold">Operator & Summon</h1>
            <p className="text-sm text-muted-foreground">Users summon bots with <code className="px-1 rounded bg-muted">{marker}</code> — no random joining.</p>
          </div>
        </div>
        <Badge variant={live ? 'default' : 'secondary'} className={live ? 'bg-green-600 hover:bg-green-600' : ''}>
          <Radio className="h-3 w-3 mr-1" />{live ? 'live' : 'offline'}
        </Badge>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          The <b>operator</b> hosts a help room and is never summoned itself. Users can put
          <code className="px-1 mx-1 rounded bg-muted">{marker}</code> in their <b>room title</b> (auto-summon), or type
          <code className="px-1 mx-1 rounded bg-muted">{marker}</code> in the operator room to pick a room from a list.
        </AlertDescription>
      </Alert>

      {/* Control: select operator + start/stop */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" /> Operator bot</CardTitle>
          <CardDescription>Pick the dedicated host bot (excluded from the summon pool), then start operator mode.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {bots.map((b) => (
              <Button key={b.id} variant={operatorBotId === b.id ? 'default' : 'outline'} size="sm" disabled={busy || running} onClick={() => selectOperator(b.id)}>
                {operatorBotId === b.id && <Bot className="h-4 w-4 mr-1" />}{b.name}
              </Button>
            ))}
            {bots.length === 0 && <span className="text-sm text-muted-foreground">No bots configured.</span>}
          </div>
          {running && <p className="text-xs text-muted-foreground">Stop the operator to change the selection.</p>}
          <div className="flex items-center gap-3 pt-1">
            {!running ? (
              <Button disabled={busy || !operatorBotId} onClick={() => startStop('start')}>
                {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />} Start operator mode
              </Button>
            ) : (
              <Button variant="destructive" disabled={busy} onClick={() => startStop('stop')}>
                {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Square className="h-4 w-4 mr-1" />} Stop operator
              </Button>
            )}
            <Badge variant={running ? 'default' : 'secondary'} className={running ? 'bg-green-600 hover:bg-green-600' : ''}>{running ? 'Running' : 'Stopped'}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Status tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Operator" value={bots.find((b) => b.id === operatorBotId)?.name || '—'} icon={<Bot className="h-4 w-4" />} />
        <StatTile label="Room" value={status?.room ? 'open' : 'not open'} icon={<DoorOpen className="h-4 w-4" />} warn={running && !status?.room} />
        <StatTile label="Pickers" value={String(status?.activeSessions ?? 0)} icon={<Users className="h-4 w-4" />} />
        <StatTile label="Free bots" value={`${(status?.summonable || []).filter((s) => s.available).length}/${summonable.length}`} icon={<ArrowRightCircle className="h-4 w-4" />} />
      </div>

      {running && !status?.room && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">
            Operator couldn’t open a room — these accounts can’t host natively (no <code>gme_user_id</code>). Create a room in the app,
            set <code>&quot;operatorRoomId&quot;:&quot;&lt;id&gt;&quot;</code> in <code>config.json</code>, and restart. <b>Topic-summon still works</b> without a hosted room.
          </AlertDescription>
        </Alert>
      )}

      {/* Live operator-room feed */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="h-4 w-4" /> Operator room — live feed {status?.room && <Badge variant="outline" className="ml-1 font-normal">{status.room.topic}</Badge>}</CardTitle>
        </CardHeader>
        <CardContent>
          <div ref={feedRef} className="h-56 overflow-y-auto rounded-lg bg-muted/40 p-3 space-y-1.5 text-sm">
            {feed.length === 0 && <p className="text-muted-foreground text-xs">No activity yet. Messages in the operator room appear here in real time.</p>}
            {feed.map((m, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-[10px] text-muted-foreground tabular-nums mt-0.5 shrink-0">{time(m.ts)}</span>
                <span className={m.self ? 'text-primary font-medium' : ''}><b>{m.from}:</b> {m.text}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent summons */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><ArrowRightCircle className="h-4 w-4" /> Recent summons</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(!status?.recentSummons || status.recentSummons.length === 0) && <p className="text-muted-foreground text-xs">No summons yet.</p>}
            {(status?.recentSummons || []).map((s, i) => (
              <div key={i} className="flex items-center justify-between text-sm border-b border-border/50 pb-1.5 last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className="shrink-0">{s.bot}</Badge>
                  <ArrowRightCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{s.roomTopic}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-[10px]">{s.type === 'chat' ? `by ${s.by || 'user'}` : 'by room name'}</Badge>
                  <span className="tabular-nums">{time(s.ts)}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Summonable pool */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Summonable bots</CardTitle>
          <CardDescription>Everyone except the operator. Green = free.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {summonable.map((b) => {
              const s = status?.summonable?.find((x) => x.id === b.id)
              const available = s ? s.available : true
              return (
                <Badge key={b.id} variant={available ? 'default' : 'secondary'} className={available ? 'bg-green-600 hover:bg-green-600' : ''}>
                  {b.name} · {available ? 'free' : (s?.currentRoomId ? 'in a room' : 'busy')}
                </Badge>
              )
            })}
            {summonable.length === 0 && <span className="text-sm text-muted-foreground">Add more bot accounts to have something to summon.</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function StatTile({ label, value, icon, warn }: { label: string; value: string; icon: React.ReactNode; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${warn ? 'border-amber-400/60 bg-amber-50 dark:bg-amber-950/20' : 'bg-card'}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
      <div className={`text-lg font-semibold mt-0.5 truncate ${warn ? 'text-amber-600' : ''}`}>{value}</div>
    </div>
  )
}
