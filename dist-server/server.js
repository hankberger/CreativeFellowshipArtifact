import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from "@google/genai";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
// When compiled, this file will be in dist-server/, so we go up one directory to find dist/
app.use(express.static(path.join(__dirname, '..', 'dist')));
const ai = new GoogleGenAI({});
app.post('/api/generate-image', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        const response = await ai.models.generateContent({
            model: "gemini-3.1-flash-image-preview",
            contents: prompt,
        });
        let base64Image = null;
        if (response.candidates && response.candidates[0] && response.candidates[0].content && response.candidates[0].content.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    base64Image = part.inlineData.data;
                    break;
                }
            }
        }
        if (base64Image) {
            res.json({ image: `data:image/png;base64,${base64Image}` });
        }
        else {
            res.status(500).json({ error: 'No image data returned from Gemini API' });
        }
    }
    catch (error) {
        console.error('Error generating image:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get(/^(?!\/api).+/, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});
app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
