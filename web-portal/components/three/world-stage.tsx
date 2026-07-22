'use client'

import * as THREE from 'three'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Interactive fleet world. Rooms are houses (labelled with topic + owner);
 * bots are the CC0 "RobotExpressive" robots (labelled with their name). Select a
 * free bot then click a house and it walks over to join. A bot playing music
 * sings into a mic while dancing.
 */

export type WorldBot = {
  id: string
  name: string
  status: 'running' | 'waiting' | 'stopped' | string
  playing?: boolean
  roomTopic?: string | null
}
export type WorldRoom = { id: string; topic: string; owner: string }

/* ---------- colors ---------- */
function tokenColor(name: string, fallback: string): THREE.Color {
  if (typeof window === 'undefined') return new THREE.Color(fallback)
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim()
  if (!v) return new THREE.Color(fallback)
  const [r, g, b] = v.split(/\s+/).map(Number)
  return new THREE.Color(r / 255, g / 255, b / 255)
}
type Palette = {
  accent: THREE.Color
  music: THREE.Color
  side: THREE.Color
  idle: THREE.Color
  ok: THREE.Color
  warn: THREE.Color
  ground: THREE.Color
  grass: THREE.Color
  house: THREE.Color
  dark: boolean
}
function computePalette(): Palette {
  const dark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
  return {
    accent: tokenColor('brand', '#ffc61a'), // sunny yellow
    music: tokenColor('glow', '#ff5c8a'), // pink
    side: tokenColor('side', '#2e9be0'), // blue
    idle: tokenColor('faint', '#a69c82'),
    ok: tokenColor('ok', '#3bb96b'), // green
    warn: tokenColor('warn', '#f08218'), // orange
    ground: new THREE.Color(dark ? '#221d13' : '#f1e8d2'),
    grass: new THREE.Color(dark ? '#17150e' : '#d9e6c6'),
    house: new THREE.Color(dark ? '#2a2417' : '#fffdf6'),
    dark,
  }
}
function usePalette(): Palette {
  const [pal, setPal] = useState<Palette>(computePalette)
  useEffect(() => {
    setPal(computePalette())
    const obs = new MutationObserver(() => setPal(computePalette()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return pal
}

/* ---------- model ---------- */
type Asset = { scene: THREE.Group; animations: THREE.AnimationClip[] }
let _assetPromise: Promise<Asset> | null = null
function loadRobot(): Promise<Asset> {
  if (!_assetPromise) {
    _assetPromise = new Promise((resolve, reject) => {
      new GLTFLoader().load(
        '/models/RobotExpressive.glb',
        (g) => resolve({ scene: g.scene as THREE.Group, animations: g.animations }),
        undefined,
        reject
      )
    })
  }
  return _assetPromise
}
function useAsset(): Asset | null {
  const [asset, setAsset] = useState<Asset | null>(null)
  useEffect(() => {
    let alive = true
    loadRobot().then((a) => alive && setAsset(a)).catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return asset
}

/* ---------- labels ---------- */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
function makeLabel(main: string, sub: string | null, dark: boolean): { tex: THREE.CanvasTexture; ratio: number } {
  const dpr = 2
  const pad = 18
  const mainFs = 34
  const subFs = 25
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  ctx.font = `600 ${mainFs}px Inter, system-ui, sans-serif`
  const mainW = ctx.measureText(main).width
  let subW = 0
  if (sub) {
    ctx.font = `500 ${subFs}px Inter, system-ui, sans-serif`
    subW = ctx.measureText(sub).width
  }
  const w = Math.ceil(Math.max(mainW, subW) + pad * 2)
  const h = Math.ceil((sub ? mainFs + subFs + 10 : mainFs) + pad * 2)
  canvas.width = w * dpr
  canvas.height = h * dpr
  ctx.scale(dpr, dpr)
  ctx.fillStyle = dark ? 'rgba(28,30,42,0.94)' : 'rgba(255,255,255,0.94)'
  roundRectPath(ctx, 0, 0, w, h, 12)
  ctx.fill()
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.10)' : 'rgba(20,22,40,0.08)'
  ctx.lineWidth = 1.5
  roundRectPath(ctx, 0.75, 0.75, w - 1.5, h - 1.5, 12)
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = dark ? '#f3f4f8' : '#16161d'
  ctx.font = `600 ${mainFs}px Inter, system-ui, sans-serif`
  ctx.fillText(main, w / 2, pad)
  if (sub) {
    ctx.fillStyle = dark ? '#a3a9bd' : '#6b7186'
    ctx.font = `500 ${subFs}px Inter, system-ui, sans-serif`
    ctx.fillText(sub, w / 2, pad + mainFs + 8)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  tex.anisotropy = 4
  return { tex, ratio: w / h }
}
function Label({ main, sub, dark, y, height = 0.34 }: { main: string; sub?: string | null; dark: boolean; y: number; height?: number }) {
  const { tex, ratio } = useMemo(() => makeLabel(main, sub ?? null, dark), [main, sub, dark])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <sprite position={[0, y, 0]} scale={[height * ratio, height, 1]}>
      <spriteMaterial map={tex} transparent depthWrite={false} depthTest={false} toneMapped={false} />
    </sprite>
  )
}

/* ---------- layout ---------- */
const truncate = (s: string, n = 16) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const HOUSE_Z = -3.2
const DOCK_Z = 2.1
function housePos(i: number, n: number): [number, number] {
  const spacing = n > 4 ? 2.4 : 2.8
  return [(i - (n - 1) / 2) * spacing, HOUSE_Z]
}
function dockPos(i: number, n: number): [number, number] {
  const spacing = n > 4 ? 1.4 : 1.7
  return [(i - (n - 1) / 2) * spacing, DOCK_Z]
}

/* ---------- house ---------- */
function House({
  room,
  x,
  z,
  index,
  pal,
  hasBot,
  onPick,
}: {
  room: WorldRoom
  x: number
  z: number
  index: number
  pal: Palette
  hasBot: boolean
  onPick: () => void
}) {
  const [hover, setHover] = useState(false)
  useEffect(() => {
    document.body.style.cursor = hover ? 'pointer' : ''
    return () => {
      document.body.style.cursor = ''
    }
  }, [hover])
  const roofColor = [pal.accent, pal.music, pal.side, pal.warn, pal.ok][index % 5]
  const roof = hover ? roofColor.clone().lerp(new THREE.Color('#ffffff'), 0.15) : roofColor
  const window = pal.dark ? '#8fd0ff' : '#cfebff'
  return (
    <group position={[x, 0, z]}>
      {/* porch base */}
      <mesh position={[0, 0.04, 0]} receiveShadow castShadow>
        <boxGeometry args={[1.34, 0.09, 1.24]} />
        <meshStandardMaterial color={pal.dark ? '#2a2d3b' : '#e7e9f2'} roughness={0.9} />
      </mesh>
      {/* body */}
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.15, 0.82, 1.02]} />
        <meshStandardMaterial color={pal.house} roughness={0.65} metalness={0.04} />
      </mesh>
      {/* roof */}
      <mesh position={[0, 1.14, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[0.98, 0.56, 4]} />
        <meshStandardMaterial color={roof} roughness={0.5} metalness={0.12} />
      </mesh>
      {/* chimney */}
      <mesh position={[0.32, 1.16, -0.18]} castShadow>
        <boxGeometry args={[0.16, 0.34, 0.16]} />
        <meshStandardMaterial color={roofColor.clone().multiplyScalar(0.8)} roughness={0.7} />
      </mesh>
      {/* door */}
      <mesh position={[0, 0.34, 0.52]}>
        <boxGeometry args={[0.3, 0.5, 0.05]} />
        <meshStandardMaterial color={roofColor.clone().multiplyScalar(0.75)} roughness={0.6} />
      </mesh>
      {/* windows */}
      {[-0.34, 0.34].map((wx) => (
        <mesh key={wx} position={[wx, 0.56, 0.52]}>
          <boxGeometry args={[0.22, 0.22, 0.04]} />
          <meshStandardMaterial color={window} emissive={window} emissiveIntensity={hasBot ? 0.6 : 0.25} roughness={0.3} />
        </mesh>
      ))}
      {/* clickable hitbox */}
      <mesh
        position={[0, 0.7, 0]}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (e.delta > 6) return
          e.stopPropagation()
          onPick()
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHover(true)
        }}
        onPointerOut={() => setHover(false)}
      >
        <boxGeometry args={[1.4, 1.7, 1.4]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Label main={truncate(room.topic)} sub={room.owner ? `♦ ${truncate(room.owner, 14)}` : null} dark={pal.dark} y={1.95} height={0.38} />
    </group>
  )
}

/* ---------- tree prop ---------- */
function Tree({ x, z, s = 1, pal }: { x: number; z: number; s?: number; pal: Palette }) {
  const trunk = pal.dark ? '#5b4632' : '#7a5a3c'
  const leafA = pal.dark ? '#3f6b4c' : '#69ad74'
  const leafB = pal.dark ? '#4b7d59' : '#7cbd85'
  return (
    <group position={[x, 0, z]} scale={s}>
      <mesh position={[0, 0.32, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.09, 0.64, 8]} />
        <meshStandardMaterial color={trunk} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.86, 0]} castShadow>
        <coneGeometry args={[0.44, 0.86, 10]} />
        <meshStandardMaterial color={leafA} roughness={0.85} />
      </mesh>
      <mesh position={[0, 1.24, 0]} castShadow>
        <coneGeometry args={[0.32, 0.66, 10]} />
        <meshStandardMaterial color={leafB} roughness={0.85} />
      </mesh>
    </group>
  )
}

/* ---------- bot ---------- */
function animFor(bot: WorldBot): string {
  if (bot.playing && bot.status === 'running') return 'Dance'
  return 'Standing' // upright neutral idle ("Idle" hunches, "Sitting" loops the sit-down)
}

const _v = new THREE.Vector3()
const _tp = new THREE.Vector3()

function Bot({
  bot,
  target,
  atHouse,
  selected,
  emote,
  asset,
  pal,
  reduced,
  onSelect,
}: {
  bot: WorldBot
  target: [number, number]
  atHouse: boolean
  selected: boolean
  emote?: string
  asset: Asset
  pal: Palette
  reduced: boolean
  onSelect: () => void
}) {
  const group = useRef<THREE.Group>(null)
  const micRef = useRef<THREE.Group>(null)
  const headRef = useRef<THREE.Object3D | null>(null)
  const cur = useRef(new THREE.Vector3(target[0], 0, target[1]))
  const inited = useRef(false)
  const facing = useRef(0)
  const clipName = useRef<string>('')
  const [hover, setHover] = useState(false)

  const { scene, mixer, actions } = useMemo(() => {
    const scene = SkeletonUtils.clone(asset.scene) as THREE.Group
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.frustumCulled = false
      }
    })
    const mixer = new THREE.AnimationMixer(scene)
    const actions: Record<string, THREE.AnimationAction> = {}
    asset.animations.forEach((c) => (actions[c.name] = mixer.clipAction(c)))
    return { scene, mixer, actions }
  }, [asset])

  useEffect(() => {
    headRef.current = scene.getObjectByName('Head') || null
  }, [scene])
  useEffect(
    () => () => {
      mixer.stopAllAction()
    },
    [mixer]
  )

  useEffect(() => {
    document.body.style.cursor = hover ? 'pointer' : ''
    return () => {
      document.body.style.cursor = ''
    }
  }, [hover])

  const play = (name: string) => {
    if (clipName.current === name) return
    const next = actions[name] || actions['Idle']
    if (!next) return
    const prev = clipName.current ? actions[clipName.current] : null
    const speed = name === 'Walking' ? 0.9 : name === 'Dance' ? 0.72 : 0.85
    if (prev && prev !== next) prev.fadeOut(0.3)
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(speed).fadeIn(0.3).play()
    clipName.current = name
  }

  useFrame((_, dt) => {
    if (!reduced) mixer.update(dt)
    const g = group.current
    if (!g) return

    _tp.set(target[0], 0, target[1])
    if (!inited.current) {
      cur.current.copy(_tp)
      inited.current = true
    }
    const dist = cur.current.distanceTo(_tp)
    const moving = dist > 0.08
    if (moving) {
      _v.copy(_tp).sub(cur.current)
      const step = Math.min(dist, (reduced ? dist : 1.7 * dt))
      _v.normalize().multiplyScalar(step)
      cur.current.add(_v)
      facing.current = Math.atan2(_v.x, _v.z)
      play('Walking')
    } else {
      play(emote || animFor(bot))
      // face the camera (front) when settled
      facing.current += ((atHouse ? 0 : 0) - facing.current) * Math.min(1, dt * 6)
    }
    g.position.copy(cur.current)
    g.rotation.y += (facing.current - g.rotation.y) * Math.min(1, dt * 8)

    // mic at mouth while singing
    const mic = micRef.current
    if (mic && headRef.current && bot.playing && bot.status === 'running') {
      headRef.current.getWorldPosition(_v)
      _v.z += 0.13
      _v.y -= 0.02
      g.worldToLocal(_v)
      mic.position.copy(_v)
    }
  })

  const singing = bot.playing && bot.status === 'running' && !emote
  const ringColor = singing ? pal.music : bot.status === 'running' ? pal.ok : bot.status === 'waiting' ? pal.warn : pal.idle

  return (
    <group ref={group}>
      <primitive object={scene} scale={0.3} />

      {/* status / selection ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <torusGeometry args={[0.42, selected ? 0.035 : 0.022, 10, 60]} />
        <meshBasicMaterial color={selected ? pal.accent : ringColor} toneMapped={false} transparent opacity={selected ? 1 : 0.85} />
      </mesh>

      {/* name over the head */}
      <Label main={truncate(bot.name, 14)} dark={pal.dark} y={0.95} height={0.28} />

      {singing && (
        <group ref={micRef} rotation={[-0.28, 0, 0]}>
          <mesh position={[0, -0.09, 0]} castShadow>
            <cylinderGeometry args={[0.02, 0.024, 0.2, 14]} />
            <meshStandardMaterial color="#17171d" roughness={0.45} metalness={0.4} />
          </mesh>
          <mesh position={[0, 0.05, 0]} castShadow>
            <sphereGeometry args={[0.075, 20, 20]} />
            <meshStandardMaterial color="#2a2a34" roughness={0.25} metalness={0.6} emissive={pal.music} emissiveIntensity={0.55} />
          </mesh>
        </group>
      )}

      {/* click hitbox */}
      <mesh
        position={[0, 0.45, 0]}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (e.delta > 6) return
          e.stopPropagation()
          onSelect()
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHover(true)
        }}
        onPointerOut={() => setHover(false)}
      >
        <boxGeometry args={[0.7, 0.95, 0.7]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

/* ---------- camera controls ---------- */
function Controls() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const ref = useRef<OrbitControls | null>(null)
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.enableDamping = true
    c.dampingFactor = 0.08
    c.enablePan = true
    c.minDistance = 4.5
    c.maxDistance = 22
    c.minPolarAngle = Math.PI / 7
    c.maxPolarAngle = Math.PI / 2.12 // stay above the ground
    c.target.set(0, 0.5, -0.3)
    c.autoRotate = true
    c.autoRotateSpeed = 0.45
    const stopAuto = () => {
      c.autoRotate = false
    }
    c.addEventListener('start', stopAuto)
    c.addEventListener('change', () => invalidate())
    c.update()
    ref.current = c
    return () => {
      c.removeEventListener('start', stopAuto)
      c.dispose()
    }
  }, [camera, gl, invalidate])
  useFrame(() => ref.current?.update())
  return null
}

/* ---------- soft studio environment (nicer PBR materials) ---------- */
function Env() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const rt = pmrem.fromScene(new RoomEnvironment(), 0.04)
    scene.environment = rt.texture
    ;(scene as any).environmentIntensity = 0.4
    invalidate()
    return () => {
      scene.environment = null
      rt.dispose()
      pmrem.dispose()
    }
  }, [gl, scene, invalidate])
  return null
}

export type ManualState = Record<string, { target?: [number, number]; emote?: string }>

function Scene({
  bots,
  rooms,
  selectedBotId,
  manual,
  onSelectBot,
  onAssignRoom,
  onMoveBot,
}: {
  bots: WorldBot[]
  rooms: WorldRoom[]
  selectedBotId: string | null
  manual: ManualState
  onSelectBot: (id: string | null) => void
  onAssignRoom: (botId: string, roomId: string) => void
  onMoveBot: (botId: string, x: number, z: number) => void
}) {
  const pal = usePalette()
  const asset = useAsset()
  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  )

  const houses = rooms.slice(0, 5)
  const houseByTopic = new Map(houses.map((r, i) => [r.topic, { room: r, pos: housePos(i, houses.length) }]))

  // targets: manual walk point wins; else the bot's house; else the dock
  const freeBots = bots.filter(
    (b) => !manual[b.id]?.target && !(b.roomTopic && houseByTopic.has(b.roomTopic))
  )
  const dockIndex = new Map(freeBots.map((b, i) => [b.id, i]))
  const perHouse = new Map<string, number>()

  const targetFor = (b: WorldBot): { target: [number, number]; atHouse: boolean } => {
    const man = manual[b.id]
    if (man?.target) return { target: man.target, atHouse: false }
    if (b.roomTopic && houseByTopic.has(b.roomTopic)) {
      const h = houseByTopic.get(b.roomTopic)!
      const k = perHouse.get(b.roomTopic) ?? 0
      perHouse.set(b.roomTopic, k + 1)
      return { target: [h.pos[0] + (k - 0) * 0.7, h.pos[1] + 1.25], atHouse: true }
    }
    const di = dockIndex.get(b.id) ?? 0
    return { target: dockPos(di, freeBots.length), atHouse: false }
  }

  const groundClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return
    if (selectedBotId) onMoveBot(selectedBotId, e.point.x, e.point.z)
    else onSelectBot(null)
  }

  return (
    <>
      <Env />
      <ambientLight intensity={0.55} />
      <hemisphereLight intensity={0.45} color={'#ffffff'} groundColor={pal.grass.getStyle()} />
      <directionalLight
        position={[6, 11, 7]}
        intensity={1.35}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0002}
        shadow-camera-far={44}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      <directionalLight position={[-7, 5, -5]} intensity={0.28} />

      {/* grass surround — click to walk the selected bot there */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]} receiveShadow onClick={groundClick}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color={pal.grass} roughness={1} metalness={0} />
      </mesh>
      {/* paved town square */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow onClick={groundClick}>
        <circleGeometry args={[7.8, 56]} />
        <meshStandardMaterial color={pal.ground} roughness={0.9} metalness={0} />
      </mesh>

      {/* trees */}
      {([
        [-6.4, -1.4, 1],
        [6.4, -1.4, 1.1],
        [-7.0, 2.4, 0.9],
        [7.0, 2.4, 1],
        [-3.4, -5.2, 1.05],
        [3.4, -5.2, 0.95],
      ] as [number, number, number][]).map(([tx, tz, ts], i) => (
        <Tree key={i} x={tx} z={tz} s={ts} pal={pal} />
      ))}

      {asset &&
        houses.map((r, i) => {
          const [x, z] = housePos(i, houses.length)
          return (
            <House
              key={r.id}
              room={r}
              x={x}
              z={z}
              index={i}
              pal={pal}
              hasBot={bots.some((b) => b.roomTopic === r.topic)}
              onPick={() => {
                if (selectedBotId) onAssignRoom(selectedBotId, r.id)
              }}
            />
          )
        })}

      {asset &&
        bots.map((b) => {
          const { target, atHouse } = targetFor(b)
          return (
            <Bot
              key={b.id}
              bot={b}
              target={target}
              atHouse={atHouse}
              selected={selectedBotId === b.id}
              emote={manual[b.id]?.emote}
              asset={asset}
              pal={pal}
              reduced={reduced}
              onSelect={() => onSelectBot(selectedBotId === b.id ? null : b.id)}
            />
          )
        })}

      <Controls />
    </>
  )
}

export default function WorldStage(props: {
  bots: WorldBot[]
  rooms: WorldRoom[]
  selectedBotId: string | null
  manual: ManualState
  onSelectBot: (id: string | null) => void
  onAssignRoom: (botId: string, roomId: string) => void
  onMoveBot: (botId: string, x: number, z: number) => void
}) {
  const reduced =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      frameloop={reduced ? 'demand' : 'always'}
      gl={{ antialias: true, alpha: true }}
      camera={{ fov: 36, position: [1.5, 5.0, 9.2] }}
      style={{ width: '100%', height: '100%' }}
    >
      <Scene {...props} />
    </Canvas>
  )
}
