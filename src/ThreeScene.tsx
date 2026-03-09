import { useRef, useEffect, useCallback, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  PointerLockControls as DreiPointerLockControls,
  OrbitControls as DreiOrbitControls,
  TransformControls as DreiTransformControls,
  Grid,
} from '@react-three/drei'
import * as THREE from 'three'
import type { PointerLockControls as PointerLockControlsImpl, OrbitControls as OrbitControlsImpl } from 'three-stdlib'

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

function FirstPersonMovement({ disabled }: { disabled: boolean }) {
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
    if (disabled) return

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

function JsonControls({ disabled }: { disabled: boolean }) {
  const controlsRef = useRef<PointerLockControlsImpl>(null!)
  const { gl } = useThree()

  useEffect(() => {
    if (disabled) {
      controlsRef.current?.unlock()
    }
  }, [disabled])

  useEffect(() => {
    if (disabled) {
      const preventLock = (e: MouseEvent) => {
        e.stopPropagation()
      }
      const canvas = gl.domElement
      canvas.addEventListener('click', preventLock, true)
      return () => canvas.removeEventListener('click', preventLock, true)
    }
  }, [disabled, gl])

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

function HoldToSelect({ disabled, onHoldStart, onHoldEnd }: { disabled: boolean; onHoldStart: (id: number) => void; onHoldEnd: () => void }) {
  const { camera, scene, gl } = useThree()
  const holdingRef = useRef<number | null>(null)
  const raycasterRef = useRef(new THREE.Raycaster())
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled

  const getHitImageId = useCallback((): number | null => {
    raycasterRef.current.setFromCamera(new THREE.Vector2(0, 0), camera)
    const intersects = raycasterRef.current.intersectObjects(scene.children, true)
    for (const hit of intersects) {
      let obj: THREE.Object3D | null = hit.object
      while (obj) {
        if (obj.userData.imageId != null) {
          return obj.userData.imageId as number
        }
        obj = obj.parent
      }
    }
    return null
  }, [camera, scene])

  useEffect(() => {
    const handleMouseDown = () => {
      if (disabledRef.current) return
      if (!document.pointerLockElement) return
      const id = getHitImageId()
      if (id !== null) {
        holdingRef.current = id
        onHoldStart(id)
      }
    }

    const handleMouseUp = () => {
      if (holdingRef.current !== null) {
        holdingRef.current = null
        onHoldEnd()
      }
    }

    gl.domElement.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      gl.domElement.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [gl, getHitImageId, onHoldStart, onHoldEnd])

  // Cancel hold if disabled or crosshair moves off target
  useFrame(() => {
    if (holdingRef.current !== null) {
      if (disabledRef.current) {
        holdingRef.current = null
        onHoldEnd()
        return
      }
      const currentId = getHitImageId()
      if (currentId !== holdingRef.current) {
        holdingRef.current = null
        onHoldEnd()
      }
    }
  })

  return null
}

function SelectionModeControls({
  selectedImageId,
  transformMode,
}: {
  selectedImageId: number | null
  transformMode: 'translate' | 'rotate' | 'scale'
}) {
  const { scene, camera } = useThree()
  const orbitRef = useRef<OrbitControlsImpl>(null!)
  const [targetObject, setTargetObject] = useState<THREE.Object3D | null>(null)

  useEffect(() => {
    if (selectedImageId == null) {
      setTargetObject(null)
      return
    }
    let result: THREE.Object3D | null = null
    scene.traverse((obj) => {
      if (obj.userData.imageId === selectedImageId) {
        result = obj
      }
    })
    const found = result as THREE.Object3D | null
    setTargetObject(found)

    if (found && orbitRef.current) {
      const pos = new THREE.Vector3()
      found.getWorldPosition(pos)
      orbitRef.current.target.copy(pos)

      // Position camera to look at object from a nice angle
      const offset = new THREE.Vector3()
      camera.getWorldDirection(offset)
      offset.multiplyScalar(-4)
      camera.position.copy(pos).add(offset)
      camera.position.y = Math.max(camera.position.y, 1)

      orbitRef.current.update()
    }
  }, [selectedImageId, scene, camera])

  return (
    <>
      <DreiOrbitControls
        ref={orbitRef}
        makeDefault
        enableDamping
      />
      {targetObject && (
        <DreiTransformControls
          object={targetObject}
          mode={transformMode}
        />
      )}
    </>
  )
}

interface ThreeSceneProps {
  panelOpen: boolean
  acceptedImages: AcceptedImage[]
  selectionMode: boolean
  selectedImageId: number | null
  onHoldStart: (id: number) => void
  onHoldEnd: () => void
  transformMode: 'translate' | 'rotate' | 'scale'
}

export default function ThreeScene({
  panelOpen,
  acceptedImages,
  selectionMode,
  selectedImageId,
  onHoldStart,
  onHoldEnd,
  transformMode,
}: ThreeSceneProps) {
  return (
    <Canvas
      camera={{ position: [0, PLAYER_HEIGHT, 5], fov: 60 }}
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 0 }}
    >
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />
      <JsonControls disabled={panelOpen || selectionMode} />
      <FirstPersonMovement disabled={selectionMode} />
      <HoldToSelect disabled={selectionMode} onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} />
      {selectionMode && (
        <SelectionModeControls
          selectedImageId={selectedImageId}
          transformMode={transformMode}
        />
      )}
      <Cube />
      {acceptedImages.map((img) => (
        <ImagePlane key={img.id} id={img.id} url={img.url} selected={selectedImageId === img.id} />
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
