'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Save, User, Loader2, Pencil, X, Check, ArrowRight, Search, Hash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { Label, Panel } from '@/components/console'

// A custom greeting is either a legacy substring rule (key = text to match,
// value = greeting string) or a per-user rule (key = user UUID, value =
// { greeting, name }). These helpers read both shapes safely.
type GreetingValue = string | { greeting?: string; name?: string; [k: string]: any }
const isUserRule = (v: GreetingValue): v is { greeting?: string; name?: string } =>
  typeof v === 'object' && v !== null
const greetingText = (v: GreetingValue): string => (isUserRule(v) ? v.greeting ?? '' : String(v ?? ''))
const greetingName = (v: GreetingValue): string => (isUserRule(v) ? v.name ?? '' : '')

export default function GreetingsPage() {
  const { toast } = useToast()
  const [data, setData] = useState<any>(null)
  const [newName, setNewName] = useState('')
  const [newGreeting, setNewGreeting] = useState('')
  const [defaultGreeting, setDefaultGreeting] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editIsUser, setEditIsUser] = useState(false)
  const [editName, setEditName] = useState('')
  const [editGreeting, setEditGreeting] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    const res = await fetch('/api/greetings')
    const json = await res.json()
    setData(json)
    setDefaultGreeting(json.defaultGreeting || 'สวัสดี')
  }

  const addGreeting = async () => {
    if (!newName.trim() || !newGreeting.trim()) {
      toast({ title: 'Missing fields', description: 'Please fill in both fields', variant: 'destructive' })
      return
    }

    setSaving(true)
    const updated = {
      ...data,
      customGreetings: {
        ...data.customGreetings,
        [newName.trim()]: newGreeting.trim(),
      },
    }

    await saveData(updated)
    setNewName('')
    setNewGreeting('')
    toast({ title: 'Greeting added', description: `Custom greeting for "${newName}" has been saved` })
  }

  const startEdit = (key: string, value: GreetingValue) => {
    setEditingId(key)
    setEditIsUser(isUserRule(value))
    setEditName(isUserRule(value) ? greetingName(value) : key)
    setEditGreeting(greetingText(value))
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditIsUser(false)
    setEditName('')
    setEditGreeting('')
  }

  const saveEdit = async () => {
    if (!editName.trim() || !editGreeting.trim()) {
      toast({ title: 'Missing fields', description: 'Please fill in both fields', variant: 'destructive' })
      return
    }

    setSaving(true)

    let customGreetings
    if (editIsUser) {
      // Per-user rule: keep the UUID key, preserve the { greeting, name } shape.
      customGreetings = {
        ...data.customGreetings,
        [editingId!]: { ...data.customGreetings[editingId!], greeting: editGreeting.trim(), name: editName.trim() },
      }
    } else {
      // Substring rule: the key itself is editable, value stays a string.
      const { [editingId!]: removed, ...rest } = data.customGreetings
      customGreetings = { ...rest, [editName.trim()]: editGreeting.trim() }
    }

    await saveData({ ...data, customGreetings })
    cancelEdit()
    toast({ title: 'Greeting updated', description: 'Custom greeting has been updated' })
  }

  const removeGreeting = async (key: string) => {
    setDeletingId(key)
    const { [key]: removed, ...rest } = data.customGreetings
    const updated = { ...data, customGreetings: rest }
    await saveData(updated)
    setDeletingId(null)
    toast({ title: 'Greeting removed', description: 'The greeting has been deleted' })
  }

  const updateDefault = async () => {
    setSaving(true)
    const updated = { ...data, defaultGreeting }
    await saveData(updated)
    toast({ title: 'Default updated', description: 'Your default greeting has been saved' })
  }

  const saveData = async (updated: any) => {
    await fetch('/api/greetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    })
    setData(updated)
    setSaving(false)
  }

  const allEntries = useMemo(
    () => Object.entries((data?.customGreetings || {}) as Record<string, GreetingValue>),
    [data]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allEntries
    return allEntries.filter(([key, value]) => {
      return (
        key.toLowerCase().includes(q) ||
        greetingName(value).toLowerCase().includes(q) ||
        greetingText(value).toLowerCase().includes(q)
      )
    })
  }, [allEntries, search])

  if (!data) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-64 shimmer rounded-sm" />
        <div className="h-40 w-full shimmer rounded-md" />
        <div className="h-80 w-full shimmer rounded-md" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Label code="//">Config · Greetings</Label>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink lg:text-3xl">
          Greeting rules
        </h1>
        <p className="mt-1 text-sm text-dim">Customize how the bot welcomes each user as they join.</p>
      </div>

      {/* Default greeting */}
      <Panel className="overflow-hidden">
        <div className="border-b border-line px-5 py-3.5">
          <div className="microlabel mb-1">Fallback</div>
          <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink">Default greeting</h3>
          <p className="mt-0.5 text-xs text-dim">Applied to every user without a custom rule.</p>
        </div>
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <label className="microlabel">Greeting text</label>
            <Input
              value={defaultGreeting}
              onChange={(e) => setDefaultGreeting(e.target.value)}
              placeholder="สวัสดี"
              className="text-base"
            />
            <p className="text-xs text-dim">
              Example output: <span className="readout text-gold">“{defaultGreeting} John”</span>
            </p>
          </div>
          <Button onClick={updateDefault} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        </div>
      </Panel>

      {/* Add custom */}
      <Panel className="overflow-hidden">
        <div className="border-b border-line px-5 py-3.5">
          <div className="microlabel mb-1">New rule</div>
          <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink">Add custom greeting</h3>
          <p className="mt-0.5 text-xs text-dim">Personalize the welcome for specific usernames.</p>
        </div>
        <div className="p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="microlabel">Username contains</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && newGreeting && addGreeting()}
                placeholder="e.g. baby, rose, botyoi"
              />
              <p className="text-xs text-dim">Case-insensitive substring match.</p>
            </div>
            <div className="space-y-2">
              <label className="microlabel">Custom greeting</label>
              <Input
                value={newGreeting}
                onChange={(e) => setNewGreeting(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && newName && addGreeting()}
                placeholder="e.g. สวัสดีคนสวย"
              />
              <p className="text-xs text-dim">The username is appended automatically.</p>
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={addGreeting} disabled={!newName.trim() || !newGreeting.trim() || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add greeting
            </Button>
          </div>
        </div>
      </Panel>

      {/* Custom list */}
      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div>
            <div className="microlabel mb-1">Rules</div>
            <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink">Custom greetings</h3>
          </div>
          <span className="readout text-[11px] text-faint">
            {search ? `${filtered.length} / ${allEntries.length}` : `${allEntries.length}`} active
          </span>
        </div>

        {/* Search */}
        <div className="border-b border-line p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by id, name, or greeting…"
              className="pl-9"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-faint transition-colors hover:bg-panel hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="p-3">
          {filtered.length > 0 ? (
            <div className="space-y-2">
              {filtered.map(([key, value]) => {
                const isUser = isUserRule(value)
                const gText = greetingText(value)
                const gName = greetingName(value)
                const outName = isUser ? gName : key

                return editingId === key ? (
                  <div key={key} className="rounded-sm border border-gold/50 bg-panel p-4">
                    {isUser && (
                      <div className="mb-3 flex items-center gap-2">
                        <span className="microlabel">User id</span>
                        <code className="readout truncate rounded-sm border border-line bg-raised px-2 py-0.5 text-[11px] text-dim" title={key}>
                          {key}
                        </code>
                      </div>
                    )}
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="microlabel">{isUser ? 'Display name' : 'Username contains'}</label>
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <label className="microlabel">Custom greeting</label>
                        <Input value={editGreeting} onChange={(e) => setEditGreeting(e.target.value)} />
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      <Button onClick={cancelEdit} variant="ghost" size="sm">
                        <X className="h-3.5 w-3.5" />
                        Cancel
                      </Button>
                      <Button onClick={saveEdit} disabled={saving || !editName.trim() || !editGreeting.trim()} size="sm">
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    key={key}
                    className="group flex flex-col gap-3 rounded-sm border border-line bg-raised p-4 transition-colors hover:border-linehi lg:flex-row lg:items-center"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-line bg-panel text-gold">
                        {isUser ? <User className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="microlabel">{isUser ? 'user' : 'contains'}</span>
                          {isUser ? (
                            <>
                              <span className="font-semibold text-ink">{gName || 'Unknown'}</span>
                              <code
                                className="readout max-w-[220px] truncate rounded-sm border border-line bg-panel px-1.5 py-0.5 text-[10px] text-faint"
                                title={key}
                              >
                                {key}
                              </code>
                            </>
                          ) : (
                            <code className="readout rounded-sm border border-line bg-panel px-2 py-0.5 text-xs font-semibold text-gold">
                              {key}
                            </code>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-dim">
                          <ArrowRight className="h-3 w-3 shrink-0 text-faint" />
                          <span className="truncate text-ink">
                            “{gText} <span className="text-faint">{outName}</span>”
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 lg:shrink-0">
                      <Button onClick={() => startEdit(key, value)} variant="ghost" size="sm">
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                      <Button
                        onClick={() => removeGreeting(key)}
                        variant="ghost"
                        size="sm"
                        disabled={deletingId === key}
                        className="text-err hover:text-err"
                      >
                        {deletingId === key ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        Delete
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-line bg-panel text-faint">
                {search ? <Search className="h-5 w-5" /> : <User className="h-5 w-5" />}
              </div>
              <p className="text-sm font-medium text-ink">
                {search ? 'No matches' : 'No custom greetings yet'}
              </p>
              <p className="text-xs text-dim">
                {search ? (
                  <>
                    Nothing matches “<span className="text-ink">{search}</span>”.
                  </>
                ) : (
                  'Add your first rule above.'
                )}
              </p>
            </div>
          )}
        </div>
      </Panel>

      {/* How it works */}
      <Panel className="overflow-hidden">
        <div className="border-b border-line px-5 py-3.5">
          <div className="microlabel mb-1">Reference</div>
          <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink">How matching works</h3>
        </div>
        <div className="grid gap-px bg-line md:grid-cols-2">
          <div className="space-y-3 bg-raised p-5">
            {allEntries.slice(0, 2).map(([key, value]) => {
              const isUser = isUserRule(value)
              const outName = isUser ? greetingName(value) : key
              return (
                <div key={key} className="rounded-sm border border-line bg-panel p-3">
                  <div className="microlabel mb-1.5">{outName || key} joins</div>
                  <p className="text-sm text-ink">
                    <span className="text-gold">Bot →</span> {greetingText(value)} {outName}
                  </p>
                </div>
              )
            })}
            <div className="rounded-sm border border-line bg-panel p-3">
              <div className="microlabel mb-1.5">NewUser123 joins</div>
              <p className="text-sm text-ink">
                <span className="text-gold">Bot →</span> {defaultGreeting} NewUser123{' '}
                <span className="text-xs text-faint">(default)</span>
              </p>
            </div>
          </div>
          <ol className="space-y-3 bg-raised p-5">
            {[
              'On join, the bot checks the user against every custom rule (by name or user id).',
              'On a match, it sends that custom greeting plus the name.',
              'With no match, it falls back to the default greeting.',
              'Matching is case-insensitive (Rose = rose = ROSE).',
            ].map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="readout text-xs font-semibold text-gold">{String(i + 1).padStart(2, '0')}</span>
                <span className="text-sm text-dim">{t}</span>
              </li>
            ))}
          </ol>
        </div>
      </Panel>
    </div>
  )
}
