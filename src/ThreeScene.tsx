import { useRef, useEffect, useCallback, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PointerLockControls as DreiPointerLockControls, Grid } from '@react-three/drei'
import * as THREE from 'three'
import type { PointerLockControls as PointerLockControlsImpl } from 'three-stdlib'

interface AcceptedImage {
  id: number;
  url: string;
}

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

function ImagePlane({ url, id, selected }: { url: string; id: number; selected: boolean }) {
  const groupRef = useRef<THREE.Group>(null!)
  const { camera } = useThree()
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  const initialized = useRef(false)

  useEffect(() => {
    const loader = new THREE.TextureLoader()
    loader.load(url, (tex) => {
      setTexture(tex)
    })
  }, [url])

  useEffect(() => {
    if (!initialized.current && groupRef.current && texture) {
      const direction = new THREE.Vector3()
      camera.getWorldDirection(direction)
      direction.y = 0
      direction.normalize()

      const pos = camera.position.clone()
      pos.addScaledVector(direction, 4)
      pos.y = 0 // center plane at grid level

      groupRef.current.position.copy(pos)

      // Face the camera horizontally
      const lookTarget = camera.position.clone()
      lookTarget.y = pos.y
      groupRef.current.lookAt(lookTarget)

      initialized.current = true
    }
  }, [texture, camera])

  if (!texture) return null

  return (
    <group ref={groupRef} userData={{ imageId: id }}>
      <mesh>
        <planeGeometry args={[2, 2]} />
        <meshStandardMaterial map={texture} transparent alphaTest={0.1} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {selected && (
        <mesh position={[0, 0, -0.01]}>
          <planeGeometry args={[2.15, 2.15]} />
          <meshBasicMaterial color="#646cff" side={THREE.DoubleSide} transparent opacity={0.7} />
        </mesh>
      )}
    </group>
  )
}

function SelectionRaycaster({ onSelect }: { onSelect: (id: number | null) => void }) {
  const { camera, scene, gl } = useThree()

  useEffect(() => {
    const raycaster = new THREE.Raycaster()
    const handleClick = () => {
      if (!document.pointerLockElement) return
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)
      const intersects = raycaster.intersectObjects(scene.children, true)

      for (const hit of intersects) {
        let obj: THREE.Object3D | null = hit.object
        while (obj) {
          if (obj.userData.imageId != null) {
            onSelect(obj.userData.imageId)
            return
          }
          obj = obj.parent
        }
      }
      onSelect(null)
    }

    gl.domElement.addEventListener('click', handleClick)
    return () => gl.domElement.removeEventListener('click', handleClick)
  }, [camera, scene, gl, onSelect])

  return null
}

export default function ThreeScene({ panelOpen, acceptedImages }: { panelOpen: boolean; acceptedImages: AcceptedImage[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const handleSelect = useCallback((id: number | null) => setSelectedId(id), [])

  return (
    <Canvas
      camera={{ position: [0, PLAYER_HEIGHT, 5], fov: 60 }}
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 0 }}
    >
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />
      <JsonControls panelOpen={panelOpen} />
      <FirstPersonMovement />
      <SelectionRaycaster onSelect={handleSelect} />
      <Cube />
      {acceptedImages.map((img) => (
        <ImagePlane key={img.id} id={img.id} url={img.url} selected={selectedId === img.id} />
      ))}
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
