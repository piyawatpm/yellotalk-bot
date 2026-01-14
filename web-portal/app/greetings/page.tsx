'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Plus, Trash2, Save, Sparkles, User, Heart, MessageCircle, Loader2, Edit2, X, Check } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

export default function GreetingsPage() {
  const { toast } = useToast()
  const [data, setData] = useState<any>(null)
  const [newName, setNewName] = useState('')
  const [newGreeting, setNewGreeting] = useState('')
  const [defaultGreeting, setDefaultGreeting] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
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
        [newName.trim()]: newGreeting.trim()
      }
    }

    await saveData(updated)
    setNewName('')
    setNewGreeting('')
    toast({ title: 'Greeting Added!', description: `Custom greeting for "${newName}" has been saved` })
  }

  const startEdit = (name: string, greeting: string) => {
    setEditingId(name)
    setEditName(name)
    setEditGreeting(greeting)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditName('')
    setEditGreeting('')
  }

  const saveEdit = async () => {
    if (!editName.trim() || !editGreeting.trim()) {
      toast({ title: 'Missing fields', description: 'Please fill in both fields', variant: 'destructive' })
      return
    }

    setSaving(true)

    // Remove old entry if name changed
    const { [editingId!]: removed, ...rest } = data.customGreetings

    const updated = {
      ...data,
      customGreetings: {
        ...rest,
        [editName.trim()]: editGreeting.trim()
      }
    }

    await saveData(updated)
    setEditingId(null)
    setEditName('')
    setEditGreeting('')
    toast({ title: 'Greeting Updated!', description: `Custom greeting has been updated` })
  }

  const removeGreeting = async (name: string) => {
    setDeletingId(name)
    const { [name]: removed, ...rest } = data.customGreetings
    const updated = { ...data, customGreetings: rest }
    await saveData(updated)
    setDeletingId(null)
    toast({ title: 'Greeting Removed', description: `Greeting for "${name}" has been deleted` })
  }

  const updateDefault = async () => {
    setSaving(true)
    const updated = { ...data, defaultGreeting }
    await saveData(updated)
    toast({ title: 'Default Updated!', description: 'Your default greeting has been saved' })
  }

  const saveData = async (updated: any) => {
    await fetch('/api/greetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    })
    setData(updated)
    setSaving(false)
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <div className="h-12 w-64 shimmer rounded-lg" />
        <div className="h-64 w-full shimmer rounded-2xl" />
        <div className="h-96 w-full shimmer rounded-2xl" />
      </div>
    )
  }

  const greetingEntries = Object.entries(data.customGreetings || {})

  return (
    <div className="space-y-6 lg:space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-2"
      >
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-rose-500 to-pink-500 shadow-lg shadow-rose-500/25">
            <Heart className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl lg:text-4xl font-bold bg-gradient-to-r from-rose-500 via-pink-500 to-rose-600 bg-clip-text text-transparent">
              Greeting Management
            </h1>
            <p className="text-sm lg:text-base text-muted-foreground">Customize how the bot greets different users</p>
          </div>
        </div>
      </motion.div>

      {/* Default Greeting */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="border-0 shadow-lg overflow-hidden bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 dark:from-amber-950/30 dark:via-orange-950/30 dark:to-rose-950/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" />
              Default Greeting
            </CardTitle>
            <CardDescription>Applied to all users not in your custom list</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 space-y-2">
                <Label className="text-sm font-medium">Greeting Text</Label>
                <Input
                  value={defaultGreeting}
                  onChange={(e) => setDefaultGreeting(e.target.value)}
                  placeholder="สวัสดี"
                  className="text-lg border-amber-200 focus:border-amber-400 focus:ring-amber-400/30 bg-white/80 dark:bg-gray-900/80"
                />
                <p className="text-xs text-muted-foreground">
                  Example: <span className="font-medium text-amber-600">"{defaultGreeting} John"</span>
                </p>
              </div>
              <div className="sm:mt-8">
                <Button
                  onClick={updateDefault}
                  disabled={saving}
                  className="w-full sm:w-auto px-6 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-lg shadow-amber-500/25 transition-all duration-300"
                >
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Add Custom Greeting */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <Card className="border-2 border-dashed border-rose-200 dark:border-rose-800 bg-white/50 dark:bg-gray-900/50 hover:border-rose-300 dark:hover:border-rose-700 transition-colors duration-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-rose-100 dark:bg-rose-900/30">
                <Plus className="h-4 w-4 text-rose-500" />
              </div>
              Add Custom Greeting
            </CardTitle>
            <CardDescription>Create personalized greetings for specific users</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Username Contains</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && newGreeting && addGreeting()}
                  placeholder="e.g., baby, rose, botyoi"
                  className="border-rose-200 focus:border-rose-400 focus:ring-rose-400/30"
                />
                <p className="text-xs text-muted-foreground">
                  Match usernames containing this text (case-insensitive)
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Custom Greeting</Label>
                <Input
                  value={newGreeting}
                  onChange={(e) => setNewGreeting(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && newName && addGreeting()}
                  placeholder="e.g., สวัสดีคนสวย"
                  className="border-rose-200 focus:border-rose-400 focus:ring-rose-400/30"
                />
                <p className="text-xs text-muted-foreground">
                  The greeting prefix (username will be added after)
                </p>
              </div>
            </div>
            <div className="mt-4">
              <Button
                onClick={addGreeting}
                disabled={!newName.trim() || !newGreeting.trim() || saving}
                className="w-full md:w-auto bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white shadow-lg shadow-rose-500/25 transition-all duration-300"
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Add Custom Greeting
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Custom Greetings List */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <Card className="border-0 shadow-lg bg-white dark:bg-gray-900">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MessageCircle className="h-5 w-5 text-rose-500" />
                  Custom Greetings
                </CardTitle>
                <CardDescription>Your personalized greeting rules (matches bot.js)</CardDescription>
              </div>
              <Badge className="w-fit bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400 hover:bg-rose-100">
                {greetingEntries.length} configured
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <AnimatePresence mode="popLayout">
              {greetingEntries.length > 0 ? (
                <div className="space-y-3">
                  {greetingEntries.map(([name, greeting], index) => (
                    <motion.div
                      key={name}
                      layout
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20, scale: 0.9 }}
                      transition={{ delay: index * 0.05 }}
                      className="group"
                    >
                      {editingId === name ? (
                        /* Edit Mode */
                        <div className="p-4 rounded-xl bg-gradient-to-r from-rose-100 to-pink-100 dark:from-rose-900/40 dark:to-pink-900/40 border-2 border-rose-300 dark:border-rose-700 space-y-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs font-medium">Username Contains</Label>
                              <Input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="border-rose-300 focus:border-rose-400 focus:ring-rose-400/30 bg-white dark:bg-gray-900"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs font-medium">Custom Greeting</Label>
                              <Input
                                value={editGreeting}
                                onChange={(e) => setEditGreeting(e.target.value)}
                                className="border-rose-300 focus:border-rose-400 focus:ring-rose-400/30 bg-white dark:bg-gray-900"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button
                              onClick={cancelEdit}
                              variant="outline"
                              size="sm"
                              className="border-gray-300 hover:bg-gray-100"
                            >
                              <X className="mr-1 h-3.5 w-3.5" />
                              Cancel
                            </Button>
                            <Button
                              onClick={saveEdit}
                              disabled={saving || !editName.trim() || !editGreeting.trim()}
                              size="sm"
                              className="bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white shadow-lg shadow-rose-500/25"
                            >
                              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
                              Save Changes
                            </Button>
                          </div>
                        </div>
                      ) : (
                        /* View Mode */
                        <div className="flex flex-col lg:flex-row lg:items-center gap-3 p-4 rounded-xl bg-gradient-to-r from-rose-50/50 to-pink-50/50 dark:from-rose-950/20 dark:to-pink-950/20 hover:from-rose-100/60 hover:to-pink-100/60 dark:hover:from-rose-950/30 dark:hover:to-pink-950/30 transition-all duration-200 border border-transparent hover:border-rose-200 dark:hover:border-rose-800">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center shadow-lg shadow-rose-500/25 flex-shrink-0">
                              <User className="h-5 w-5 text-white" />
                            </div>
                            <div className="flex-1 min-w-0 space-y-1.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-medium text-muted-foreground">If username contains:</span>
                                <code className="text-sm font-bold px-2.5 py-1 bg-rose-100 dark:bg-rose-900/40 rounded-lg text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800">
                                  {name}
                                </code>
                              </div>
                              <div className="flex items-start gap-2">
                                <span className="text-xs font-medium text-muted-foreground mt-0.5">Then greet:</span>
                                <div className="flex-1">
                                  <p className="text-sm font-medium text-foreground break-words">
                                    {String(greeting)}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    Output: <span className="text-rose-500 font-medium">"{String(greeting)} {name}"</span>
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 lg:flex-shrink-0">
                            <Button
                              onClick={() => startEdit(name, String(greeting))}
                              variant="ghost"
                              size="sm"
                              className="text-rose-500 hover:text-rose-600 hover:bg-rose-100 dark:hover:bg-rose-900/30 transition-colors duration-200"
                            >
                              <Edit2 className="h-4 w-4 mr-1" />
                              Edit
                            </Button>
                            <Button
                              onClick={() => removeGreeting(name)}
                              variant="ghost"
                              size="sm"
                              disabled={deletingId === name}
                              className="text-rose-500 hover:text-rose-600 hover:bg-rose-100 dark:hover:bg-rose-900/30 transition-colors duration-200"
                            >
                              {deletingId === name ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Trash2 className="h-4 w-4 mr-1" />
                                  Delete
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-16">
                  <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-rose-100 to-pink-100 dark:from-rose-900/30 dark:to-pink-900/30 flex items-center justify-center">
                    <Heart className="h-10 w-10 text-rose-400" />
                  </div>
                  <p className="text-sm font-medium mb-1">No custom greetings yet</p>
                  <p className="text-xs text-muted-foreground">Add your first custom greeting above</p>
                </div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </motion.div>

      {/* How It Works */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <Card className="border-0 shadow-lg overflow-hidden bg-gradient-to-br from-rose-50 via-pink-50 to-rose-50 dark:from-rose-950/30 dark:via-pink-950/30 dark:to-rose-950/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-rose-500" />
              Live Preview
            </CardTitle>
            <CardDescription>See how your greetings will look in action</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {/* Example with custom greeting */}
              {greetingEntries.slice(0, 2).map(([name, greeting]) => (
                <div key={name} className="flex items-start gap-3 p-3 rounded-xl bg-white/60 dark:bg-gray-900/60 backdrop-blur-sm">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-rose-500/25 flex-shrink-0">
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold">{name}</span>
                      <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30">
                        Joined
                      </Badge>
                    </div>
                    <div className="mt-2 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border-l-4 border-rose-500">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-rose-600 to-pink-600 flex items-center justify-center">
                          <Heart className="h-3.5 w-3.5 text-white" />
                        </div>
                        <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">Bot</span>
                      </div>
                      <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
                        {String(greeting)} {name}
                      </p>
                    </div>
                  </div>
                </div>
              ))}

              {/* Example with default greeting */}
              <div className="flex items-start gap-3 p-3 rounded-xl bg-white/60 dark:bg-gray-900/60 backdrop-blur-sm">
                <div className="w-10 h-10 rounded-xl bg-gray-400 flex items-center justify-center text-white text-sm font-bold shadow-lg flex-shrink-0">
                  N
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold">NewUser123</span>
                    <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30">
                      Joined
                    </Badge>
                  </div>
                  <div className="mt-2 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-900/50 border-l-4 border-gray-400">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-rose-600 to-pink-600 flex items-center justify-center">
                        <Heart className="h-3.5 w-3.5 text-white" />
                      </div>
                      <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Bot</span>
                    </div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {defaultGreeting} NewUser123
                      <span className="ml-2 text-xs text-muted-foreground">(using default)</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* How it works */}
            <Alert className="border-rose-200 dark:border-rose-800 bg-white/60 dark:bg-gray-900/60">
              <AlertDescription>
                <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-rose-500" />
                  How It Works
                </p>
                <ul className="text-xs space-y-1.5 text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <span className="text-rose-500 font-bold mt-0.5">1.</span>
                    <span>When a new user joins, bot checks if their username contains any of your custom keywords</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-rose-500 font-bold mt-0.5">2.</span>
                    <span>If matched, bot sends the custom greeting + username</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-rose-500 font-bold mt-0.5">3.</span>
                    <span>If no match, bot uses default greeting + username</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-rose-500 font-bold mt-0.5">4.</span>
                    <span>Matching is case-insensitive (Rose = rose = ROSE)</span>
                  </li>
                </ul>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
