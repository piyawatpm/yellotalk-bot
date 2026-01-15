'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Activity,
  Radio,
  MessageSquare,
  Users,
  ArrowRight,
  PlayCircle,
  Sparkles,
  Heart,
  Zap,
  Settings
} from 'lucide-react'
import Link from 'next/link'
import io from 'socket.io-client'

export default function DashboardPage() {
  const [botState, setBotState] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const socket = io('http://localhost:5353')

    socket.on('connect', () => {
      setLoading(false)
    })

    socket.on('bot-state', (state) => {
      setBotState(state)
    })

    socket.on('connect_error', () => {
      setLoading(false)
    })

    return () => { socket.disconnect() }
  }, [])

  const metrics = [
    {
      title: 'Bot Status',
      value: botState?.status || 'offline',
      icon: Activity,
      isRunning: botState?.status === 'running'
    },
    {
      title: 'Messages',
      value: botState?.messageCount || 0,
      icon: MessageSquare,
    },
    {
      title: 'Participants',
      value: botState?.participants?.length || 0,
      icon: Users,
    },
    {
      title: 'Current Room',
      value: botState?.currentRoom?.topic || 'None',
      icon: Radio,
      isText: true
    }
  ]

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center space-y-6 py-8 lg:py-12"
      >
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 text-sm font-medium">
          <Sparkles className="w-4 h-4" />
          Welcome to YelloTalk Bot Portal
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight">
          <span className="bg-gradient-to-r from-rose-500 via-pink-500 to-rose-600 bg-clip-text text-transparent">
            YelloTalk
          </span>
          <br />
          <span className="text-foreground">Bot Portal</span>
        </h1>

        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          Monitor, control, and customize your bot in real-time with our beautiful and intuitive dashboard
        </p>

        <div className="flex flex-wrap justify-center gap-4">
          <Link href="/control">
            <Button size="lg" className="bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white shadow-lg shadow-rose-500/25 transition-all duration-300 hover:shadow-rose-500/40">
              <PlayCircle className="mr-2 h-5 w-5" />
              Start Bot
            </Button>
          </Link>
          <Link href="/greetings">
            <Button size="lg" variant="outline" className="border-rose-200 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950/30 transition-colors duration-300">
              <Settings className="mr-2 h-5 w-5" />
              Configure
            </Button>
          </Link>
        </div>
      </motion.div>

      {/* Metrics Grid */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6"
      >
        {metrics.map((metric, index) => {
          const Icon = metric.icon
          return (
            <motion.div
              key={metric.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 + index * 0.05 }}
            >
              <Card className="overflow-hidden border-0 shadow-lg bg-white dark:bg-gray-900 hover:shadow-xl hover:shadow-rose-500/10 transition-shadow duration-300">
                <CardContent className="p-4 lg:p-6">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <p className="text-xs lg:text-sm font-medium text-muted-foreground">{metric.title}</p>
                      <p className={`text-2xl lg:text-3xl font-bold text-rose-600 dark:text-rose-400 ${metric.isText ? 'text-sm lg:text-base truncate max-w-[100px] lg:max-w-[150px]' : ''}`}>
                        {metric.isRunning !== undefined ? (
                          <span className={metric.isRunning ? 'text-emerald-500' : 'text-gray-400'}>
                            {metric.value}
                          </span>
                        ) : metric.value}
                      </p>
                    </div>
                    <div className={`p-2 lg:p-3 rounded-xl ${metric.isRunning ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-rose-100 dark:bg-rose-900/30'}`}>
                      <Icon className={`h-4 w-4 lg:h-5 lg:w-5 ${metric.isRunning ? 'text-emerald-500' : 'text-rose-500'}`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )
        })}
      </motion.div>

      {/* Quick Actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
      >
        <Link href="/control" className="block">
          <Card className="h-full overflow-hidden border-0 shadow-lg bg-white dark:bg-gray-900 hover:shadow-xl hover:shadow-rose-500/10 transition-all duration-300 cursor-pointer group">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-gradient-to-br from-rose-500 to-pink-500 shadow-lg shadow-rose-500/25">
                  <PlayCircle className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-lg lg:text-xl">Bot Control Center</CardTitle>
                  <CardDescription>Start, stop, and monitor your bot in real-time</CardDescription>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-rose-500 group-hover:translate-x-1 transition-all duration-300" />
              </div>
            </CardHeader>
            <CardContent>
              <Button className="w-full bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white shadow-lg shadow-rose-500/20 transition-all duration-300">
                Open Control Panel
              </Button>
            </CardContent>
          </Card>
        </Link>

        <Card className="overflow-hidden border-0 shadow-lg bg-white dark:bg-gray-900 hover:shadow-xl hover:shadow-rose-500/10 transition-all duration-300">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-gradient-to-br from-rose-400 to-pink-400 shadow-lg shadow-rose-500/25">
                <MessageSquare className="h-6 w-6 text-white" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg lg:text-xl">Bot Settings</CardTitle>
                <CardDescription>Customize greetings and keyword triggers</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <Link href="/greetings" className="flex-1">
                <Button variant="outline" className="w-full border-rose-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-300 dark:border-rose-800 dark:hover:bg-rose-950/30 transition-all duration-300">
                  <Heart className="mr-2 h-4 w-4" />
                  Greetings
                </Button>
              </Link>
              <Link href="/keywords" className="flex-1">
                <Button variant="outline" className="w-full border-rose-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-300 dark:border-rose-800 dark:hover:bg-rose-950/30 transition-all duration-300">
                  <Zap className="mr-2 h-4 w-4" />
                  Keywords
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Recent Activity */}
      {botState?.messages && botState.messages.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <Card className="border-0 shadow-lg bg-white dark:bg-gray-900">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-rose-500" />
                    Recent Activity
                  </CardTitle>
                  <CardDescription>Latest messages from the bot</CardDescription>
                </div>
                <Badge className="bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
                  {botState.messages.length} messages
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {botState.messages.slice(-5).reverse().map((msg: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 rounded-xl bg-rose-50/50 dark:bg-rose-950/20 hover:bg-rose-100/50 dark:hover:bg-rose-950/30 transition-colors duration-200"
                  >
                    <div className="w-10 h-10 bg-gradient-to-br from-rose-500 to-pink-500 rounded-xl flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-lg shadow-rose-500/25">
                      {msg.sender?.charAt(0) || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{msg.sender}</span>
                        <span className="text-xs text-muted-foreground">{msg.time}</span>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{msg.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Getting Started Guide */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
      >
        <Card className="border-0 shadow-lg overflow-hidden bg-gradient-to-br from-rose-50 via-pink-50 to-rose-50 dark:from-rose-950/30 dark:via-pink-950/30 dark:to-rose-950/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-rose-500" />
              Getting Started
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { step: '1', title: 'Start Server', desc: 'Run node bot-server.js' },
                { step: '2', title: 'Select Room', desc: 'Go to Bot Control and pick a room' },
                { step: '3', title: 'Start Bot', desc: 'Click Start Bot to begin' },
                { step: '4', title: 'Customize', desc: 'Configure greetings and keywords' },
              ].map((item, index) => (
                <div
                  key={item.step}
                  className="relative p-4 rounded-xl bg-white/60 dark:bg-gray-900/60 backdrop-blur-sm hover:bg-white/80 dark:hover:bg-gray-900/80 transition-colors duration-200"
                >
                  <div className="absolute -top-2 -left-2 w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-rose-500/25">
                    {item.step}
                  </div>
                  <div className="pt-4">
                    <h4 className="font-semibold text-sm">{item.title}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
