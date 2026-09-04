import multer from 'multer';
import path from 'path';
import { promises as fs } from 'fs';
import { UPLOADS_DIR } from '../config.js';

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'background-' + uniqueSuffix + ext);
  }
});

// Create multer instance
export const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

export interface UploadedImage {
  filename: string;
  path: string;
  url: string;
}

export async function listUploadedImages(): Promise<UploadedImage[]> {
  try {
    const files = await fs.readdir(UPLOADS_DIR);
    const imageFiles = files.filter(file =>
      /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file)
    );

    return imageFiles.map(filename => ({
      filename,
      path: `/uploads/${filename}`,
      url: `/uploads/${filename}`
    }));
  } catch (error) {
    console.error('Error listing uploaded images:', error);
    return [];
  }
}

// ---------------------------------------------------------------------------------------------
// Sound uploads
// ---------------------------------------------------------------------------------------------

/**
 * Sound files an operator uploads from the Settings screen.
 *
 * They land in the same persisted volume as background images, which is the point: `public/sounds`
 * is baked into the container image, so anything added there is lost on the next deploy.
 *
 * The old "upload sound" button did not upload anything — it handed the file back to the
 * operator's own browser as a download and asked them to copy it into the source tree, then
 * wrote metadata to a `sounds` collection the backend does not accept, so the request always
 * failed. This replaces it.
 */
const soundStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    // Keep the operator's own name — it is what they will look for in the sound dropdowns — but
    // strip anything that could escape the directory or confuse a URL.
    const ext = path.extname(file.originalname).toLowerCase();
    const stem = path
      .basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    cb(null, `sound-${Date.now()}-${stem || 'upload'}${ext}`);
  }
});

export const uploadSound = multer({
  storage: soundStorage,
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const isMp3 = file.mimetype === 'audio/mpeg' || /\.mp3$/i.test(file.originalname);
    if (isMp3) {
      cb(null, true);
    } else {
      cb(new Error('Only MP3 audio files are allowed'));
    }
  }
});

export interface UploadedSound {
  filename: string;
  url: string;
  size: number;
}

export async function listUploadedSounds(): Promise<UploadedSound[]> {
  try {
    const files = await fs.readdir(UPLOADS_DIR);
    const sounds = files.filter(file => file.startsWith('sound-') && /\.mp3$/i.test(file));

    return await Promise.all(
      sounds.map(async filename => {
        const stats = await fs.stat(path.join(UPLOADS_DIR, filename));
        return { filename, url: `/uploads/${filename}`, size: stats.size };
      })
    );
  } catch (error) {
    console.error('Error listing uploaded sounds:', error);
    return [];
  }
}

/**
 * Delete one uploaded sound.
 *
 * The filename arrives in the URL, so it is attacker-controlled: it is reduced to its basename
 * and required to match the exact shape this service writes before anything is unlinked.
 * Without that, `../../data/winners.json` would be a valid request.
 */
export async function deleteUploadedSound(filename: string): Promise<boolean> {
  const safe = path.basename(filename);
  if (!/^sound-\d+-[a-zA-Z0-9._-]*\.mp3$/i.test(safe)) return false;

  const resolved = path.resolve(path.join(UPLOADS_DIR, safe));
  if (!resolved.startsWith(path.resolve(UPLOADS_DIR) + path.sep)) return false;

  try {
    await fs.unlink(resolved);
    return true;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
