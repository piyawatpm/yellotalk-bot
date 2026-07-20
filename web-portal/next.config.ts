import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    '*.trycloudflare.com',
    '*.ts.net',
    'localhost',
    '0.0.0.0',
  ],
  // Allow cross-origin requests from tunnel domains
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
    ]
  },
}

export default nextConfig
