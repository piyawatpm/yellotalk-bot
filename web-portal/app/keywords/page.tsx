'use client'

import { useEffect, useState } from 'react'
import { Plus, X, Loader2, Hash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { Label, Panel } from '@/components/console'

export default function KeywordsPage() {
  const { toast } = useToast()
  const [data, setData] = useState<any>(null)
  const [newKeyword, setNewKeyword] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingKeyword, setDeletingKeyword] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    const res = await fetch('/api/greetings')
    const json = await res.json()
    setData(json)
  }

  const addKeyword = async () => {
    if (!newKeyword.trim()) return

    setSaving(true)
    const updated = {
      ...data,
      keywords: {
        ...data.keywords,
        listUsers: [...(data.keywords.listUsers || []), newKeyword.trim()],
      },
    }

    await saveData(updated)
    setNewKeyword('')
    toast({ title: 'Keyword added', description: `"${newKeyword}" will now trigger the user-list response` })
  }

  const removeKeyword = async (keyword: string) => {
    setDeletingKeyword(keyword)
    const updated = {
      ...data,
      keywords: {
        ...data.keywords,
        listUsers: data.keywords.listUsers.filter((k: string) => k !== keyword),
      },
    }
    await saveData(updated)
    setDeletingKeyword(null)
    toast({ title: 'Keyword removed', description: `"${keyword}" has been removed` })
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

  if (!data) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-64 shimmer rounded-sm" />
        <div className="h-32 w-full shimmer rounded-md" />
        <div className="h-64 w-full shimmer rounded-md" />
      </div>
    )
  }

  const keywords = data.keywords?.listUsers || []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Label code="//">Config · Keywords</Label>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink lg:text-3xl">
          Trigger words
        </h1>
        <p className="mt-1 text-sm text-dim">
          Define words that make the bot auto-reply with the current room roster.
        </p>
      </div>

      {/* Add keyword */}
      <Panel className="overflow-hidden">
        <div className="border-b border-line px-5 py-3.5">
          <div className="microlabel mb-1">New trigger</div>
          <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink">Add keyword</h3>
        </div>
        <div className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1 space-y-2">
              <Input
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addKeyword()}
                placeholder="e.g. ใครบ้าง, who, list users"
                className="text-base"
              />
              <p className="text-xs text-dim">
                Press <kbd className="readout rounded-sm border border-line bg-panel px-1.5 py-0.5 text-[10px] text-gold">Enter</kbd> or Add to save.
              </p>
            </div>
            <Button onClick={addKeyword} disabled={!newKeyword.trim() || saving} size="lg">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </Button>
          </div>
        </div>
      </Panel>

      {/* Keyword list */}
      <Panel className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <div className="microlabel mb-1">Active</div>
            <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink">
              Roster triggers
            </h3>
          </div>
          <span className="readout text-[11px] text-faint">{keywords.length} words</span>
        </div>
        <div className="p-5">
          {keywords.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {keywords.map((keyword: string) => (
                <div
                  key={keyword}
                  className="group inline-flex items-center gap-2 rounded-sm border border-line bg-panel py-1.5 pl-2.5 pr-1.5 transition-colors hover:border-gold"
                >
                  <Hash className="h-3.5 w-3.5 text-gold" />
                  <span className="text-sm font-medium text-ink">{keyword}</span>
                  <button
                    onClick={() => removeKeyword(keyword)}
                    disabled={deletingKeyword === keyword}
                    aria-label={`Remove ${keyword}`}
                    className="flex h-5 w-5 items-center justify-center rounded-sm text-faint transition-colors hover:bg-err hover:text-white"
                  >
                    {deletingKeyword === keyword ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-line bg-panel text-faint">
                <Hash className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-ink">No keywords configured</p>
              <p className="text-xs text-dim">Add your first trigger above.</p>
            </div>
          )}
        </div>
      </Panel>

      {/* How it works */}
      <Panel className="overflow-hidden">
        <div className="border-b border-line px-5 py-3.5">
          <div className="microlabel mb-1">Reference</div>
          <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink">How it works</h3>
        </div>
        <div className="grid gap-px bg-line md:grid-cols-2">
          {/* Example interaction */}
          <div className="space-y-3 bg-raised p-5">
            <div className="microlabel">Example interaction</div>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-line bg-panel text-xs font-bold text-dim">
                U
              </div>
              <div className="flex-1 rounded-sm border border-line bg-panel p-3">
                <div className="text-xs font-semibold text-dim">User123</div>
                <p className="mt-1 text-sm text-ink">{keywords[0] || 'ใครบ้าง'}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-gold/50 bg-panel text-xs font-bold text-gold">
                B
              </div>
              <div className="flex-1 rounded-sm border border-line bg-panel p-3">
                <div className="text-xs font-semibold text-gold">Bot</div>
                <p className="mt-1 whitespace-pre-line text-sm text-ink">
                  {'คนในห้องตอนนี้ (5 คน):\n1. User1\n2. User2\n3. User3\n…'}
                </p>
              </div>
            </div>
          </div>

          {/* Rules */}
          <ol className="space-y-3 bg-raised p-5">
            {[
              'The bot watches every chat message in real time.',
              'A message containing any keyword triggers the roster reply.',
              'Keywords are case-insensitive (who = WHO = Who).',
              'The bot ignores its own messages to avoid loops.',
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
