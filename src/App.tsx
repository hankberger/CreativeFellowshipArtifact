import { useState, useEffect, useCallback, useRef } from 'react'
import ThreeScene from './ThreeScene'
import './App.css'

interface ImageRecord {
  id: string;
  created_at: string;
}

interface AcceptedImage {
  id: number;
  imageId: string;
  url: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
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
        }
      } catch (err) {
        console.error('Failed to load scene objects', err)
      }
    })()
  }, [])

  const handleAccept = async () => {
    if (imageUrl) {
      // Extract imageId from URL like /images/<uuid>.png
      const match = imageUrl.match(/\/images\/(.+)\.png$/)
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
            }),
          })
        } catch (err) {
          console.error('Failed to save transform', err)
        }
      }
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
        return
      }

      if (e.code === 'KeyE') {
        togglePanel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePanel, selectionMode, handleAcceptPlacement])

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
                stroke="rgba(100, 108, 255, 0.3)"
                strokeWidth="3"
              />
              <circle
                cx="22" cy="22" r="18"
                fill="none"
                stroke="#646cff"
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
      />

      {panelOpen && (
        <div className="floating-panel">
          <div className="panel-header">
            <h1>Gemini Image Generator</h1>
            <button className="panel-close" onClick={() => setPanelOpen(false)}>
              &times;
            </button>
          </div>

          <form onSubmit={handleSubmit} className="panel-form">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter a prompt to generate an image..."
              rows={4}
            />
            <button
              type="submit"
              disabled={loading || !prompt.trim()}
              className="generate-btn"
            >
              {loading ? 'Generating...' : 'Generate Image'}
            </button>
          </form>

          {error && <div className="panel-error">{error}</div>}

          {imageUrl && (
            <div className="panel-result">
              <h2>Generated Image:</h2>
              <img src={imageUrl} alt="Generated" />
              <button className="accept-btn" onClick={handleAccept}>
                Accept
              </button>
            </div>
          )}

          {gallery.length > 0 && (
            <div className="panel-gallery">
              <h2>Gallery</h2>
              <div className="gallery-grid">
                {gallery.map((img) => (
                  <div key={img.id} className="gallery-item">
                    <img
                      src={`/images/${img.id}.png`}
                      alt={`Generated at ${img.created_at}`}
                    />
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
          <button className="accept-placement-btn" onClick={handleAcceptPlacement}>
            Accept Placement
          </button>
          <div className="selection-hint">
            <kbd>Enter</kbd> or <kbd>Esc</kbd> to confirm
          </div>
        </div>
      )}

      {!selectionMode && (
        <div className="controls-guide">
          <div className="controls-guide-title">Controls</div>
          <div className="controls-guide-row"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move</div>
          <div className="controls-guide-row"><kbd>Mouse</kbd> Look</div>
          <div className="controls-guide-row"><kbd>Hold Click</kbd> to select object</div>
          <div className="controls-guide-row controls-guide-action"><kbd className="kbd-highlight">E</kbd> Generate Image</div>
        </div>
      )}
    </>
  )
}

export default App
