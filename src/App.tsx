import { useState, useEffect, useCallback, useRef } from 'react'
import ThreeScene from './ThreeScene'
import './App.css'

interface DialogTextHandle {
  isFinished: () => boolean
  skipToEnd: () => void
}

function DialogText({ text, handleRef, onStreamingChange }: { text: string; handleRef: React.MutableRefObject<DialogTextHandle | null>; onStreamingChange?: (streaming: boolean) => void }) {
  const colonIdx = text.indexOf(':')
  const firstWord = colonIdx === -1 ? '' : text.slice(0, colonIdx + 1)
  const rest = colonIdx === -1 ? text : text.slice(colonIdx + 1)
  const [charCount, setCharCount] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setCharCount(0)
    onStreamingChange?.(!!rest)
    if (!rest) return
    let i = 0
    intervalRef.current = setInterval(() => {
      i++
      setCharCount(i)
      if (i >= rest.length) {
        if (intervalRef.current) clearInterval(intervalRef.current)
        intervalRef.current = null
        onStreamingChange?.(false)
      }
    }, 30)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [text])

  handleRef.current = {
    isFinished: () => !rest || charCount >= rest.length,
    skipToEnd: () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
      setCharCount(rest.length)
      onStreamingChange?.(false)
    },
  }

  return <><strong>{firstWord}</strong>{rest.slice(0, charCount)}</>
}

interface ImageRecord {
  id: string;
  prompt: string;
  created_at: string;
}

interface DialogEntry {
  id?: number;
  text: string;
  camPos?: [number, number, number] | null;
  camQuat?: [number, number, number, number] | null;
}

interface AcceptedImage {
  id: number;
  imageId: string;
  url: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  billboard?: boolean;
  character?: boolean;
  radius?: number;
  speakingImageId?: string | null;
  dialogEndSound?: string | null;
}

const HOLD_DURATION = 2000
const HOLD_DELAY = 750
const IS_MOBILE = window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 1024

function VirtualJoystick({ moveRef }: { moveRef: React.MutableRefObject<{ x: number; y: number }> }) {
  const stickRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLDivElement>(null)
  const touchIdRef = useRef<number | null>(null)
  const centerRef = useRef({ x: 0, y: 0 })
  const RADIUS = 40

  const updatePosition = (clientX: number, clientY: number) => {
    let dx = clientX - centerRef.current.x
    let dy = clientY - centerRef.current.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist > RADIUS) {
      dx = (dx / dist) * RADIUS
      dy = (dy / dist) * RADIUS
    }
    moveRef.current = { x: dx / RADIUS, y: dy / RADIUS }
    if (stickRef.current) {
      stickRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
    }
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (touchIdRef.current !== null) return
    const touch = e.changedTouches[0]
    touchIdRef.current = touch.identifier
    const rect = baseRef.current!.getBoundingClientRect()
    centerRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    updatePosition(touch.clientX, touch.clientY)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]
      if (touch.identifier === touchIdRef.current) {
        updatePosition(touch.clientX, touch.clientY)
        break
      }
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchIdRef.current) {
        touchIdRef.current = null
        moveRef.current = { x: 0, y: 0 }
        if (stickRef.current) {
          stickRef.current.style.transform = 'translate(-50%, -50%)'
        }
        break
      }
    }
  }

  return (
    <div
      ref={baseRef}
      className="virtual-joystick"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div ref={stickRef} className="virtual-joystick-stick" />
    </div>
  )
}

function App() {
  const [prompt, setPrompt] = useState('Grafiti of a banana')
  const [useMagentaScreen, setUseMagentaScreen] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gallery, setGallery] = useState<ImageRecord[]>([])
  const [panelOpen, setPanelOpen] = useState(false)
  const [acceptedImages, setAcceptedImages] = useState<AcceptedImage[]>([])
  const [selectedImageId, setSelectedImageId] = useState<number | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | 'scale'>('translate')
  const [snapToGroundTrigger, setSnapToGroundTrigger] = useState(0)
  const [snapRotationTrigger, setSnapRotationTrigger] = useState<{ rotation: [number, number, number]; counter: number; delta?: boolean }>({ rotation: [0, 0, 0], counter: 0 })
  const [billboardIds, setBillboardIds] = useState<Set<number>>(new Set())
  const [characterIds, setCharacterIds] = useState<Set<number>>(new Set())
  const [gallerySearch, setGallerySearch] = useState('')
  const [referenceImages, setReferenceImages] = useState<{ file: File; preview: string }[]>([])
  const refImageInputRef = useRef<HTMLInputElement>(null)
  const [dialogEntries, setDialogEntries] = useState<DialogEntry[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [characterRadii, setCharacterRadii] = useState<Map<number, number>>(new Map())
  const [speakingImageIds, setSpeakingImageIds] = useState<Map<number, string>>(new Map())
  const [dialogEndSounds, setDialogEndSounds] = useState<Map<number, string>>(new Map())
  const [availableSounds, setAvailableSounds] = useState<string[]>([])
  const [speakingGalleryOpen, setSpeakingGalleryOpen] = useState(false)
  const [speakingGallerySearch, setSpeakingGallerySearch] = useState('')
  const [swapGalleryOpen, setSwapGalleryOpen] = useState(false)
  const [swapGallerySearch, setSwapGallerySearch] = useState('')
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedImageIds, setSelectedImageIds] = useState<Set<number>>(new Set())
  // Dialog playback state (triggered by proximity)
  const [activeDialog, setActiveDialog] = useState<DialogEntry[]>([])
  const [activeDialogIndex, setActiveDialogIndex] = useState(0)
  const [activeDialogCharId, setActiveDialogCharId] = useState<number | null>(null)

  // Scene loading state
  const [sceneLoadingFadeOut, setSceneLoadingFadeOut] = useState(false)
  const sceneObjectCount = useRef(0)
  const texturesLoadedCount = useRef(0)

  // Click-to-start state (shown after loading, dismissed on first interaction)
  const [hasInteracted, setHasInteracted] = useState(false)

  // Ref to get camera state from ThreeScene
  const getCameraStateRef = useRef<(() => { position: [number, number, number]; quaternion: [number, number, number, number] }) | null>(null)

  // Debug mode
  const [debugMode, setDebugMode] = useState(false)
  const debugRef = useRef({ x: 0, y: 0, z: 0, fps: 0 })
  const [debugDisplay, setDebugDisplay] = useState({ x: 0, y: 0, z: 0, fps: 0 })

  // Pause state (triggered when pointer lock is released via Esc)
  const [paused, setPaused] = useState(false)

  // Mobile controls
  const mobileMove = useRef({ x: 0, y: 0 })

  // Hold-to-select state
  const [holdTarget, setHoldTarget] = useState<number | null>(null)
  const [holdProgress, setHoldProgress] = useState(0)
  const [holdVisible, setHoldVisible] = useState(false)
  const holdStartTime = useRef(0)

  // Track latest transforms reported by ThreeScene
  const latestTransforms = useRef(new Map<number, { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }>())

  const handleTransformUpdate = useCallback((id: number, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => {
    latestTransforms.current.set(id, { position, rotation, scale })
  }, [])

  const handleTextureLoaded = useCallback(() => {
    texturesLoadedCount.current++
    if (texturesLoadedCount.current >= sceneObjectCount.current) {
      setSceneLoadingFadeOut(true)
    }
  }, [])

  const handleMultiSelectToggle = useCallback((id: number) => {
    setSelectedImageIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        // If we removed the primary, pick a new one
        if (id === selectedImageId && next.size > 0) {
          setSelectedImageId(next.values().next().value!)
        }
      } else {
        next.add(id)
      }
      return next
    })
  }, [selectedImageId])


  // Load scene objects on mount
  // Debug mode toggle on semicolon key
  useEffect(() => {
    const handleDebugKey = (e: KeyboardEvent) => {
      if (e.key === ';') setDebugMode(prev => !prev)
    }
    window.addEventListener('keydown', handleDebugKey)
    return () => window.removeEventListener('keydown', handleDebugKey)
  }, [])

  // Update debug display from ref at interval
  useEffect(() => {
    if (!debugMode) return
    const interval = setInterval(() => {
      setDebugDisplay({ ...debugRef.current })
    }, 200)
    return () => clearInterval(interval)
  }, [debugMode])

  // Dismiss "Click to start" on first pointer lock (desktop) or touch (mobile)
  useEffect(() => {
    if (hasInteracted) return
    if (IS_MOBILE) {
      const onTouch = () => setHasInteracted(true)
      document.addEventListener('touchstart', onTouch, { once: true })
      return () => document.removeEventListener('touchstart', onTouch)
    } else {
      const onLock = () => {
        if (document.pointerLockElement) setHasInteracted(true)
      }
      document.addEventListener('pointerlockchange', onLock)
      return () => document.removeEventListener('pointerlockchange', onLock)
    }
  }, [hasInteracted])

  // Detect pointer lock release to show pause menu (desktop only)
  useEffect(() => {
    if (IS_MOBILE) return
    const onPointerLockChange = () => {
      if (!document.pointerLockElement) {
        // Only pause if we're in normal gameplay (not panel/selection open)
        setPaused(true)
      } else {
        setPaused(false)
      }
    }
    document.addEventListener('pointerlockchange', onPointerLockChange)
    return () => document.removeEventListener('pointerlockchange', onPointerLockChange)
  }, [])

  const handleResume = useCallback(() => {
    const canvas = document.querySelector('canvas')
    if (canvas) canvas.requestPointerLock()
  }, [])

  useEffect(() => {
    // Safety timeout: dismiss loading screen after 15s no matter what
    const safetyTimeout = setTimeout(() => {
      setSceneLoadingFadeOut(true)
    }, 15000);

    (async () => {
      try {
        const res = await fetch('/api/scene-objects')
        if (res.ok) {
          const data = await res.json()
          sceneObjectCount.current = data.length
          texturesLoadedCount.current = 0
          if (data.length === 0) {
            setSceneLoadingFadeOut(true)
          }
          setAcceptedImages(data)
          setBillboardIds(new Set(data.filter((d: AcceptedImage) => d.billboard).map((d: AcceptedImage) => d.id)))
          setCharacterIds(new Set(data.filter((d: AcceptedImage) => d.character).map((d: AcceptedImage) => d.id)))
          const radii = new Map<number, number>()
          data.forEach((d: AcceptedImage) => { if (d.character && d.radius != null) radii.set(d.id, d.radius) })
          setCharacterRadii(radii)
          const speaking = new Map<number, string>()
          data.forEach((d: AcceptedImage) => { if (d.speakingImageId) speaking.set(d.id, d.speakingImageId) })
          setSpeakingImageIds(speaking)
          const endSounds = new Map<number, string>()
          data.forEach((d: AcceptedImage) => { if (d.dialogEndSound) endSounds.set(d.id, d.dialogEndSound) })
          setDialogEndSounds(endSounds)
        } else {
          setSceneLoadingFadeOut(true)
        }
      } catch (err) {
        console.error('Failed to load scene objects', err)
        setSceneLoadingFadeOut(true)
      }
    })()

    return () => clearTimeout(safetyTimeout)
  }, [])

  useEffect(() => {
    fetch('/api/sounds').then(r => r.ok ? r.json() : []).then(setAvailableSounds).catch(() => {})
  }, [])

  const handleAccept = async () => {
    if (imageUrl) {
      // Extract imageId from URL like /images/<uuid>.webp
      const match = imageUrl.match(/\/images\/(.+)\.webp$/)
      if (!match) return
      const imageId = match[1]
      try {
        // Compute spawn position in front of the player
        let spawnPosition: [number, number, number] | undefined
        const camState = getCameraStateRef.current?.()
        if (camState) {
          const [cx, , cz] = camState.position
          const [qx, qy, qz, qw] = camState.quaternion
          // Camera forward = -Z column of rotation matrix from quaternion
          const fx = -2 * (qx * qz + qw * qy)
          const fz = -(1 - 2 * (qx * qx + qy * qy))
          // Flatten to XZ plane and normalize
          const len = Math.sqrt(fx * fx + fz * fz) || 1
          spawnPosition = [cx + (fx / len) * 4, 0, cz + (fz / len) * 4]
        }

        const res = await fetch('/api/scene-objects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageId }),
        })
        const { id } = await res.json()
        setAcceptedImages(prev => [...prev, { id, imageId, url: imageUrl, position: spawnPosition }])
        setPanelOpen(false)
        setSelectedImageId(id)
        setSelectionMode(true)
        setTransformMode('translate')
      } catch (err) {
        console.error('Failed to create scene object', err)
      }
    }
  }

  const handleHoldStart = useCallback((id: number) => {
    setHoldTarget(id)
    holdStartTime.current = performance.now()
  }, [])

  const handleHoldEnd = useCallback(() => {
    setHoldTarget(null)
    setHoldProgress(0)
  }, [])

  const handleMobileTapSelect = useCallback((id: number) => {
    setSelectedImageId(id)
    setSelectionMode(true)
    setTransformMode('translate')
  }, [])

  // Animate hold progress and trigger selection mode at completion
  useEffect(() => {
    if (holdTarget === null) {
      setHoldVisible(false)
      return
    }

    setHoldProgress(0)

    const showTimeout = setTimeout(() => setHoldVisible(true), 150)

    let animFrame: number
    const totalDuration = HOLD_DELAY + HOLD_DURATION
    const animate = () => {
      const elapsed = performance.now() - holdStartTime.current
      const progress = Math.min(elapsed / totalDuration, 1)
      setHoldProgress(progress)

      if (progress >= 1) {
        setSelectedImageId(holdTarget)
        setSelectionMode(true)
        setTransformMode('translate')
        setHoldTarget(null)
        setHoldProgress(0)
        setHoldVisible(false)
        return
      }

      animFrame = requestAnimationFrame(animate)
    }
    animFrame = requestAnimationFrame(animate)

    return () => {
      clearTimeout(showTimeout)
      cancelAnimationFrame(animFrame)
    }
  }, [holdTarget])

  const loadDialog = useCallback(async (objectId: number) => {
    try {
      const res = await fetch(`/api/scene-objects/${objectId}/dialog`)
      if (res.ok) {
        const data = await res.json()
        setDialogEntries(data.length > 0 ? data : [{ text: '' }])
      }
    } catch (err) {
      console.error('Failed to load dialog', err)
      setDialogEntries([{ text: '' }])
    }
  }, [])

  const saveDialog = useCallback(async (objectId: number, entries: DialogEntry[]) => {
    try {
      await fetch(`/api/scene-objects/${objectId}/dialog`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      })
    } catch (err) {
      console.error('Failed to save dialog', err)
    }
  }, [])

  const handleAcceptPlacement = useCallback(async () => {
    const idsToSave = multiSelectMode && selectedImageIds.size > 0
      ? Array.from(selectedImageIds)
      : (selectedImageId != null ? [selectedImageId] : [])

    for (const id of idsToSave) {
      const t = latestTransforms.current.get(id)
      if (t) {
        try {
          const currentObj = acceptedImages.find(img => img.id === id)
          await fetch(`/api/scene-objects/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageId: currentObj?.imageId,
              positionX: t.position[0], positionY: t.position[1], positionZ: t.position[2],
              rotationX: t.rotation[0], rotationY: t.rotation[1], rotationZ: t.rotation[2],
              scaleX: t.scale[0], scaleY: t.scale[1], scaleZ: t.scale[2],
              billboard: billboardIds.has(id),
              character: characterIds.has(id),
              radius: characterRadii.get(id) ?? 5,
              speakingImageId: speakingImageIds.get(id) ?? null,
              dialogEndSound: dialogEndSounds.get(id) ?? null,
            }),
          })
        } catch (err) {
          console.error('Failed to save transform', err)
        }
      }
    }

    // Save dialog for single-select character
    if (!multiSelectMode && selectedImageId != null && characterIds.has(selectedImageId) && dialogEntries.length > 0) {
      await saveDialog(selectedImageId, dialogEntries)
    }

    // Update local state for all saved objects
    setAcceptedImages(prev => prev.map(img => {
      const t = latestTransforms.current.get(img.id)
      if (idsToSave.includes(img.id) && t) {
        return { ...img, position: t.position, rotation: t.rotation, scale: t.scale, billboard: billboardIds.has(img.id), character: characterIds.has(img.id), radius: characterRadii.get(img.id) ?? 5, speakingImageId: speakingImageIds.get(img.id) ?? null, dialogEndSound: dialogEndSounds.get(img.id) ?? null }
      }
      return img
    }))

    setSelectionMode(false)
    setSelectedImageId(null)
    setMultiSelectMode(false)
    setSelectedImageIds(new Set())
    setDialogOpen(false)
    setDialogEntries([])
    setSpeakingGalleryOpen(false)
    setSwapGalleryOpen(false)
    setSnapToGroundTrigger(0)
    setSnapRotationTrigger({ rotation: [0, 0, 0], counter: 0 })
    requestAnimationFrame(() => {
      const canvas = document.querySelector('canvas')
      if (canvas) canvas.requestPointerLock()
    })
  }, [selectedImageId, selectedImageIds, multiSelectMode, acceptedImages, billboardIds, characterIds, characterRadii, speakingImageIds, dialogEndSounds, dialogEntries, saveDialog])

  const handleDuplicateObject = useCallback(async () => {
    const idsToDuplicate = multiSelectMode && selectedImageIds.size > 0
      ? Array.from(selectedImageIds)
      : (selectedImageId != null ? [selectedImageId] : [])
    if (idsToDuplicate.length === 0) return

    try {
      // First save all source objects
      for (const id of idsToDuplicate) {
        const t = latestTransforms.current.get(id)
        if (t) {
          await fetch(`/api/scene-objects/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              positionX: t.position[0], positionY: t.position[1], positionZ: t.position[2],
              rotationX: t.rotation[0], rotationY: t.rotation[1], rotationZ: t.rotation[2],
              scaleX: t.scale[0], scaleY: t.scale[1], scaleZ: t.scale[2],
              billboard: billboardIds.has(id),
              character: characterIds.has(id),
              radius: characterRadii.get(id) ?? 5,
              speakingImageId: speakingImageIds.get(id) ?? null,
              dialogEndSound: dialogEndSounds.get(id) ?? null,
            }),
          })
        }
      }

      // Update local state for saved sources
      setAcceptedImages(prev => prev.map(img => {
        const t = latestTransforms.current.get(img.id)
        if (idsToDuplicate.includes(img.id) && t) {
          return { ...img, position: t.position, rotation: t.rotation, scale: t.scale, billboard: billboardIds.has(img.id), character: characterIds.has(img.id) }
        }
        return img
      }))

      // Create duplicates
      const newIds: number[] = []
      const newImages: AcceptedImage[] = []
      for (const id of idsToDuplicate) {
        const source = acceptedImages.find(img => img.id === id)
        if (!source) continue
        const t = latestTransforms.current.get(id)

        const res = await fetch('/api/scene-objects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageId: source.imageId }),
        })
        const { id: newId } = await res.json()

        const srcPos = t?.position ?? source.position ?? [0, 0, 0]
        const srcRot = t?.rotation ?? source.rotation
        const srcScale = t?.scale ?? source.scale ?? [1, 1, 1]
        const newPos: [number, number, number] = [srcPos[0] + 1, srcPos[1], srcPos[2]]

        newIds.push(newId)
        newImages.push({
          id: newId,
          imageId: source.imageId,
          url: source.url,
          position: newPos,
          rotation: srcRot ? [...srcRot] as [number, number, number] : undefined,
          scale: [...srcScale] as [number, number, number],
        })
      }

      setAcceptedImages(prev => [...prev, ...newImages])

      setDialogOpen(false)
      setDialogEntries([])
      setSpeakingGalleryOpen(false)
      setSwapGalleryOpen(false)

      if (multiSelectMode && newIds.length > 1) {
        // Stay in multi-select mode with the new duplicates selected
        setSelectedImageId(newIds[0])
        setSelectedImageIds(new Set(newIds))
        setMultiSelectMode(true)
      } else {
        setSelectedImageId(newIds[0])
        setMultiSelectMode(false)
        setSelectedImageIds(new Set())
      }
      setSelectionMode(true)
      setTransformMode('translate')
    } catch (err) {
      console.error('Failed to duplicate object', err)
    }
  }, [selectedImageId, selectedImageIds, multiSelectMode, acceptedImages, billboardIds, characterIds, characterRadii, speakingImageIds, dialogEndSounds, dialogEntries, saveDialog])

  const handleRemoveObject = useCallback(async () => {
    const idsToRemove = multiSelectMode && selectedImageIds.size > 0
      ? Array.from(selectedImageIds)
      : (selectedImageId != null ? [selectedImageId] : [])
    if (idsToRemove.length === 0) return

    try {
      for (const id of idsToRemove) {
        await fetch(`/api/scene-objects/${id}`, { method: 'DELETE' })
      }
      const removeSet = new Set(idsToRemove)
      setAcceptedImages(prev => prev.filter(img => !removeSet.has(img.id)))
      setBillboardIds(prev => {
        const next = new Set(prev)
        for (const id of idsToRemove) next.delete(id)
        return next
      })
      setCharacterIds(prev => {
        const next = new Set(prev)
        for (const id of idsToRemove) next.delete(id)
        return next
      })
    } catch (err) {
      console.error('Failed to remove object', err)
    }
    setSelectionMode(false)
    setSelectedImageId(null)
    setMultiSelectMode(false)
    setSelectedImageIds(new Set())
    setSnapToGroundTrigger(0)
    setSnapRotationTrigger({ rotation: [0, 0, 0], counter: 0 })
    requestAnimationFrame(() => {
      const canvas = document.querySelector('canvas')
      if (canvas) canvas.requestPointerLock()
    })
  }, [selectedImageId, selectedImageIds, multiSelectMode])

  const togglePanel = useCallback(() => {
    setPanelOpen(prev => {
      if (prev) {
        // Closing panel — re-acquire pointer lock for first person controls
        requestAnimationFrame(() => {
          const canvas = document.querySelector('canvas')
          if (canvas) canvas.requestPointerLock()
        })
      }
      return !prev
    })
  }, [])

  const activeDialogCharIdRef = useRef<number | null>(null)
  const dialogTextRef = useRef<DialogTextHandle | null>(null)
  const activeDialogRef = useRef<DialogEntry[]>([])
  const dialogEndAudioRef = useRef<HTMLAudioElement | null>(null)
  const [dialogStreaming, setDialogStreaming] = useState(false)

  const handleCharacterProximity = useCallback(async (characterId: number | null) => {
    if (characterId === null) {
      // Left radius — dismiss dialog
      activeDialogCharIdRef.current = null
      activeDialogRef.current = []
      setActiveDialog([])
      setActiveDialogIndex(0)
      setActiveDialogCharId(null)
      return
    }
    // Stop any playing end-dialog sound
    if (dialogEndAudioRef.current) {
      dialogEndAudioRef.current.pause()
      dialogEndAudioRef.current = null
    }
    // Already showing dialog for this character
    if (characterId === activeDialogCharIdRef.current) return
    // Mark immediately so the next frame doesn't re-trigger
    activeDialogCharIdRef.current = characterId
    // Fetch dialog for this character
    try {
      const res = await fetch(`/api/scene-objects/${characterId}/dialog`)
      if (res.ok) {
        const data: DialogEntry[] = await res.json()
        const entries = data.filter(d => d.text.trim().length > 0)
        if (entries.length > 0) {
          activeDialogRef.current = entries
          setActiveDialog(entries)
          setActiveDialogIndex(0)
          setActiveDialogCharId(characterId)
        }
      }
    } catch (err) {
      console.error('Failed to load character dialog', err)
    }
  }, [])

  const advanceDialog = useCallback(() => {
    if (activeDialogRef.current.length === 0) return
    setActiveDialogIndex(prev => {
      if (prev < activeDialogRef.current.length - 1) {
        return prev + 1
      } else {
        // End of dialog — play end sound if configured
        const charId = activeDialogCharIdRef.current
        if (charId != null) {
          const sound = dialogEndSounds.get(charId)
          if (sound) {
            const audio = new Audio(`/${sound}`)
            audio.volume = 0.2
            audio.addEventListener('ended', () => { dialogEndAudioRef.current = null })
            dialogEndAudioRef.current = audio
            audio.play().catch(() => {})
          }
        }
        activeDialogRef.current = []
        activeDialogCharIdRef.current = null
        setActiveDialog([])
        setActiveDialogCharId(null)
        return 0
      }
    })
  }, [dialogEndSounds])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return

      // Dialog playback: space advances or skips typewriter
      if (activeDialog.length > 0) {
        if (e.code === 'Space') {
          e.preventDefault()
          if (dialogTextRef.current && !dialogTextRef.current.isFinished()) {
            dialogTextRef.current.skipToEnd()
          } else {
            advanceDialog()
          }
        }
        return
      }

      if (selectionMode) {
        if (e.code === 'KeyG') setTransformMode('translate')
        if (e.code === 'KeyR') setTransformMode('rotate')
        if (e.code === 'KeyT') setTransformMode('scale')
        if (e.code === 'Enter' || e.code === 'Escape') handleAcceptPlacement()
        if (e.code === 'Delete') handleRemoveObject()
        return
      }

      if (e.code === 'KeyE') {
        togglePanel()
      }
    }

    const onClick = () => {
      if (activeDialog.length > 0) {
        if (dialogTextRef.current && !dialogTextRef.current.isFinished()) {
          dialogTextRef.current.skipToEnd()
        } else {
          advanceDialog()
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('click', onClick)
    }
  }, [togglePanel, selectionMode, handleAcceptPlacement, handleRemoveObject, activeDialog, advanceDialog])

  const fetchGallery = async () => {
    try {
      const res = await fetch('/api/images')
      if (res.ok) {
        const data = await res.json()
        setGallery(data)
      }
    } catch (err) {
      console.error('Failed to fetch gallery', err)
    }
  }

  useEffect(() => {
    fetchGallery()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setImageUrl(null)

    try {
      // Convert reference images to base64
      const refImagesBase64: { mimeType: string; data: string }[] = []
      for (const ref of referenceImages) {
        const arrayBuffer = await ref.file.arrayBuffer()
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        )
        refImagesBase64.push({ mimeType: ref.file.type, data: base64 })
      }

      const response = await fetch('/api/generate-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, referenceImages: refImagesBase64, useMagentaScreen }),
      })

      if (!response.ok) {
        throw new Error('Failed to generate image')
      }

      const data = await response.json()
      if (data.image) {
        setImageUrl(data.image)
        fetchGallery()
      } else if (data.error) {
        throw new Error(data.error)
      } else {
        throw new Error('Unknown error occurred')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate image')
    } finally {
      setLoading(false)
    }
  }

  // SVG circle circumference for r=18
  const circumference = 2 * Math.PI * 18

  return (
    <>
      <div className={`scene-loading-overlay${sceneLoadingFadeOut ? ' fade-out' : ''}`}>
        <div className="scene-loading-content">
          <img src="/images/9092c16a-dbe1-44a3-a903-4dd9f714da86.webp" alt="" className="scene-loading-logo" />
          <div className="scene-loading-bar-container">
            <div className={`scene-loading-bar${sceneLoadingFadeOut ? ' complete' : ''}`} />
          </div>
          <div className="scene-loading-title">Banana City</div>
          <div className="scene-loading-subtitle">Hank's Creative Artifact</div>
        </div>
      </div>
      {sceneLoadingFadeOut && !hasInteracted && (
        <div className="click-to-start-overlay">
          <div className="click-to-start-text">
            {IS_MOBILE ? 'Tap to start' : 'Click to start'}
          </div>
        </div>
      )}
      {!selectionMode && (
        <div className="crosshair-container">
          <div className="crosshair" />
          {holdTarget !== null && holdVisible && (
            <svg className="hold-ring" viewBox="0 0 44 44">
              <circle
                cx="22" cy="22" r="18"
                fill="none"
                stroke="rgba(255, 255, 255, 0.3)"
                strokeWidth="3"
              />
              <circle
                cx="22" cy="22" r="18"
                fill="none"
                stroke="#ffffff"
                strokeWidth="3"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - holdProgress)}
                strokeLinecap="round"
                transform="rotate(-90 22 22)"
              />
            </svg>
          )}
        </div>
      )}
      <ThreeScene
        panelOpen={panelOpen}
        acceptedImages={acceptedImages}
        selectionMode={selectionMode}
        selectedImageId={selectedImageId}
        selectedImageIds={selectedImageIds}
        multiSelectMode={multiSelectMode}
        onMultiSelectToggle={handleMultiSelectToggle}
        onHoldStart={handleHoldStart}
        onHoldEnd={handleHoldEnd}
        transformMode={transformMode}
        onTransformUpdate={handleTransformUpdate}
        snapToGroundTrigger={snapToGroundTrigger}
        snapRotationTrigger={snapRotationTrigger}
        billboardIds={billboardIds}
        characterIds={characterIds}
        characterRadii={characterRadii}
        onCharacterProximity={handleCharacterProximity}
        speakingImageIds={speakingImageIds}
        speakingCharacterId={activeDialog.length > 0 && dialogStreaming ? activeDialogCharId : null}
        dialogActive={activeDialog.length > 0}
        getCameraStateRef={getCameraStateRef}
        dialogCameraTarget={activeDialog.length > 0 && activeDialog[activeDialogIndex] ? {
          camPos: activeDialog[activeDialogIndex].camPos || null,
          camQuat: activeDialog[activeDialogIndex].camQuat || null,
        } : null}
        onTextureLoaded={handleTextureLoaded}
        mobileMove={mobileMove}
        isMobile={IS_MOBILE}
        onMobileTapSelect={handleMobileTapSelect}
        debugRef={debugMode ? debugRef : undefined}
      />

      {debugMode && (
        <div className="debug-overlay">
          <div className="debug-overlay-title">Debug</div>
          <div className="debug-overlay-row">
            <span className="debug-overlay-label">FPS</span>
            <span className="debug-overlay-value">{debugDisplay.fps}</span>
          </div>
          <div className="debug-overlay-row">
            <span className="debug-overlay-label">X</span>
            <span className="debug-overlay-value">{debugDisplay.x.toFixed(2)}</span>
          </div>
          <div className="debug-overlay-row">
            <span className="debug-overlay-label">Y</span>
            <span className="debug-overlay-value">{debugDisplay.y.toFixed(2)}</span>
          </div>
          <div className="debug-overlay-row">
            <span className="debug-overlay-label">Z</span>
            <span className="debug-overlay-value">{debugDisplay.z.toFixed(2)}</span>
          </div>
        </div>
      )}

      {panelOpen && (
        <div className="floating-panel">
          <div className="panel-header">
            <h1><span className="panel-header-badge">Image Creator</span></h1>
            <button className="panel-close" onClick={togglePanel}>
              &times;
            </button>
          </div>

          <form onSubmit={handleSubmit} className="panel-form">
            <div className="panel-form-label">Describe your creation</div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Grafiti of a banana"
              rows={4}
            />
            <div className="prompt-char-count">{prompt.length} chars</div>

            <div className="ref-images-section">
              <div className="ref-images-grid">
                {referenceImages.map((ref, i) => (
                  <div key={i} className="ref-image-thumb">
                    <img src={ref.preview} alt={`Reference ${i + 1}`} />
                    <button
                      type="button"
                      className="ref-image-remove"
                      onClick={() => {
                        URL.revokeObjectURL(ref.preview)
                        setReferenceImages(prev => prev.filter((_, idx) => idx !== i))
                      }}
                    >
                      &times;
                    </button>
                  </div>
                ))}
                {referenceImages.length < 3 && (
                  <button
                    type="button"
                    className="ref-image-add"
                    onClick={() => refImageInputRef.current?.click()}
                  >
                    +
                  </button>
                )}
              </div>
              <input
                ref={refImageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = e.target.files
                  if (!files) return
                  const remaining = 3 - referenceImages.length
                  const newFiles = Array.from(files).slice(0, remaining)
                  const newRefs = newFiles.map(file => ({
                    file,
                    preview: URL.createObjectURL(file),
                  }))
                  setReferenceImages(prev => [...prev, ...newRefs])
                  e.target.value = ''
                }}
                multiple
              />
            </div>

            <label className="magenta-toggle">
              <input
                type="checkbox"
                checked={useMagentaScreen}
                onChange={(e) => setUseMagentaScreen(e.target.checked)}
              />
              <span>Magenta screen</span>
              <span className="magenta-toggle-hint">(use for green objects)</span>
            </label>

            <button
              type="submit"
              disabled={loading || !prompt.trim()}
              className="generate-btn"
            >
              <span className="generate-btn-text">{loading ? 'Generating...' : 'Generate'}</span>
            </button>
          </form>

          {error && <div className="panel-error">{error}</div>}

          {loading && (
            <div className="loading-canvas">
              <div className="loading-aurora" />
              <div className="loading-scan" />
              <div className="loading-corner loading-corner-tl" />
              <div className="loading-corner loading-corner-tr" />
              <div className="loading-corner loading-corner-bl" />
              <div className="loading-corner loading-corner-br" />
              <div className="loading-center">
                <div className="loading-ring" />
                <div className="loading-ring loading-ring-inner" />
                <div className="loading-pulse" />
              </div>
              <div className="loading-text">
                Materializing
                <span className="loading-dot" style={{ animationDelay: '0s' }}>.</span>
                <span className="loading-dot" style={{ animationDelay: '0.3s' }}>.</span>
                <span className="loading-dot" style={{ animationDelay: '0.6s' }}>.</span>
              </div>
            </div>
          )}

          {imageUrl && (
            <div className="panel-result">
              <h2>Result</h2>
              <img src={imageUrl} alt="Generated" />
              <div className="result-actions">
                <button className="accept-btn" onClick={handleAccept}>
                  Place in World
                </button>
                <button
                  className="recycle-btn"
                  disabled={loading}
                  onClick={() => {
                    const fakeEvent = { preventDefault: () => {} } as React.FormEvent
                    handleSubmit(fakeEvent)
                  }}
                >
                  {loading ? 'Generating...' : 'Regenerate'}
                </button>
              </div>
            </div>
          )}

          {gallery.length > 0 && (
            <div className="panel-gallery">
              <div className="panel-gallery-header">
                <h2>Archive</h2>
                <span className="gallery-count">{gallery.length} artifact{gallery.length !== 1 ? 's' : ''}</span>
              </div>
              <input
                type="text"
                className="gallery-search"
                placeholder="Search artifacts..."
                value={gallerySearch}
                onChange={(e) => setGallerySearch(e.target.value)}
              />
              <div className="gallery-grid">
                {gallery.filter((img) => {
                  if (!gallerySearch.trim()) return true
                  const title = (img.prompt || 'Untitled').toLowerCase()
                  return title.includes(gallerySearch.trim().toLowerCase())
                }).map((img) => (
                  <div
                    key={img.id}
                    className="gallery-item gallery-item-clickable"
                    onClick={async () => {
                      try {
                        // Compute spawn position in front of the player
                        let spawnPosition: [number, number, number] | undefined
                        const camState = getCameraStateRef.current?.()
                        if (camState) {
                          const [cx, , cz] = camState.position
                          const [qx, qy2, qz, qw] = camState.quaternion
                          const fx = -2 * (qx * qz + qw * qy2)
                          const fz = -(1 - 2 * (qx * qx + qy2 * qy2))
                          const len = Math.sqrt(fx * fx + fz * fz) || 1
                          spawnPosition = [cx + (fx / len) * 4, 0, cz + (fz / len) * 4]
                        }
                        const res = await fetch('/api/scene-objects', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ imageId: img.id }),
                        })
                        const { id } = await res.json()
                        const url = `/images/${img.id}.webp`
                        setAcceptedImages(prev => [...prev, { id, imageId: img.id, url, position: spawnPosition }])
                        setPanelOpen(false)
                        setSelectedImageId(id)
                        setSelectionMode(true)
                        setTransformMode('translate')
                      } catch (err) {
                        console.error('Failed to add gallery image to scene', err)
                      }
                    }}
                  >
                    <div className="gallery-item-img-wrapper">
                      <img
                        src={`/images/${img.id}.webp`}
                        alt={img.prompt || `Generated at ${img.created_at}`}
                      />
                      {referenceImages.length < 3 && (
                        <button
                          className="gallery-remix-btn"
                          onClick={async (e) => {
                            e.stopPropagation()
                            try {
                              const resp = await fetch(`/images/${img.id}.webp`)
                              const blob = await resp.blob()
                              const file = new File([blob], `${img.id}.webp`, { type: 'image/webp' })
                              setReferenceImages(prev => {
                                if (prev.length >= 3) return prev
                                return [...prev, { file, preview: URL.createObjectURL(blob) }]
                              })
                            } catch (err) {
                              console.error('Failed to add as reference', err)
                            }
                          }}
                        >
                          <span className="gallery-remix-arrow">&gt;</span>
                          <span className="gallery-remix-label">Remix</span>
                        </button>
                      )}
                    </div>
                    <p className="gallery-item-title">{img.prompt || 'Untitled'}</p>
                    <p>{new Date(img.created_at).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {selectionMode && (
        <div className="selection-mode-overlay">
          <div className="transform-mode-buttons">
            <button
              className={`transform-btn ${transformMode === 'translate' ? 'active' : ''}`}
              onClick={() => setTransformMode('translate')}
            >
              Move <kbd>G</kbd>
            </button>
            <button
              className={`transform-btn ${transformMode === 'rotate' ? 'active' : ''}`}
              onClick={() => setTransformMode('rotate')}
            >
              Rotate <kbd>R</kbd>
            </button>
            <button
              className={`transform-btn ${transformMode === 'scale' ? 'active' : ''}`}
              onClick={() => setTransformMode('scale')}
            >
              Scale <kbd>T</kbd>
            </button>
          </div>
          <div className="action-buttons-row">
            <button
              className={`billboard-btn ${multiSelectMode ? 'active' : ''}`}
              onClick={() => {
                if (multiSelectMode) {
                  setMultiSelectMode(false)
                  setSelectedImageIds(new Set())
                } else {
                  setMultiSelectMode(true)
                  if (selectedImageId != null) {
                    setSelectedImageIds(new Set([selectedImageId]))
                  }
                }
              }}
            >
              Multi Select{multiSelectMode && selectedImageIds.size > 0 ? ` (${selectedImageIds.size})` : ''}
            </button>
            <button
              className="snap-ground-btn"
              onClick={() => setSnapToGroundTrigger(n => n + 1)}
            >
              Snap to Ground
            </button>
            <button
              className={`billboard-btn ${selectedImageId != null && billboardIds.has(selectedImageId) ? 'active' : ''}`}
              onClick={() => {
                if (selectedImageId == null) return
                setBillboardIds(prev => {
                  const next = new Set(prev)
                  if (next.has(selectedImageId)) next.delete(selectedImageId)
                  else next.add(selectedImageId)
                  return next
                })
              }}
            >
              Billboard
            </button>
            <button
              className={`billboard-btn ${selectedImageId != null && characterIds.has(selectedImageId) ? 'active' : ''}`}
              onClick={() => {
                if (selectedImageId == null) return
                const wasCharacter = characterIds.has(selectedImageId)
                setCharacterIds(prev => {
                  const next = new Set(prev)
                  if (next.has(selectedImageId)) next.delete(selectedImageId)
                  else next.add(selectedImageId)
                  return next
                })
                if (!wasCharacter) {
                  loadDialog(selectedImageId)
                  setDialogOpen(true)
                } else {
                  setDialogOpen(false)
                }
              }}
            >
              Character
            </button>
            {selectedImageId != null && characterIds.has(selectedImageId) && (
              <button
                className={`billboard-btn ${dialogOpen ? 'active' : ''}`}
                onClick={() => {
                  if (!dialogOpen && selectedImageId != null) {
                    loadDialog(selectedImageId)
                  }
                  setDialogOpen(prev => !prev)
                }}
              >
                Dialog
              </button>
            )}
            {selectedImageId != null && characterIds.has(selectedImageId) && (
              <button
                className={`billboard-btn ${speakingImageIds.has(selectedImageId) ? 'active' : ''}`}
                onClick={() => {
                  setSpeakingGalleryOpen(prev => !prev)
                  setSpeakingGallerySearch('')
                }}
              >
                Speaking
              </button>
            )}
            <button
              className="billboard-btn"
              onClick={() => {
                setSwapGalleryOpen(prev => !prev)
                setSwapGallerySearch('')
              }}
            >
              Swap
            </button>
          </div>
          {selectedImageId != null && characterIds.has(selectedImageId) && (
            <div className="character-radius-row">
              <span className="snap-rotation-label">Radius</span>
              <input
                type="range"
                className="radius-slider"
                min="1"
                max="20"
                step="0.5"
                value={characterRadii.get(selectedImageId) ?? 5}
                onChange={(e) => {
                  const val = parseFloat(e.target.value)
                  setCharacterRadii(prev => {
                    const next = new Map(prev)
                    next.set(selectedImageId!, val)
                    return next
                  })
                }}
              />
              <span className="radius-value">{(characterRadii.get(selectedImageId) ?? 5).toFixed(1)}</span>
            </div>
          )}
          <div className="snap-rotation-row">
            <span className="snap-rotation-label">Snap</span>
            <button
              className="snap-rotation-btn"
              onClick={() => setSnapRotationTrigger(prev => ({ rotation: [0, 0, 0], counter: prev.counter + 1 }))}
              title="Face front (toward +Z)"
            >
              Front
            </button>
            <button
              className="snap-rotation-btn"
              onClick={() => setSnapRotationTrigger(prev => ({ rotation: [0, Math.PI, 0], counter: prev.counter + 1 }))}
              title="Face back (toward -Z)"
            >
              Back
            </button>
            <button
              className="snap-rotation-btn"
              onClick={() => setSnapRotationTrigger(prev => ({ rotation: [0, Math.PI / 2, 0], counter: prev.counter + 1 }))}
              title="Face left (toward +X)"
            >
              Left
            </button>
            <button
              className="snap-rotation-btn"
              onClick={() => setSnapRotationTrigger(prev => ({ rotation: [0, -Math.PI / 2, 0], counter: prev.counter + 1 }))}
              title="Face right (toward -X)"
            >
              Right
            </button>
            <button
              className="snap-rotation-btn"
              onClick={() => setSnapRotationTrigger(prev => ({ rotation: [-Math.PI / 2, 0, 0], counter: prev.counter + 1 }))}
              title="Face up (flat on ground)"
            >
              Flat
            </button>
          </div>
          <div className="snap-rotation-row">
            <span className="snap-rotation-label">90&deg;</span>
            <button
              className="snap-rotation-btn"
              onClick={() => setSnapRotationTrigger(prev => ({ rotation: [Math.PI / 2, 0, 0], counter: prev.counter + 1, delta: true }))}
              title="Rotate +90° on X axis"
            >
              X+
            </button>
            <button
              className="snap-rotation-btn"
              onClick={() => setSnapRotationTrigger(prev => ({ rotation: [-Math.PI / 2, 0, 0], counter: prev.counter + 1, delta: true }))}
              title="Rotate -90° on X axis"
            >
              X-
            </button>
            <button
              className="snap-rotation-btn"
              onClick={() => setSnapRotationTrigger(prev => ({ rotation: [0, Math.PI / 2, 0], counter: prev.counter + 1, delta: true }))}
              title="Rotate +90° on Y axis"
            >
              Y+
            </button>
            <button
              className="snap-rotation-btn"
              onClick={() => setSnapRotationTrigger(prev => ({ rotation: [0, -Math.PI / 2, 0], counter: prev.counter + 1, delta: true }))}
              title="Rotate -90° on Y axis"
            >
              Y-
            </button>
            <button
              className="snap-rotation-btn"
              onClick={() => setSnapRotationTrigger(prev => ({ rotation: [0, 0, Math.PI / 2], counter: prev.counter + 1, delta: true }))}
              title="Rotate +90° on Z axis"
            >
              Z+
            </button>
            <button
              className="snap-rotation-btn"
              onClick={() => setSnapRotationTrigger(prev => ({ rotation: [0, 0, -Math.PI / 2], counter: prev.counter + 1, delta: true }))}
              title="Rotate -90° on Z axis"
            >
              Z-
            </button>
          </div>
          {dialogOpen && selectedImageId != null && characterIds.has(selectedImageId) && (
            <div className="dialog-editor">
              <div className="dialog-editor-header">
                <span className="dialog-editor-title">Character Dialog</span>
                <span className="dialog-editor-count">{dialogEntries.length} line{dialogEntries.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="dialog-editor-entries">
                {dialogEntries.map((entry, idx) => (
                  <div key={idx} className="dialog-entry">
                    <span className="dialog-entry-number">{idx + 1}</span>
                    <div className="dialog-entry-content">
                      <textarea
                        className="dialog-entry-text"
                        value={entry.text}
                        onChange={(e) => {
                          const updated = [...dialogEntries]
                          updated[idx] = { ...updated[idx], text: e.target.value }
                          setDialogEntries(updated)
                        }}
                        placeholder="Enter dialog text..."
                        rows={2}
                      />
                      <button
                        className={`dialog-set-camera-btn ${entry.camPos ? 'has-camera' : ''}`}
                        onClick={() => {
                          const camState = getCameraStateRef.current?.()
                          if (camState) {
                            const updated = [...dialogEntries]
                            updated[idx] = {
                              ...updated[idx],
                              camPos: camState.position,
                              camQuat: camState.quaternion,
                            }
                            setDialogEntries(updated)
                          }
                        }}
                        title={entry.camPos ? 'Camera position set — click to update' : 'Set current camera position for this dialog line'}
                      >
                        {entry.camPos ? 'Cam Set' : 'Set Cam'}
                      </button>
                      {entry.camPos && (
                        <button
                          className="dialog-clear-camera-btn"
                          onClick={() => {
                            const updated = [...dialogEntries]
                            updated[idx] = { ...updated[idx], camPos: null, camQuat: null }
                            setDialogEntries(updated)
                          }}
                          title="Clear camera position"
                        >
                          &times;
                        </button>
                      )}
                    </div>
                    <button
                      className="dialog-entry-remove"
                      onClick={() => {
                        if (dialogEntries.length <= 1) return
                        const updated = dialogEntries.filter((_, i) => i !== idx)
                        setDialogEntries(updated)
                      }}
                      disabled={dialogEntries.length <= 1}
                      title="Remove this line"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
              <div className="dialog-editor-actions">
                <button
                  className="dialog-add-btn"
                  onClick={() => setDialogEntries(prev => [...prev, { text: '' }])}
                >
                  + Add Line
                </button>
                <button
                  className="dialog-save-btn"
                  onClick={() => {
                    if (selectedImageId != null) {
                      saveDialog(selectedImageId, dialogEntries)
                    }
                  }}
                >
                  Save Dialog
                </button>
              </div>
            </div>
          )}
          {selectedImageId != null && characterIds.has(selectedImageId) && (
            <div className="dialog-end-sound">
              <label className="dialog-editor-title">End Sound</label>
              <select
                value={dialogEndSounds.get(selectedImageId) ?? ''}
                onChange={(e) => {
                  const val = e.target.value
                  setDialogEndSounds(prev => {
                    const next = new Map(prev)
                    if (val) next.set(selectedImageId!, val)
                    else next.delete(selectedImageId!)
                    return next
                  })
                }}
              >
                <option value="">None</option>
                {availableSounds.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          {speakingGalleryOpen && selectedImageId != null && characterIds.has(selectedImageId) && (
            <div className="speaking-gallery">
              <div className="dialog-editor-header">
                <span className="dialog-editor-title">Speaking Image</span>
                {speakingImageIds.has(selectedImageId) && (
                  <button
                    className="dialog-clear-camera-btn"
                    onClick={() => {
                      setSpeakingImageIds(prev => {
                        const next = new Map(prev)
                        next.delete(selectedImageId!)
                        return next
                      })
                    }}
                    title="Remove speaking image"
                  >
                    Clear
                  </button>
                )}
              </div>
              {speakingImageIds.has(selectedImageId) && (
                <div className="speaking-preview">
                  <img src={`/images/${speakingImageIds.get(selectedImageId)}.webp`} alt="Speaking" />
                </div>
              )}
              <input
                type="text"
                className="gallery-search"
                placeholder="Search images..."
                value={speakingGallerySearch}
                onChange={(e) => setSpeakingGallerySearch(e.target.value)}
              />
              <div className="speaking-gallery-grid">
                {gallery.filter((img) => {
                  if (!speakingGallerySearch.trim()) return true
                  return (img.prompt || '').toLowerCase().includes(speakingGallerySearch.trim().toLowerCase())
                }).map((img) => (
                  <div
                    key={img.id}
                    className={`speaking-gallery-item ${speakingImageIds.get(selectedImageId!) === img.id ? 'selected' : ''}`}
                    onClick={() => {
                      setSpeakingImageIds(prev => {
                        const next = new Map(prev)
                        next.set(selectedImageId!, img.id)
                        return next
                      })
                    }}
                  >
                    <img src={`/images/${img.id}.webp`} alt={img.prompt || 'Image'} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {swapGalleryOpen && selectedImageId != null && (
            <div className="speaking-gallery">
              <div className="dialog-editor-header">
                <span className="dialog-editor-title">Swap Image</span>
              </div>
              <input
                type="text"
                className="gallery-search"
                placeholder="Search images..."
                value={swapGallerySearch}
                onChange={(e) => setSwapGallerySearch(e.target.value)}
              />
              <div className="speaking-gallery-grid">
                {gallery.filter((img) => {
                  if (!swapGallerySearch.trim()) return true
                  return (img.prompt || '').toLowerCase().includes(swapGallerySearch.trim().toLowerCase())
                }).map((img) => {
                  const selected = acceptedImages.find(a => a.id === selectedImageId)
                  return (
                    <div
                      key={img.id}
                      className={`speaking-gallery-item ${selected?.imageId === img.id ? 'selected' : ''}`}
                      onClick={() => {
                        setAcceptedImages(prev => prev.map(a =>
                          a.id === selectedImageId
                            ? { ...a, imageId: img.id, url: `/images/${img.id}.webp` }
                            : a
                        ))
                        setSwapGalleryOpen(false)
                      }}
                    >
                      <img src={`/images/${img.id}.webp`} alt={img.prompt || 'Image'} />
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          <button className="accept-placement-btn" onClick={handleAcceptPlacement}>
            Accept Placement
          </button>
          <button className="duplicate-object-btn" onClick={handleDuplicateObject}>
            Duplicate
          </button>
          <button className="remove-object-btn" onClick={handleRemoveObject}>
            Remove
          </button>
          <div className="selection-hint">
            <kbd>Enter</kbd> or <kbd>Esc</kbd> to confirm &middot; <kbd>Del</kbd> to remove
            {multiSelectMode && ' \u00b7 Click objects to add/remove from selection'}
          </div>
        </div>
      )}

      {activeDialog.length > 0 && (
        <div className="dialog-playback-overlay">
          <div className="dialog-card">
            <div className="dialog-card-text">
              <DialogText text={activeDialog[activeDialogIndex]?.text || ''} handleRef={dialogTextRef} onStreamingChange={setDialogStreaming} />
            </div>
            <div className="dialog-card-footer">
              <span className="dialog-card-progress">{activeDialogIndex + 1} / {activeDialog.length}</span>
              <span className="dialog-card-hint">
                {activeDialogIndex < activeDialog.length - 1
                  ? (IS_MOBILE ? 'Tap to continue' : 'Press Space or Click to continue')
                  : (IS_MOBILE ? 'Tap to close' : 'Press Space or Click to close')}
              </span>
            </div>
          </div>
        </div>
      )}

      {!selectionMode && !IS_MOBILE && (
        <div className="controls-guide">
          <div className="controls-guide-title">Controls</div>
          <div className="controls-guide-body">
            <div className="controls-guide-row">
              <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>
              <span className="controls-guide-row-label">Move</span>
            </div>
            <div className="controls-guide-row">
              <kbd>Mouse</kbd>
              <span className="controls-guide-row-label">Look</span>
            </div>
            <div className="controls-guide-row">
              <kbd>Hold Click</kbd>
              <span className="controls-guide-row-label">Edit Object</span>
            </div>
            <div className="controls-guide-row">
              <kbd>Esc</kbd>
              <span className="controls-guide-row-label">Pause</span>
            </div>
            <div className="controls-guide-divider" />
            <div className="controls-guide-row controls-guide-action">
              <kbd className="kbd-highlight">E</kbd>
              <span className="controls-guide-row-label">Open Creator</span>
            </div>
          </div>
        </div>
      )}

      {paused && !panelOpen && !selectionMode && !IS_MOBILE && (
        <div className="pause-overlay" onClick={handleResume}>
          <div className="pause-card">
            <div className="pause-social-links" onClick={e => e.stopPropagation()}>
              <a href="https://github.com/hankberger/CreativeFellowshipArtifact/" target="_blank" rel="noopener noreferrer" className="pause-social-link" title="GitHub">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              </a>
              <a href="https://www.linkedin.com/in/hankberger/" target="_blank" rel="noopener noreferrer" className="pause-social-link" title="LinkedIn">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
              </a>
              <a href="https://x.com/h4nkdog" target="_blank" rel="noopener noreferrer" className="pause-social-link" title="X">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </a>
              <a href="https://www.instagram.com/h4nkdog/" target="_blank" rel="noopener noreferrer" className="pause-social-link" title="Instagram">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
              </a>
            </div>
            <div className="pause-divider" />
            <button className="pause-resume-btn">Resume</button>
            <div className="pause-divider" />
            <div className="pause-controls-title">Controls</div>
            <div className="pause-controls">
              <div className="pause-controls-row"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>Move</span></div>
              <div className="pause-controls-row"><kbd>Mouse</kbd><span>Look</span></div>
              <div className="pause-controls-row"><kbd>Hold Click</kbd><span>Edit Object</span></div>
              <div className="pause-controls-row"><kbd>Shift</kbd><span>Sprint</span></div>
              <div className="pause-controls-row"><kbd>Space</kbd><span>Jump</span></div>
              <div className="pause-controls-row"><kbd>E</kbd><span>Image Creator</span></div>
              <div className="pause-controls-row"><kbd>Esc</kbd><span>Pause</span></div>
            </div>
          </div>
        </div>
      )}

      {IS_MOBILE && !selectionMode && !panelOpen && activeDialog.length === 0 && (
        <VirtualJoystick moveRef={mobileMove} />
      )}
    </>
  )
}

export default App
