import fs from 'node:fs';
import archiver from 'archiver';

import { contentDisposition } from '../util.js';
import { blobPath } from './files.js';

/**
 * Stream a ZIP of the given entries (see `collectZipEntries`) to an HTTP
 * response. Files are appended as streams so memory use stays flat even for
 * multi-gigabyte folders.
 *
 * @param {import('express').Response} res
 * @param {object} config
 * @param {string} ownerId
 * @param {string} downloadName base name for the Content-Disposition header
 * @param {{node: object, archivePath: string}[]} entries
 */
export function sendZip(res, config, ownerId, downloadName, entries) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', contentDisposition('attachment', `${downloadName}.zip`));
  res.setHeader('Cache-Control', 'private, no-store');

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('warning', (error) => {
    if (error.code !== 'ENOENT') console.warn('[zip] warning:', error.message);
  });
  archive.on('error', (error) => {
    console.error('[zip] error:', error.message);
    res.destroy(error);
  });
  archive.pipe(res);

  for (const entry of entries) {
    const stream = fs.createReadStream(blobPath(config, ownerId, entry.node.storage_key ?? entry.node.id));
    stream.on('error', (error) => archive.destroy(error));
    archive.append(stream, { name: entry.archivePath, date: new Date(entry.node.updated_at) });
  }
  archive.finalize().catch((error) => archive.destroy(error));
}
