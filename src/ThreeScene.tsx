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
const STEP_HEIGHT = 0.5 // max height player can step up without jumping

function FirstPersonMovement({ disabled, mobileMove }: { disabled: boolean; mobileMove?: React.RefObject<{ x: number; y: number }> }) {
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
    const baseSpeed = MOVE_SPEED * (sprinting ? SPRINT_MULTIPLIER : 1) * delta

    const origin = camera.position.clone()

    // Combine keyboard + mobile joystick input
    let moveZ = 0
    let moveX = 0
    if (keys.current['KeyW'] || keys.current['ArrowUp']) moveZ += 1
    if (keys.current['KeyS'] || keys.current['ArrowDown']) moveZ -= 1
    if (keys.current['KeyA'] || keys.current['ArrowLeft']) moveX -= 1
    if (keys.current['KeyD'] || keys.current['ArrowRight']) moveX += 1
    if (mobileMove?.current) {
      moveZ -= mobileMove.current.y
      moveX += mobileMove.current.x
    }

    if (moveZ > 0.1) {
      const speed = baseSpeed * Math.min(moveZ, 1)
      if (canMove(origin, forward, speed)) {
        camera.position.addScaledVector(forward, speed)
      }
    } else if (moveZ < -0.1) {
      const speed = baseSpeed * Math.min(-moveZ, 1)
      const back = forward.clone().negate()
      if (canMove(origin, back, speed)) {
        camera.position.addScaledVector(forward, -speed)
      }
    }
    if (moveX > 0.1) {
      const speed = baseSpeed * Math.min(moveX, 1)
      if (canMove(origin, right, speed)) {
        camera.position.addScaledVector(right, speed)
      }
    } else if (moveX < -0.1) {
      const speed = baseSpeed * Math.min(-moveX, 1)
      const left = right.clone().negate()
      if (canMove(origin, left, speed)) {
        camera.position.addScaledVector(right, -speed)
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

function JsonControls({ disabled, isMobile }: { disabled: boolean; isMobile?: boolean }) {
  useEffect(() => {
    if (disabled && document.pointerLockElement) {
      document.exitPointerLock()
    }
  }, [disabled])

  if (disabled || isMobile) return null

  return <DreiPointerLockControls />
}

function TouchLookControls({ disabled }: { disabled: boolean }) {
  const { camera, gl } = useThree()
  const touchRef = useRef<{ id: number; x: number; y: number } | null>(null)
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'))
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled

  useEffect(() => {
    const canvas = gl.domElement
    const SENSITIVITY = 0.004

    const onTouchStart = (e: TouchEvent) => {
      if (disabledRef.current) return
      if (touchRef.current !== null) return
      const touch = e.changedTouches[0]
      touchRef.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!touchRef.current || disabledRef.current) return
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]
        if (touch.identifier === touchRef.current.id) {
          const dx = touch.clientX - touchRef.current.x
          const dy = touch.clientY - touchRef.current.y
          touchRef.current.x = touch.clientX
          touchRef.current.y = touch.clientY
          euler.current.setFromQuaternion(camera.quaternion)
          euler.current.y -= dx * SENSITIVITY
          euler.current.x -= dy * SENSITIVITY
          euler.current.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.current.x))
          camera.quaternion.setFromEuler(euler.current)
          break
        }
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!touchRef.current) return
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchRef.current.id) {
          touchRef.current = null
          break
        }
      }
    }

    canvas.addEventListener('touchstart', onTouchStart, { passive: true })
    canvas.addEventListener('touchmove', onTouchMove, { passive: true })
    canvas.addEventListener('touchend', onTouchEnd, { passive: true })
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', onTouchEnd)
      canvas.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [camera, gl])

  return null
}

function ImagePlane({
  url, id, selected,
  savedPosition, savedRotation, savedScale,
  onTransformUpdate, billboard, character,
  speakingImageUrl, isSpeaking, onTextureLoaded,
}: {
  url: string; id: number; selected: boolean;
  savedPosition?: [number, number, number];
  savedRotation?: [number, number, number];
  savedScale?: [number, number, number];
  onTransformUpdate?: (id: number, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => void;
  billboard?: boolean;
  character?: boolean;
  speakingImageUrl?: string | null;
  isSpeaking?: boolean;
  onTextureLoaded?: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null!)
  const chatBubbleRef = useRef<THREE.Group>(null!)
  const { camera } = useThree()
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  const [chatBubbleTexture, setChatBubbleTexture] = useState<THREE.Texture | null>(null)
  const [speakingTexture, setSpeakingTexture] = useState<THREE.Texture | null>(null)
  const [showSpeakingFrame, setShowSpeakingFrame] = useState(false)
  const [planeSize, setPlaneSize] = useState<[number, number]>([2, 2])
  const initialized = useRef(false)
  const speakingImageUrlRef = useRef(speakingImageUrl)

  // Load chatbubble texture when character flag is set
  useEffect(() => {
    if (character && !chatBubbleTexture) {
      const loader = new THREE.TextureLoader()
      loader.load('/chatbubble.png', (tex) => {
        setChatBubbleTexture(tex)
      })
    }
  }, [character, chatBubbleTexture])

  // Load speaking texture
  useEffect(() => {
    if (!speakingImageUrl) {
      setSpeakingTexture(null)
      speakingImageUrlRef.current = null
      return
    }
    if (speakingImageUrl === speakingImageUrlRef.current && speakingTexture) return
    speakingImageUrlRef.current = speakingImageUrl
    const loader = new THREE.TextureLoader()
    loader.load(speakingImageUrl, (tex) => {
      // Analyze and crop like the main texture
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
        const uMin = minX / width
        const uMax = (maxX + 1) / width
        const vMin = 1 - (maxY + 1) / height
        const vMax = 1 - minY / height
        tex.offset.set(uMin, vMin)
        tex.repeat.set(uMax - uMin, vMax - vMin)
      }

      setSpeakingTexture(tex)
    })
  }, [speakingImageUrl])

  // Flash between normal and speaking texture every 50ms when speaking
  useEffect(() => {
    if (!isSpeaking || !speakingTexture) {
      setShowSpeakingFrame(false)
      return
    }
    const interval = setInterval(() => {
      setShowSpeakingFrame(prev => !prev)
    }, 100)
    return () => clearInterval(interval)
  }, [isSpeaking, speakingTexture])

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
      onTextureLoaded?.()
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
    // Chatbubble always faces camera and bobs up/down
    if (character && chatBubbleRef.current) {
      const camPos = camera.position.clone()
      camPos.y = chatBubbleRef.current.getWorldPosition(new THREE.Vector3()).y
      chatBubbleRef.current.lookAt(camPos)
      const baseY = planeSize[1] / 2 + 0.3
      chatBubbleRef.current.position.y = baseY + Math.sin(performance.now() * 0.0015) * 0.04
    }
  })

  return (
    <group ref={groupRef} userData={{ imageId: id }} position={savedPosition || [0, 0, 0]}>
      {texture && (
        <>
          <mesh>
            <planeGeometry args={planeSize} />
            <meshStandardMaterial map={showSpeakingFrame && speakingTexture ? speakingTexture : texture} transparent alphaTest={0.5} side={THREE.DoubleSide} />
          </mesh>
          {selected && (
            <mesh position={[0, 0, -0.01]}>
              <planeGeometry args={[planeSize[0] + 0.15, planeSize[1] + 0.15]} />
              <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} transparent opacity={0.7} />
            </mesh>
          )}
        </>
      )}
      {character && chatBubbleTexture && (
        <group ref={chatBubbleRef} position={[0, planeSize[1] / 2 + 0.3, 0]}>
          <mesh>
            <planeGeometry args={[0.3, 0.3]} />
            <meshBasicMaterial map={chatBubbleTexture} transparent alphaTest={0.1} side={THREE.DoubleSide} />
          </mesh>
        </group>
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

    const handleTouchStart = () => handleMouseDown()
    const handleTouchEnd = () => handleMouseUp()
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchend', handleTouchEnd, { passive: true })
    document.addEventListener('touchcancel', handleTouchEnd, { passive: true })
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchend', handleTouchEnd)
      document.removeEventListener('touchcancel', handleTouchEnd)
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

function MobileTapSelect({ disabled, onSelect }: { disabled: boolean; onSelect: (id: number) => void }) {
  const { camera, scene, gl } = useThree()
  const raycasterRef = useRef(new THREE.Raycaster())
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null)

  const getHitImageId = useCallback((): number | null => {
    raycasterRef.current.setFromCamera(new THREE.Vector2(0, 0), camera)
    const intersects = raycasterRef.current.intersectObjects(scene.children, true)
    for (const hit of intersects) {
      let obj: THREE.Object3D | null = hit.object
      while (obj) {
        if (obj.userData.imageId != null) return obj.userData.imageId as number
        obj = obj.parent
      }
    }
    return null
  }, [camera, scene])

  useEffect(() => {
    const canvas = gl.domElement

    const onTouchStart = (e: TouchEvent) => {
      if (disabledRef.current || e.touches.length !== 1) return
      const t = e.changedTouches[0]
      touchStartRef.current = { x: t.clientX, y: t.clientY, time: performance.now() }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (disabledRef.current || !touchStartRef.current) return
      const t = e.changedTouches[0]
      const dx = t.clientX - touchStartRef.current.x
      const dy = t.clientY - touchStartRef.current.y
      const elapsed = performance.now() - touchStartRef.current.time
      touchStartRef.current = null
      // Quick tap with minimal movement
      if (Math.sqrt(dx * dx + dy * dy) < 15 && elapsed < 300) {
        const id = getHitImageId()
        if (id !== null) onSelect(id)
      }
    }

    canvas.addEventListener('touchstart', onTouchStart, { passive: true })
    canvas.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchend', onTouchEnd)
    }
  }, [gl, getHitImageId, onSelect])

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
  selectedImageIds,
  multiSelectMode,
  transformMode,
  onTransformUpdate,
  snapToGroundTrigger,
  snapRotationTrigger,
}: {
  selectedImageId: number | null
  selectedImageIds: Set<number>
  multiSelectMode: boolean
  transformMode: 'translate' | 'rotate' | 'scale'
  onTransformUpdate?: (id: number, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => void
  snapToGroundTrigger: number
  snapRotationTrigger: { rotation: [number, number, number]; counter: number; delta?: boolean }
}) {
  const { scene, camera } = useThree()
  const orbitRef = useRef<OrbitControlsImpl>(null!)
  const transformRef = useRef<any>(null!)
  const [targetObject, setTargetObject] = useState<THREE.Object3D | null>(null)

  // Multi-select drag tracking
  const isDragging = useRef(false)
  const dragStartTransforms = useRef<Map<number, { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 }>>(new Map())

  // Helper to find scene object by imageId
  const findObjectById = useCallback((id: number): THREE.Object3D | null => {
    let result: THREE.Object3D | null = null
    scene.traverse((obj) => {
      if (obj.userData.imageId === id) result = obj
    })
    return result
  }, [scene])

  // Report transform for an object
  const reportTransform = useCallback((obj: THREE.Object3D, id: number) => {
    if (onTransformUpdate) {
      onTransformUpdate(
        id,
        [obj.position.x, obj.position.y, obj.position.z],
        [obj.rotation.x, obj.rotation.y, obj.rotation.z],
        [obj.scale.x, obj.scale.y, obj.scale.z],
      )
    }
  }, [onTransformUpdate])

  // Find the target object when selectedImageId changes
  useEffect(() => {
    if (selectedImageId == null) {
      setTargetObject(null)
      return
    }
    setTargetObject(findObjectById(selectedImageId))
  }, [selectedImageId, scene, findObjectById])

  // Retry finding the target if not found initially (e.g. texture still loading)
  // Also apply multi-select transforms during drag
  useFrame(() => {
    if (selectedImageId != null && !targetObject) {
      const result = findObjectById(selectedImageId)
      if (result) setTargetObject(result)
    }

    // Apply multi-select transforms during drag
    if (isDragging.current && multiSelectMode && targetObject && selectedImageId != null) {
      const primaryStart = dragStartTransforms.current.get(selectedImageId)
      if (!primaryStart) return

      for (const [id, start] of dragStartTransforms.current) {
        if (id === selectedImageId) continue
        const obj = findObjectById(id)
        if (!obj) continue

        if (transformMode === 'translate') {
          const delta = new THREE.Vector3().subVectors(targetObject.position, primaryStart.position)
          obj.position.copy(start.position.clone().add(delta))
        } else if (transformMode === 'rotate') {
          obj.rotation.set(
            start.rotation.x + (targetObject.rotation.x - primaryStart.rotation.x),
            start.rotation.y + (targetObject.rotation.y - primaryStart.rotation.y),
            start.rotation.z + (targetObject.rotation.z - primaryStart.rotation.z),
          )
        } else if (transformMode === 'scale') {
          obj.scale.set(
            start.scale.x * (primaryStart.scale.x !== 0 ? targetObject.scale.x / primaryStart.scale.x : 1),
            start.scale.y * (primaryStart.scale.y !== 0 ? targetObject.scale.y / primaryStart.scale.y : 1),
            start.scale.z * (primaryStart.scale.z !== 0 ? targetObject.scale.z / primaryStart.scale.z : 1),
          )
        }
      }
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
    if (snapToGroundTrigger === 0) return

    const idsToSnap = multiSelectMode && selectedImageIds.size > 0
      ? Array.from(selectedImageIds)
      : (selectedImageId != null ? [selectedImageId] : [])

    for (const id of idsToSnap) {
      const obj = findObjectById(id)
      if (!obj) continue

      const box = new THREE.Box3().setFromObject(obj)
      const minY = box.min.y
      const offset = minY - GROUND_Y
      obj.position.y -= offset - 0.01

      reportTransform(obj, id)
    }

    // Update orbit target
    if (orbitRef.current && targetObject) {
      const pos = new THREE.Vector3()
      targetObject.getWorldPosition(pos)
      orbitRef.current.target.copy(pos)
      orbitRef.current.update()
    }
  }, [snapToGroundTrigger])

  // Snap rotation when trigger changes
  useEffect(() => {
    if (snapRotationTrigger.counter === 0 || selectedImageId == null) return

    const [rx, ry, rz] = snapRotationTrigger.rotation
    const isDelta = snapRotationTrigger.delta === true
    const idsToSnap = multiSelectMode && selectedImageIds.size > 0
      ? Array.from(selectedImageIds)
      : [selectedImageId]

    for (const id of idsToSnap) {
      const obj = findObjectById(id)
      if (!obj) continue

      if (isDelta) {
        obj.rotation.set(
          obj.rotation.x + rx,
          obj.rotation.y + ry,
          obj.rotation.z + rz,
        )
      } else {
        obj.rotation.set(rx, ry, rz)
      }

      reportTransform(obj, id)
    }

    if (orbitRef.current) {
      orbitRef.current.update()
    }
  }, [snapRotationTrigger])

  // Listen for drag start/end on TransformControls
  useEffect(() => {
    const ctrl = transformRef.current
    if (!ctrl || !targetObject || selectedImageId == null) return

    const handleMouseDown = () => {
      isDragging.current = true
      dragStartTransforms.current = new Map()

      if (multiSelectMode) {
        for (const id of selectedImageIds) {
          const obj = findObjectById(id)
          if (obj) {
            dragStartTransforms.current.set(id, {
              position: obj.position.clone(),
              rotation: obj.rotation.clone(),
              scale: obj.scale.clone(),
            })
          }
        }
      }
    }

    const handleMouseUp = () => {
      isDragging.current = false

      // Report transforms for all affected objects
      if (multiSelectMode && selectedImageIds.size > 0) {
        for (const id of selectedImageIds) {
          const obj = findObjectById(id)
          if (obj) reportTransform(obj, id)
        }
      } else {
        reportTransform(targetObject, selectedImageId)
      }

      // Update orbit target
      if (orbitRef.current && targetObject) {
        const pos = new THREE.Vector3()
        targetObject.getWorldPosition(pos)
        orbitRef.current.target.copy(pos)
        orbitRef.current.update()
      }

      dragStartTransforms.current = new Map()
    }

    ctrl.addEventListener('mouseDown', handleMouseDown)
    ctrl.addEventListener('mouseUp', handleMouseUp)
    return () => {
      ctrl.removeEventListener('mouseDown', handleMouseDown)
      ctrl.removeEventListener('mouseUp', handleMouseUp)
    }
  }, [targetObject, selectedImageId, selectedImageIds, multiSelectMode, onTransformUpdate, findObjectById, reportTransform])

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

const EXIT_RADIUS_MULTIPLIER = 1.5

function ProximityDetector({
  acceptedImages,
  characterIds,
  characterRadii,
  onCharacterProximity,
  disabled,
}: {
  acceptedImages: AcceptedImage[]
  characterIds: Set<number>
  characterRadii: Map<number, number>
  onCharacterProximity: (characterId: number | null) => void
  disabled: boolean
}) {
  const { camera, scene } = useThree()
  const currentCharRef = useRef<number | null>(null)
  // Track which character the player must fully exit before re-triggering
  const cooldownCharRef = useRef<number | null>(null)
  const prevDisabledRef = useRef(disabled)
  const onCharacterProximityRef = useRef(onCharacterProximity)
  onCharacterProximityRef.current = onCharacterProximity

  useFrame(() => {
    // When transitioning from disabled (dialog active) back to enabled,
    // set cooldown so dialog doesn't immediately re-trigger
    if (prevDisabledRef.current && !disabled && currentCharRef.current !== null) {
      cooldownCharRef.current = currentCharRef.current
      currentCharRef.current = null
    }
    prevDisabledRef.current = disabled

    if (disabled) return

    const playerPos = camera.position

    // If we have a cooldown character, check if player has left the exit radius
    if (cooldownCharRef.current !== null) {
      let stillInExit = false
      const cooldownId = cooldownCharRef.current
      scene.traverse((obj) => {
        if (obj.userData.imageId === cooldownId) {
          const objPos = new THREE.Vector3()
          obj.getWorldPosition(objPos)
          const dx = playerPos.x - objPos.x
          const dz = playerPos.z - objPos.z
          const dist = Math.sqrt(dx * dx + dz * dz)
          const exitRadius = (characterRadii.get(cooldownId) ?? 5) * EXIT_RADIUS_MULTIPLIER
          if (dist <= exitRadius) stillInExit = true
        }
      })
      if (stillInExit) return
      // Player has left the exit radius — clear cooldown
      cooldownCharRef.current = null
    }

    let closestId: number | null = null
    let closestDist = Infinity

    // Check distance to each character (entry radius)
    for (const img of acceptedImages) {
      if (!characterIds.has(img.id)) continue
      let objPos: THREE.Vector3 | null = null
      scene.traverse((obj) => {
        if (obj.userData.imageId === img.id) {
          objPos = new THREE.Vector3()
          obj.getWorldPosition(objPos)
        }
      })
      if (!objPos) continue

      const dx = playerPos.x - (objPos as THREE.Vector3).x
      const dz = playerPos.z - (objPos as THREE.Vector3).z
      const dist = Math.sqrt(dx * dx + dz * dz)
      const radius = characterRadii.get(img.id) ?? 5

      if (dist <= radius && dist < closestDist) {
        closestDist = dist
        closestId = img.id
      }
    }

    if (closestId !== currentCharRef.current) {
      // If we're leaving a character, set it as the cooldown target
      if (currentCharRef.current !== null && closestId === null) {
        cooldownCharRef.current = currentCharRef.current
      }
      currentCharRef.current = closestId
      onCharacterProximityRef.current(closestId)
    }
  })

  return null
}

// Exposes the camera state getter via a ref from App
function CameraStateExposer({ getCameraStateRef }: {
  getCameraStateRef: React.MutableRefObject<(() => { position: [number, number, number]; quaternion: [number, number, number, number] }) | null>
}) {
  const { camera } = useThree()

  useEffect(() => {
    getCameraStateRef.current = () => ({
      position: [camera.position.x, camera.position.y, camera.position.z],
      quaternion: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w],
    })
    return () => { getCameraStateRef.current = null }
  }, [camera, getCameraStateRef])

  return null
}

function DebugInfoUpdater({ debugRef }: {
  debugRef: React.MutableRefObject<{ x: number; y: number; z: number; fps: number }>
}) {
  const { camera } = useThree()
  const frames = useRef(0)
  const lastTime = useRef(performance.now())

  useFrame(() => {
    debugRef.current.x = camera.position.x
    debugRef.current.y = camera.position.y
    debugRef.current.z = camera.position.z
    frames.current++
    const now = performance.now()
    if (now - lastTime.current >= 500) {
      debugRef.current.fps = Math.round(frames.current / ((now - lastTime.current) / 1000))
      frames.current = 0
      lastTime.current = now
    }
  })

  return null
}

// LERPs the camera between dialog camera positions
function DialogCameraController({ target, dialogActive }: {
  target: { camPos: [number, number, number] | null; camQuat: [number, number, number, number] | null } | null
  dialogActive: boolean
}) {
  const { camera } = useThree()
  const savedCamState = useRef<{ position: THREE.Vector3; quaternion: THREE.Quaternion } | null>(null)
  const targetPos = useRef(new THREE.Vector3())
  const targetQuat = useRef(new THREE.Quaternion())
  const hasTarget = useRef(false)
  const prevDialogActive = useRef(false)

  // Save camera when dialog starts, restore when it ends
  useEffect(() => {
    if (dialogActive && !prevDialogActive.current) {
      savedCamState.current = {
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
      }
    } else if (!dialogActive && prevDialogActive.current && savedCamState.current) {
      // Restore camera
      camera.position.copy(savedCamState.current.position)
      camera.quaternion.copy(savedCamState.current.quaternion)
      savedCamState.current = null
      hasTarget.current = false
    }
    prevDialogActive.current = dialogActive
  }, [dialogActive, camera])

  // Update target when dialog index changes
  useEffect(() => {
    if (!dialogActive || !target) {
      hasTarget.current = false
      return
    }
    if (target.camPos && target.camQuat) {
      targetPos.current.set(target.camPos[0], target.camPos[1], target.camPos[2])
      targetQuat.current.set(target.camQuat[0], target.camQuat[1], target.camQuat[2], target.camQuat[3])
      hasTarget.current = true
    } else {
      hasTarget.current = false
    }
  }, [target, dialogActive])

  // Smoothly LERP camera each frame
  useFrame(() => {
    if (!dialogActive || !hasTarget.current) return

    const lerpSpeed = 0.04
    camera.position.lerp(targetPos.current, lerpSpeed)
    camera.quaternion.slerp(targetQuat.current, lerpSpeed)
  })

  return null
}

function MultiSelectClickHandler({ onToggle }: { onToggle: (id: number) => void }) {
  const { camera, scene, gl } = useThree()
  const raycasterRef = useRef(new THREE.Raycaster())
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null)
  const onToggleRef = useRef(onToggle)
  onToggleRef.current = onToggle

  useEffect(() => {
    const canvas = gl.domElement

    const onMouseDown = (e: MouseEvent) => {
      mouseDownPos.current = { x: e.clientX, y: e.clientY }
    }

    const onMouseUp = (e: MouseEvent) => {
      if (!mouseDownPos.current) return
      const dx = e.clientX - mouseDownPos.current.x
      const dy = e.clientY - mouseDownPos.current.y
      mouseDownPos.current = null

      // Only count as click if mouse barely moved
      if (Math.sqrt(dx * dx + dy * dy) > 5) return

      const rect = canvas.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1

      raycasterRef.current.setFromCamera(new THREE.Vector2(x, y), camera)
      const intersects = raycasterRef.current.intersectObjects(scene.children, true)

      for (const hit of intersects) {
        let obj: THREE.Object3D | null = hit.object
        while (obj) {
          if (obj.userData.imageId != null) {
            onToggleRef.current(obj.userData.imageId as number)
            return
          }
          obj = obj.parent
        }
      }
    }

    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('mouseup', onMouseUp)
    return () => {
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mouseup', onMouseUp)
    }
  }, [camera, scene, gl])

  return null
}

interface ThreeSceneProps {
  panelOpen: boolean
  acceptedImages: AcceptedImage[]
  selectionMode: boolean
  selectedImageId: number | null
  selectedImageIds: Set<number>
  multiSelectMode: boolean
  onMultiSelectToggle: (id: number) => void
  onHoldStart: (id: number) => void
  onHoldEnd: () => void
  transformMode: 'translate' | 'rotate' | 'scale'
  onTransformUpdate: (id: number, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => void
  snapToGroundTrigger: number
  snapRotationTrigger: { rotation: [number, number, number]; counter: number; delta?: boolean }
  billboardIds: Set<number>
  characterIds: Set<number>
  characterRadii: Map<number, number>
  speakingImageIds: Map<number, string>
  speakingCharacterId: number | null
  onCharacterProximity: (characterId: number | null) => void
  dialogActive: boolean
  getCameraStateRef: React.MutableRefObject<(() => { position: [number, number, number]; quaternion: [number, number, number, number] }) | null>
  dialogCameraTarget: { camPos: [number, number, number] | null; camQuat: [number, number, number, number] | null } | null
  onTextureLoaded?: () => void
  mobileMove?: React.RefObject<{ x: number; y: number }>
  isMobile?: boolean
  onMobileTapSelect?: (id: number) => void
  debugRef?: React.MutableRefObject<{ x: number; y: number; z: number; fps: number }>
}

export default function ThreeScene({
  panelOpen,
  acceptedImages,
  selectionMode,
  selectedImageId,
  selectedImageIds,
  multiSelectMode,
  onMultiSelectToggle,
  onHoldStart,
  onHoldEnd,
  transformMode,
  onTransformUpdate,
  snapToGroundTrigger,
  snapRotationTrigger,
  billboardIds,
  characterIds,
  characterRadii,
  speakingImageIds,
  speakingCharacterId,
  onCharacterProximity,
  dialogActive,
  getCameraStateRef,
  dialogCameraTarget,
  onTextureLoaded,
  mobileMove,
  isMobile,
  onMobileTapSelect,
  debugRef,
}: ThreeSceneProps) {
  return (
    <Canvas
      shadows
      camera={{ position: [0, PLAYER_HEIGHT, 5], fov: 60, rotation: [-0.15, 0, 0] }}
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 0 }}
    >
      <Environment files="/sky.hdr" background environmentIntensity={0.08} backgroundIntensity={0.25} />
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[-72, 15, 48]}
        intensity={1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={30}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />
      <pointLight position={[10, 10, 10]} />
      <JsonControls disabled={panelOpen || selectionMode} isMobile={isMobile} />
      <FirstPersonMovement disabled={panelOpen || selectionMode || dialogActive} mobileMove={mobileMove} />
      {isMobile && <TouchLookControls disabled={panelOpen || selectionMode || dialogActive} />}
      <CameraStateSaver selectionMode={selectionMode} />
      <CameraStateExposer getCameraStateRef={getCameraStateRef} />
      {debugRef && <DebugInfoUpdater debugRef={debugRef} />}
      <DialogCameraController target={dialogCameraTarget} dialogActive={dialogActive} />
      <HoldToSelect disabled={selectionMode || dialogActive || !!isMobile} onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} />
      {isMobile && onMobileTapSelect && (
        <MobileTapSelect disabled={selectionMode || dialogActive || panelOpen} onSelect={onMobileTapSelect} />
      )}
      <ProximityDetector
        acceptedImages={acceptedImages}
        characterIds={characterIds}
        characterRadii={characterRadii}
        onCharacterProximity={onCharacterProximity}
        disabled={selectionMode || panelOpen || dialogActive}
      />
      {selectionMode && multiSelectMode && (
        <MultiSelectClickHandler onToggle={onMultiSelectToggle} />
      )}
      {selectionMode && (
        <SelectionModeControls
          selectedImageId={selectedImageId}
          selectedImageIds={selectedImageIds}
          multiSelectMode={multiSelectMode}
          transformMode={transformMode}
          onTransformUpdate={onTransformUpdate}
          snapToGroundTrigger={snapToGroundTrigger}
          snapRotationTrigger={snapRotationTrigger}
        />
      )}
      {acceptedImages.map((img) => {
        const speakingImgId = speakingImageIds.get(img.id)
        return (
          <ImagePlane
            key={img.id}
            id={img.id}
            url={img.url}
            selected={selectedImageId === img.id || selectedImageIds.has(img.id)}
            savedPosition={img.position}
            savedRotation={img.rotation}
            savedScale={img.scale}
            onTransformUpdate={onTransformUpdate}
            billboard={billboardIds.has(img.id)}
            character={characterIds.has(img.id)}
            speakingImageUrl={speakingImgId ? `/images/${speakingImgId}.webp` : null}
            isSpeaking={speakingCharacterId === img.id}
            onTextureLoaded={onTextureLoaded}
          />
        )
      })}
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
      <mesh position={[-82, 2, 38]} castShadow>
        <sphereGeometry args={[1.5, 32, 32]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <shadowMaterial opacity={0.3} />
      </mesh>
    </Canvas>
  )
}
