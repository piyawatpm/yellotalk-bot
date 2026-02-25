import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
  try {
    const urlFile = path.join(process.cwd(), '..', '.api-tunnel-url')
    if (fs.existsSync(urlFile)) {
      const url = fs.readFileSync(urlFile, 'utf-8').trim()
      return NextResponse.json({ url })
    }
    return NextResponse.json({ url: null })
  } catch {
    return NextResponse.json({ url: null })
  }
}
