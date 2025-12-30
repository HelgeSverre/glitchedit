#!/usr/bin/env node
/**
 * Generate effect preview images for the help dialog.
 * Uses the shared effects module to apply each effect to a sample image.
 */

import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Import shared effects module
import {
  effectRegistry,
  getDefaultParams
} from '../effects.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREVIEW_SIZE = 120;

async function main() {
  console.log('Generating effect previews...');
  console.log(`Found ${effectRegistry.size} effects`);

  const assetsDir = path.join(__dirname, '..', 'assets');
  const samplePath = path.join(assetsDir, 'sample.png');

  // Ensure assets directory exists
  await fs.mkdir(assetsDir, { recursive: true });

  // Download sample image if it doesn't exist
  try {
    await fs.access(samplePath);
    console.log('Sample image exists.');
  } catch {
    console.log('Downloading sample image from picsum...');
    const response = await fetch('https://picsum.photos/200/200');
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(samplePath, buffer);
    console.log('Sample image saved.');
  }

  // Read and resize sample image
  const { data: rawData, info } = await sharp(samplePath)
    .resize(PREVIEW_SIZE, PREVIEW_SIZE)
    .ensureAlpha() // Ensure 4 channels (RGBA)
    .raw()
    .toBuffer({ resolveWithObject: true });

  console.log(`Image loaded: ${info.width}x${info.height}, ${info.channels} channels`);

  // Convert raw RGBA to PNG-style pixel data (with filter bytes)
  const bytesPerPixel = info.channels;
  const scanlineLength = 1 + info.width * bytesPerPixel;
  const pixelData = new Uint8Array(info.height * scanlineLength);

  for (let y = 0; y < info.height; y++) {
    pixelData[y * scanlineLength] = 0; // Filter byte (None)
    for (let x = 0; x < info.width; x++) {
      const srcIdx = (y * info.width + x) * bytesPerPixel;
      const dstIdx = y * scanlineLength + 1 + x * bytesPerPixel;
      for (let c = 0; c < bytesPerPixel; c++) {
        pixelData[dstIdx + c] = rawData[srcIdx + c];
      }
    }
  }

  const imageInfo = {
    width: info.width,
    height: info.height,
    bytesPerPixel,
    scanlineLength
  };

  // Generate previews
  const previews = {};
  let count = 0;

  for (const [id, effect] of effectRegistry) {
    try {
      const params = getDefaultParams(id);
      const result = effect.apply(new Uint8Array(pixelData), imageInfo, params, 12345);

      // Convert back to raw format (remove filter bytes)
      const rawResult = Buffer.alloc(info.width * info.height * bytesPerPixel);
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const srcIdx = y * scanlineLength + 1 + x * bytesPerPixel;
          const dstIdx = (y * info.width + x) * bytesPerPixel;
          for (let c = 0; c < bytesPerPixel; c++) {
            rawResult[dstIdx + c] = result[srcIdx + c];
          }
        }
      }

      // Convert to PNG base64
      const pngBuffer = await sharp(rawResult, {
        raw: {
          width: info.width,
          height: info.height,
          channels: bytesPerPixel
        }
      }).png().toBuffer();

      previews[id] = `data:image/png;base64,${pngBuffer.toString('base64')}`;
      count++;
      process.stdout.write(`\rProcessed ${count}/${effectRegistry.size} effects...`);
    } catch (err) {
      console.error(`\nError processing ${id}:`, err.message);
      previews[id] = null;
    }
  }

  console.log('\nWriting effect-previews.json...');
  await fs.writeFile(
    path.join(assetsDir, 'effect-previews.json'),
    JSON.stringify(previews, null, 2)
  );

  console.log(`Done! Generated ${count} previews.`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
