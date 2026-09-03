import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR, UPLOADS_DIR, CollectionItem, CollectionName } from '../config.js';

export async function ensureDataDir(): Promise<void> {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });

    const collections: CollectionName[] = ['lists', 'winners', 'prizes', 'history', 'settings', 'backups'];
    for (const collection of collections) {
      const filePath = path.join(DATA_DIR, `${collection}.json`);
      await fs.writeFile(filePath, '[]', 'utf8');
    }
    console.log('Data directory initialized');
  }

  // Ensure uploads directory exists
  try {
    await fs.access(UPLOADS_DIR);
  } catch {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    console.log('Uploads directory initialized');
  }
}

/**
 * Reads a collection from disk.
 *
 * An empty array is returned for exactly ONE case: the file does not exist yet. That is the
 * only state that genuinely means "no data", and it is how every collection starts.
 *
 * Every other failure throws, because of what callers do with the result: `POST /:collection`
 * and `/batch-save` read the collection, merge the incoming item into it, and write the whole
 * thing back. An empty array handed back for a file that DOES exist is therefore not a safe
 * default — it is total data loss on the very next save, and the file left behind looks
 * perfectly valid, so nothing ever reports it.
 *
 * That is not hypothetical. `settings` used to be exempted here and returned [] on a parse
 * error; winner-app's production settings were reduced to just the single key that happened to
 * be saved next, with nothing in the file or the response to indicate anything had gone wrong.
 * Failing loudly leaves the damaged file intact and recoverable instead.
 */
export async function readCollection(collection: string): Promise<CollectionItem[]> {
  const filePath = path.join(DATA_DIR, `${collection}.json`);

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error: any) {
    // A missing file is the one benign case: the collection has never been written.
    if (error.code === 'ENOENT') {
      console.log(`Collection ${collection} doesn't exist yet, will be created`);
      return [];
    }
    // Anything else (permissions, I/O) must not be mistaken for "no data".
    console.error(`Error reading ${collection}:`, error);
    throw new Error(`Failed to read collection ${collection}: ${error.message}`);
  }

  // A zero-byte file is corruption, never something this app produced: writeCollection
  // serialises even an empty collection as "[]". Reading it as "no data" would let the next
  // save overwrite a truncated file with whichever single item was being written.
  if (raw.trim() === '') {
    throw new Error(
      `${collection}.json is empty (0 bytes). This app never writes a 0-byte collection file, ` +
      `so it is being treated as corruption rather than as an empty collection. Restore it from ` +
      `a backup, or write "[]" into it to deliberately start the collection over.`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (parseError: any) {
    throw new Error(`Corrupted JSON in ${collection}.json: ${parseError.message}`);
  }

  // Guard the shape too: a file containing `{}` or `null` parses fine, then fails deep inside a
  // caller's .findIndex/.filter with a message that says nothing about the real problem.
  if (!Array.isArray(parsed)) {
    throw new Error(
      `${collection}.json does not contain a JSON array (got ${parsed === null ? 'null' : typeof parsed}).`
    );
  }

  return parsed as CollectionItem[];
}

/**
 * Writes a collection to disk atomically: serialise into a temp file in the same directory,
 * flush it to stable storage, then rename over the target. Rename within a directory is atomic,
 * so a reader sees either the whole old file or the whole new one — never a partial write.
 *
 * The fsync is what makes that hold across a crash or power loss. Without it the rename can
 * reach the disk before the file contents do, leaving a ZERO-LENGTH file — which is exactly the
 * corruption `readCollection` now refuses to mistake for an empty collection.
 *
 * There is deliberately NO fallback to writing the target directly. The previous version did
 * that whenever the atomic path failed, and a direct write truncates the live file before it
 * writes a byte — so the fallback turned "could not write safely" into "destroyed the existing
 * data", and then returned true. Returning false instead leaves the good file in place; every
 * caller already branches on it to decide its status code.
 */
export async function writeCollection(collection: string, data: CollectionItem[]): Promise<boolean> {
  const filePath = path.join(DATA_DIR, `${collection}.json`);
  // Unique per write: a fixed temp name lets two concurrent writes to the same collection
  // clobber each other's temp file, so one rename publishes the other's data and the loser
  // fails on a file that is already gone. Settings in particular are saved in rapid bursts.
  const tempPath = path.join(
    DATA_DIR,
    `.${collection}.json.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`
  );

  try {
    // Ensure directory exists before writing
    await fs.mkdir(DATA_DIR, { recursive: true });

    const serialised = JSON.stringify(data, null, 2);
    const handle = await fs.open(tempPath, 'w');
    try {
      await handle.writeFile(serialised, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    // Atomic rename (temp and target are in the same directory, so always same filesystem)
    await fs.rename(tempPath, filePath);

    console.log(`Successfully wrote ${data.length} items to ${collection}.json`);
    return true;

  } catch (error: any) {
    // The existing file was never opened for writing, so it is still intact. Drop the partial
    // temp file so a failed write leaves nothing behind.
    try {
      await fs.unlink(tempPath);
    } catch {
      // Never created, or already gone — nothing to clean up.
    }

    console.error(`Error writing ${collection}:`, error);
    if (error.code === 'EACCES') {
      console.error(`Permission denied writing to ${collection}.json. Check file/directory permissions.`);
    } else if (error.code === 'ENOSPC') {
      console.error(`No space left on device while writing ${collection}.json — existing data left untouched.`);
    } else if (error.code === 'ENOENT') {
      console.error(`Failed to create directory or write file for ${collection}.json`);
    }
    return false;
  }
}
