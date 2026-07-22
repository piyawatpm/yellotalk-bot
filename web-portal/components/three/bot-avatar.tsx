'use client'

import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
import { useEffect, useMemo, useRef, useState } from 'react'

/** A single "RobotExpressive" (CC0) avatar for the selected bot on Control. */

type Asset = { scene: THREE.Group; animations: THREE.AnimationClip[] }
let _p: Promise<Asset> | null = null
function loadRobot(): Promise<Asset> {
  if (!_p) {
    _p = new Promise((res, rej) => {
      new GLTFLoader().load(
        '/models/RobotExpressive.glb',
        (g) => res({ scene: g.scene as THREE.Group, animations: g.animations }),
        undefined,
        rej
      )
    })
  }
  return _p
}

function musicColor(): THREE.Color {
  if (typeof window === 'undefined') return new THREE.Color('#8b5cf6')
  const v = getComputedStyle(document.documentElement).getPropertyValue('--color-glow').trim()
  if (!v) return new THREE.Color('#8b5cf6')
  const [r, g, b] = v.split(/\s+/).map(Number)
  return new THREE.Color(r / 255, g / 255, b / 255)
}

function animFor(status: string, playing: boolean) {
  if (playing && status === 'running') return 'Dance'
  return 'Standing'
}

function Bot({ status, playing }: { status: string; playing: boolean }) {
  const [asset, setAsset] = useState<Asset | null>(null)
  useEffect(() => {
    let alive = true
    loadRobot().then((a) => alive && setAsset(a)).catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  )
  const glow = useMemo(() => musicColor(), [])

  const built = useMemo(() => {
    if (!asset) return null
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

  const clip = useRef('')
  const micRef = useRef<THREE.Group>(null)
  const headRef = useRef<THREE.Object3D | null>(null)
  const groupRef = useRef<THREE.Group>(null)
  const tmp = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    if (built) headRef.current = built.scene.getObjectByName('Head') || null
  }, [built])
  useEffect(() => {
    return () => {
      built?.mixer.stopAllAction()
    }
  }, [built])

  const target = animFor(status, playing)
  useEffect(() => {
    if (!built) return
    const next = built.actions[target] || built.actions['Idle']
    if (!next) return
    const prev = clip.current ? built.actions[clip.current] : null
    const speed = target === 'Dance' ? 0.72 : 0.85
    if (prev && prev !== next) prev.fadeOut(0.3)
    next.reset().setEffectiveTimeScale(speed).fadeIn(0.3).play()
    clip.current = target
    if (reduced) built.mixer.update(0.2)
  }, [built, target, reduced])

  useFrame((_, dt) => {
    if (built && !reduced) built.mixer.update(dt)
    const mic = micRef.current
    const g = groupRef.current
    if (mic && g && headRef.current && playing && status === 'running') {
      headRef.current.getWorldPosition(tmp)
      tmp.z += 0.13
      tmp.y -= 0.02
      g.worldToLocal(tmp)
      mic.position.copy(tmp)
    }
  })

  if (!built) return null
  const singing = playing && status === 'running'

  return (
    <group ref={groupRef} position={[0, -0.62, 0]}>
      <primitive object={built.scene} scale={0.4} />
      {singing && (
        <group ref={micRef} rotation={[-0.28, 0, 0]}>
          <mesh position={[0, -0.09, 0]}>
            <cylinderGeometry args={[0.02, 0.024, 0.2, 14]} />
            <meshStandardMaterial color="#17171d" roughness={0.45} metalness={0.4} />
          </mesh>
          <mesh position={[0, 0.05, 0]}>
            <sphereGeometry args={[0.075, 20, 20]} />
            <meshStandardMaterial color="#2a2a34" roughness={0.25} metalness={0.6} emissive={glow} emissiveIntensity={0.55} />
          </mesh>
        </group>
      )}
    </group>
  )
}

export default function BotAvatar({ status = 'stopped', playing = false }: { status?: string; playing?: boolean }) {
  return (
    <Canvas
      flat
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      camera={{ fov: 38, position: [0, 0.15, 3.7] }}
      style={{ width: '100%', height: '100%' }}
    >
      <ambientLight intensity={0.9} />
      <hemisphereLight intensity={0.5} color={'#ffffff'} groundColor={'#c7ccdb'} />
      <directionalLight position={[3, 5, 4]} intensity={1.1} />
      <Bot status={status} playing={playing} />
    </Canvas>
  )
}
