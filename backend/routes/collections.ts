import express from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

import { isValidCollection, getKeyField, CollectionItem } from '../config.js';
import { readCollection, writeCollection } from '../services/collection.js';

export const collectionsRouter = express.Router();

// ============================================
// GENERIC COLLECTION ROUTES - MUST BE LAST!
// ============================================

// GET all documents from a collection
collectionsRouter.get('/:collection', async (req: Request, res: Response) => {
  try {
    const { collection } = req.params;

    if (!isValidCollection(collection)) {
      return res.status(400).json({ error: `Invalid collection: ${collection}` });
    }

    const data = await readCollection(collection);
    res.json(data);
  } catch (error: any) {
    console.error('Error in GET /:collection:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET single document from a collection
collectionsRouter.get('/:collection/:id', async (req: Request, res: Response) => {
  try {
    const { collection, id } = req.params;

    if (!isValidCollection(collection)) {
      return res.status(400).json({ error: `Invalid collection: ${collection}` });
    }

    const data = await readCollection(collection);
    const keyField = getKeyField(collection);

    const item = data.find(d => d[keyField] === id);
    if (!item) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(item);
  } catch (error: any) {
    console.error('Error in GET /:collection/:id:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST new document to a collection
collectionsRouter.post('/:collection', async (req: Request, res: Response) => {
  try {
    const { collection } = req.params;

    if (!isValidCollection(collection)) {
      return res.status(400).json({ error: `Invalid collection: ${collection}` });
    }

    const newItem = req.body;
    const keyField = getKeyField(collection);

    console.log(`POST /${collection}:`, { keyField, newItem });

    if (!newItem[keyField]) {
      newItem[keyField] = uuidv4();
    }

    let data: CollectionItem[];
    try {
      data = await readCollection(collection);
    } catch (readError: any) {
      console.error(`Failed to read ${collection} for POST operation:`, readError);
      return res.status(500).json({
        error: `Failed to read existing ${collection} data. Not saving to prevent data loss.`,
        details: readError.message
      });
    }

    if (collection === 'settings') {
      console.log(`Updating setting: ${newItem[keyField]} = ${JSON.stringify(newItem.value)}`);
      console.log(`Current settings count before update: ${data.length}`);

      const existingIndex = data.findIndex(d => d[keyField] === newItem[keyField]);
      if (existingIndex >= 0) {
        data[existingIndex] = { ...data[existingIndex], ...newItem };
      } else {
        data.push(newItem);
      }

      console.log(`Settings count after update: ${data.length}`);
    } else {
      const existingIndex = data.findIndex(d => d[keyField] === newItem[keyField]);
      if (existingIndex >= 0) {
        data[existingIndex] = newItem;
      } else {
        data.push(newItem);
      }
    }

    const writeSuccess = await writeCollection(collection, data);
    if (!writeSuccess) {
      return res.status(500).json({ error: `Failed to write ${collection} data` });
    }

    res.json({ success: true, id: newItem[keyField] });
  } catch (error: any) {
    console.error('Error in POST /:collection:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT update document in a collection
collectionsRouter.put('/:collection/:id', async (req: Request, res: Response) => {
  try {
    const { collection, id } = req.params;

    if (!isValidCollection(collection)) {
      return res.status(400).json({ error: `Invalid collection: ${collection}` });
    }

    const updateData = req.body;
    const keyField = getKeyField(collection);

    const data = await readCollection(collection);
    const index = data.findIndex(d => d[keyField] === id);

    if (index === -1) {
      return res.status(404).json({ error: 'Not found' });
    }

    data[index] = { ...data[index], ...updateData };
    // writeCollection returns false on EACCES/ENOSPC rather than throwing, so the result has to
    // be checked — reporting success for a persist that did not happen leaves the client showing
    // an edit that is not on disk.
    const writeSuccess = await writeCollection(collection, data);
    if (!writeSuccess) {
      return res.status(500).json({ error: `Failed to write ${collection} data` });
    }

    res.json({ success: true, data: data[index] });
  } catch (error: any) {
    console.error('Error in PUT /:collection/:id:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE document from a collection
collectionsRouter.delete('/:collection/:id', async (req: Request, res: Response) => {
  try {
    const { collection, id } = req.params;

    if (!isValidCollection(collection)) {
      return res.status(400).json({ error: `Invalid collection: ${collection}` });
    }

    const keyField = getKeyField(collection);

    const data = await readCollection(collection);
    const index = data.findIndex(d => d[keyField] === id);

    if (index === -1) {
      return res.status(404).json({ error: 'Not found' });
    }

    data.splice(index, 1);
    // Same as PUT: an unchecked write reports a deletion that may still be on disk.
    const writeSuccess = await writeCollection(collection, data);
    if (!writeSuccess) {
      return res.status(500).json({ error: `Failed to write ${collection} data` });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error in DELETE /:collection/:id:', error);
    res.status(500).json({ error: error.message });
  }
});
