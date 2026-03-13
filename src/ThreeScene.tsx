import { useRef, useEffect, useCallback, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  PointerLockControls as DreiPointerLockControls,
  OrbitControls as DreiOrbitControls,
  TransformControls as DreiTransformControls,
  Grid,
} from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

interface AcceptedImage {
  id: number;
  imageId: string;
  url: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
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
  useEffect(() => {
    if (disabled && document.pointerLockElement) {
      document.exitPointerLock()
    }
  }, [disabled])

  if (disabled) return null

  return <DreiPointerLockControls />
}

function ImagePlane({
  url, id, selected,
  savedPosition, savedRotation, savedScale,
  onTransformUpdate, billboard,
}: {
  url: string; id: number; selected: boolean;
  savedPosition?: [number, number, number];
  savedRotation?: [number, number, number];
  savedScale?: [number, number, number];
  onTransformUpdate?: (id: number, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => void;
  billboard?: boolean;
}) {
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
      if (savedPosition) {
        // Restore saved transform from DB
        groupRef.current.position.set(...savedPosition)
        if (savedRotation) groupRef.current.rotation.set(...savedRotation)
        if (savedScale) groupRef.current.scale.set(...savedScale)
      } else {
        // Compute from camera for newly placed images
        const direction = new THREE.Vector3()
        camera.getWorldDirection(direction)
        direction.y = 0
        direction.normalize()

        const pos = camera.position.clone()
        pos.addScaledVector(direction, 4)
        pos.y = 0

        groupRef.current.position.copy(pos)

        const lookTarget = camera.position.clone()
        lookTarget.y = pos.y
        groupRef.current.lookAt(lookTarget)
      }

      initialized.current = true

      // Report initial transform
      if (onTransformUpdate) {
        const g = groupRef.current
        onTransformUpdate(
          id,
          [g.position.x, g.position.y, g.position.z],
          [g.rotation.x, g.rotation.y, g.rotation.z],
          [g.scale.x, g.scale.y, g.scale.z],
        )
      }
    }
  }, [texture, camera, savedPosition, savedRotation, savedScale, id, onTransformUpdate])

  // Billboard: always face the camera
  useFrame(() => {
    if (billboard && groupRef.current && !selected) {
      const camPos = camera.position.clone()
      camPos.y = groupRef.current.position.y
      groupRef.current.lookAt(camPos)
    }
  })

  return (
    <group ref={groupRef} userData={{ imageId: id }}>
      {texture && (
        <>
          <mesh>
            <planeGeometry args={[2, 2]} />
            <meshStandardMaterial map={texture} transparent alphaTest={0.1} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          {selected && (
            <mesh position={[0, 0, -0.01]}>
              <planeGeometry args={[2.15, 2.15]} />
              <meshBasicMaterial color="#f97316" side={THREE.DoubleSide} transparent opacity={0.7} />
            </mesh>
          )}
        </>
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

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [getHitImageId, onHoldStart, onHoldEnd])

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

function CameraStateSaver({ selectionMode }: { selectionMode: boolean }) {
  const { camera } = useThree()
  const savedState = useRef<{ position: THREE.Vector3; quaternion: THREE.Quaternion } | null>(null)
  const prevSelectionMode = useRef(false)

  useEffect(() => {
    if (selectionMode && !prevSelectionMode.current) {
      savedState.current = {
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
      }
    } else if (!selectionMode && prevSelectionMode.current && savedState.current) {
      camera.position.copy(savedState.current.position)
      camera.quaternion.copy(savedState.current.quaternion)
      savedState.current = null
    }
    prevSelectionMode.current = selectionMode
  }, [selectionMode, camera])

  return null
}

const GROUND_Y = -1

function SelectionModeControls({
  selectedImageId,
  transformMode,
  onTransformUpdate,
  snapToGroundTrigger,
}: {
  selectedImageId: number | null
  transformMode: 'translate' | 'rotate' | 'scale'
  onTransformUpdate?: (id: number, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => void
  snapToGroundTrigger: number
}) {
  const { scene, camera } = useThree()
  const orbitRef = useRef<OrbitControlsImpl>(null!)
  const transformRef = useRef<any>(null!)
  const [targetObject, setTargetObject] = useState<THREE.Object3D | null>(null)

  // Find the target object when selectedImageId changes
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
    setTargetObject(result)
  }, [selectedImageId, scene])

  // Retry finding the target if not found initially (e.g. texture still loading)
  useFrame(() => {
    if (selectedImageId != null && !targetObject) {
      let result: THREE.Object3D | null = null
      scene.traverse((obj) => {
        if (obj.userData.imageId === selectedImageId) {
          result = obj
        }
      })
      if (result) setTargetObject(result)
    }
  })

  // Position camera when target is found
  useEffect(() => {
    if (!targetObject || !orbitRef.current) return

    const pos = new THREE.Vector3()
    targetObject.getWorldPosition(pos)
    orbitRef.current.target.copy(pos)

    // Position camera to look at object from a nice angle
    const offset = new THREE.Vector3()
    camera.getWorldDirection(offset)
    offset.multiplyScalar(-4)
    camera.position.copy(pos).add(offset)
    camera.position.y = Math.max(camera.position.y, 1)

    orbitRef.current.update()
  }, [targetObject, camera])

  // Snap to ground when trigger changes
  useEffect(() => {
    if (snapToGroundTrigger === 0 || !targetObject) return

    // Compute the world-space bounding box of the object
    const box = new THREE.Box3().setFromObject(targetObject)
    const minY = box.min.y
    const offset = minY - GROUND_Y
    targetObject.position.y -= offset

    // Report updated transform
    if (onTransformUpdate && selectedImageId != null) {
      onTransformUpdate(
        selectedImageId,
        [targetObject.position.x, targetObject.position.y, targetObject.position.z],
        [targetObject.rotation.x, targetObject.rotation.y, targetObject.rotation.z],
        [targetObject.scale.x, targetObject.scale.y, targetObject.scale.z],
      )
    }

    // Update orbit target
    if (orbitRef.current) {
      const pos = new THREE.Vector3()
      targetObject.getWorldPosition(pos)
      orbitRef.current.target.copy(pos)
      orbitRef.current.update()
    }
  }, [snapToGroundTrigger])

  // Listen for drag-end on TransformControls to report updated transform
  useEffect(() => {
    const ctrl = transformRef.current
    if (!ctrl || !targetObject || selectedImageId == null) return

    const handleMouseUp = () => {
      if (onTransformUpdate && targetObject) {
        onTransformUpdate(
          selectedImageId,
          [targetObject.position.x, targetObject.position.y, targetObject.position.z],
          [targetObject.rotation.x, targetObject.rotation.y, targetObject.rotation.z],
          [targetObject.scale.x, targetObject.scale.y, targetObject.scale.z],
        )
      }
      if (orbitRef.current && targetObject) {
        const pos = new THREE.Vector3()
        targetObject.getWorldPosition(pos)
        orbitRef.current.target.copy(pos)
        orbitRef.current.update()
      }
    }

    ctrl.addEventListener('mouseUp', handleMouseUp)
    return () => ctrl.removeEventListener('mouseUp', handleMouseUp)
  }, [targetObject, selectedImageId, onTransformUpdate])

  return (
    <>
      <DreiOrbitControls
        ref={orbitRef}
        makeDefault
        enableDamping
      />
      {targetObject && (
        <DreiTransformControls
          ref={transformRef}
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
  onTransformUpdate: (id: number, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => void
  snapToGroundTrigger: number
  billboardIds: Set<number>
}

export default function ThreeScene({
  panelOpen,
  acceptedImages,
  selectionMode,
  selectedImageId,
  onHoldStart,
  onHoldEnd,
  transformMode,
  onTransformUpdate,
  snapToGroundTrigger,
  billboardIds,
}: ThreeSceneProps) {
  return (
    <Canvas
      camera={{ position: [0, PLAYER_HEIGHT, 5], fov: 60 }}
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 0 }}
    >
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />
      <JsonControls disabled={panelOpen || selectionMode} />
      <FirstPersonMovement disabled={panelOpen || selectionMode} />
      <CameraStateSaver selectionMode={selectionMode} />
      <HoldToSelect disabled={selectionMode} onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} />
      {selectionMode && (
        <SelectionModeControls
          selectedImageId={selectedImageId}
          transformMode={transformMode}
          onTransformUpdate={onTransformUpdate}
          snapToGroundTrigger={snapToGroundTrigger}
        />
      )}
      {acceptedImages.map((img) => (
        <ImagePlane
          key={img.id}
          id={img.id}
          url={img.url}
          selected={selectedImageId === img.id}
          savedPosition={img.position}
          savedRotation={img.rotation}
          savedScale={img.scale}
          onTransformUpdate={onTransformUpdate}
          billboard={billboardIds.has(img.id)}
        />
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
        fadeDistance={60}
        infiniteGrid
      />
    </Canvas>
  )
}
