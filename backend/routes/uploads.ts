import express from 'express';
import type { Request, Response } from 'express';

import {
  upload,
  uploadSound,
  listUploadedImages,
  listUploadedSounds,
  deleteUploadedSound
} from '../services/upload.js';

export const uploadsRouter = express.Router();

// Get list of uploaded images
uploadsRouter.get('/uploaded-images', async (req: Request, res: Response) => {
  const images = await listUploadedImages();
  res.json(images);
});

// Image upload endpoint
uploadsRouter.post('/upload-background', upload.single('image'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const imagePath = `/uploads/${req.file.filename}`;
    res.json({ success: true, imagePath });
  } catch (error: any) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: error.message });
  }
});

// Sound files an operator has uploaded, from the persisted volume.
uploadsRouter.get('/uploaded-sounds', async (req: Request, res: Response) => {
  const sounds = await listUploadedSounds();
  res.json(sounds);
});

uploadsRouter.post('/upload-sound', uploadSound.single('sound'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    res.json({
      filename: req.file.filename,
      url: `/uploads/${req.file.filename}`,
      size: req.file.size
    });
  } catch (error: any) {
    console.error('Error uploading sound:', error);
    res.status(500).json({ error: error.message });
  }
});

uploadsRouter.delete('/uploaded-sounds/:filename', async (req: Request, res: Response) => {
  try {
    const removed = await deleteUploadedSound(req.params.filename ?? '');
    if (!removed) {
      return res.status(404).json({ error: 'Sound not found' });
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting sound:', error);
    res.status(500).json({ error: error.message });
  }
});
