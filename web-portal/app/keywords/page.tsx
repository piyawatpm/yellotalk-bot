'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Plus, X, Zap, MessageCircle, Sparkles, Loader2, Hash } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
} as const

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24 }
  }
}

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
        listUsers: [...(data.keywords.listUsers || []), newKeyword.trim()]
      }
    }

    await saveData(updated)
    setNewKeyword('')
    toast({ title: 'Keyword Added!', description: `"${newKeyword}" will now trigger the user list response` })
  }

  const removeKeyword = async (keyword: string) => {
    setDeletingKeyword(keyword)
    const updated = {
      ...data,
      keywords: {
        ...data.keywords,
        listUsers: data.keywords.listUsers.filter((k: string) => k !== keyword)
      }
    }
    await saveData(updated)
    setDeletingKeyword(null)
    toast({ title: 'Keyword Removed', description: `"${keyword}" has been removed` })
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
        <div className="h-48 w-full shimmer rounded-2xl" />
        <div className="h-64 w-full shimmer rounded-2xl" />
      </div>
    )
  }

  const keywords = data.keywords?.listUsers || []

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6 lg:space-y-8"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="space-y-2">
        <div className="flex items-center gap-3">
          <motion.div
            whileHover={{ rotate: 15, scale: 1.1 }}
            className="p-2.5 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 shadow-lg shadow-amber-500/30"
          >
            <Zap className="h-5 w-5 text-white" />
          </motion.div>
          <div>
            <h1 className="text-2xl lg:text-4xl font-bold gradient-text-warm">Keyword Management</h1>
            <p className="text-sm lg:text-base text-muted-foreground">Define trigger words for automatic bot responses</p>
          </div>
        </div>
      </motion.div>

      {/* Add Keyword */}
      <motion.div variants={itemVariants}>
        <Card className="border-2 border-dashed border-amber-200 dark:border-amber-800 bg-gradient-to-br from-amber-50/50 to-orange-50/50 dark:from-amber-950/20 dark:to-orange-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <motion.div
                animate={{ scale: [1, 1.2, 1], rotate: [0, 10, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/30"
              >
                <Plus className="h-4 w-4 text-amber-600" />
              </motion.div>
              Add New Keyword
            </CardTitle>
            <CardDescription>Add words or phrases that trigger automatic responses</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 space-y-2">
                <Input
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addKeyword()}
                  placeholder="e.g., ใครบ้าง, who, list users"
                  className="text-lg border-amber-200 focus:border-amber-400 focus:ring-amber-400/30 bg-white/80 dark:bg-gray-900/80"
                />
                <p className="text-xs text-muted-foreground">
                  Press <kbd className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 rounded text-amber-600 font-mono text-xs">Enter</kbd> or click Add to save
                </p>
              </div>
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Button
                  onClick={addKeyword}
                  disabled={!newKeyword.trim() || saving}
                  size="lg"
                  className="w-full sm:w-auto px-8 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-lg shadow-amber-500/30"
                >
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Add
                </Button>
              </motion.div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Keywords List */}
      <motion.div variants={itemVariants}>
        <Card className="border-0 shadow-lg bg-white dark:bg-gray-900">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <motion.div
                    animate={{ rotate: [0, 360] }}
                    transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                  >
                    <Zap className="h-5 w-5 text-amber-500" />
                  </motion.div>
                  Active Keywords
                </CardTitle>
                <CardDescription>Keywords that trigger "List Users" response</CardDescription>
              </div>
              <Badge className="w-fit bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 hover:bg-amber-100">
                {keywords.length} keywords
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <AnimatePresence mode="popLayout">
              {keywords.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {keywords.map((keyword: string, index: number) => (
                    <motion.div
                      key={keyword}
                      layout
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8, y: -10 }}
                      transition={{ delay: index * 0.05 }}
                      whileHover={{ scale: 1.05, y: -2 }}
                      className="group relative"
                    >
                      <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border-2 border-amber-200 dark:border-amber-800 rounded-full shadow-sm hover:shadow-md hover:border-amber-300 transition-all">
                        <Hash className="h-3.5 w-3.5 text-amber-500" />
                        <span className="font-medium text-amber-900 dark:text-amber-100">{keyword}</span>
                        <motion.button
                          whileHover={{ scale: 1.1, rotate: 90 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => removeKeyword(keyword)}
                          disabled={deletingKeyword === keyword}
                          className="ml-1 w-5 h-5 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                        >
                          {deletingKeyword === keyword ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <X className="h-3 w-3" />
                          )}
                        </motion.button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center py-12"
                >
                  <motion.div
                    animate={{
                      y: [0, -5, 0],
                      rotate: [0, 5, -5, 0]
                    }}
                    transition={{ duration: 3, repeat: Infinity }}
                    className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/30 dark:to-orange-900/30 flex items-center justify-center"
                  >
                    <Zap className="h-10 w-10 text-amber-400" />
                  </motion.div>
                  <p className="text-sm font-medium mb-1">No keywords configured</p>
                  <p className="text-xs text-muted-foreground">Add your first keyword above</p>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </motion.div>

      {/* How It Works */}
      <motion.div variants={itemVariants}>
        <Card className="border-0 shadow-lg overflow-hidden bg-gradient-to-br from-rose-50 via-pink-50 to-fuchsia-50 dark:from-rose-950/30 dark:via-pink-950/30 dark:to-fuchsia-950/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-rose-500" />
              How It Works
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Example Interaction */}
            <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-sm p-4 rounded-xl border border-rose-100 dark:border-rose-900/30">
              <p className="text-sm font-semibold mb-4 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-rose-500" />
                Example Interaction
              </p>
              <div className="space-y-4">
                {/* User Message */}
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                  className="flex items-start gap-3"
                >
                  <div className="w-10 h-10 rounded-xl bg-gray-300 dark:bg-gray-700 flex items-center justify-center text-white text-sm font-bold shadow-lg">
                    U
                  </div>
                  <div className="flex-1 p-3 rounded-xl rounded-tl-none bg-gray-100 dark:bg-gray-800 shadow-sm">
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">User123</p>
                    <p className="text-sm mt-1">{keywords[0] || 'ใครบ้าง'}</p>
                  </div>
                </motion.div>

                {/* Bot Response */}
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 }}
                  className="flex items-start gap-3"
                >
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-rose-500/30">
                    B
                  </div>
                  <div className="flex-1 p-3 rounded-xl rounded-tl-none bg-gradient-to-r from-rose-100 to-pink-100 dark:from-rose-900/30 dark:to-pink-900/30 shadow-sm">
                    <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">Bot</p>
                    <p className="text-sm mt-1 whitespace-pre-line">
                      คนในห้องตอนนี้ (5 คน):{'\n'}
                      1. User1{'\n'}
                      2. User2{'\n'}
                      3. User3{'\n'}
                      ...
                    </p>
                  </div>
                </motion.div>
              </div>
            </div>

            {/* Rules */}
            <Alert className="border-rose-200 dark:border-rose-800 bg-white/60 dark:bg-gray-900/60">
              <AlertDescription>
                <ul className="text-sm space-y-2">
                  {[
                    { icon: '👁️', text: 'Bot monitors all chat messages in real-time' },
                    { icon: '⚡', text: 'When a message contains any keyword → Auto-respond with user list' },
                    { icon: '🔤', text: 'Keywords are case-insensitive (who = WHO = Who)' },
                    { icon: '🤖', text: "Bot ignores its own messages to prevent loops" },
                  ].map((rule, index) => (
                    <motion.li
                      key={index}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.5 + index * 0.1 }}
                      className="flex items-start gap-2"
                    >
                      <span className="text-base">{rule.icon}</span>
                      <span>{rule.text}</span>
                    </motion.li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
