import "dotenv/config";
import express, { Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { Jimp, rgbaToInt } from "jimp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve project root: when compiled (dist-server/), go up one level; otherwise use __dirname directly
const projectRoot = __dirname.endsWith("dist-server") ? path.join(__dirname, "..") : __dirname;

// Persistent data directory at project root (survives rebuilds/redeploys)
const dataDir = path.join(projectRoot, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const imagesDir = path.join(dataDir, "images");
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

// Initialize SQLite database
let db: any;
(async () => {
  db = await open({
    filename: path.join(dataDir, "database.sqlite"),
    driver: sqlite3.Database,
  });
  await db.exec(
    "CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
  );
  await db.exec(`CREATE TABLE IF NOT EXISTS scene_objects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_id TEXT NOT NULL,
    position_x REAL DEFAULT 0,
    position_y REAL DEFAULT 0,
    position_z REAL DEFAULT 0,
    rotation_x REAL DEFAULT 0,
    rotation_y REAL DEFAULT 0,
    rotation_z REAL DEFAULT 0,
    scale_x REAL DEFAULT 1,
    scale_y REAL DEFAULT 1,
    scale_z REAL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
})();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
// When compiled, this file will be in dist-server/, so we go up one directory to find dist/
app.use(express.static(path.join(projectRoot, "dist")));
app.use("/images", express.static(path.join(projectRoot, "data", "images")));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.get("/api/images", async (req: Request, res: Response) => {
  try {
    const images = await db.all(
      "SELECT id, created_at FROM images ORDER BY created_at DESC",
    );
    res.json(images);
  } catch (error) {
    console.error("Error fetching images:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post(
  "/api/generate-image",
  async (req: Request, res: Response): Promise<any> => {
    try {
      const { prompt } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const finalPrompt = `${prompt}, isolated on a solid bright green chroma key (#00FF00) background with no shadows, no gradients, no floor, and no reflections. The subject should have clean, sharp edges with no green or light-colored fringing. Studio product photography style with flat even lighting.`;
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-image-preview",
        contents: finalPrompt,
      });

      let base64Image = null;

      if (
        response.candidates &&
        response.candidates[0] &&
        response.candidates[0].content &&
        response.candidates[0].content.parts
      ) {
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
        const filePath = path.join(imagesDir, filename);
        const buffer = Buffer.from(base64Image, "base64");

        // Process image with Jimp to make white background transparent
        const image = await Jimp.read(buffer);

        image.scan(
          0,
          0,
          image.bitmap.width,
          image.bitmap.height,
          function (this: any, x, y, idx) {
            const r = this.bitmap.data[idx + 0];
            const g = this.bitmap.data[idx + 1];
            const b = this.bitmap.data[idx + 2];

            // Chroma key removal: detect green background pixels
            // "greenness" = how much greener the pixel is than red/blue
            const greenness = g - Math.max(r, b);

            if (greenness > 30) {
              // Strong green — fully transparent
              this.bitmap.data[idx + 3] = 0;
            } else if (greenness > 0 && g > 100) {
              // Edge feathering: semi-transparent for pixels with mild green tint
              // Smoothly fade alpha from 255 down to 0 across the greenness range 0–30
              const alpha = Math.round(255 * (1 - greenness / 30));
              this.bitmap.data[idx + 3] = alpha;
            }
          },
        );

        const modifiedBuffer = await image.getBuffer("image/png");
        fs.writeFileSync(filePath, modifiedBuffer);

        await db.run("INSERT INTO images (id) VALUES (?)", [id]);

        res.json({ image: `/images/${filename}` });
      } else {
        res
          .status(500)
          .json({ error: "No image data returned from Gemini API" });
      }
    } catch (error) {
      console.error("Error generating image:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Scene objects CRUD
app.get("/api/scene-objects", async (req: Request, res: Response) => {
  try {
    const rows = await db.all(
      "SELECT id, image_id, position_x, position_y, position_z, rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z FROM scene_objects ORDER BY created_at ASC",
    );
    const objects = rows.map((r: any) => ({
      id: r.id,
      imageId: r.image_id,
      url: `/images/${r.image_id}.png`,
      position: [r.position_x, r.position_y, r.position_z],
      rotation: [r.rotation_x, r.rotation_y, r.rotation_z],
      scale: [r.scale_x, r.scale_y, r.scale_z],
    }));
    res.json(objects);
  } catch (error) {
    console.error("Error fetching scene objects:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post(
  "/api/scene-objects",
  async (req: Request, res: Response): Promise<any> => {
    try {
      const { imageId } = req.body;
      if (!imageId) {
        return res.status(400).json({ error: "imageId is required" });
      }
      const result = await db.run(
        "INSERT INTO scene_objects (image_id) VALUES (?)",
        [imageId],
      );
      res.json({ id: result.lastID });
    } catch (error) {
      console.error("Error creating scene object:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

app.put(
  "/api/scene-objects/:id",
  async (req: Request, res: Response): Promise<any> => {
    try {
      const { id } = req.params;
      const {
        positionX, positionY, positionZ,
        rotationX, rotationY, rotationZ,
        scaleX, scaleY, scaleZ,
      } = req.body;
      await db.run(
        `UPDATE scene_objects SET
          position_x = ?, position_y = ?, position_z = ?,
          rotation_x = ?, rotation_y = ?, rotation_z = ?,
          scale_x = ?, scale_y = ?, scale_z = ?
        WHERE id = ?`,
        [positionX, positionY, positionZ, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, id],
      );
      res.json({ ok: true });
    } catch (error) {
      console.error("Error updating scene object:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

app.delete(
  "/api/scene-objects/:id",
  async (req: Request, res: Response): Promise<any> => {
    try {
      const { id } = req.params;
      await db.run("DELETE FROM scene_objects WHERE id = ?", [id]);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting scene object:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// 404 for any unmatched API routes
app.all("/api/*", (req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// SPA catch-all: serve index.html only for navigation requests (no file extension)
app.get("*", (req: Request, res: Response, next: Function) => {
  if (path.extname(req.path)) {
    return next();
  }
  res.sendFile(path.join(projectRoot, "dist", "index.html"));
});

// Final 404 fallback for anything else (e.g. missing static files)
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
