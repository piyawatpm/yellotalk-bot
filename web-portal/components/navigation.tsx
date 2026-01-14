'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Home,
  Settings2,
  MessageCircle,
  Zap,
  Menu,
  X,
  Bot,
  Sparkles
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/', label: 'Dashboard', icon: Home },
  { href: '/control', label: 'Control', icon: Settings2 },
  { href: '/greetings', label: 'Greetings', icon: MessageCircle },
  { href: '/keywords', label: 'Keywords', icon: Zap },
]

export function Navigation() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    setIsOpen(false)
  }, [pathname])

  return (
    <>
      <motion.nav
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className={cn(
          'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
          scrolled
            ? 'bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg shadow-rose-500/5'
            : 'bg-transparent'
        )}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 lg:h-20 items-center">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-3 group">
              <motion.div
                whileHover={{ scale: 1.05, rotate: 5 }}
                whileTap={{ scale: 0.95 }}
                className="relative"
              >
                <div className="w-10 h-10 lg:w-12 lg:h-12 rounded-xl bg-gradient-to-br from-rose-500 via-pink-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-rose-500/30">
                  <Bot className="w-5 h-5 lg:w-6 lg:h-6 text-white" />
                </div>
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute -top-1 -right-1"
                >
                  <Sparkles className="w-4 h-4 text-rose-500" />
                </motion.div>
              </motion.div>
              <div className="hidden sm:block">
                <h1 className="text-lg lg:text-xl font-bold gradient-text">YelloTalk</h1>
                <p className="text-xs text-muted-foreground -mt-1">Bot Portal</p>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-1">
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href

                return (
                  <Link key={item.href} href={item.href}>
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className={cn(
                        'relative px-4 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 flex items-center gap-2',
                        isActive
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-gray-600 dark:text-gray-400 hover:text-rose-600 dark:hover:text-rose-400'
                      )}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="nav-indicator"
                          className="absolute inset-0 bg-rose-100 dark:bg-rose-900/30 rounded-xl"
                          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        />
                      )}
                      <Icon className="w-4 h-4 relative z-10" />
                      <span className="relative z-10">{item.label}</span>
                    </motion.div>
                  </Link>
                )
              })}
            </div>

            {/* Mobile Menu Button */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsOpen(!isOpen)}
              className="md:hidden relative w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center text-rose-600 dark:text-rose-400"
            >
              <AnimatePresence mode="wait">
                {isOpen ? (
                  <motion.div
                    key="close"
                    initial={{ rotate: -90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: 90, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <X className="w-5 h-5" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="menu"
                    initial={{ rotate: 90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: -90, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Menu className="w-5 h-5" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>
          </div>
        </div>
      </motion.nav>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden"
            />
            <motion.div
              initial={{ opacity: 0, x: '100%' }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed top-0 right-0 bottom-0 w-72 bg-white dark:bg-gray-900 shadow-2xl z-50 md:hidden"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 via-pink-500 to-fuchsia-500 flex items-center justify-center">
                      <Bot className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h2 className="font-bold gradient-text">YelloTalk</h2>
                      <p className="text-xs text-muted-foreground">Bot Portal</p>
                    </div>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setIsOpen(false)}
                    className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center text-rose-600"
                  >
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>

                <div className="space-y-2">
                  {navItems.map((item, index) => {
                    const Icon = item.icon
                    const isActive = pathname === item.href

                    return (
                      <motion.div
                        key={item.href}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.1 }}
                      >
                        <Link href={item.href}>
                          <motion.div
                            whileHover={{ x: 4 }}
                            whileTap={{ scale: 0.98 }}
                            className={cn(
                              'flex items-center gap-3 px-4 py-3.5 rounded-xl font-medium transition-all',
                              isActive
                                ? 'bg-gradient-to-r from-rose-500 to-pink-500 text-white shadow-lg shadow-rose-500/30'
                                : 'text-gray-600 dark:text-gray-400 hover:bg-rose-50 dark:hover:bg-rose-900/20'
                            )}
                          >
                            <Icon className="w-5 h-5" />
                            <span>{item.label}</span>
                            {isActive && (
                              <motion.div
                                layoutId="mobile-indicator"
                                className="ml-auto w-2 h-2 rounded-full bg-white"
                              />
                            )}
                          </motion.div>
                        </Link>
                      </motion.div>
                    )
                  })}
                </div>

                <div className="absolute bottom-6 left-6 right-6">
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-rose-50 to-pink-50 dark:from-rose-950/50 dark:to-pink-950/50">
                    <p className="text-xs text-muted-foreground text-center">
                      Made with <span className="text-rose-500">♥</span> for YelloTalk
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Spacer for fixed nav */}
      <div className="h-16 lg:h-20" />
    </>
  )
}
