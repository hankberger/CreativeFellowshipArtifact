import "dotenv/config";
import express, { Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import sharp from "sharp";

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
  await db.exec("PRAGMA foreign_keys = ON");
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
    billboard INTEGER DEFAULT 0,
    character INTEGER DEFAULT 0,
    radius REAL DEFAULT 5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Migration: add billboard column if missing
  const cols = await db.all("PRAGMA table_info(scene_objects)");
  if (!cols.some((c: any) => c.name === 'billboard')) {
    await db.exec("ALTER TABLE scene_objects ADD COLUMN billboard INTEGER DEFAULT 0");
  }

  // Migration: add character column if missing
  if (!cols.some((c: any) => c.name === 'character')) {
    await db.exec("ALTER TABLE scene_objects ADD COLUMN character INTEGER DEFAULT 0");
  }

  // Migration: add radius column if missing
  if (!cols.some((c: any) => c.name === 'radius')) {
    await db.exec("ALTER TABLE scene_objects ADD COLUMN radius REAL DEFAULT 5");
  }

  // Create character_dialog table
  await db.exec(`CREATE TABLE IF NOT EXISTS character_dialog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_object_id INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    text TEXT NOT NULL DEFAULT '',
    cam_pos_x REAL,
    cam_pos_y REAL,
    cam_pos_z REAL,
    cam_quat_x REAL,
    cam_quat_y REAL,
    cam_quat_z REAL,
    cam_quat_w REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (scene_object_id) REFERENCES scene_objects(id) ON DELETE CASCADE
  )`);

  // Migration: add camera columns to character_dialog if missing
  const dialogCols = await db.all("PRAGMA table_info(character_dialog)");
  if (!dialogCols.some((c: any) => c.name === 'cam_pos_x')) {
    await db.exec("ALTER TABLE character_dialog ADD COLUMN cam_pos_x REAL");
    await db.exec("ALTER TABLE character_dialog ADD COLUMN cam_pos_y REAL");
    await db.exec("ALTER TABLE character_dialog ADD COLUMN cam_pos_z REAL");
    await db.exec("ALTER TABLE character_dialog ADD COLUMN cam_quat_x REAL");
    await db.exec("ALTER TABLE character_dialog ADD COLUMN cam_quat_y REAL");
    await db.exec("ALTER TABLE character_dialog ADD COLUMN cam_quat_z REAL");
    await db.exec("ALTER TABLE character_dialog ADD COLUMN cam_quat_w REAL");
  }

  // Migration: add prompt column to images if missing
  const imgCols = await db.all("PRAGMA table_info(images)");
  if (!imgCols.some((c: any) => c.name === 'prompt')) {
    await db.exec("ALTER TABLE images ADD COLUMN prompt TEXT DEFAULT ''");
  }
})();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
// When compiled, this file will be in dist-server/, so we go up one directory to find dist/
app.use(express.static(path.join(projectRoot, "dist")));
app.use("/images", express.static(path.join(projectRoot, "data", "images")));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.get("/api/images", async (req: Request, res: Response) => {
  try {
    const images = await db.all(
      "SELECT id, prompt, created_at FROM images ORDER BY created_at DESC",
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
      const { prompt, referenceImages } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const finalPrompt = `${prompt}, isolated on a solid bright green chroma key (#00FF00) background with no shadows, no gradients, no floor, and no reflections. The subject should have clean, sharp edges with no green or light-colored fringing. Studio product photography style with flat even lighting.`;

      // Build contents array with optional reference images
      const contents: any[] = [{ text: finalPrompt }];
      if (referenceImages && Array.isArray(referenceImages)) {
        for (const img of referenceImages.slice(0, 3)) {
          if (img.mimeType && img.data) {
            contents.push({
              inlineData: {
                mimeType: img.mimeType,
                data: img.data,
              },
            });
          }
        }
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-image-preview",
        contents: contents,
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
        const filename = `${id}.webp`;
        const filePath = path.join(imagesDir, filename);
        const buffer = Buffer.from(base64Image, "base64");

        // Process image with sharp to make green background transparent
        const { data, info } = await sharp(buffer)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // Chroma key removal: detect green background pixels
          // "greenness" = how much greener the pixel is than red/blue
          const greenness = g - Math.max(r, b);

          if (greenness > 30) {
            // Strong green — fully transparent
            data[i + 3] = 0;
          } else if (greenness > 0 && g > 100) {
            // Edge feathering: semi-transparent for pixels with mild green tint
            const alpha = Math.round(255 * (1 - greenness / 30));
            data[i + 3] = alpha;
          }
        }

        const modifiedBuffer = await sharp(data, {
          raw: { width: info.width, height: info.height, channels: 4 },
        })
          .webp({ quality: 80 })
          .toBuffer();
        fs.writeFileSync(filePath, modifiedBuffer);

        await db.run("INSERT INTO images (id, prompt) VALUES (?, ?)", [id, prompt]);

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
      "SELECT id, image_id, position_x, position_y, position_z, rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, billboard, character, radius FROM scene_objects ORDER BY created_at ASC",
    );
    const objects = rows.map((r: any) => ({
      id: r.id,
      imageId: r.image_id,
      url: `/images/${r.image_id}.webp`,
      position: [r.position_x, r.position_y, r.position_z],
      rotation: [r.rotation_x, r.rotation_y, r.rotation_z],
      scale: [r.scale_x, r.scale_y, r.scale_z],
      billboard: !!r.billboard,
      character: !!r.character,
      radius: r.radius ?? 5,
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
        billboard,
        character,
        radius,
      } = req.body;
      await db.run(
        `UPDATE scene_objects SET
          position_x = ?, position_y = ?, position_z = ?,
          rotation_x = ?, rotation_y = ?, rotation_z = ?,
          scale_x = ?, scale_y = ?, scale_z = ?,
          billboard = ?,
          character = ?,
          radius = ?
        WHERE id = ?`,
        [positionX, positionY, positionZ, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, billboard ? 1 : 0, character ? 1 : 0, radius ?? 5, id],
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

// Character dialog CRUD
app.get(
  "/api/scene-objects/:id/dialog",
  async (req: Request, res: Response): Promise<any> => {
    try {
      const { id } = req.params;
      const rows = await db.all(
        "SELECT id, text, sort_order, cam_pos_x, cam_pos_y, cam_pos_z, cam_quat_x, cam_quat_y, cam_quat_z, cam_quat_w FROM character_dialog WHERE scene_object_id = ? ORDER BY sort_order ASC",
        [id],
      );
      const entries = rows.map((r: any) => ({
        id: r.id,
        text: r.text,
        sort_order: r.sort_order,
        camPos: r.cam_pos_x != null ? [r.cam_pos_x, r.cam_pos_y, r.cam_pos_z] : null,
        camQuat: r.cam_quat_x != null ? [r.cam_quat_x, r.cam_quat_y, r.cam_quat_z, r.cam_quat_w] : null,
      }));
      res.json(entries);
    } catch (error) {
      console.error("Error fetching dialog:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

app.put(
  "/api/scene-objects/:id/dialog",
  async (req: Request, res: Response): Promise<any> => {
    try {
      const { id } = req.params;
      const { entries } = req.body;
      if (!Array.isArray(entries)) {
        return res.status(400).json({ error: "entries array is required" });
      }
      // Replace all dialog for this object
      await db.run("DELETE FROM character_dialog WHERE scene_object_id = ?", [id]);
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const text = e.text || "";
        const camPos = e.camPos;
        const camQuat = e.camQuat;
        await db.run(
          "INSERT INTO character_dialog (scene_object_id, sort_order, text, cam_pos_x, cam_pos_y, cam_pos_z, cam_quat_x, cam_quat_y, cam_quat_z, cam_quat_w) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [id, i, text,
            camPos?.[0] ?? null, camPos?.[1] ?? null, camPos?.[2] ?? null,
            camQuat?.[0] ?? null, camQuat?.[1] ?? null, camQuat?.[2] ?? null, camQuat?.[3] ?? null],
        );
      }
      // Return the saved entries
      const rows = await db.all(
        "SELECT id, text, sort_order, cam_pos_x, cam_pos_y, cam_pos_z, cam_quat_x, cam_quat_y, cam_quat_z, cam_quat_w FROM character_dialog WHERE scene_object_id = ? ORDER BY sort_order ASC",
        [id],
      );
      const result = rows.map((r: any) => ({
        id: r.id,
        text: r.text,
        sort_order: r.sort_order,
        camPos: r.cam_pos_x != null ? [r.cam_pos_x, r.cam_pos_y, r.cam_pos_z] : null,
        camQuat: r.cam_quat_x != null ? [r.cam_quat_x, r.cam_quat_y, r.cam_quat_z, r.cam_quat_w] : null,
      }));
      res.json(result);
    } catch (error) {
      console.error("Error saving dialog:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// 404 for any unmatched API routes
app.all("/api/{*path}", (req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// SPA catch-all: serve index.html only for navigation requests (no file extension)
app.use((req: Request, res: Response, next) => {
  if (req.method !== "GET" || path.extname(req.path)) {
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
