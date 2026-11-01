'use strict';

// Box art and screenshots the user uploads, in their own folder per game (user-media/<game id>).
// Never put them under media/<id>: a metadata refresh replaces that whole folder.

const fs = require('fs');
const path = require('path');

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp)$/i;
const MAX_BYTES = 20 * 1024 * 1024;

let seq = 0;

function userDir(mediaRoot, id) {
  return path.join(mediaRoot, path.basename(id));
}

/** Save an uploaded image as `<prefix>-<time>-<n>.<ext>` and return its file name. */
function saveUserImage(mediaRoot, id, { name, data }, prefix) {
  const ext = (String(name).match(IMAGE_EXT) || [])[1];
  if (!ext) throw new Error(`${name} is not an image (PNG, JPEG, GIF, BMP or WebP).`);
  const bytes = Buffer.from(data);
  if (bytes.length > MAX_BYTES) throw new Error(`${name} is larger than 20 MB.`);
  const dir = userDir(mediaRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  seq = (seq + 1) % 10000;
  const file = `${prefix}-${Date.now()}-${String(seq).padStart(4, '0')}.${ext.toLowerCase()}`;
  fs.writeFileSync(path.join(dir, file), bytes);
  return file;
}

/** Full paths of uploaded screenshots, oldest first. */
function listUserShots(mediaRoot, id) {
  const dir = userDir(mediaRoot, id);
  try {
    return fs.readdirSync(dir).filter((f) => f.startsWith('shot-') && IMAGE_EXT.test(f)).sort().map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function userImagePath(mediaRoot, id, file) {
  return file ? path.join(userDir(mediaRoot, id), path.basename(file)) : null;
}

/** Delete an uploaded image. Only the file name is used, so it can't reach outside the folder. */
function removeUserImage(mediaRoot, id, file) {
  fs.rmSync(userImagePath(mediaRoot, id, file), { force: true });
}

module.exports = { saveUserImage, listUserShots, removeUserImage, userImagePath };
