import { useState, useEffect } from 'react'
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
        fetchGallery() // refresh gallery
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
    <div className="app-container" style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem', textAlign: 'center' }}>
      <h1>Gemini Image Generator</h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter a prompt to generate an image..."
          rows={4}
          style={{ padding: '0.5rem', fontSize: '1rem', width: '100%' }}
        />
        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          style={{ padding: '0.5rem 1rem', fontSize: '1rem', cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          {loading ? 'Generating...' : 'Generate Image'}
        </button>
      </form>

      {error && <div style={{ color: 'red', marginBottom: '1rem' }}>{error}</div>}

      {imageUrl && (
        <div style={{ marginBottom: '2rem' }}>
          <h2>Generated Image:</h2>
          <img src={imageUrl} alt="Generated" style={{ maxWidth: '100%', height: 'auto', borderRadius: '8px' }} />
        </div>
      )}

      {gallery.length > 0 && (
        <div style={{ marginTop: '3rem', borderTop: '1px solid #ccc', paddingTop: '2rem' }}>
          <h2>Gallery</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
            {gallery.map((img) => (
              <div key={img.id} style={{ border: '1px solid #ddd', padding: '0.5rem', borderRadius: '8px' }}>
                <img
                  src={`/images/${img.id}.png`}
                  alt={`Generated at ${img.created_at}`}
                  style={{ width: '100%', height: 'auto', display: 'block', borderRadius: '4px' }}
                />
                <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}>
                  {new Date(img.created_at).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
