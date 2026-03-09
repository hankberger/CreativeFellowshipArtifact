import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { Jimp } from 'jimp';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Initialize SQLite database
let db;
(async () => {
    db = await open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });
    await db.exec('CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
})();
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
// When compiled, this file will be in dist-server/, so we go up one directory to find dist/
app.use(express.static(path.join(__dirname, '..', 'dist')));
const ai = new GoogleGenAI({});
app.get('/api/images', async (req, res) => {
    try {
        const images = await db.all('SELECT id, created_at FROM images ORDER BY created_at DESC');
        res.json(images);
    }
    catch (error) {
        console.error('Error fetching images:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.post('/api/generate-image', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        const finalPrompt = `${prompt} with a pure white background`;
        const response = await ai.models.generateContent({
            model: "gemini-3.1-flash-image-preview",
            contents: finalPrompt,
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
            const id = uuidv4();
            const filename = `${id}.png`;
            const imagesDir = path.join(__dirname, '..', 'dist', 'images');
            if (!fs.existsSync(imagesDir)) {
                fs.mkdirSync(imagesDir, { recursive: true });
            }
            const filePath = path.join(imagesDir, filename);
            const buffer = Buffer.from(base64Image, 'base64');
            // Process image with Jimp to make white background transparent
            const image = await Jimp.read(buffer);
            image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
                const r = this.bitmap.data[idx + 0];
                const g = this.bitmap.data[idx + 1];
                const b = this.bitmap.data[idx + 2];
                // Define a threshold for "white" (e.g., RGB values above 240)
                if (r > 240 && g > 240 && b > 240) {
                    // Set alpha to 0 (transparent)
                    this.bitmap.data[idx + 3] = 0;
                }
            });
            const modifiedBuffer = await image.getBuffer("image/png");
            fs.writeFileSync(filePath, modifiedBuffer);
            await db.run('INSERT INTO images (id) VALUES (?)', [id]);
            res.json({ image: `/images/${filename}` });
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
