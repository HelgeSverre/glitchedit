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
const PREVIEW_SIZE = 140;

// Boost parameters to make effects more visible in previews
function boostParams(id, params) {
  const boosted = { ...params };

  // General boosts for common parameters
  if ('intensity' in boosted) boosted.intensity = Math.min(100, boosted.intensity * 2);
  if ('amount' in boosted) boosted.amount = Math.min(100, boosted.amount * 2);
  if ('strength' in boosted) boosted.strength = Math.min(100, boosted.strength * 2);
  if ('blend' in boosted) boosted.blend = Math.min(100, boosted.blend * 1.5);

  // Effect-specific boosts
  const boosts = {
    'channel-shift': { shiftX: 30, shiftY: 15 },
    'channel-swap': {},
    'chromatic-aberration': { amount: 40 },
    'pixel-sort': { threshold: 40 },
    'block-glitch': { probability: 40, maxShift: 50 },
    'data-mosh': { amount: 60, blockSize: 24 },
    'warp-field': { strength: 60, scale: 40 },
    'color-quantize': { levels: 6 },
    'posterize': { levels: 4 },
    'halftone': { dotSize: 8 },
    'noise-overlay': { amount: 50 },
    'scanline-corrupt': { probability: 40 },
    'bit-crush': { bits: 3 },
    'echo-decay': { echoCount: 5, offsetX: 40, offsetY: 20 },
    'perlin-displace': { strength: 60 },
    'glitch-lines': { probability: 50 },
    'rgb-split': { amount: 30 },
    'pixel-plasma': { frequency: 40, amplitude: 50 },
    'edge-detect': { strength: 80 },
    'color-bleed': { iterations: 8, threshold: 40 },
    'spiral-warp': { strength: 60, turns: 3 },
    'melt': { strength: 60 },
    'crystal': { cellSize: 12 },
    'voronoi': { cells: 80 },
    'reaction-diffusion': { iterations: 15 },
    'life-cycle': { generations: 10 },
    'cellular-automata': { iterations: 8 },
    'fluid-flow': { flowStrength: 60, iterations: 8 }
  };

  if (boosts[id]) {
    Object.assign(boosted, boosts[id]);
  }

  return boosted;
}

async function main() {
  console.log('Generating effect previews...');
  console.log(`Found ${effectRegistry.size} effects`);

  const assetsDir = path.join(__dirname, '..', 'assets');
  const samplePath = path.join(assetsDir, 'sample.png');

  // Ensure assets directory exists
  await fs.mkdir(assetsDir, { recursive: true });

  // Always download a fresh, colorful sample image
  console.log('Downloading sample image...');
  // Use a specific colorful image with good contrast
  const response = await fetch('https://picsum.photos/seed/glitchedit/300/300');
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(samplePath, buffer);
  console.log('Sample image saved.');

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
      const params = boostParams(id, getDefaultParams(id));
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
