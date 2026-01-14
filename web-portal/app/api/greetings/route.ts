import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const DATA_FILE = path.join(process.cwd(), '..', 'greetings.json')

export async function GET() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8')
    return NextResponse.json(JSON.parse(data))
  } catch (error) {
    // Return default if file doesn't exist
    const defaultData = {
      customGreetings: {
        "botyoi": "สวัสดีพี่ชาย",
        "rose": "สวัสดีคนสวย",
        "baby": "สวัสดีคนสวย"
      },
      defaultGreeting: "สวัสดีสุดหล่อ",
      keywords: {
        listUsers: ["ใครบ้าง", "มีใครบ้าง", "list", "users", "who"]
      }
    }
    return NextResponse.json(defaultData)
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json()
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8')

    // Also update bot.js with new greetings
    await updateBotCode(data)

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}

async function updateBotCode(data: any) {
  // Read bot.js
  const botPath = path.join(process.cwd(), '..', 'bot.js')
  let botCode = await fs.readFile(botPath, 'utf-8')

  // Generate custom greeting code
  const customNames = Object.keys(data.customGreetings)
  const greetingConditions = customNames.map((name, i) => {
    const greeting = data.customGreetings[name]
    const isFirst = i === 0
    const prefix = isFirst ? 'if' : 'else if'

    return `                    ${prefix} (userName.includes('${name}')) {
                        greeting = \`${greeting} \${userName}\`;
                    }`
  }).join('\n')

  // Find and replace the greeting logic in bot.js
  const greetingRegex = /\/\/ Custom greetings[\s\S]*?greeting = `สวัสดีสุดหล่อ \${userName}`;/

  const newGreetingLogic = `// Custom greetings
                    let greeting;

                    ${greetingConditions}
                    // Everyone else
                    else {
                        greeting = \`${data.defaultGreeting} \${userName}\`;
                    }`

  if (greetingRegex.test(botCode)) {
    botCode = botCode.replace(greetingRegex, newGreetingLogic)
    await fs.writeFile(botPath, botCode, 'utf-8')
  }
}
