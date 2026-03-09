import { useState, useEffect, useCallback } from 'react'
import ThreeScene from './ThreeScene'
import './App.css'

interface ImageRecord {
  id: string;
  created_at: string;
}

function App() {
  const [prompt, setPrompt] = useState('Create a picture of a nano banana dish in a fancy restaurant with a Gemini theme')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gallery, setGallery] = useState<ImageRecord[]>([])
  const [panelOpen, setPanelOpen] = useState(false)

  const togglePanel = useCallback(() => {
    setPanelOpen(prev => !prev)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyE' && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) {
        togglePanel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePanel])

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

  return (
    <>
      <ThreeScene panelOpen={panelOpen} />

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
      <div className="controls-guide">
        <div className="controls-guide-title">Controls</div>
        <div className="controls-guide-row"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move</div>
        <div className="controls-guide-row"><kbd>Mouse</kbd> Look</div>
        <div className="controls-guide-row"><kbd>Click</kbd> to start &middot; <kbd>Esc</kbd> to unlock</div>
        <div className="controls-guide-row controls-guide-action"><kbd className="kbd-highlight">E</kbd> Generate Image</div>
      </div>
    </>
  )
}

export default App
