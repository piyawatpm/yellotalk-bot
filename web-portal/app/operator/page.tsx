'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Bot, Play, Square, Loader2, Users, DoorOpen, Megaphone, Info } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

const getApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:5353'
  const h = window.location.hostname
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:5353'
  return `http://${h}:5353`
}

type BotItem = { id: string; name: string }
type Summonable = { id: string; name: string; available: boolean; currentRoomId: string | null }
type Status = {
  running: boolean
  operatorBotId: string | null
  operatorRoomId: string | null
  room: { id: string; topic: string } | null
  activeSessions: number
  marker: string
  summonable: Summonable[]
}

export default function OperatorPage() {
  const { toast } = useToast()
  const [bots, setBots] = useState<BotItem[]>([])
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)

  const api = getApiUrl()

  const loadBots = useCallback(async () => {
    try {
      const r = await fetch(`${api}/api/bots`)
      const j = await r.json()
      setBots(j.bots || [])
    } catch { /* ignore */ }
  }, [api])

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch(`${api}/api/operator/status`)
      setStatus(await r.json())
    } catch { /* ignore */ }
  }, [api])

  useEffect(() => {
    loadBots()
    loadStatus()
    const t = setInterval(loadStatus, 4000)
    return () => clearInterval(t)
  }, [loadBots, loadStatus])

  const selectOperator = async (botId: string) => {
    setBusy(true)
    try {
      await fetch(`${api}/api/operator/select`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId }),
      })
      toast({ title: 'Operator set', description: bots.find(b => b.id === botId)?.name || botId })
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
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'failed', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  const running = status?.running
  const operatorBotId = status?.operatorBotId || null
  const summonable = bots.filter(b => b.id !== operatorBotId)

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-primary/10"><Megaphone className="h-6 w-6 text-primary" /></div>
        <div>
          <h1 className="text-2xl font-bold">Operator & Summon</h1>
          <p className="text-sm text-muted-foreground">Users summon bots with <code className="px-1 rounded bg-muted">@bot</code> — no random joining.</p>
        </div>
      </div>

      {/* How it works */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          The <b>operator</b> hosts a help room and never gets summoned itself. Users can (1) put
          <code className="px-1 mx-1 rounded bg-muted">@bot</code> in their <b>room title</b> to auto-summon a free bot, or
          (2) type <code className="px-1 mx-1 rounded bg-muted">@bot</code> in the operator room to pick a room from a list.
        </AlertDescription>
      </Alert>

      {/* Operator selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" /> Operator bot</CardTitle>
          <CardDescription>Pick the dedicated bot that hosts the help room. Excluded from the summon pool.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {bots.map(b => (
              <Button
                key={b.id}
                variant={operatorBotId === b.id ? 'default' : 'outline'}
                size="sm"
                disabled={busy || running}
                onClick={() => selectOperator(b.id)}
              >
                {operatorBotId === b.id && <Bot className="h-4 w-4 mr-1" />}{b.name}
              </Button>
            ))}
            {bots.length === 0 && <span className="text-sm text-muted-foreground">No bots configured.</span>}
          </div>
          {running && <p className="text-xs text-muted-foreground">Stop the operator to change the selection.</p>}

          <div className="flex items-center gap-3 pt-2">
            {!running ? (
              <Button disabled={busy || !operatorBotId} onClick={() => startStop('start')}>
                {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />} Start operator
              </Button>
            ) : (
              <Button variant="destructive" disabled={busy} onClick={() => startStop('stop')}>
                {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Square className="h-4 w-4 mr-1" />} Stop operator
              </Button>
            )}
            <Badge variant={running ? 'default' : 'secondary'}>{running ? 'Running' : 'Stopped'}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Live status */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><DoorOpen className="h-5 w-5" /> Status</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Operator room</span>
            <span>{status?.room ? <Badge variant="outline">{status.room.topic}</Badge> : <span className="text-amber-600">not open</span>}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1"><Users className="h-4 w-4" /> Active picker sessions</span>
            <span>{status?.activeSessions ?? 0}</span>
          </div>
          {!status?.room && running && (
            <Alert variant="destructive">
              <AlertDescription className="text-xs">
                The operator couldn’t open a room — these bot accounts can’t host natively (no <code>gme_user_id</code>).
                Create a room in the app, then set <code>&quot;operatorRoomId&quot;:&quot;&lt;id&gt;&quot;</code> in <code>config.json</code> and restart.
                Topic-summon still works without a hosted room.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Summonable pool */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Summonable bots</CardTitle>
          <CardDescription>Everyone except the operator. Green = free to be summoned.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {summonable.map(b => {
              const s = status?.summonable?.find(x => x.id === b.id)
              const available = s ? s.available : true
              return (
                <Badge key={b.id} variant={available ? 'default' : 'secondary'} className={available ? 'bg-green-600 hover:bg-green-600' : ''}>
                  {b.name} · {available ? 'free' : 'busy'}
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
