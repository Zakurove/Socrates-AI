import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { mkdirSync, existsSync, statSync, readdirSync } from "fs";
import { writeFile } from "fs/promises";
import path from "path";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const UPLOAD_DIR = path.resolve(process.cwd(), "server", "uploads", "items");
if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
// Basic global disk quota guard for the uploads dir.
const MAX_TOTAL_BYTES = 500 * 1024 * 1024; // 500 MB

function getUploadDirSize(): number {
  try {
    let total = 0;
    for (const name of readdirSync(UPLOAD_DIR)) {
      try {
        total += statSync(path.join(UPLOAD_DIR, name)).size;
      } catch {}
    }
    return total;
  } catch {
    return 0;
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

// Magic-byte sniffers — JPG / PNG / WebP only.
function sniffMime(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

const ALLOWED_HEADERS = new Set(["image/jpeg", "image/png", "image/webp"]);

// POST /api/uploads/image
router.post("/image", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "no_file" });
    }
    const headerMime = req.file.mimetype.toLowerCase();
    if (!ALLOWED_HEADERS.has(headerMime)) {
      return res.status(415).json({ error: "unsupported_mime" });
    }
    const sniffed = sniffMime(req.file.buffer);
    if (!sniffed || sniffed !== headerMime) {
      return res.status(415).json({ error: "mime_mismatch" });
    }
    // Basic disk quota guard.
    if (getUploadDirSize() + req.file.buffer.length > MAX_TOTAL_BYTES) {
      return res.status(507).json({ error: "quota_exceeded" });
    }
    const ext = sniffed === "image/jpeg" ? "jpg" : sniffed === "image/png" ? "png" : "webp";
    const id = randomUUID();
    const filename = `${id}.${ext}`;
    await writeFile(path.join(UPLOAD_DIR, filename), req.file.buffer);
    return res.status(201).json({ url: `/uploads/items/${filename}` });
  } catch (err: any) {
    if (err && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "file_too_large" });
    }
    next(err);
  }
});

export default router;
