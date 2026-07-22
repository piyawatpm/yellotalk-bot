import type { Metadata } from 'next'
import { Mitr, IBM_Plex_Sans_Thai, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { Sidebar } from '@/components/sidebar'

// Playful rounded display + Thai-capable body, matching the YelloTalk brand.
const display = Mitr({
  weight: ['500', '600', '700'],
  subsets: ['latin', 'thai'],
  variable: '--font-display',
})

const sans = IBM_Plex_Sans_Thai({
  weight: ['400', '500', '600'],
  subsets: ['latin', 'thai'],
  variable: '--font-sans',
})

const mono = JetBrains_Mono({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'YelloTalk · Signal Ops',
  description: 'Live operations console for YelloTalk room bots — fleet, control, and configuration.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        {/* apply saved theme before first paint (light-first) */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('yt-theme');document.documentElement.dataset.theme=(t==='dark')?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}",
          }}
        />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <div className="pointer-events-none fixed inset-0 -z-10 aurora" />
        <Sidebar />
        <div className="lg:pl-60">
          <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main>
        </div>
        <Toaster />
      </body>
    </html>
  )
}
