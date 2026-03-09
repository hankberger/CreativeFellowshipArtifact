import { useRef, useEffect, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PointerLockControls as DreiPointerLockControls, Grid } from '@react-three/drei'
import * as THREE from 'three'
import type { PointerLockControls as PointerLockControlsImpl } from 'three-stdlib'

function Cube() {
  const ref = useRef<THREE.Mesh>(null!)
  useFrame((_, delta) => {
    ref.current.rotation.x += delta * 0.5
    ref.current.rotation.y += delta * 0.5
  })
  return (
    <mesh ref={ref}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#646cff" />
    </mesh>
  )
}

const MOVE_SPEED = 5
const PLAYER_HEIGHT = 2

function FirstPersonMovement() {
  const { camera } = useThree()
  const keys = useRef<Record<string, boolean>>({})

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    keys.current[e.code] = true
  }, [])

  const onKeyUp = useCallback((e: KeyboardEvent) => {
    keys.current[e.code] = false
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [onKeyDown, onKeyUp])

  useFrame((_, delta) => {
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()

    const right = new THREE.Vector3()
    right.crossVectors(forward, camera.up).normalize()

    const speed = MOVE_SPEED * delta

    if (keys.current['KeyW'] || keys.current['ArrowUp']) {
      camera.position.addScaledVector(forward, speed)
    }
    if (keys.current['KeyS'] || keys.current['ArrowDown']) {
      camera.position.addScaledVector(forward, -speed)
    }
    if (keys.current['KeyA'] || keys.current['ArrowLeft']) {
      camera.position.addScaledVector(right, -speed)
    }
    if (keys.current['KeyD'] || keys.current['ArrowRight']) {
      camera.position.addScaledVector(right, speed)
    }

    camera.position.y = PLAYER_HEIGHT
  })

  return null
}

function JsonControls({ panelOpen }: { panelOpen: boolean }) {
  const controlsRef = useRef<PointerLockControlsImpl>(null!)
  const { gl } = useThree()

  useEffect(() => {
    if (panelOpen) {
      controlsRef.current?.unlock()
    }
  }, [panelOpen])

  useEffect(() => {
    if (panelOpen) {
      const preventLock = (e: MouseEvent) => {
        e.stopPropagation()
      }
      const canvas = gl.domElement
      canvas.addEventListener('click', preventLock, true)
      return () => canvas.removeEventListener('click', preventLock, true)
    }
  }, [panelOpen, gl])

  return <DreiPointerLockControls ref={controlsRef} />
}

export default function ThreeScene({ panelOpen }: { panelOpen: boolean }) {
  return (
    <Canvas
      camera={{ position: [0, PLAYER_HEIGHT, 5], fov: 60 }}
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 0 }}
    >
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />
      <JsonControls panelOpen={panelOpen} />
      <FirstPersonMovement />
      <Cube />
      <Grid
        position={[0, -1, 0]}
        args={[100, 100]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#ffffff"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#ffffff"
        fadeDistance={30}
        infiniteGrid
      />
    </Canvas>
  )
}
