import { useState, useEffect, useCallback, useRef } from 'react'
import ThreeScene from './ThreeScene'
import './App.css'

interface ImageRecord {
  id: string;
  prompt: string;
  created_at: string;
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
}

const HOLD_DURATION = 2000

function App() {
  const [prompt, setPrompt] = useState('Create a picture of a nano banana dish in a fancy restaurant with a Gemini theme')
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
        const res = await fetch('/api/scene-objects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageId }),
        })
        const { id } = await res.json()
        setAcceptedImages(prev => [...prev, { id, imageId, url: imageUrl }])
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
            }),
          })
          const isBillboard = billboardIds.has(selectedImageId)
          const isCharacter = characterIds.has(selectedImageId)
          setAcceptedImages(prev => prev.map(img =>
            img.id === selectedImageId
              ? { ...img, position: t.position, rotation: t.rotation, scale: t.scale, billboard: isBillboard, character: isCharacter }
              : img
          ))
        } catch (err) {
          console.error('Failed to save transform', err)
        }
      }
    }
    setSelectionMode(false)
    setSelectedImageId(null)
  }, [selectedImageId, billboardIds, characterIds])

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return

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
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePanel, selectionMode, handleAcceptPlacement, handleRemoveObject])

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
      const response = await fetch('/api/generate-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
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
                        const res = await fetch('/api/scene-objects', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ imageId: img.id }),
                        })
                        const { id } = await res.json()
                        const url = `/images/${img.id}.webp`
                        setAcceptedImages(prev => [...prev, { id, imageId: img.id, url }])
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
                setCharacterIds(prev => {
                  const next = new Set(prev)
                  if (next.has(selectedImageId)) next.delete(selectedImageId)
                  else next.add(selectedImageId)
                  return next
                })
              }}
            >
              Character
            </button>
          </div>
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
              <span className="controls-guide-row-label">Select object</span>
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
