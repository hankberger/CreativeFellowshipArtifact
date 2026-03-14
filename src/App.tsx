import { useState, useEffect, useCallback, useRef } from 'react'
import ThreeScene from './ThreeScene'
import './App.css'

interface DialogTextHandle {
  isFinished: () => boolean
  skipToEnd: () => void
}

function DialogText({ text, handleRef }: { text: string; handleRef: React.MutableRefObject<DialogTextHandle | null> }) {
  const spaceIdx = text.indexOf(' ')
  const firstWord = spaceIdx === -1 ? text : text.slice(0, spaceIdx)
  const rest = spaceIdx === -1 ? '' : text.slice(spaceIdx)
  const [charCount, setCharCount] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setCharCount(0)
    if (!rest) return
    let i = 0
    intervalRef.current = setInterval(() => {
      i++
      setCharCount(i)
      if (i >= rest.length) {
        if (intervalRef.current) clearInterval(intervalRef.current)
        intervalRef.current = null
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
}

const HOLD_DURATION = 2000

function App() {
  const [prompt, setPrompt] = useState('A cathedral made entirely of ice, with colored light refracting through its translucent walls')
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
  const [snapRotationTrigger, setSnapRotationTrigger] = useState<{ rotation: [number, number, number]; counter: number }>({ rotation: [0, 0, 0], counter: 0 })
  const [billboardIds, setBillboardIds] = useState<Set<number>>(new Set())
  const [characterIds, setCharacterIds] = useState<Set<number>>(new Set())
  const [gallerySearch, setGallerySearch] = useState('')
  const [referenceImages, setReferenceImages] = useState<{ file: File; preview: string }[]>([])
  const refImageInputRef = useRef<HTMLInputElement>(null)
  const [dialogEntries, setDialogEntries] = useState<DialogEntry[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [characterRadii, setCharacterRadii] = useState<Map<number, number>>(new Map())

  // Dialog playback state (triggered by proximity)
  const [activeDialog, setActiveDialog] = useState<DialogEntry[]>([])
  const [activeDialogIndex, setActiveDialogIndex] = useState(0)
  const [, setActiveDialogCharId] = useState<number | null>(null)

  // Ref to get camera state from ThreeScene
  const getCameraStateRef = useRef<(() => { position: [number, number, number]; quaternion: [number, number, number, number] }) | null>(null)

  // Hold-to-select state
  const [holdTarget, setHoldTarget] = useState<number | null>(null)
  const [holdProgress, setHoldProgress] = useState(0)
  const holdStartTime = useRef(0)

  // Track latest transforms reported by ThreeScene
  const latestTransforms = useRef(new Map<number, { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }>())

  const handleTransformUpdate = useCallback((id: number, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => {
    latestTransforms.current.set(id, { position, rotation, scale })
  }, [])

  // Load scene objects on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/scene-objects')
        if (res.ok) {
          const data = await res.json()
          setAcceptedImages(data)
          setBillboardIds(new Set(data.filter((d: AcceptedImage) => d.billboard).map((d: AcceptedImage) => d.id)))
          setCharacterIds(new Set(data.filter((d: AcceptedImage) => d.character).map((d: AcceptedImage) => d.id)))
          const radii = new Map<number, number>()
          data.forEach((d: AcceptedImage) => { if (d.character && d.radius != null) radii.set(d.id, d.radius) })
          setCharacterRadii(radii)
        }
      } catch (err) {
        console.error('Failed to load scene objects', err)
      }
    })()
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

  // Animate hold progress and trigger selection mode at completion
  useEffect(() => {
    if (holdTarget === null) return

    let animFrame: number
    const animate = () => {
      const elapsed = performance.now() - holdStartTime.current
      const progress = Math.min(elapsed / HOLD_DURATION, 1)
      setHoldProgress(progress)

      if (progress >= 1) {
        setSelectedImageId(holdTarget)
        setSelectionMode(true)
        setTransformMode('translate')
        setHoldTarget(null)
        setHoldProgress(0)
        return
      }

      animFrame = requestAnimationFrame(animate)
    }
    animFrame = requestAnimationFrame(animate)

    return () => cancelAnimationFrame(animFrame)
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
    if (selectedImageId != null) {
      const t = latestTransforms.current.get(selectedImageId)
      if (t) {
        try {
          await fetch(`/api/scene-objects/${selectedImageId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              positionX: t.position[0], positionY: t.position[1], positionZ: t.position[2],
              rotationX: t.rotation[0], rotationY: t.rotation[1], rotationZ: t.rotation[2],
              scaleX: t.scale[0], scaleY: t.scale[1], scaleZ: t.scale[2],
              billboard: billboardIds.has(selectedImageId),
              character: characterIds.has(selectedImageId),
              radius: characterRadii.get(selectedImageId) ?? 5,
            }),
          })
          const isBillboard = billboardIds.has(selectedImageId)
          const isCharacter = characterIds.has(selectedImageId)
          if (isCharacter && dialogEntries.length > 0) {
            await saveDialog(selectedImageId, dialogEntries)
          }
          setAcceptedImages(prev => prev.map(img =>
            img.id === selectedImageId
              ? { ...img, position: t.position, rotation: t.rotation, scale: t.scale, billboard: isBillboard, character: isCharacter, radius: characterRadii.get(selectedImageId) ?? 5 }
              : img
          ))
        } catch (err) {
          console.error('Failed to save transform', err)
        }
      }
    }
    setSelectionMode(false)
    setSelectedImageId(null)
    setDialogOpen(false)
    setDialogEntries([])
  }, [selectedImageId, billboardIds, characterIds, characterRadii, dialogEntries, saveDialog])

  const handleRemoveObject = useCallback(async () => {
    if (selectedImageId == null) return
    try {
      await fetch(`/api/scene-objects/${selectedImageId}`, { method: 'DELETE' })
      setAcceptedImages(prev => prev.filter(img => img.id !== selectedImageId))
      setBillboardIds(prev => {
        const next = new Set(prev)
        next.delete(selectedImageId!)
        return next
      })
      setCharacterIds(prev => {
        const next = new Set(prev)
        next.delete(selectedImageId!)
        return next
      })
    } catch (err) {
      console.error('Failed to remove object', err)
    }
    setSelectionMode(false)
    setSelectedImageId(null)
  }, [selectedImageId])

  const togglePanel = useCallback(() => {
    setPanelOpen(prev => !prev)
  }, [])

  const activeDialogCharIdRef = useRef<number | null>(null)
  const dialogTextRef = useRef<DialogTextHandle | null>(null)
  const activeDialogRef = useRef<DialogEntry[]>([])

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
        // End of dialog
        activeDialogRef.current = []
        activeDialogCharIdRef.current = null
        setActiveDialog([])
        setActiveDialogCharId(null)
        return 0
      }
    })
  }, [])

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
        body: JSON.stringify({ prompt, referenceImages: refImagesBase64 }),
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
      {!selectionMode && (
        <div className="crosshair-container">
          <div className="crosshair" />
          {holdTarget !== null && (
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
        dialogActive={activeDialog.length > 0}
        getCameraStateRef={getCameraStateRef}
        dialogCameraTarget={activeDialog.length > 0 && activeDialog[activeDialogIndex] ? {
          camPos: activeDialog[activeDialogIndex].camPos || null,
          camQuat: activeDialog[activeDialogIndex].camQuat || null,
        } : null}
      />

      {panelOpen && (
        <div className="floating-panel">
          <div className="panel-header">
            <h1><span className="panel-header-badge">Image Creator</span></h1>
            <button className="panel-close" onClick={() => setPanelOpen(false)}>
              &times;
            </button>
          </div>

          <form onSubmit={handleSubmit} className="panel-form">
            <div className="panel-form-label">Describe your creation</div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A cartoon man with a tophat and a moustache"
              rows={4}
            />
            <div className="prompt-char-count">{prompt.length} chars</div>

            <div className="panel-form-label">Reference images (optional, up to 3)</div>
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
                    <img
                      src={`/images/${img.id}.webp`}
                      alt={img.prompt || `Generated at ${img.created_at}`}
                    />
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
          <button className="accept-placement-btn" onClick={handleAcceptPlacement}>
            Accept Placement
          </button>
          <button className="remove-object-btn" onClick={handleRemoveObject}>
            Remove
          </button>
          <div className="selection-hint">
            <kbd>Enter</kbd> or <kbd>Esc</kbd> to confirm &middot; <kbd>Del</kbd> to remove
          </div>
        </div>
      )}

      {activeDialog.length > 0 && (
        <div className="dialog-playback-overlay">
          <div className="dialog-card">
            <div className="dialog-card-text">
              <DialogText text={activeDialog[activeDialogIndex]?.text || ''} handleRef={dialogTextRef} />
            </div>
            <div className="dialog-card-footer">
              <span className="dialog-card-progress">{activeDialogIndex + 1} / {activeDialog.length}</span>
              <span className="dialog-card-hint">
                {activeDialogIndex < activeDialog.length - 1 ? 'Press Space or Click to continue' : 'Press Space or Click to close'}
              </span>
            </div>
          </div>
        </div>
      )}

      {!selectionMode && (
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
              <span className="controls-guide-row-label">Show Mouse</span>
            </div>
            <div className="controls-guide-divider" />
            <div className="controls-guide-row controls-guide-action">
              <kbd className="kbd-highlight">E</kbd>
              <span className="controls-guide-row-label">Open Creator</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default App
