import { useRef, useEffect, useCallback, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  PointerLockControls as DreiPointerLockControls,
  OrbitControls as DreiOrbitControls,
  TransformControls as DreiTransformControls,
  Grid,
  Environment,
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

const MOVE_SPEED = 8
const SPRINT_MULTIPLIER = 1.5625
const PLAYER_HEIGHT = 2
const COLLISION_DISTANCE = 0.6
const JUMP_VELOCITY = 6
const GRAVITY = -15
const STEP_HEIGHT = 0.25 // max height player can step up without jumping

function FirstPersonMovement({ disabled }: { disabled: boolean }) {
  const { camera, scene } = useThree()
  const keys = useRef<Record<string, boolean>>({})
  const raycaster = useRef(new THREE.Raycaster())
  const velocityY = useRef(0)
  const isGrounded = useRef(true)

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

  // Collect all meshes belonging to image planes
  const getCollidables = useCallback(() => {
    const meshes: THREE.Mesh[] = []
    scene.traverse((obj) => {
      let parent: THREE.Object3D | null = obj
      while (parent) {
        if (parent.userData.imageId != null) {
          if (obj instanceof THREE.Mesh) meshes.push(obj)
          break
        }
        parent = parent.parent
      }
    })
    return meshes
  }, [scene])

  // Check if moving in a direction would collide
  // Cast rays at multiple heights; allow passage if hit is below step-up height (ramp)
  const canMove = useCallback((origin: THREE.Vector3, direction: THREE.Vector3, distance: number) => {
    const collidables = getCollidables()
    const threshold = distance + COLLISION_DISTANCE
    const feetY = origin.y - PLAYER_HEIGHT
    const testOrigin = new THREE.Vector3()

    // Rays above step height block movement; rays at step height allow ramp walk-up
    const rayHeights = [
      feetY + STEP_HEIGHT + 0.1, // just above step-up zone — blocks walls
      feetY + PLAYER_HEIGHT * 0.5,
      feetY + PLAYER_HEIGHT * 0.85,
    ]

    for (const h of rayHeights) {
      testOrigin.set(origin.x, h, origin.z)
      raycaster.current.set(testOrigin, direction)
      raycaster.current.far = threshold
      const hits = raycaster.current.intersectObjects(collidables, false)
      if (hits.length > 0 && hits[0].distance <= threshold) return false
    }
    return true
  }, [getCollidables])

  useFrame((_, delta) => {
    if (disabled) return

    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()

    const right = new THREE.Vector3()
    right.crossVectors(forward, camera.up).normalize()

    const sprinting = keys.current['ShiftLeft'] || keys.current['ShiftRight']
    const speed = MOVE_SPEED * (sprinting ? SPRINT_MULTIPLIER : 1) * delta

    const origin = camera.position.clone()
    // canMove casts rays at multiple heights from this base

    if (keys.current['KeyW'] || keys.current['ArrowUp']) {
      if (canMove(origin, forward, speed)) {
        camera.position.addScaledVector(forward, speed)
      }
    }
    if (keys.current['KeyS'] || keys.current['ArrowDown']) {
      const back = forward.clone().negate()
      if (canMove(origin, back, speed)) {
        camera.position.addScaledVector(forward, -speed)
      }
    }
    if (keys.current['KeyA'] || keys.current['ArrowLeft']) {
      const left = right.clone().negate()
      if (canMove(origin, left, speed)) {
        camera.position.addScaledVector(right, -speed)
      }
    }
    if (keys.current['KeyD'] || keys.current['ArrowRight']) {
      if (canMove(origin, right, speed)) {
        camera.position.addScaledVector(right, speed)
      }
    }

    // Jump
    if (keys.current['Space'] && isGrounded.current) {
      velocityY.current = JUMP_VELOCITY
      isGrounded.current = false
    }

    // Apply gravity
    velocityY.current += GRAVITY * delta
    camera.position.y += velocityY.current * delta

    // Downward raycast to find surfaces below the player
    const feetPos = new THREE.Vector3(camera.position.x, camera.position.y, camera.position.z)
    const downDir = new THREE.Vector3(0, -1, 0)
    raycaster.current.set(feetPos, downDir)
    raycaster.current.far = PLAYER_HEIGHT + 2 // check below feet plus some margin
    const collidables = getCollidables()
    const downHits = raycaster.current.intersectObjects(collidables, false)

    // Find the highest surface below the player's feet
    let surfaceY = 0 // world ground
    for (const hit of downHits) {
      const hitSurfaceY = hit.point.y
      // Only count surfaces that are roughly below the player (not above head)
      if (hitSurfaceY <= camera.position.y && hitSurfaceY > surfaceY) {
        surfaceY = hitSurfaceY
      }
    }

    const targetCameraY = surfaceY + PLAYER_HEIGHT

    // Step-up: if walking and the surface is slightly above feet, step up automatically
    if (isGrounded.current && surfaceY > 0) {
      const feetY = camera.position.y - PLAYER_HEIGHT
      const stepDelta = surfaceY - feetY
      if (stepDelta > 0 && stepDelta <= STEP_HEIGHT) {
        camera.position.y = targetCameraY
        velocityY.current = 0
      }
    }

    // Land on surface or ground
    if (camera.position.y <= targetCameraY) {
      camera.position.y = targetCameraY
      velocityY.current = 0
      isGrounded.current = true
    }

    // Fallback: never fall below world ground
    if (camera.position.y < PLAYER_HEIGHT) {
      camera.position.y = PLAYER_HEIGHT
      velocityY.current = 0
      isGrounded.current = true
    }
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
  const [planeSize, setPlaneSize] = useState<[number, number]>([2, 2])
  const initialized = useRef(false)

  useEffect(() => {
    const loader = new THREE.TextureLoader()
    loader.load(url, (tex) => {
      // Analyze texture to find non-transparent content bounds
      const image = tex.image as HTMLImageElement
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth || image.width
      canvas.height = image.naturalHeight || image.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const { data, width, height } = imageData

      let minX = width, minY = height, maxX = 0, maxY = 0
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const alpha = data[(y * width + x) * 4 + 3]
          if (alpha > 10) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }

      if (maxX >= minX && maxY >= minY) {
        // Set UV offset/repeat to crop to non-transparent region
        const uMin = minX / width
        const uMax = (maxX + 1) / width
        const vMin = 1 - (maxY + 1) / height  // UV y is flipped
        const vMax = 1 - minY / height
        tex.offset.set(uMin, vMin)
        tex.repeat.set(uMax - uMin, vMax - vMin)

        // Scale plane to match cropped aspect ratio, fitting within 2 units
        const contentW = maxX - minX + 1
        const contentH = maxY - minY + 1
        const aspect = contentW / contentH
        const targetSize = 2
        if (aspect >= 1) {
          setPlaneSize([targetSize, targetSize / aspect])
        } else {
          setPlaneSize([targetSize * aspect, targetSize])
        }
      }

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
            <planeGeometry args={planeSize} />
            <meshStandardMaterial map={texture} transparent alphaTest={0.5} side={THREE.DoubleSide} />
          </mesh>
          {selected && (
            <mesh position={[0, 0, -0.01]}>
              <planeGeometry args={[planeSize[0] + 0.15, planeSize[1] + 0.15]} />
              <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} transparent opacity={0.7} />
            </mesh>
          )}
        </>
      )}
    </group>
  )
}

function HoldToSelect({ disabled, onHoldStart, onHoldEnd }: { disabled: boolean; onHoldStart: (id: number) => void; onHoldEnd: () => void }) {
  const { camera, scene } = useThree()
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
  snapRotationTrigger,
}: {
  selectedImageId: number | null
  transformMode: 'translate' | 'rotate' | 'scale'
  onTransformUpdate?: (id: number, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => void
  snapToGroundTrigger: number
  snapRotationTrigger: { rotation: [number, number, number]; counter: number }
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

  // Snap rotation when trigger changes
  useEffect(() => {
    if (snapRotationTrigger.counter === 0 || !targetObject || selectedImageId == null) return

    const [rx, ry, rz] = snapRotationTrigger.rotation
    targetObject.rotation.set(rx, ry, rz)

    if (onTransformUpdate) {
      onTransformUpdate(
        selectedImageId,
        [targetObject.position.x, targetObject.position.y, targetObject.position.z],
        [rx, ry, rz],
        [targetObject.scale.x, targetObject.scale.y, targetObject.scale.z],
      )
    }

    if (orbitRef.current) {
      orbitRef.current.update()
    }
  }, [snapRotationTrigger])

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
  snapRotationTrigger: { rotation: [number, number, number]; counter: number }
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
  snapRotationTrigger,
  billboardIds,
}: ThreeSceneProps) {
  return (
    <Canvas
      camera={{ position: [0, PLAYER_HEIGHT, 5], fov: 60 }}
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 0 }}
    >
      <Environment files="/sky.hdr" background environmentIntensity={0.1} backgroundIntensity={0.3} />
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
          snapRotationTrigger={snapRotationTrigger}
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
