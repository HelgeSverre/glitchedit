/**
 * GLITCHEDIT Effects Module
 * Shared between browser and Node.js generator
 */

// ========== EFFECT REGISTRY ==========

export const effectRegistry = new Map();

export function registerEffect(descriptor) {
  effectRegistry.set(descriptor.id, descriptor);
}

// Seeded random number generator (mulberry32)
export function createSeededRNG(seed) {
  return function() {
let t = seed += 0x6D2B79F5;
t = Math.imul(t ^ t >>> 15, t | 1);
t ^= t + Math.imul(t ^ t >>> 7, t | 61);
return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Logarithmic scale for subtle effect control
export function logScale(value, max, actualMax, power = 2.5) {
  return Math.pow(value / max, power) * actualMax;
}

// Bidirectional log scale (for values that can be negative)
export function logScaleBidirectional(value, max, actualMax, power = 2.5) {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.pow(Math.abs(value) / max, power) * actualMax;
}

// Simplex noise implementation (fast 2D noise)
export const simplexNoise = (() => {
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  const grad3 = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  let perm = new Uint8Array(512);

  function seed(s) {
const rng = createSeededRNG(s);
const p = new Uint8Array(256);
for (let i = 0; i < 256; i++) p[i] = i;
for (let i = 255; i > 0; i--) {
  const j = Math.floor(rng() * (i + 1));
  [p[i], p[j]] = [p[j], p[i]];
}
for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  }
  seed(0);

  function noise2D(x, y) {
const s = (x + y) * F2;
const i = Math.floor(x + s), j = Math.floor(y + s);
const t = (i + j) * G2;
const X0 = i - t, Y0 = j - t;
const x0 = x - X0, y0 = y - Y0;
const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
const ii = i & 255, jj = j & 255;
const gi0 = perm[ii + perm[jj]] & 7;
const gi1 = perm[ii + i1 + perm[jj + j1]] & 7;
const gi2 = perm[ii + 1 + perm[jj + 1]] & 7;
let n0 = 0, n1 = 0, n2 = 0;
let t0 = 0.5 - x0*x0 - y0*y0;
if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * (grad3[gi0][0]*x0 + grad3[gi0][1]*y0); }
let t1 = 0.5 - x1*x1 - y1*y1;
if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * (grad3[gi1][0]*x1 + grad3[gi1][1]*y1); }
let t2 = 0.5 - x2*x2 - y2*y2;
if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * (grad3[gi2][0]*x2 + grad3[gi2][1]*y2); }
return 70 * (n0 + n1 + n2);
  }

  function fbm(x, y, octaves = 4, lacunarity = 2, persistence = 0.5) {
let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
for (let i = 0; i < octaves; i++) {
  value += amplitude * noise2D(x * frequency, y * frequency);
  maxValue += amplitude;
  amplitude *= persistence;
  frequency *= lacunarity;
}
return value / maxValue;
  }

  return { seed, noise2D, fbm };
})();

// Get default parameters for an effect
export function getDefaultParams(effectId) {
  const effect = effectRegistry.get(effectId);
  if (!effect) return {};
  const params = {};
  for (const param of effect.parameters) {
params[param.id] = param.default;
  }
  return params;
}

// ========== EFFECTS ==========

registerEffect({
  id: 'filter-byte',
  name: 'Filter Byte',
  category: 'filter',
  icon: '⬓',
  parameters: [
    { id: 'filterType', type: 'dropdown', label: 'Type', default: 1,
      options: [
        { value: 0, label: 'None' },
        { value: 1, label: 'Sub (→)' },
        { value: 2, label: 'Up (↓)' },
        { value: 3, label: 'Average' },
        { value: 4, label: 'Paeth' }
      ]
    },
    { id: 'probability', type: 'slider', label: 'Amount', default: 5, min: 1, max: 100, step: 1, unit: '%' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);
    const { height, scanlineLength } = imageInfo;
    const prob = params.probability / 100;

    for (let y = 0; y < height; y++) {
      if (rng() < prob) {
        result[y * scanlineLength] = params.filterType;
      }
    }
    return result;
  }
});

// Channel Shift Effect (logarithmic scaling for subtle control)
registerEffect({
  id: 'channel-shift',
  name: 'Channel Shift',
  category: 'channel',
  icon: '↔',
  parameters: [
    { id: 'redShift', type: 'slider', label: 'Red', default: 3, min: -50, max: 50, step: 1, unit: '' },
    { id: 'greenShift', type: 'slider', label: 'Green', default: 0, min: -50, max: 50, step: 1, unit: '' },
    { id: 'blueShift', type: 'slider', label: 'Blue', default: -3, min: -50, max: 50, step: 1, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    if (bytesPerPixel < 3) return pixelData;

    const result = new Uint8Array(pixelData);
    // Log scale: slider ±50 maps to ±30px actual shift
    const rShift = Math.round(logScaleBidirectional(params.redShift, 50, 30));
    const gShift = Math.round(logScaleBidirectional(params.greenShift, 50, 30));
    const bShift = Math.round(logScaleBidirectional(params.blueShift, 50, 30));

    for (let y = 0; y < height; y++) {
      const rowStart = y * scanlineLength + 1;
      for (let x = 0; x < width; x++) {
        const pixelOffset = rowStart + x * bytesPerPixel;
        const rSrcX = ((x + rShift) % width + width) % width;
        const gSrcX = ((x + gShift) % width + width) % width;
        const bSrcX = ((x + bShift) % width + width) % width;

        result[pixelOffset] = pixelData[rowStart + rSrcX * bytesPerPixel];
        result[pixelOffset + 1] = pixelData[rowStart + gSrcX * bytesPerPixel + 1];
        result[pixelOffset + 2] = pixelData[rowStart + bSrcX * bytesPerPixel + 2];
      }
    }
    return result;
  }
});

// Scanline Corrupt Effect (logarithmic scaling)
registerEffect({
  id: 'scanline-corrupt',
  name: 'Scanline Corrupt',
  category: 'distortion',
  icon: '≡',
  parameters: [
    { id: 'interval', type: 'slider', label: 'Interval', default: 30, min: 5, max: 100, step: 1, unit: 'px' },
    { id: 'intensity', type: 'slider', label: 'Intensity', default: 10, min: 1, max: 100, step: 1, unit: '' },
    { id: 'shift', type: 'slider', label: 'Shift', default: 10, min: 1, max: 100, step: 1, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);
    const { height, scanlineLength } = imageInfo;
    const { interval } = params;
    // Log scale: slider maps to actual percentage/amount
    const actualIntensity = logScale(params.intensity, 100, 30); // max 30% of scanline
    const actualShift = logScale(params.shift, 100, 80); // max ±80 byte shift

    for (let y = 0; y < height; y += interval) {
      const rowStart = y * scanlineLength + 1;
      const corruptCount = Math.floor((scanlineLength - 1) * (actualIntensity / 100));

      for (let i = 0; i < corruptCount; i++) {
        const offset = rowStart + Math.floor(rng() * (scanlineLength - 1));
        const delta = Math.floor(rng() * actualShift * 2) - actualShift;
        result[offset] = Math.max(0, Math.min(255, result[offset] + delta));
      }
    }
    return result;
  }
});

// Pixel Sort Effect
registerEffect({
  id: 'pixel-sort',
  name: 'Pixel Sort',
  category: 'sorting',
  icon: '▤',
  parameters: [
    { id: 'threshold', type: 'slider', label: 'Threshold', default: 128, min: 0, max: 255, step: 1, unit: '' },
    { id: 'rowSkip', type: 'slider', label: 'Row Skip', default: 4, min: 1, max: 20, step: 1, unit: '' },
    { id: 'maxLength', type: 'slider', label: 'Max Length', default: 30, min: 10, max: 500, step: 5, unit: 'px' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    if (bytesPerPixel < 3) return pixelData;

    const result = new Uint8Array(pixelData);
    const { threshold, rowSkip, maxLength } = params;

    for (let y = 0; y < height; y += rowSkip) {
      const rowStart = y * scanlineLength + 1;
      const pixels = [];

      for (let x = 0; x < width; x++) {
        const offset = rowStart + x * bytesPerPixel;
        const r = pixelData[offset], g = pixelData[offset + 1], b = pixelData[offset + 2];
        pixels.push({ x, r, g, b, brightness: (r + g + b) / 3,
          a: bytesPerPixel > 3 ? pixelData[offset + 3] : 255 });
      }

      let intervalStart = -1;
      for (let x = 0; x <= width; x++) {
        const bright = x < width ? pixels[x].brightness > threshold : false;
        if (bright && intervalStart === -1) {
          intervalStart = x;
        } else if (!bright && intervalStart !== -1) {
          const len = Math.min(x - intervalStart, maxLength);
          const interval = pixels.slice(intervalStart, intervalStart + len);
          interval.sort((a, b) => a.brightness - b.brightness);

          for (let i = 0; i < interval.length; i++) {
            const destOffset = rowStart + (intervalStart + i) * bytesPerPixel;
            result[destOffset] = interval[i].r;
            result[destOffset + 1] = interval[i].g;
            result[destOffset + 2] = interval[i].b;
            if (bytesPerPixel > 3) result[destOffset + 3] = interval[i].a;
          }
          intervalStart = -1;
        }
      }
    }
    return result;
  }
});

// Displacement Effect (logarithmic scale for fine control at low values)
registerEffect({
  id: 'displacement',
  name: 'Displacement',
  category: 'distortion',
  icon: '〰',
  parameters: [
    { id: 'amount', type: 'slider', label: 'Amount', default: 10, min: 1, max: 100, step: 1, unit: '' },
    { id: 'direction', type: 'dropdown', label: 'Direction', default: 'horizontal',
      options: [
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical', label: 'Vertical' },
        { value: 'both', label: 'Both' }
      ]
    }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const { direction } = params;
    // Logarithmic scale: slider 1-100 maps to ~0.1-30px
    const logAmount = Math.pow(params.amount / 100, 2) * 30;

    for (let y = 0; y < height; y++) {
      const rowStart = y * scanlineLength + 1;
      for (let x = 0; x < width; x++) {
        const srcOffset = rowStart + x * bytesPerPixel;
        const brightness = (pixelData[srcOffset] + pixelData[srcOffset + 1] + pixelData[srcOffset + 2]) / 3;
        const displacement = Math.floor((brightness / 255) * logAmount);

        let srcX = x, srcY = y;
        if (direction === 'horizontal' || direction === 'both') {
          srcX = ((x - displacement) % width + width) % width;
        }
        if (direction === 'vertical' || direction === 'both') {
          srcY = ((y - displacement) % height + height) % height;
        }

        const srcPixelOffset = srcY * scanlineLength + 1 + srcX * bytesPerPixel;
        for (let c = 0; c < bytesPerPixel; c++) {
          result[srcOffset + c] = pixelData[srcPixelOffset + c];
        }
      }
    }
    return result;
  }
});

// Block Glitch Effect (logarithmic scaling)
registerEffect({
  id: 'block-glitch',
  name: 'Block Glitch',
  category: 'distortion',
  icon: '▦',
  parameters: [
    { id: 'blockSize', type: 'slider', label: 'Block Size', default: 32, min: 8, max: 128, step: 4, unit: 'px' },
    { id: 'probability', type: 'slider', label: 'Probability', default: 8, min: 1, max: 100, step: 1, unit: '' },
    { id: 'maxShift', type: 'slider', label: 'Max Shift', default: 10, min: 1, max: 100, step: 1, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);
    const { blockSize } = params;
    // Log scale for probability and shift
    const actualProb = logScale(params.probability, 100, 40); // max 40%
    const actualShift = logScale(params.maxShift, 100, 150); // max 150px

    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);

    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        if (rng() * 100 > actualProb) continue;

        const shiftX = Math.floor(rng() * actualShift * 2) - actualShift;
        const startX = bx * blockSize;
        const startY = by * blockSize;
        const endX = Math.min(startX + blockSize, width);
        const endY = Math.min(startY + blockSize, height);

        for (let y = startY; y < endY; y++) {
          const rowStart = y * scanlineLength + 1;
          for (let x = startX; x < endX; x++) {
            const srcX = ((x + shiftX) % width + width) % width;
            const destOffset = rowStart + x * bytesPerPixel;
            const srcOffset = rowStart + srcX * bytesPerPixel;
            for (let c = 0; c < bytesPerPixel; c++) {
              result[destOffset + c] = pixelData[srcOffset + c];
            }
          }
        }
      }
    }
    return result;
  }
});

// Color Quantize Effect
registerEffect({
  id: 'color-quantize',
  name: 'Color Quantize',
  category: 'color',
  icon: '◧',
  parameters: [
    { id: 'levels', type: 'slider', label: 'Levels', default: 16, min: 2, max: 32, step: 1, unit: '' },
    { id: 'dither', type: 'checkbox', label: 'Dither', default: false }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);
    const { levels, dither } = params;
    const step = 255 / (levels - 1);

    for (let y = 0; y < height; y++) {
      const rowStart = y * scanlineLength + 1;
      for (let x = 0; x < width; x++) {
        const offset = rowStart + x * bytesPerPixel;
        for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
          let val = pixelData[offset + c];
          if (dither) val += (rng() - 0.5) * step;
          result[offset + c] = Math.round(val / step) * step;
        }
      }
    }
    return result;
  }
});

// Noise Injection Effect (logarithmic scaling)
registerEffect({
  id: 'noise',
  name: 'Noise',
  category: 'color',
  icon: '▒',
  parameters: [
    { id: 'amount', type: 'slider', label: 'Amount', default: 8, min: 1, max: 100, step: 1, unit: '' },
    { id: 'monochrome', type: 'checkbox', label: 'Mono', default: false }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);
    const { monochrome } = params;
    // Log scale: slider 1-100 maps to 1-60 actual noise range
    const actualAmount = logScale(params.amount, 100, 60);

    for (let y = 0; y < height; y++) {
      const rowStart = y * scanlineLength + 1;
      for (let x = 0; x < width; x++) {
        const offset = rowStart + x * bytesPerPixel;
        if (monochrome) {
          const noise = (rng() - 0.5) * actualAmount * 2;
          for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
            result[offset + c] = Math.max(0, Math.min(255, pixelData[offset + c] + noise));
          }
        } else {
          for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
            const noise = (rng() - 0.5) * actualAmount * 2;
            result[offset + c] = Math.max(0, Math.min(255, pixelData[offset + c] + noise));
          }
        }
      }
    }
    return result;
  }
});

// ========== PROBABILITY-BASED EFFECTS ==========

// Bit Flip Effect - randomly flip bits in pixel values
registerEffect({
  id: 'bit-flip',
  name: 'Bit Flip',
  category: 'distortion',
  icon: '⊕',
  parameters: [
    { id: 'probability', type: 'slider', label: 'Probability', default: 1, min: 0.1, max: 10, step: 0.1, unit: '%' },
    { id: 'bits', type: 'slider', label: 'Bits', default: 2, min: 1, max: 8, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);
    const { probability, bits } = params;
    const prob = probability / 100;

    for (let y = 0; y < height; y++) {
      const rowStart = y * scanlineLength + 1;
      for (let x = 0; x < width; x++) {
        const offset = rowStart + x * bytesPerPixel;
        for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
          if (rng() < prob) {
            // Flip random bits
            let mask = 0;
            for (let b = 0; b < bits; b++) {
              mask |= (1 << Math.floor(rng() * 8));
            }
            result[offset + c] = pixelData[offset + c] ^ mask;
          }
        }
      }
    }
    return result;
  }
});

// Pixel Dropout Effect - randomly drop pixels
registerEffect({
  id: 'pixel-dropout',
  name: 'Pixel Dropout',
  category: 'distortion',
  icon: '◌',
  parameters: [
    { id: 'probability', type: 'slider', label: 'Probability', default: 2, min: 0.1, max: 20, step: 0.1, unit: '%' },
    { id: 'mode', type: 'dropdown', label: 'Mode', default: 'black',
      options: [
        { value: 'black', label: 'Black' },
        { value: 'white', label: 'White' },
        { value: 'random', label: 'Random' },
        { value: 'invert', label: 'Invert' }
      ]
    }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);
    const { probability, mode } = params;
    const prob = probability / 100;

    for (let y = 0; y < height; y++) {
      const rowStart = y * scanlineLength + 1;
      for (let x = 0; x < width; x++) {
        if (rng() < prob) {
          const offset = rowStart + x * bytesPerPixel;
          for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
            if (mode === 'black') result[offset + c] = 0;
            else if (mode === 'white') result[offset + c] = 255;
            else if (mode === 'random') result[offset + c] = Math.floor(rng() * 256);
            else if (mode === 'invert') result[offset + c] = 255 - pixelData[offset + c];
          }
        }
      }
    }
    return result;
  }
});

// Channel Swap Effect - randomly swap RGB channels
registerEffect({
  id: 'channel-swap',
  name: 'Channel Swap',
  category: 'channel',
  icon: '⇄',
  parameters: [
    { id: 'probability', type: 'slider', label: 'Probability', default: 5, min: 0.5, max: 50, step: 0.5, unit: '%' },
    { id: 'swapType', type: 'dropdown', label: 'Swap', default: 'random',
      options: [
        { value: 'random', label: 'Random' },
        { value: 'rgb-bgr', label: 'R↔B' },
        { value: 'rgb-grb', label: 'R↔G' },
        { value: 'rgb-rbg', label: 'G↔B' }
      ]
    }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    if (bytesPerPixel < 3) return pixelData;
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);
    const { probability, swapType } = params;
    const prob = probability / 100;

    for (let y = 0; y < height; y++) {
      const rowStart = y * scanlineLength + 1;
      for (let x = 0; x < width; x++) {
        if (rng() < prob) {
          const offset = rowStart + x * bytesPerPixel;
          const r = pixelData[offset], g = pixelData[offset + 1], b = pixelData[offset + 2];

          let swap = swapType;
          if (swap === 'random') {
            const swaps = ['rgb-bgr', 'rgb-grb', 'rgb-rbg'];
            swap = swaps[Math.floor(rng() * 3)];
          }

          if (swap === 'rgb-bgr') { result[offset] = b; result[offset + 2] = r; }
          else if (swap === 'rgb-grb') { result[offset] = g; result[offset + 1] = r; }
          else if (swap === 'rgb-rbg') { result[offset + 1] = b; result[offset + 2] = g; }
        }
      }
    }
    return result;
  }
});

// Data Mosh Effect - copy random blocks from elsewhere (logarithmic scaling)
registerEffect({
  id: 'data-mosh',
  name: 'Data Mosh',
  category: 'distortion',
  icon: '▧',
  parameters: [
    { id: 'probability', type: 'slider', label: 'Probability', default: 8, min: 1, max: 100, step: 1, unit: '' },
    { id: 'blockSize', type: 'slider', label: 'Block Size', default: 16, min: 4, max: 64, step: 2, unit: 'px' },
    { id: 'maxDistance', type: 'slider', label: 'Distance', default: 10, min: 1, max: 100, step: 1, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);
    const { blockSize } = params;
    // Log scale for probability and distance
    const prob = logScale(params.probability, 100, 25) / 100; // max 25%
    const actualDistance = logScale(params.maxDistance, 100, 300); // max 300px

    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);

    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        if (rng() >= prob) continue;

        // Source block position (random offset from current)
        const offsetX = Math.floor(rng() * actualDistance * 2) - actualDistance;
        const offsetY = Math.floor(rng() * actualDistance * 2) - actualDistance;

        const startX = bx * blockSize;
        const startY = by * blockSize;
        const endX = Math.min(startX + blockSize, width);
        const endY = Math.min(startY + blockSize, height);

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const srcX = ((x + offsetX) % width + width) % width;
            const srcY = ((y + offsetY) % height + height) % height;

            const destOffset = y * scanlineLength + 1 + x * bytesPerPixel;
            const srcOffset = srcY * scanlineLength + 1 + srcX * bytesPerPixel;

            for (let c = 0; c < bytesPerPixel; c++) {
              result[destOffset + c] = pixelData[srcOffset + c];
            }
          }
        }
      }
    }
    return result;
  }
});

// Glitch Lines Effect - random horizontal line shifts (logarithmic scaling)
registerEffect({
  id: 'glitch-lines',
  name: 'Glitch Lines',
  category: 'distortion',
  icon: '═',
  parameters: [
    { id: 'probability', type: 'slider', label: 'Probability', default: 8, min: 1, max: 100, step: 1, unit: '' },
    { id: 'maxShift', type: 'slider', label: 'Max Shift', default: 8, min: 1, max: 100, step: 1, unit: '' },
    { id: 'thickness', type: 'slider', label: 'Thickness', default: 2, min: 1, max: 20, step: 1, unit: 'px' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);
    const { thickness } = params;
    // Log scale for probability and shift
    const prob = logScale(params.probability, 100, 20) / 100; // max 20%
    const actualShift = logScale(params.maxShift, 100, 150); // max 150px

    for (let y = 0; y < height; y++) {
      if (rng() < prob) {
        const shift = Math.floor(rng() * actualShift * 2) - actualShift;
        const lineThickness = Math.min(thickness, height - y);

        for (let dy = 0; dy < lineThickness; dy++) {
          const rowStart = (y + dy) * scanlineLength + 1;
          for (let x = 0; x < width; x++) {
            const srcX = ((x + shift) % width + width) % width;
            const destOffset = rowStart + x * bytesPerPixel;
            const srcOffset = rowStart + srcX * bytesPerPixel;

            for (let c = 0; c < bytesPerPixel; c++) {
              result[destOffset + c] = pixelData[srcOffset + c];
            }
          }
        }
        y += lineThickness - 1; // Skip processed lines
      }
    }
    return result;
  }
});

// Sparkle Effect - random bright/dark pixels (salt & pepper)
registerEffect({
  id: 'sparkle',
  name: 'Sparkle',
  category: 'color',
  icon: '✦',
  parameters: [
    { id: 'probability', type: 'slider', label: 'Probability', default: 1, min: 0.1, max: 10, step: 0.1, unit: '%' },
    { id: 'brightness', type: 'slider', label: 'Brightness', default: 50, min: 0, max: 100, unit: '%' },
    { id: 'colorful', type: 'checkbox', label: 'Colorful', default: false }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);
    const { probability, brightness, colorful } = params;
    const prob = probability / 100;
    const brightProb = brightness / 100;

    for (let y = 0; y < height; y++) {
      const rowStart = y * scanlineLength + 1;
      for (let x = 0; x < width; x++) {
        if (rng() < prob) {
          const offset = rowStart + x * bytesPerPixel;
          const isBright = rng() < brightProb;

          if (colorful) {
            for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
              result[offset + c] = isBright ?
                Math.floor(200 + rng() * 55) :
                Math.floor(rng() * 55);
            }
          } else {
            const val = isBright ? 255 : 0;
            for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
              result[offset + c] = val;
            }
          }
        }
      }
    }
    return result;
  }
});

// Chromatic Aberration Effect - edge-based RGB split (logarithmic scaling)
registerEffect({
  id: 'chromatic-aberration',
  name: 'Chromatic Aberr.',
  category: 'channel',
  icon: '◐',
  parameters: [
    { id: 'amount', type: 'slider', label: 'Amount', default: 5, min: 1, max: 100, step: 1, unit: '' },
    { id: 'angle', type: 'slider', label: 'Angle', default: 0, min: 0, max: 360, step: 5, unit: '°' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    if (bytesPerPixel < 3) return pixelData;
    const result = new Uint8Array(pixelData);
    const { angle } = params;
    // Log scale: slider 1-100 maps to 0.5-20px actual offset
    const actualAmount = logScale(params.amount, 100, 20);

    const rad = angle * Math.PI / 180;
    const rOffsetX = Math.round(Math.cos(rad) * actualAmount);
    const rOffsetY = Math.round(Math.sin(rad) * actualAmount);
    const bOffsetX = Math.round(Math.cos(rad + Math.PI) * actualAmount);
    const bOffsetY = Math.round(Math.sin(rad + Math.PI) * actualAmount);

    for (let y = 0; y < height; y++) {
      const rowStart = y * scanlineLength + 1;
      for (let x = 0; x < width; x++) {
        const offset = rowStart + x * bytesPerPixel;

        // Red channel offset
        const rSrcX = ((x + rOffsetX) % width + width) % width;
        const rSrcY = ((y + rOffsetY) % height + height) % height;
        const rSrcOffset = rSrcY * scanlineLength + 1 + rSrcX * bytesPerPixel;

        // Blue channel offset (opposite direction)
        const bSrcX = ((x + bOffsetX) % width + width) % width;
        const bSrcY = ((y + bOffsetY) % height + height) % height;
        const bSrcOffset = bSrcY * scanlineLength + 1 + bSrcX * bytesPerPixel;

        result[offset] = pixelData[rSrcOffset];     // R
        result[offset + 1] = pixelData[offset + 1]; // G stays
        result[offset + 2] = pixelData[bSrcOffset + 2]; // B
      }
    }
    return result;
  }
});

// ========== ADVANCED CREATIVE EFFECTS ==========

// Warp Field - Perlin/Simplex noise displacement
registerEffect({
  id: 'warp-field',
  name: 'Warp Field',
  category: 'distortion',
  icon: '◎',
  parameters: [
    { id: 'amount', type: 'slider', label: 'Amount', default: 10, min: 1, max: 100, step: 1, unit: '' },
    { id: 'scale', type: 'slider', label: 'Scale', default: 30, min: 5, max: 100, step: 1, unit: '' },
    { id: 'octaves', type: 'slider', label: 'Detail', default: 3, min: 1, max: 6, step: 1, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    simplexNoise.seed(seed);
    const amount = logScale(params.amount, 100, 50);
    const scale = logScale(params.scale, 100, 0.02);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = simplexNoise.fbm(x * scale, y * scale, params.octaves);
        const ny = simplexNoise.fbm(x * scale + 100, y * scale + 100, params.octaves);
        const srcX = Math.floor(((x + nx * amount) % width + width) % width);
        const srcY = Math.floor(((y + ny * amount) % height + height) % height);
        const destOffset = y * scanlineLength + 1 + x * bytesPerPixel;
        const srcOffset = srcY * scanlineLength + 1 + srcX * bytesPerPixel;
        for (let c = 0; c < bytesPerPixel; c++) {
          result[destOffset + c] = pixelData[srcOffset + c];
        }
      }
    }
    return result;
  }
});

// Halftone - Bayer matrix ordered dithering
registerEffect({
  id: 'halftone',
  name: 'Halftone',
  category: 'color',
  icon: '▣',
  parameters: [
    { id: 'levels', type: 'slider', label: 'Levels', default: 6, min: 2, max: 16, step: 1, unit: '' },
    { id: 'matrixSize', type: 'dropdown', label: 'Pattern', default: 4,
      options: [
        { value: 2, label: '2×2' },
        { value: 4, label: '4×4' },
        { value: 8, label: '8×8' }
      ]
    },
    { id: 'colorMode', type: 'dropdown', label: 'Color', default: 'rgb',
      options: [
        { value: 'mono', label: 'Mono' },
        { value: 'rgb', label: 'RGB' }
      ]
    }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const { levels, matrixSize, colorMode } = params;

    // Bayer matrices
    const bayer2 = [[0,2],[3,1]];
    const bayer4 = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
    const bayer8 = [];
    for (let i = 0; i < 8; i++) {
      bayer8[i] = [];
      for (let j = 0; j < 8; j++) {
        const x = (i & 4) >> 2 | (j & 4) >> 1 | (i & 2) | (j & 2) << 1 | (i & 1) << 2 | (j & 1) << 3;
        bayer8[i][j] = x;
      }
    }
    const matrices = { 2: bayer2, 4: bayer4, 8: bayer8 };
    const matrix = matrices[matrixSize];
    const matrixMax = matrixSize * matrixSize;

    for (let y = 0; y < height; y++) {
      const rowStart = y * scanlineLength + 1;
      for (let x = 0; x < width; x++) {
        const offset = rowStart + x * bytesPerPixel;
        const threshold = (matrix[y % matrixSize][x % matrixSize] / matrixMax) * 255;

        for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
          const val = pixelData[offset + c];
          if (colorMode === 'mono' && c > 0) {
            result[offset + c] = result[offset]; // Copy from first channel
          } else {
            const step = 255 / (levels - 1);
            const adjusted = val + (threshold - 128) * (step / 255);
            result[offset + c] = Math.round(Math.max(0, Math.min(255, adjusted)) / step) * step;
          }
        }
      }
    }
    return result;
  }
});

// Wave Pool - Multiple interference patterns
registerEffect({
  id: 'wave-pool',
  name: 'Wave Pool',
  category: 'distortion',
  icon: '◠',
  parameters: [
    { id: 'waves', type: 'slider', label: 'Waves', default: 2, min: 1, max: 8, step: 1, unit: '' },
    { id: 'amplitude', type: 'slider', label: 'Amplitude', default: 10, min: 1, max: 100, step: 1, unit: '' },
    { id: 'frequency', type: 'slider', label: 'Frequency', default: 20, min: 5, max: 100, step: 1, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);
    const amplitude = logScale(params.amplitude, 100, 40);
    const freq = logScale(params.frequency, 100, 0.1);

    // Generate wave centers
    const centers = [];
    for (let i = 0; i < params.waves; i++) {
      centers.push({ x: rng() * width, y: rng() * height, phase: rng() * Math.PI * 2 });
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let totalDisp = 0;
        for (const c of centers) {
          const dist = Math.sqrt((x - c.x) ** 2 + (y - c.y) ** 2);
          totalDisp += Math.sin(dist * freq + c.phase);
        }
        totalDisp = (totalDisp / params.waves) * amplitude;

        const srcX = Math.floor(((x + totalDisp) % width + width) % width);
        const srcY = Math.floor(((y + totalDisp * 0.5) % height + height) % height);
        const destOffset = y * scanlineLength + 1 + x * bytesPerPixel;
        const srcOffset = srcY * scanlineLength + 1 + srcX * bytesPerPixel;
        for (let c = 0; c < bytesPerPixel; c++) {
          result[destOffset + c] = pixelData[srcOffset + c];
        }
      }
    }
    return result;
  }
});

// Neighbor Drift - Sequential pixel influence
registerEffect({
  id: 'neighbor-drift',
  name: 'Neighbor Drift',
  category: 'color',
  icon: '→',
  parameters: [
    { id: 'memory', type: 'slider', label: 'Memory', default: 4, min: 2, max: 20, step: 1, unit: 'px' },
    { id: 'blend', type: 'slider', label: 'Blend', default: 20, min: 1, max: 100, step: 1, unit: '' },
    { id: 'direction', type: 'dropdown', label: 'Direction', default: 'horizontal',
      options: [
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical', label: 'Vertical' },
        { value: 'diagonal', label: 'Diagonal' }
      ]
    }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    simplexNoise.seed(seed);
    const blend = logScale(params.blend, 100, 0.8);
    const memory = params.memory;

    if (params.direction === 'horizontal' || params.direction === 'diagonal') {
      for (let y = 0; y < height; y++) {
        const rowStart = y * scanlineLength + 1;
        const history = [];
        for (let x = 0; x < width; x++) {
          const offset = rowStart + x * bytesPerPixel;
          const noise = (simplexNoise.noise2D(x * 0.05, y * 0.05) + 1) * 0.5;

          if (history.length >= memory) history.shift();
          const current = [];
          for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
            current.push(pixelData[offset + c]);
          }
          history.push(current);

          if (history.length > 1) {
            const avg = [0, 0, 0];
            for (const h of history) {
              for (let c = 0; c < 3; c++) avg[c] += h[c] || 0;
            }
            for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
              const avgVal = avg[c] / history.length;
              result[offset + c] = Math.round(pixelData[offset + c] * (1 - blend * noise) + avgVal * blend * noise);
            }
          }
        }
      }
    }
    if (params.direction === 'vertical' || params.direction === 'diagonal') {
      for (let x = 0; x < width; x++) {
        const history = [];
        for (let y = 0; y < height; y++) {
          const offset = y * scanlineLength + 1 + x * bytesPerPixel;
          const noise = (simplexNoise.noise2D(x * 0.05, y * 0.05) + 1) * 0.5;

          if (history.length >= memory) history.shift();
          const current = [];
          for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
            current.push(result[offset + c]);
          }
          history.push(current);

          if (history.length > 1) {
            const avg = [0, 0, 0];
            for (const h of history) {
              for (let c = 0; c < 3; c++) avg[c] += h[c] || 0;
            }
            for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
              const avgVal = avg[c] / history.length;
              result[offset + c] = Math.round(result[offset + c] * (1 - blend * noise) + avgVal * blend * noise);
            }
          }
        }
      }
    }
    return result;
  }
});

// Turing Grow - Reaction-diffusion patterns
registerEffect({
  id: 'turing-grow',
  name: 'Turing Grow',
  category: 'generative',
  icon: '❂',
  parameters: [
    { id: 'iterations', type: 'slider', label: 'Growth', default: 5, min: 1, max: 50, step: 1, unit: '' },
    { id: 'feed', type: 'slider', label: 'Feed', default: 55, min: 1, max: 100, step: 1, unit: '' },
    { id: 'kill', type: 'slider', label: 'Kill', default: 62, min: 1, max: 100, step: 1, unit: '' },
    { id: 'blend', type: 'slider', label: 'Blend', default: 30, min: 1, max: 100, step: 1, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);

    // Gray-Scott parameters (scaled from sliders)
    const dA = 1.0, dB = 0.5;
    const f = 0.01 + (params.feed / 100) * 0.08; // 0.01 - 0.09
    const k = 0.03 + (params.kill / 100) * 0.04; // 0.03 - 0.07
    const blend = params.blend / 100;

    // Initialize grids from image brightness
    let gridA = new Float32Array(width * height);
    let gridB = new Float32Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = y * scanlineLength + 1 + x * bytesPerPixel;
        const brightness = (pixelData[offset] + pixelData[offset + 1] + pixelData[offset + 2]) / (3 * 255);
        gridA[y * width + x] = 1;
        gridB[y * width + x] = brightness > 0.5 ? rng() * 0.5 : 0;
      }
    }

    // Run iterations
    for (let iter = 0; iter < params.iterations; iter++) {
      const newA = new Float32Array(width * height);
      const newB = new Float32Array(width * height);

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          const a = gridA[idx], b = gridB[idx];

          // Laplacian (simplified 3x3)
          const lapA = gridA[idx-1] + gridA[idx+1] + gridA[idx-width] + gridA[idx+width] - 4*a;
          const lapB = gridB[idx-1] + gridB[idx+1] + gridB[idx-width] + gridB[idx+width] - 4*b;

          const abb = a * b * b;
          newA[idx] = Math.max(0, Math.min(1, a + dA * lapA * 0.2 - abb + f * (1 - a)));
          newB[idx] = Math.max(0, Math.min(1, b + dB * lapB * 0.2 + abb - (k + f) * b));
        }
      }
      gridA = newA;
      gridB = newB;
    }

    // Blend result with original
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = y * scanlineLength + 1 + x * bytesPerPixel;
        const pattern = gridB[y * width + x];
        for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
          const original = pixelData[offset + c];
          const modified = original * (1 - pattern * 0.8);
          result[offset + c] = Math.round(original * (1 - blend) + modified * blend);
        }
      }
    }
    return result;
  }
});

// Life Cycle - Conway's Game of Life on image
registerEffect({
  id: 'life-cycle',
  name: 'Life Cycle',
  category: 'generative',
  icon: '⬡',
  parameters: [
    { id: 'generations', type: 'slider', label: 'Generations', default: 3, min: 1, max: 30, step: 1, unit: '' },
    { id: 'threshold', type: 'slider', label: 'Threshold', default: 50, min: 1, max: 100, step: 1, unit: '' },
    { id: 'blend', type: 'slider', label: 'Blend', default: 25, min: 1, max: 100, step: 1, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const threshold = (params.threshold / 100) * 255;
    const blend = params.blend / 100;

    // Initialize from brightness
    let grid = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = y * scanlineLength + 1 + x * bytesPerPixel;
        const brightness = (pixelData[offset] + pixelData[offset + 1] + pixelData[offset + 2]) / 3;
        grid[y * width + x] = brightness > threshold ? 1 : 0;
      }
    }

    // Run generations
    for (let gen = 0; gen < params.generations; gen++) {
      const newGrid = new Uint8Array(width * height);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          let neighbors = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              neighbors += grid[(y + dy) * width + (x + dx)];
            }
          }
          const alive = grid[y * width + x];
          // Conway's rules
          if (alive && (neighbors === 2 || neighbors === 3)) newGrid[y * width + x] = 1;
          else if (!alive && neighbors === 3) newGrid[y * width + x] = 1;
        }
      }
      grid = newGrid;
    }

    // Apply to image
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = y * scanlineLength + 1 + x * bytesPerPixel;
        const cell = grid[y * width + x];
        for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
          const original = pixelData[offset + c];
          const modified = cell ? Math.min(255, original * 1.3) : original * 0.5;
          result[offset + c] = Math.round(original * (1 - blend) + modified * blend);
        }
      }
    }
    return result;
  }
});

// Crystal - Voronoi mosaic effect
registerEffect({
  id: 'crystal',
  name: 'Crystal',
  category: 'stylize',
  icon: '◇',
  parameters: [
    { id: 'cells', type: 'slider', label: 'Cells', default: 50, min: 10, max: 200, step: 5, unit: '' },
    { id: 'edgeWidth', type: 'slider', label: 'Edge', default: 0, min: 0, max: 10, step: 1, unit: 'px' },
    { id: 'jitter', type: 'slider', label: 'Jitter', default: 50, min: 0, max: 100, step: 5, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);
    const numCells = params.cells;
    const jitter = params.jitter / 100;

    // Generate cell centers with optional grid-based placement
    const cells = [];
    const gridSize = Math.ceil(Math.sqrt(numCells));
    const cellW = width / gridSize, cellH = height / gridSize;

    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        if (cells.length >= numCells) break;
        const baseX = (gx + 0.5) * cellW;
        const baseY = (gy + 0.5) * cellH;
        cells.push({
          x: baseX + (rng() - 0.5) * cellW * jitter,
          y: baseY + (rng() - 0.5) * cellH * jitter,
          color: [0, 0, 0],
          count: 0
        });
      }
    }

    // Assign pixels to cells and accumulate colors
    const assignments = new Uint16Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let minDist = Infinity, nearest = 0;
        for (let i = 0; i < cells.length; i++) {
          const dx = x - cells[i].x, dy = y - cells[i].y;
          const dist = dx * dx + dy * dy;
          if (dist < minDist) { minDist = dist; nearest = i; }
        }
        assignments[y * width + x] = nearest;
        const offset = y * scanlineLength + 1 + x * bytesPerPixel;
        for (let c = 0; c < 3; c++) {
          cells[nearest].color[c] += pixelData[offset + c];
        }
        cells[nearest].count++;
      }
    }

    // Average colors
    for (const cell of cells) {
      if (cell.count > 0) {
        for (let c = 0; c < 3; c++) cell.color[c] = Math.round(cell.color[c] / cell.count);
      }
    }

    // Apply colors with optional edge detection
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = y * scanlineLength + 1 + x * bytesPerPixel;
        const cellIdx = assignments[y * width + x];

        // Edge detection
        let isEdge = false;
        if (params.edgeWidth > 0 && x > 0 && x < width-1 && y > 0 && y < height-1) {
          if (assignments[y * width + x - 1] !== cellIdx ||
              assignments[y * width + x + 1] !== cellIdx ||
              assignments[(y-1) * width + x] !== cellIdx ||
              assignments[(y+1) * width + x] !== cellIdx) {
            isEdge = true;
          }
        }

        for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
          result[offset + c] = isEdge ? 30 : cells[cellIdx].color[c];
        }
      }
    }
    return result;
  }
});

// Echo Decay - Recursive shrink/rotate feedback
registerEffect({
  id: 'echo-decay',
  name: 'Echo Decay',
  category: 'distortion',
  icon: '◌',
  parameters: [
    { id: 'echoes', type: 'slider', label: 'Echoes', default: 3, min: 2, max: 15, step: 1, unit: '' },
    { id: 'scale', type: 'slider', label: 'Scale', default: 90, min: 50, max: 99, step: 1, unit: '%' },
    { id: 'rotation', type: 'slider', label: 'Rotation', default: 5, min: -45, max: 45, step: 1, unit: '°' },
    { id: 'decay', type: 'slider', label: 'Decay', default: 15, min: 5, max: 50, step: 1, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const cx = width / 2, cy = height / 2;
    const scale = params.scale / 100;
    const rotation = (params.rotation * Math.PI) / 180;
    const decayRate = params.decay / 100;

    for (let echo = params.echoes - 1; echo >= 0; echo--) {
      const currentScale = Math.pow(scale, echo);
      const currentRot = rotation * echo;
      const opacity = Math.pow(1 - decayRate, echo);
      const cosR = Math.cos(currentRot), sinR = Math.sin(currentRot);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          // Transform from destination to source
          const dx = (x - cx) / currentScale;
          const dy = (y - cy) / currentScale;
          const srcX = Math.floor(cx + dx * cosR - dy * sinR);
          const srcY = Math.floor(cy + dx * sinR + dy * cosR);

          if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
            const destOffset = y * scanlineLength + 1 + x * bytesPerPixel;
            const srcOffset = srcY * scanlineLength + 1 + srcX * bytesPerPixel;
            for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
              result[destOffset + c] = Math.round(
                result[destOffset + c] * (1 - opacity) + pixelData[srcOffset + c] * opacity
              );
            }
          }
        }
      }
    }
    return result;
  }
});

// Spiral Pull - Polar coordinate warp
registerEffect({
  id: 'spiral-pull',
  name: 'Spiral Pull',
  category: 'distortion',
  icon: '◈',
  parameters: [
    { id: 'twist', type: 'slider', label: 'Twist', default: 10, min: -100, max: 100, step: 1, unit: '' },
    { id: 'pull', type: 'slider', label: 'Pull', default: 0, min: -50, max: 50, step: 1, unit: '' },
    { id: 'falloff', type: 'dropdown', label: 'Falloff', default: 'linear',
      options: [
        { value: 'linear', label: 'Linear' },
        { value: 'quadratic', label: 'Smooth' },
        { value: 'constant', label: 'Constant' }
      ]
    }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const cx = width / 2, cy = height / 2;
    const maxRadius = Math.sqrt(cx * cx + cy * cy);
    const twist = logScaleBidirectional(params.twist, 100, Math.PI * 3);
    const pull = params.pull / 100;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - cx, dy = y - cy;
        const radius = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        // Apply falloff
        let factor;
        if (params.falloff === 'constant') factor = 1;
        else if (params.falloff === 'quadratic') factor = 1 - Math.pow(radius / maxRadius, 2);
        else factor = 1 - radius / maxRadius;

        const newAngle = angle + twist * factor;
        const newRadius = radius * (1 + pull * factor);

        const srcX = Math.floor(cx + Math.cos(newAngle) * newRadius);
        const srcY = Math.floor(cy + Math.sin(newAngle) * newRadius);

        const destOffset = y * scanlineLength + 1 + x * bytesPerPixel;
        if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
          const srcOffset = srcY * scanlineLength + 1 + srcX * bytesPerPixel;
          for (let c = 0; c < bytesPerPixel; c++) {
            result[destOffset + c] = pixelData[srcOffset + c];
          }
        }
      }
    }
    return result;
  }
});

// Erode - Morphological erosion/dilation
registerEffect({
  id: 'erode',
  name: 'Erode',
  category: 'stylize',
  icon: '◖',
  parameters: [
    { id: 'iterations', type: 'slider', label: 'Strength', default: 1, min: 1, max: 10, step: 1, unit: '' },
    { id: 'mode', type: 'dropdown', label: 'Mode', default: 'erode',
      options: [
        { value: 'erode', label: 'Erode Dark' },
        { value: 'dilate', label: 'Dilate Bright' },
        { value: 'both', label: 'Both' }
      ]
    },
    { id: 'channel', type: 'dropdown', label: 'Channel', default: 'all',
      options: [
        { value: 'all', label: 'All' },
        { value: 'brightness', label: 'Brightness' }
      ]
    }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    let current = new Uint8Array(pixelData);

    for (let iter = 0; iter < params.iterations; iter++) {
      const next = new Uint8Array(current);

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const offset = y * scanlineLength + 1 + x * bytesPerPixel;

          for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
            let minVal = 255, maxVal = 0;
            // 3x3 neighborhood
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const nOffset = (y + dy) * scanlineLength + 1 + (x + dx) * bytesPerPixel;
                const val = current[nOffset + c];
                if (val < minVal) minVal = val;
                if (val > maxVal) maxVal = val;
              }
            }

            if (params.mode === 'erode') next[offset + c] = minVal;
            else if (params.mode === 'dilate') next[offset + c] = maxVal;
            else next[offset + c] = (iter % 2 === 0) ? minVal : maxVal;
          }
        }
      }
      current = next;
    }
    return current;
  }
});

// Convolution - Custom kernel effects
registerEffect({
  id: 'convolution',
  name: 'Convolution',
  category: 'stylize',
  icon: '▩',
  parameters: [
    { id: 'kernel', type: 'dropdown', label: 'Kernel', default: 'emboss',
      options: [
        { value: 'emboss', label: 'Emboss' },
        { value: 'sharpen', label: 'Sharpen' },
        { value: 'edge', label: 'Edge Detect' },
        { value: 'blur', label: 'Blur' },
        { value: 'motionH', label: 'Motion H' },
        { value: 'motionV', label: 'Motion V' }
      ]
    },
    { id: 'strength', type: 'slider', label: 'Strength', default: 30, min: 1, max: 100, step: 1, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const strength = params.strength / 100;

    const kernels = {
      emboss: [[-2,-1,0],[-1,1,1],[0,1,2]],
      sharpen: [[0,-1,0],[-1,5,-1],[0,-1,0]],
      edge: [[-1,-1,-1],[-1,8,-1],[-1,-1,-1]],
      blur: [[1,2,1],[2,4,2],[1,2,1]],
      motionH: [[0,0,0],[1,1,1],[0,0,0]],
      motionV: [[0,1,0],[0,1,0],[0,1,0]]
    };

    const kernel = kernels[params.kernel];
    let divisor = 0;
    for (const row of kernel) for (const v of row) divisor += v;
    if (divisor === 0) divisor = 1;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const offset = y * scanlineLength + 1 + x * bytesPerPixel;

        for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
          let sum = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const nOffset = (y + ky) * scanlineLength + 1 + (x + kx) * bytesPerPixel;
              sum += pixelData[nOffset + c] * kernel[ky + 1][kx + 1];
            }
          }
          const filtered = Math.max(0, Math.min(255, sum / divisor));
          result[offset + c] = Math.round(pixelData[offset + c] * (1 - strength) + filtered * strength);
        }
      }
    }
    return result;
  }
});

// Pixel Plasma - Sine wave color modulation
registerEffect({
  id: 'pixel-plasma',
  name: 'Pixel Plasma',
  category: 'color',
  icon: '◉',
  parameters: [
    { id: 'frequency', type: 'slider', label: 'Frequency', default: 20, min: 5, max: 100, step: 1, unit: '' },
    { id: 'amplitude', type: 'slider', label: 'Amplitude', default: 15, min: 1, max: 100, step: 1, unit: '' },
    { id: 'mode', type: 'dropdown', label: 'Mode', default: 'add',
      options: [
        { value: 'add', label: 'Additive' },
        { value: 'multiply', label: 'Multiply' },
        { value: 'screen', label: 'Screen' }
      ]
    }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);
    const freq = logScale(params.frequency, 100, 0.15);
    const amp = logScale(params.amplitude, 100, 100);

    // Random phase offsets for each channel
    const phases = [rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2];
    const freqMult = [1 + rng() * 0.5, 1 + rng() * 0.5, 1 + rng() * 0.5];

    for (let y = 0; y < height; y++) {
      const rowStart = y * scanlineLength + 1;
      for (let x = 0; x < width; x++) {
        const offset = rowStart + x * bytesPerPixel;

        for (let c = 0; c < Math.min(3, bytesPerPixel); c++) {
          const plasma = Math.sin(x * freq * freqMult[c] + phases[c]) +
                        Math.sin(y * freq * freqMult[c] + phases[c] + 1) +
                        Math.sin((x + y) * freq * 0.7 + phases[c] + 2);
          const plasmaVal = ((plasma / 3) + 1) * 0.5 * amp;

          const original = pixelData[offset + c];
          let newVal;
          if (params.mode === 'add') {
            newVal = original + plasmaVal - amp/2;
          } else if (params.mode === 'multiply') {
            newVal = original * (0.5 + plasmaVal / amp);
          } else { // screen
            newVal = 255 - (255 - original) * (1 - plasmaVal / 255);
          }
          result[offset + c] = Math.max(0, Math.min(255, Math.round(newVal)));
        }
      }
    }
    return result;
  }
});

// Color Bleed - Diffusion/spread effect
registerEffect({
  id: 'color-bleed',
  name: 'Color Bleed',
  category: 'color',
  icon: '◐',
  parameters: [
    { id: 'iterations', type: 'slider', label: 'Spread', default: 3, min: 1, max: 20, step: 1, unit: '' },
    { id: 'threshold', type: 'slider', label: 'Threshold', default: 20, min: 1, max: 100, step: 1, unit: '' },
    { id: 'mode', type: 'dropdown', label: 'Mode', default: 'bright',
      options: [
        { value: 'bright', label: 'Bright Bleeds' },
        { value: 'dark', label: 'Dark Bleeds' },
        { value: 'saturated', label: 'Saturated Bleeds' }
      ]
    }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    let current = new Uint8Array(pixelData);
    const threshold = logScale(params.threshold, 100, 50);

    for (let iter = 0; iter < params.iterations; iter++) {
      const next = new Uint8Array(current);

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const offset = y * scanlineLength + 1 + x * bytesPerPixel;
          const r = current[offset], g = current[offset + 1], b = current[offset + 2];
          const brightness = (r + g + b) / 3;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const saturation = max === 0 ? 0 : (max - min) / max * 255;

          let shouldBleed = false;
          if (params.mode === 'bright') shouldBleed = brightness > 255 - threshold;
          else if (params.mode === 'dark') shouldBleed = brightness < threshold;
          else shouldBleed = saturation > 255 - threshold;

          if (shouldBleed) {
            // Spread to neighbors
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nOffset = (y + dy) * scanlineLength + 1 + (x + dx) * bytesPerPixel;
                for (let c = 0; c < 3; c++) {
                  next[nOffset + c] = Math.round(next[nOffset + c] * 0.7 + current[offset + c] * 0.3);
                }
              }
            }
          }
        }
      }
      current = next;
    }
    return current;
  }
});

// ========== ADVANCED EFFECTS ==========

// 1. Spiral Warp - Twist pixels around a center point
registerEffect({
  id: 'spiral-warp',
  name: 'Spiral Warp',
  category: 'distortion',
  icon: '🌀',
  parameters: [
    { id: 'centerX', type: 'slider', label: 'Center X', default: 50, min: 0, max: 100, step: 1, unit: '%' },
    { id: 'centerY', type: 'slider', label: 'Center Y', default: 50, min: 0, max: 100, step: 1, unit: '%' },
    { id: 'radius', type: 'slider', label: 'Radius', default: 50, min: 5, max: 100, step: 1, unit: '%' },
    { id: 'strength', type: 'slider', label: 'Strength', default: 30, min: 1, max: 100, step: 1, unit: '' },
    { id: 'falloff', type: 'dropdown', label: 'Falloff', default: 'smooth',
      options: [
        { value: 'linear', label: 'Linear' },
        { value: 'smooth', label: 'Smooth' },
        { value: 'sharp', label: 'Sharp' }
      ]
    },
    { id: 'direction', type: 'dropdown', label: 'Direction', default: 'cw',
      options: [
        { value: 'cw', label: 'Clockwise' },
        { value: 'ccw', label: 'Counter-CW' }
      ]
    }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);

    const cx = (params.centerX / 100) * width;
    const cy = (params.centerY / 100) * height;
    const maxRadius = Math.max(width, height) * (params.radius / 100);
    const angle = logScale(params.strength, 100, Math.PI * 2) * (params.direction === 'ccw' ? -1 : 1);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < maxRadius && dist > 0) {
          let factor = 1 - (dist / maxRadius);
          if (params.falloff === 'smooth') factor = factor * factor * (3 - 2 * factor);
          else if (params.falloff === 'sharp') factor = factor * factor;

          const rotation = angle * factor;
          const cos = Math.cos(rotation), sin = Math.sin(rotation);
          const srcX = Math.round(cx + dx * cos - dy * sin);
          const srcY = Math.round(cy + dx * sin + dy * cos);

          if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
            const dstOffset = y * scanlineLength + 1 + x * bytesPerPixel;
            const srcOffset = srcY * scanlineLength + 1 + srcX * bytesPerPixel;
            for (let c = 0; c < bytesPerPixel; c++) {
              result[dstOffset + c] = pixelData[srcOffset + c];
            }
          }
        }
      }
    }
    return result;
  }
});

// 2. Wave Mesh - Apply sine/cosine displacement grid
registerEffect({
  id: 'wave-mesh',
  name: 'Wave Mesh',
  category: 'distortion',
  icon: '〰',
  parameters: [
    { id: 'xFreq', type: 'slider', label: 'X Frequency', default: 20, min: 1, max: 100, step: 1, unit: '' },
    { id: 'yFreq', type: 'slider', label: 'Y Frequency', default: 20, min: 1, max: 100, step: 1, unit: '' },
    { id: 'xAmp', type: 'slider', label: 'X Amplitude', default: 15, min: 1, max: 100, step: 1, unit: '' },
    { id: 'yAmp', type: 'slider', label: 'Y Amplitude', default: 15, min: 1, max: 100, step: 1, unit: '' },
    { id: 'phase', type: 'slider', label: 'Phase', default: 0, min: 0, max: 100, step: 1, unit: '' },
    { id: 'waveType', type: 'dropdown', label: 'Wave Type', default: 'sine',
      options: [
        { value: 'sine', label: 'Sine' },
        { value: 'triangle', label: 'Triangle' },
        { value: 'square', label: 'Square' }
      ]
    }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);

    const xFreq = logScale(params.xFreq, 100, 0.1);
    const yFreq = logScale(params.yFreq, 100, 0.1);
    const xAmp = logScale(params.xAmp, 100, 50);
    const yAmp = logScale(params.yAmp, 100, 50);
    const phase = (params.phase / 100) * Math.PI * 2;

    const wave = (t, type) => {
      if (type === 'sine') return Math.sin(t);
      if (type === 'triangle') return 2 * Math.abs(2 * (t / (Math.PI * 2) - Math.floor(t / (Math.PI * 2) + 0.5))) - 1;
      if (type === 'square') return Math.sin(t) >= 0 ? 1 : -1;
      return Math.sin(t);
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offsetX = wave(y * yFreq + phase, params.waveType) * xAmp;
        const offsetY = wave(x * xFreq + phase, params.waveType) * yAmp;
        const srcX = Math.round(x + offsetX);
        const srcY = Math.round(y + offsetY);

        if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
          const dstOffset = y * scanlineLength + 1 + x * bytesPerPixel;
          const srcOffset = srcY * scanlineLength + 1 + srcX * bytesPerPixel;
          for (let c = 0; c < bytesPerPixel; c++) {
            result[dstOffset + c] = pixelData[srcOffset + c];
          }
        }
      }
    }
    return result;
  }
});

// 3. Pixel Drift - Pixels migrate based on luminance
registerEffect({
  id: 'pixel-drift',
  name: 'Pixel Drift',
  category: 'distortion',
  icon: '↗',
  parameters: [
    { id: 'angle', type: 'slider', label: 'Direction', default: 45, min: 0, max: 360, step: 5, unit: '°' },
    { id: 'speed', type: 'slider', label: 'Speed', default: 20, min: 1, max: 100, step: 1, unit: '' },
    { id: 'threshold', type: 'slider', label: 'Threshold', default: 50, min: 0, max: 100, step: 1, unit: '' },
    { id: 'mode', type: 'dropdown', label: 'Mode', default: 'bright',
      options: [
        { value: 'bright', label: 'Bright Drifts' },
        { value: 'dark', label: 'Dark Drifts' },
        { value: 'all', label: 'All Pixels' }
      ]
    }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);

    const angleRad = (params.angle * Math.PI) / 180;
    const maxDrift = logScale(params.speed, 100, 100);
    const threshold = (params.threshold / 100) * 255;
    const dx = Math.cos(angleRad), dy = Math.sin(angleRad);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcOffset = y * scanlineLength + 1 + x * bytesPerPixel;
        const lum = (pixelData[srcOffset] + pixelData[srcOffset + 1] + pixelData[srcOffset + 2]) / 3;

        let drift = 0;
        if (params.mode === 'bright' && lum > threshold) drift = (lum / 255) * maxDrift;
        else if (params.mode === 'dark' && lum < threshold) drift = (1 - lum / 255) * maxDrift;
        else if (params.mode === 'all') drift = (lum / 255) * maxDrift;

        const dstX = Math.round(x + dx * drift);
        const dstY = Math.round(y + dy * drift);

        if (dstX >= 0 && dstX < width && dstY >= 0 && dstY < height) {
          const dstOffset = dstY * scanlineLength + 1 + dstX * bytesPerPixel;
          for (let c = 0; c < bytesPerPixel; c++) {
            result[dstOffset + c] = pixelData[srcOffset + c];
          }
        }
      }
    }
    return result;
  }
});

// 4. Elastic Bounce - Pixels spring toward attractors
registerEffect({
  id: 'elastic-bounce',
  name: 'Elastic Bounce',
  category: 'distortion',
  icon: '◉',
  parameters: [
    { id: 'attractors', type: 'slider', label: 'Attractors', default: 3, min: 1, max: 10, step: 1, unit: '' },
    { id: 'strength', type: 'slider', label: 'Strength', default: 30, min: 1, max: 100, step: 1, unit: '' },
    { id: 'damping', type: 'slider', label: 'Damping', default: 50, min: 1, max: 100, step: 1, unit: '' },
    { id: 'iterations', type: 'slider', label: 'Iterations', default: 3, min: 1, max: 10, step: 1, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);

    const attractors = [];
    for (let i = 0; i < params.attractors; i++) {
      attractors.push({ x: rng() * width, y: rng() * height });
    }

    const strength = logScale(params.strength, 100, 80);
    const damping = params.damping / 100;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let px = x, py = y;

        for (let iter = 0; iter < params.iterations; iter++) {
          let fx = 0, fy = 0;
          for (const a of attractors) {
            const dx = a.x - px, dy = a.y - py;
            const dist = Math.sqrt(dx * dx + dy * dy) + 1;
            fx += (dx / dist) * (strength / dist);
            fy += (dy / dist) * (strength / dist);
          }
          px += fx * damping;
          py += fy * damping;
        }

        const srcX = Math.round(px), srcY = Math.round(py);
        if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
          const dstOffset = y * scanlineLength + 1 + x * bytesPerPixel;
          const srcOffset = srcY * scanlineLength + 1 + srcX * bytesPerPixel;
          for (let c = 0; c < bytesPerPixel; c++) {
            result[dstOffset + c] = pixelData[srcOffset + c];
          }
        }
      }
    }
    return result;
  }
});

// 5. Voronoi Shatter - Break image into Voronoi cells, displace each
registerEffect({
  id: 'voronoi-shatter',
  name: 'Voronoi Shatter',
  category: 'distortion',
  icon: '⬡',
  parameters: [
    { id: 'cells', type: 'slider', label: 'Cells', default: 20, min: 3, max: 100, step: 1, unit: '' },
    { id: 'displacement', type: 'slider', label: 'Displacement', default: 20, min: 0, max: 100, step: 1, unit: '' },
    { id: 'rotation', type: 'slider', label: 'Rotation', default: 15, min: 0, max: 100, step: 1, unit: '' },
    { id: 'scale', type: 'slider', label: 'Scale Variance', default: 10, min: 0, max: 100, step: 1, unit: '%' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData.length);
    const rng = createSeededRNG(seed);

    // Generate Voronoi points with per-cell transforms
    const cells = [];
    for (let i = 0; i < params.cells; i++) {
      cells.push({
        x: rng() * width,
        y: rng() * height,
        dx: (rng() - 0.5) * logScale(params.displacement, 100, 100),
        dy: (rng() - 0.5) * logScale(params.displacement, 100, 100),
        rotation: (rng() - 0.5) * logScale(params.rotation, 100, Math.PI / 2),
        scale: 1 + (rng() - 0.5) * (params.scale / 50)
      });
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Find nearest cell
        let minDist = Infinity, nearestCell = cells[0];
        for (const cell of cells) {
          const dist = (x - cell.x) ** 2 + (y - cell.y) ** 2;
          if (dist < minDist) { minDist = dist; nearestCell = cell; }
        }

        // Apply cell transform
        const relX = x - nearestCell.x, relY = y - nearestCell.y;
        const cos = Math.cos(nearestCell.rotation), sin = Math.sin(nearestCell.rotation);
        const srcX = Math.round(nearestCell.x + (relX * cos - relY * sin) * nearestCell.scale + nearestCell.dx);
        const srcY = Math.round(nearestCell.y + (relX * sin + relY * cos) * nearestCell.scale + nearestCell.dy);

        const dstOffset = y * scanlineLength + 1 + x * bytesPerPixel;
        if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
          const srcOffset = srcY * scanlineLength + 1 + srcX * bytesPerPixel;
          for (let c = 0; c < bytesPerPixel; c++) {
            result[dstOffset + c] = pixelData[srcOffset + c];
          }
        }
      }
    }
    return result;
  }
});

// 6. Radial Stretch - Stretch/compress from center point
registerEffect({
  id: 'radial-stretch',
  name: 'Radial Stretch',
  category: 'distortion',
  icon: '⊛',
  parameters: [
    { id: 'centerX', type: 'slider', label: 'Center X', default: 50, min: 0, max: 100, step: 1, unit: '%' },
    { id: 'centerY', type: 'slider', label: 'Center Y', default: 50, min: 0, max: 100, step: 1, unit: '%' },
    { id: 'innerRadius', type: 'slider', label: 'Inner Radius', default: 10, min: 0, max: 100, step: 1, unit: '%' },
    { id: 'outerRadius', type: 'slider', label: 'Outer Radius', default: 80, min: 10, max: 100, step: 1, unit: '%' },
    { id: 'stretch', type: 'slider', label: 'Stretch', default: 30, min: -100, max: 100, step: 1, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);

    const cx = (params.centerX / 100) * width;
    const cy = (params.centerY / 100) * height;
    const maxDim = Math.max(width, height);
    const innerR = (params.innerRadius / 100) * maxDim;
    const outerR = (params.outerRadius / 100) * maxDim;
    const stretchFactor = 1 + logScaleBidirectional(params.stretch, 100, 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > innerR && dist < outerR && dist > 0) {
          const t = (dist - innerR) / (outerR - innerR);
          const factor = 1 + (stretchFactor - 1) * Math.sin(t * Math.PI);
          const srcDist = dist / factor;
          const srcX = Math.round(cx + (dx / dist) * srcDist);
          const srcY = Math.round(cy + (dy / dist) * srcDist);

          if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
            const dstOffset = y * scanlineLength + 1 + x * bytesPerPixel;
            const srcOffset = srcY * scanlineLength + 1 + srcX * bytesPerPixel;
            for (let c = 0; c < bytesPerPixel; c++) {
              result[dstOffset + c] = pixelData[srcOffset + c];
            }
          }
        }
      }
    }
    return result;
  }
});

// 7. Scanline Shuffle - Rearrange scanlines by pattern
registerEffect({
  id: 'scanline-shuffle',
  name: 'Scanline Shuffle',
  category: 'distortion',
  icon: '☰',
  parameters: [
    { id: 'pattern', type: 'dropdown', label: 'Pattern', default: 'reverse',
      options: [
        { value: 'reverse', label: 'Reverse Groups' },
        { value: 'interleave', label: 'Interleave' },
        { value: 'fibonacci', label: 'Fibonacci' },
        { value: 'prime', label: 'Prime Gaps' },
        { value: 'random', label: 'Random' }
      ]
    },
    { id: 'groupSize', type: 'slider', label: 'Group Size', default: 20, min: 2, max: 100, step: 1, unit: 'px' },
    { id: 'offset', type: 'slider', label: 'Offset', default: 0, min: 0, max: 100, step: 1, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { height, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);

    // Generate mapping based on pattern
    const mapping = new Array(height).fill(0).map((_, i) => i);
    const groupSize = params.groupSize;
    const offset = Math.floor((params.offset / 100) * height);

    // Fibonacci sequence
    const fib = [1, 1];
    while (fib[fib.length - 1] < height) fib.push(fib[fib.length - 1] + fib[fib.length - 2]);

    // Prime check
    const isPrime = n => { if (n < 2) return false; for (let i = 2; i <= Math.sqrt(n); i++) if (n % i === 0) return false; return true; };

    for (let g = 0; g < Math.ceil(height / groupSize); g++) {
      const start = g * groupSize;
      const end = Math.min(start + groupSize, height);
      const group = mapping.slice(start, end);

      if (params.pattern === 'reverse') group.reverse();
      else if (params.pattern === 'interleave') {
        const evens = group.filter((_, i) => i % 2 === 0);
        const odds = group.filter((_, i) => i % 2 === 1);
        for (let i = 0; i < group.length; i++) group[i] = i < evens.length ? evens[i] : odds[i - evens.length];
      }
      else if (params.pattern === 'fibonacci') {
        const newGroup = [...group];
        for (let i = 0; i < group.length; i++) {
          const fibIdx = fib.findIndex(f => f > i) - 1;
          newGroup[i] = group[(i + fib[Math.max(0, fibIdx)]) % group.length];
        }
        for (let i = 0; i < group.length; i++) group[i] = newGroup[i];
      }
      else if (params.pattern === 'prime') {
        const newGroup = [...group];
        let primeOffset = 0;
        for (let i = 0; i < group.length; i++) {
          if (isPrime(i)) primeOffset++;
          newGroup[i] = group[(i + primeOffset) % group.length];
        }
        for (let i = 0; i < group.length; i++) group[i] = newGroup[i];
      }
      else if (params.pattern === 'random') {
        for (let i = group.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [group[i], group[j]] = [group[j], group[i]];
        }
      }

      for (let i = start; i < end; i++) mapping[i] = group[i - start];
    }

    // Apply offset rotation
    const shifted = [...mapping];
    for (let i = 0; i < height; i++) shifted[(i + offset) % height] = mapping[i];

    // Copy scanlines according to mapping
    for (let y = 0; y < height; y++) {
      const srcY = shifted[y];
      if (srcY >= 0 && srcY < height) {
        const dstStart = y * scanlineLength;
        const srcStart = srcY * scanlineLength;
        result.set(pixelData.slice(srcStart, srcStart + scanlineLength), dstStart);
      }
    }
    return result;
  }
});

// 8. Channel Orbit - Rotate RGB channels around color wheel
registerEffect({
  id: 'channel-orbit',
  name: 'Channel Orbit',
  category: 'channel',
  icon: '◔',
  parameters: [
    { id: 'rotation', type: 'slider', label: 'Rotation', default: 30, min: 0, max: 360, step: 5, unit: '°' },
    { id: 'rOffset', type: 'slider', label: 'R Offset', default: 0, min: -180, max: 180, step: 5, unit: '°' },
    { id: 'gOffset', type: 'slider', label: 'G Offset', default: 0, min: -180, max: 180, step: 5, unit: '°' },
    { id: 'bOffset', type: 'slider', label: 'B Offset', default: 0, min: -180, max: 180, step: 5, unit: '°' },
    { id: 'preserveLum', type: 'checkbox', label: 'Preserve Luminance', default: false }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    if (bytesPerPixel < 3) return pixelData;
    const result = new Uint8Array(pixelData);

    const baseRot = (params.rotation * Math.PI) / 180;
    const rRot = baseRot + (params.rOffset * Math.PI) / 180;
    const gRot = baseRot + (params.gOffset * Math.PI) / 180;
    const bRot = baseRot + (params.bOffset * Math.PI) / 180;

    // RGB to HSL and back helpers
    const rgbToHsl = (r, g, b) => {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h, s, l = (max + min) / 2;
      if (max === min) { h = s = 0; }
      else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
          case g: h = ((b - r) / d + 2) / 6; break;
          case b: h = ((r - g) / d + 4) / 6; break;
        }
      }
      return [h, s, l];
    };

    const hslToRgb = (h, s, l) => {
      let r, g, b;
      if (s === 0) { r = g = b = l; }
      else {
        const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1; if (t > 1) t -= 1;
          if (t < 1/6) return p + (q - p) * 6 * t;
          if (t < 1/2) return q;
          if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
      }
      return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = y * scanlineLength + 1 + x * bytesPerPixel;
        const [h, s, l] = rgbToHsl(pixelData[offset], pixelData[offset + 1], pixelData[offset + 2]);
        const origLum = l;

        // Rotate each channel's contribution
        const [rH] = rgbToHsl(pixelData[offset], 0, 0);
        const [gH] = rgbToHsl(0, pixelData[offset + 1], 0);
        const [bH] = rgbToHsl(0, 0, pixelData[offset + 2]);

        const newH = (h + baseRot / (Math.PI * 2) + 1) % 1;
        let [nr, ng, nb] = hslToRgb(newH, s, l);

        // Apply per-channel offsets
        const rMix = (pixelData[offset] / 255);
        const gMix = (pixelData[offset + 1] / 255);
        const bMix = (pixelData[offset + 2] / 255);

        nr = Math.round(nr * Math.cos(rRot - baseRot) + pixelData[offset] * Math.sin(rRot - baseRot) * 0.3 + nr * 0.7);
        ng = Math.round(ng * Math.cos(gRot - baseRot) + pixelData[offset + 1] * Math.sin(gRot - baseRot) * 0.3 + ng * 0.7);
        nb = Math.round(nb * Math.cos(bRot - baseRot) + pixelData[offset + 2] * Math.sin(bRot - baseRot) * 0.3 + nb * 0.7);

        if (params.preserveLum) {
          const [, , newL] = rgbToHsl(nr, ng, nb);
          if (newL > 0) {
            const lumRatio = origLum / newL;
            nr = Math.min(255, Math.round(nr * lumRatio));
            ng = Math.min(255, Math.round(ng * lumRatio));
            nb = Math.min(255, Math.round(nb * lumRatio));
          }
        }

        result[offset] = Math.max(0, Math.min(255, nr));
        result[offset + 1] = Math.max(0, Math.min(255, ng));
        result[offset + 2] = Math.max(0, Math.min(255, nb));
      }
    }
    return result;
  }
});

// 9. Chromatic Aberration Pro - Advanced color fringing
registerEffect({
  id: 'chromatic-aberration-pro',
  name: 'Chromatic Aberration Pro',
  category: 'channel',
  icon: '◈',
  parameters: [
    { id: 'rOffsetX', type: 'slider', label: 'R Offset X', default: 5, min: -50, max: 50, step: 1, unit: 'px' },
    { id: 'rOffsetY', type: 'slider', label: 'R Offset Y', default: 0, min: -50, max: 50, step: 1, unit: 'px' },
    { id: 'bOffsetX', type: 'slider', label: 'B Offset X', default: -5, min: -50, max: 50, step: 1, unit: 'px' },
    { id: 'bOffsetY', type: 'slider', label: 'B Offset Y', default: 0, min: -50, max: 50, step: 1, unit: 'px' },
    { id: 'radialFalloff', type: 'slider', label: 'Radial Falloff', default: 50, min: 0, max: 100, step: 1, unit: '%' },
    { id: 'edgeBoost', type: 'slider', label: 'Edge Boost', default: 20, min: 0, max: 100, step: 1, unit: '%' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    if (bytesPerPixel < 3) return pixelData;
    const result = new Uint8Array(pixelData);

    const rX = logScaleBidirectional(params.rOffsetX, 50, 30);
    const rY = logScaleBidirectional(params.rOffsetY, 50, 30);
    const bX = logScaleBidirectional(params.bOffsetX, 50, 30);
    const bY = logScaleBidirectional(params.bOffsetY, 50, 30);
    const radialFalloff = params.radialFalloff / 100;
    const edgeBoost = 1 + (params.edgeBoost / 100) * 2;

    const cx = width / 2, cy = height / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radialMult = radialFalloff > 0 ? Math.pow(dist / maxDist, radialFalloff) * edgeBoost : 1;

        const offset = y * scanlineLength + 1 + x * bytesPerPixel;

        // Red channel
        const rSrcX = Math.round(x - rX * radialMult);
        const rSrcY = Math.round(y - rY * radialMult);
        if (rSrcX >= 0 && rSrcX < width && rSrcY >= 0 && rSrcY < height) {
          result[offset] = pixelData[rSrcY * scanlineLength + 1 + rSrcX * bytesPerPixel];
        }

        // Green stays in place
        result[offset + 1] = pixelData[offset + 1];

        // Blue channel
        const bSrcX = Math.round(x - bX * radialMult);
        const bSrcY = Math.round(y - bY * radialMult);
        if (bSrcX >= 0 && bSrcX < width && bSrcY >= 0 && bSrcY < height) {
          result[offset + 2] = pixelData[bSrcY * scanlineLength + 1 + bSrcX * bytesPerPixel + 2];
        }
      }
    }
    return result;
  }
});

// 10. Palette Quantize - Reduce to N colors with dithering
registerEffect({
  id: 'palette-quantize',
  name: 'Palette Quantize',
  category: 'color',
  icon: '▦',
  parameters: [
    { id: 'colors', type: 'slider', label: 'Colors', default: 8, min: 2, max: 64, step: 1, unit: '' },
    { id: 'dither', type: 'dropdown', label: 'Dither', default: 'floyd',
      options: [
        { value: 'none', label: 'None' },
        { value: 'floyd', label: 'Floyd-Steinberg' },
        { value: 'bayer', label: 'Bayer 4x4' },
        { value: 'noise', label: 'Noise' }
      ]
    },
    { id: 'errorDiffusion', type: 'slider', label: 'Error Diffusion', default: 70, min: 0, max: 100, step: 5, unit: '%' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    if (bytesPerPixel < 3) return pixelData;

    const result = new Float32Array(pixelData.length);
    for (let i = 0; i < pixelData.length; i++) result[i] = pixelData[i];

    const rng = createSeededRNG(seed);
    const levels = Math.round(Math.pow(params.colors, 1/3));
    const step = 255 / (levels - 1);
    const errorMult = params.errorDiffusion / 100;

    // Bayer matrix 4x4
    const bayer = [
      [0, 8, 2, 10], [12, 4, 14, 6],
      [3, 11, 1, 9], [15, 7, 13, 5]
    ].map(row => row.map(v => (v / 16 - 0.5) * step));

    const quantize = (v) => Math.round(v / step) * step;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = y * scanlineLength + 1 + x * bytesPerPixel;

        for (let c = 0; c < 3; c++) {
          let oldVal = result[offset + c];

          // Add dither before quantization
          if (params.dither === 'bayer') oldVal += bayer[y % 4][x % 4];
          else if (params.dither === 'noise') oldVal += (rng() - 0.5) * step;

          const newVal = Math.max(0, Math.min(255, quantize(oldVal)));
          result[offset + c] = newVal;

          // Error diffusion (Floyd-Steinberg)
          if (params.dither === 'floyd') {
            const error = (oldVal - newVal) * errorMult;
            if (x + 1 < width) result[offset + bytesPerPixel + c] += error * 7/16;
            if (y + 1 < height) {
              if (x > 0) result[offset + scanlineLength - bytesPerPixel + c] += error * 3/16;
              result[offset + scanlineLength + c] += error * 5/16;
              if (x + 1 < width) result[offset + scanlineLength + bytesPerPixel + c] += error * 1/16;
            }
          }
        }
      }
    }

    const output = new Uint8Array(pixelData.length);
    for (let i = 0; i < pixelData.length; i++) {
      output[i] = Math.max(0, Math.min(255, Math.round(result[i])));
    }
    return output;
  }
});

// 11. Channel Blend Modes - Apply blend modes between channels
registerEffect({
  id: 'channel-blend-modes',
  name: 'Channel Blend Modes',
  category: 'channel',
  icon: '⊕',
  parameters: [
    { id: 'rgMode', type: 'dropdown', label: 'R→G Blend', default: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'multiply', label: 'Multiply' },
        { value: 'screen', label: 'Screen' },
        { value: 'overlay', label: 'Overlay' },
        { value: 'difference', label: 'Difference' }
      ]
    },
    { id: 'gbMode', type: 'dropdown', label: 'G→B Blend', default: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'multiply', label: 'Multiply' },
        { value: 'screen', label: 'Screen' },
        { value: 'overlay', label: 'Overlay' },
        { value: 'difference', label: 'Difference' }
      ]
    },
    { id: 'brMode', type: 'dropdown', label: 'B→R Blend', default: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'multiply', label: 'Multiply' },
        { value: 'screen', label: 'Screen' },
        { value: 'overlay', label: 'Overlay' },
        { value: 'difference', label: 'Difference' }
      ]
    },
    { id: 'strength', type: 'slider', label: 'Strength', default: 50, min: 0, max: 100, step: 5, unit: '%' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    if (bytesPerPixel < 3) return pixelData;
    const result = new Uint8Array(pixelData);

    const blend = (a, b, mode) => {
      const an = a / 255, bn = b / 255;
      let r;
      switch (mode) {
        case 'multiply': r = an * bn; break;
        case 'screen': r = 1 - (1 - an) * (1 - bn); break;
        case 'overlay': r = an < 0.5 ? 2 * an * bn : 1 - 2 * (1 - an) * (1 - bn); break;
        case 'difference': r = Math.abs(an - bn); break;
        default: return a;
      }
      return Math.round(r * 255);
    };

    const strength = params.strength / 100;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = y * scanlineLength + 1 + x * bytesPerPixel;
        const r = pixelData[offset], g = pixelData[offset + 1], b = pixelData[offset + 2];

        let newR = r, newG = g, newB = b;

        if (params.rgMode !== 'none') {
          newG = Math.round(g * (1 - strength) + blend(r, g, params.rgMode) * strength);
        }
        if (params.gbMode !== 'none') {
          newB = Math.round(b * (1 - strength) + blend(g, b, params.gbMode) * strength);
        }
        if (params.brMode !== 'none') {
          newR = Math.round(r * (1 - strength) + blend(b, r, params.brMode) * strength);
        }

        result[offset] = Math.max(0, Math.min(255, newR));
        result[offset + 1] = Math.max(0, Math.min(255, newG));
        result[offset + 2] = Math.max(0, Math.min(255, newB));
      }
    }
    return result;
  }
});

// 12. Gradient Map Chaos - Map luminance to shifting gradient
registerEffect({
  id: 'gradient-map-chaos',
  name: 'Gradient Map Chaos',
  category: 'color',
  icon: '▤',
  parameters: [
    { id: 'hueStart', type: 'slider', label: 'Hue Start', default: 0, min: 0, max: 360, step: 10, unit: '°' },
    { id: 'hueEnd', type: 'slider', label: 'Hue End', default: 180, min: 0, max: 360, step: 10, unit: '°' },
    { id: 'oscillation', type: 'slider', label: 'Oscillation', default: 30, min: 0, max: 100, step: 5, unit: '' },
    { id: 'noiseAmount', type: 'slider', label: 'Noise', default: 20, min: 0, max: 100, step: 5, unit: '%' },
    { id: 'channelIndep', type: 'checkbox', label: 'Per-Channel', default: false }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    if (bytesPerPixel < 3) return pixelData;
    const result = new Uint8Array(pixelData);

    simplexNoise.seed(seed);
    const oscillation = logScale(params.oscillation, 100, 5);
    const noiseAmt = params.noiseAmount / 100;

    const hslToRgb = (h, s, l) => {
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs((h / 60) % 2 - 1));
      const m = l - c / 2;
      let r, g, b;
      if (h < 60) { r = c; g = x; b = 0; }
      else if (h < 120) { r = x; g = c; b = 0; }
      else if (h < 180) { r = 0; g = c; b = x; }
      else if (h < 240) { r = 0; g = x; b = c; }
      else if (h < 300) { r = x; g = 0; b = c; }
      else { r = c; g = 0; b = x; }
      return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = y * scanlineLength + 1 + x * bytesPerPixel;
        const r = pixelData[offset], g = pixelData[offset + 1], b = pixelData[offset + 2];
        const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;

        const noise = simplexNoise.noise2D(x * 0.02, y * 0.02) * noiseAmt;
        const osc = Math.sin(lum * oscillation * Math.PI) * 0.2;
        const t = Math.max(0, Math.min(1, lum + noise + osc));

        if (params.channelIndep) {
          const rLum = r / 255, gLum = g / 255, bLum = b / 255;
          const rH = params.hueStart + (params.hueEnd - params.hueStart) * rLum;
          const gH = params.hueStart + (params.hueEnd - params.hueStart) * gLum;
          const bH = params.hueStart + (params.hueEnd - params.hueStart) * bLum;
          result[offset] = hslToRgb(rH % 360, 0.8, rLum)[0];
          result[offset + 1] = hslToRgb(gH % 360, 0.8, gLum)[1];
          result[offset + 2] = hslToRgb(bH % 360, 0.8, bLum)[2];
        } else {
          const hue = (params.hueStart + (params.hueEnd - params.hueStart) * t + 360) % 360;
          const [nr, ng, nb] = hslToRgb(hue, 0.8, lum);
          result[offset] = nr;
          result[offset + 1] = ng;
          result[offset + 2] = nb;
        }
      }
    }
    return result;
  }
});

// 13. Cellular Automata - Apply CA rules to pixels
registerEffect({
  id: 'cellular-automata',
  name: 'Cellular Automata',
  category: 'generative',
  icon: '▣',
  parameters: [
    { id: 'rule', type: 'slider', label: 'Rule', default: 30, min: 0, max: 255, step: 1, unit: '' },
    { id: 'iterations', type: 'slider', label: 'Iterations', default: 3, min: 1, max: 20, step: 1, unit: '' },
    { id: 'threshold', type: 'slider', label: 'Threshold', default: 50, min: 0, max: 100, step: 5, unit: '%' },
    { id: 'neighborhood', type: 'dropdown', label: 'Neighborhood', default: 'moore',
      options: [
        { value: 'moore', label: 'Moore (8)' },
        { value: 'vonneumann', label: 'Von Neumann (4)' }
      ]
    },
    { id: 'colorMode', type: 'dropdown', label: 'Color Mode', default: 'preserve',
      options: [
        { value: 'preserve', label: 'Preserve Colors' },
        { value: 'binary', label: 'Binary' },
        { value: 'heatmap', label: 'Heatmap' }
      ]
    }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const threshold = (params.threshold / 100) * 255;

    // Create binary grid from luminance
    let grid = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = y * scanlineLength + 1 + x * bytesPerPixel;
        const lum = (pixelData[offset] + pixelData[offset + 1] + pixelData[offset + 2]) / 3;
        grid[y * width + x] = lum > threshold ? 1 : 0;
      }
    }

    // Apply CA rules
    const mooreOffsets = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    const vnOffsets = [[-1,0],[0,-1],[0,1],[1,0]];
    const offsets = params.neighborhood === 'moore' ? mooreOffsets : vnOffsets;

    for (let iter = 0; iter < params.iterations; iter++) {
      const newGrid = new Uint8Array(width * height);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          let neighbors = 0;
          for (const [dy, dx] of offsets) {
            neighbors += grid[(y + dy) * width + (x + dx)];
          }
          // Use rule number as bitmask for neighbor count
          const idx = y * width + x;
          const current = grid[idx];
          const state = (current << 3) | neighbors;
          newGrid[idx] = (params.rule >> (state % 8)) & 1;
        }
      }
      grid = newGrid;
    }

    // Apply result to image
    const result = new Uint8Array(pixelData);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = y * scanlineLength + 1 + x * bytesPerPixel;
        const cell = grid[y * width + x];

        if (params.colorMode === 'binary') {
          const v = cell ? 255 : 0;
          result[offset] = result[offset + 1] = result[offset + 2] = v;
        } else if (params.colorMode === 'heatmap') {
          result[offset] = cell ? 255 : pixelData[offset] * 0.3;
          result[offset + 1] = cell ? 100 : pixelData[offset + 1] * 0.3;
          result[offset + 2] = cell ? 50 : pixelData[offset + 2];
        } else {
          // Preserve - use CA to modulate existing colors
          const mult = cell ? 1 : 0.4;
          result[offset] = Math.round(pixelData[offset] * mult);
          result[offset + 1] = Math.round(pixelData[offset + 1] * mult);
          result[offset + 2] = Math.round(pixelData[offset + 2] * mult);
        }
      }
    }
    return result;
  }
});

// 14. Euclidean Rhythm - Apply pattern based on Euclidean algorithm
registerEffect({
  id: 'euclidean-rhythm',
  name: 'Euclidean Rhythm',
  category: 'generative',
  icon: '◎',
  parameters: [
    { id: 'steps', type: 'slider', label: 'Steps', default: 16, min: 4, max: 64, step: 1, unit: '' },
    { id: 'pulses', type: 'slider', label: 'Pulses', default: 5, min: 1, max: 32, step: 1, unit: '' },
    { id: 'rotation', type: 'slider', label: 'Rotation', default: 0, min: 0, max: 100, step: 1, unit: '%' },
    { id: 'affect', type: 'dropdown', label: 'Affect', default: 'position',
      options: [
        { value: 'position', label: 'Position' },
        { value: 'color', label: 'Color' },
        { value: 'alpha', label: 'Brightness' },
        { value: 'all', label: 'All' }
      ]
    },
    { id: 'intensity', type: 'slider', label: 'Intensity', default: 50, min: 1, max: 100, step: 1, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);

    // Generate Euclidean rhythm pattern
    const euclidean = (steps, pulses) => {
      const pattern = new Array(steps).fill(0);
      let bucket = 0;
      for (let i = 0; i < steps; i++) {
        bucket += pulses;
        if (bucket >= steps) {
          bucket -= steps;
          pattern[i] = 1;
        }
      }
      return pattern;
    };

    const steps = Math.max(params.steps, params.pulses);
    const pattern = euclidean(steps, Math.min(params.pulses, steps));
    const rotation = Math.floor((params.rotation / 100) * steps);
    const intensity = logScale(params.intensity, 100, 50);

    // Rotate pattern
    const rotated = [...pattern.slice(rotation), ...pattern.slice(0, rotation)];

    for (let y = 0; y < height; y++) {
      const rowPattern = rotated[(y * steps / height) | 0];

      for (let x = 0; x < width; x++) {
        const colPattern = rotated[(x * steps / width) | 0];
        const offset = y * scanlineLength + 1 + x * bytesPerPixel;
        const active = rowPattern || colPattern;

        if (params.affect === 'position' || params.affect === 'all') {
          if (active) {
            const shift = ((x + y) % 2 === 0 ? 1 : -1) * intensity * rowPattern;
            const srcX = Math.max(0, Math.min(width - 1, x + Math.round(shift)));
            const srcOffset = y * scanlineLength + 1 + srcX * bytesPerPixel;
            for (let c = 0; c < bytesPerPixel; c++) {
              result[offset + c] = pixelData[srcOffset + c];
            }
          }
        }

        if (params.affect === 'color' || params.affect === 'all') {
          if (active) {
            const hueShift = intensity * 2;
            result[offset] = (pixelData[offset] + hueShift) % 256;
            result[offset + 2] = (pixelData[offset + 2] + hueShift * 2) % 256;
          }
        }

        if (params.affect === 'alpha' || params.affect === 'all') {
          const mult = active ? 1 : 1 - (intensity / 100);
          result[offset] = Math.round(result[offset] * mult);
          result[offset + 1] = Math.round(result[offset + 1] * mult);
          result[offset + 2] = Math.round(result[offset + 2] * mult);
        }
      }
    }
    return result;
  }
});

// 15. Fractal Displacement - Mandelbrot/Julia set displacement
registerEffect({
  id: 'fractal-displacement',
  name: 'Fractal Displacement',
  category: 'generative',
  icon: '❋',
  parameters: [
    { id: 'fractalType', type: 'dropdown', label: 'Type', default: 'mandelbrot',
      options: [
        { value: 'mandelbrot', label: 'Mandelbrot' },
        { value: 'julia', label: 'Julia' }
      ]
    },
    { id: 'iterations', type: 'slider', label: 'Iterations', default: 20, min: 5, max: 100, step: 5, unit: '' },
    { id: 'zoom', type: 'slider', label: 'Zoom', default: 30, min: 1, max: 100, step: 1, unit: '' },
    { id: 'centerX', type: 'slider', label: 'Center X', default: 50, min: 0, max: 100, step: 1, unit: '%' },
    { id: 'centerY', type: 'slider', label: 'Center Y', default: 50, min: 0, max: 100, step: 1, unit: '%' },
    { id: 'displacement', type: 'slider', label: 'Displacement', default: 30, min: 1, max: 100, step: 1, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);

    const zoom = logScale(params.zoom, 100, 4);
    const cx = (params.centerX / 50 - 1) * 2;
    const cy = (params.centerY / 50 - 1) * 2;
    const maxDisp = logScale(params.displacement, 100, 100);

    // Julia set constant (interesting values)
    const juliaC = { r: -0.7, i: 0.27015 };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Map pixel to complex plane
        let zr = (x / width - 0.5) * 4 / zoom + cx;
        let zi = (y / height - 0.5) * 4 / zoom + cy;
        let cr = params.fractalType === 'julia' ? juliaC.r : zr;
        let ci = params.fractalType === 'julia' ? juliaC.i : zi;

        let iter = 0;
        while (zr * zr + zi * zi < 4 && iter < params.iterations) {
          const tmp = zr * zr - zi * zi + cr;
          zi = 2 * zr * zi + ci;
          zr = tmp;
          iter++;
        }

        const t = iter / params.iterations;
        const angle = t * Math.PI * 4;
        const dispX = Math.cos(angle) * maxDisp * t;
        const dispY = Math.sin(angle) * maxDisp * t;

        const srcX = Math.round(x + dispX);
        const srcY = Math.round(y + dispY);

        const dstOffset = y * scanlineLength + 1 + x * bytesPerPixel;
        if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
          const srcOffset = srcY * scanlineLength + 1 + srcX * bytesPerPixel;
          for (let c = 0; c < bytesPerPixel; c++) {
            result[dstOffset + c] = pixelData[srcOffset + c];
          }
        }
      }
    }
    return result;
  }
});

// 16. Perlin Flow Field - Move pixels along noise-based vectors
registerEffect({
  id: 'perlin-flow-field',
  name: 'Perlin Flow Field',
  category: 'generative',
  icon: '≋',
  parameters: [
    { id: 'scale', type: 'slider', label: 'Scale', default: 30, min: 1, max: 100, step: 1, unit: '' },
    { id: 'octaves', type: 'slider', label: 'Octaves', default: 3, min: 1, max: 8, step: 1, unit: '' },
    { id: 'persistence', type: 'slider', label: 'Persistence', default: 50, min: 10, max: 90, step: 5, unit: '%' },
    { id: 'flowStrength', type: 'slider', label: 'Flow Strength', default: 40, min: 1, max: 100, step: 1, unit: '' },
    { id: 'iterations', type: 'slider', label: 'Iterations', default: 5, min: 1, max: 20, step: 1, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);

    simplexNoise.seed(seed);
    const scale = logScale(params.scale, 100, 0.05);
    const flowStrength = logScale(params.flowStrength, 100, 30);
    const persistence = params.persistence / 100;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let px = x, py = y;

        for (let iter = 0; iter < params.iterations; iter++) {
          const angle = simplexNoise.fbm(px * scale, py * scale, params.octaves, 2, persistence) * Math.PI * 2;
          px += Math.cos(angle) * flowStrength / params.iterations;
          py += Math.sin(angle) * flowStrength / params.iterations;
        }

        const srcX = Math.round(px), srcY = Math.round(py);
        const dstOffset = y * scanlineLength + 1 + x * bytesPerPixel;

        if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
          const srcOffset = srcY * scanlineLength + 1 + srcX * bytesPerPixel;
          for (let c = 0; c < bytesPerPixel; c++) {
            result[dstOffset + c] = pixelData[srcOffset + c];
          }
        }
      }
    }
    return result;
  }
});

// 17. Reaction Diffusion - Gray-Scott simulation overlay
registerEffect({
  id: 'reaction-diffusion',
  name: 'Reaction Diffusion',
  category: 'generative',
  icon: '◌',
  parameters: [
    { id: 'feed', type: 'slider', label: 'Feed Rate', default: 35, min: 10, max: 80, step: 1, unit: '' },
    { id: 'kill', type: 'slider', label: 'Kill Rate', default: 62, min: 40, max: 80, step: 1, unit: '' },
    { id: 'iterations', type: 'slider', label: 'Iterations', default: 30, min: 5, max: 100, step: 5, unit: '' },
    { id: 'blendMode', type: 'dropdown', label: 'Blend', default: 'multiply',
      options: [
        { value: 'multiply', label: 'Multiply' },
        { value: 'screen', label: 'Screen' },
        { value: 'overlay', label: 'Overlay' },
        { value: 'replace', label: 'Replace' }
      ]
    }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);

    const f = params.feed / 1000;
    const k = params.kill / 1000;
    const dA = 1.0, dB = 0.5;

    // Initialize grids
    let gridA = new Float32Array(width * height).fill(1);
    let gridB = new Float32Array(width * height).fill(0);

    // Seed with image luminance
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = y * scanlineLength + 1 + x * bytesPerPixel;
        const lum = (pixelData[offset] + pixelData[offset + 1] + pixelData[offset + 2]) / 765;
        if (lum > 0.5 && rng() < 0.1) {
          const idx = y * width + x;
          gridB[idx] = 1;
        }
      }
    }

    // Run simulation
    for (let iter = 0; iter < params.iterations; iter++) {
      const nextA = new Float32Array(width * height);
      const nextB = new Float32Array(width * height);

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          const a = gridA[idx], b = gridB[idx];

          // Laplacian
          const lapA = gridA[idx-1] + gridA[idx+1] + gridA[idx-width] + gridA[idx+width] - 4*a;
          const lapB = gridB[idx-1] + gridB[idx+1] + gridB[idx-width] + gridB[idx+width] - 4*b;

          const abb = a * b * b;
          nextA[idx] = Math.max(0, Math.min(1, a + dA * lapA * 0.2 - abb + f * (1 - a)));
          nextB[idx] = Math.max(0, Math.min(1, b + dB * lapB * 0.2 + abb - (k + f) * b));
        }
      }
      gridA = nextA;
      gridB = nextB;
    }

    // Apply to image
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = y * scanlineLength + 1 + x * bytesPerPixel;
        const idx = y * width + x;
        const v = 1 - gridB[idx];

        for (let c = 0; c < 3; c++) {
          const orig = pixelData[offset + c] / 255;
          let blended;
          if (params.blendMode === 'multiply') blended = orig * v;
          else if (params.blendMode === 'screen') blended = 1 - (1 - orig) * (1 - v);
          else if (params.blendMode === 'overlay') blended = orig < 0.5 ? 2 * orig * v : 1 - 2 * (1 - orig) * (1 - v);
          else blended = v;
          result[offset + c] = Math.round(blended * 255);
        }
      }
    }
    return result;
  }
});

// 18. Temporal Echo - Blend with offset copies
registerEffect({
  id: 'temporal-echo',
  name: 'Temporal Echo',
  category: 'blend',
  icon: '◔◔',
  parameters: [
    { id: 'echoCount', type: 'slider', label: 'Echoes', default: 4, min: 1, max: 10, step: 1, unit: '' },
    { id: 'offsetX', type: 'slider', label: 'Offset X', default: 20, min: -100, max: 100, step: 5, unit: 'px' },
    { id: 'offsetY', type: 'slider', label: 'Offset Y', default: 10, min: -100, max: 100, step: 5, unit: 'px' },
    { id: 'decay', type: 'dropdown', label: 'Decay', default: 'linear',
      options: [
        { value: 'linear', label: 'Linear' },
        { value: 'exponential', label: 'Exponential' },
        { value: 'equal', label: 'Equal' }
      ]
    },
    { id: 'blendMode', type: 'dropdown', label: 'Blend', default: 'screen',
      options: [
        { value: 'screen', label: 'Screen' },
        { value: 'add', label: 'Add' },
        { value: 'average', label: 'Average' },
        { value: 'max', label: 'Lighten' }
      ]
    },
    { id: 'hueShift', type: 'slider', label: 'Hue Shift', default: 20, min: 0, max: 60, step: 5, unit: '°' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Float32Array(width * height * 3);

    const dx = logScaleBidirectional(params.offsetX, 100, 50);
    const dy = logScaleBidirectional(params.offsetY, 100, 50);
    const hueShift = params.hueShift;

    for (let echo = 0; echo <= params.echoCount; echo++) {
      let weight;
      if (params.decay === 'linear') weight = 1 - echo / (params.echoCount + 1);
      else if (params.decay === 'exponential') weight = Math.pow(0.6, echo);
      else weight = 1 / (params.echoCount + 1);

      const ox = Math.round(dx * echo);
      const oy = Math.round(dy * echo);
      const hue = (hueShift * echo) % 360;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const srcX = x - ox, srcY = y - oy;
          if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) continue;

          const srcOffset = srcY * scanlineLength + 1 + srcX * bytesPerPixel;
          const dstIdx = (y * width + x) * 3;

          // Simple hue shift by rotating channels
          let r = pixelData[srcOffset];
          let g = pixelData[srcOffset + 1];
          let b = pixelData[srcOffset + 2];

          if (hue > 0) {
            const angle = (hue * Math.PI) / 180;
            const cos = Math.cos(angle), sin = Math.sin(angle);
            const nr = r * (cos + (1-cos)/3) + g * ((1-cos)/3 - sin/Math.sqrt(3)) + b * ((1-cos)/3 + sin/Math.sqrt(3));
            const ng = r * ((1-cos)/3 + sin/Math.sqrt(3)) + g * (cos + (1-cos)/3) + b * ((1-cos)/3 - sin/Math.sqrt(3));
            const nb = r * ((1-cos)/3 - sin/Math.sqrt(3)) + g * ((1-cos)/3 + sin/Math.sqrt(3)) + b * (cos + (1-cos)/3);
            r = nr; g = ng; b = nb;
          }

          if (params.blendMode === 'screen') {
            result[dstIdx] = 255 - (255 - result[dstIdx]) * (255 - r * weight) / 255;
            result[dstIdx + 1] = 255 - (255 - result[dstIdx + 1]) * (255 - g * weight) / 255;
            result[dstIdx + 2] = 255 - (255 - result[dstIdx + 2]) * (255 - b * weight) / 255;
          } else if (params.blendMode === 'add') {
            result[dstIdx] += r * weight;
            result[dstIdx + 1] += g * weight;
            result[dstIdx + 2] += b * weight;
          } else if (params.blendMode === 'average') {
            result[dstIdx] += r * weight;
            result[dstIdx + 1] += g * weight;
            result[dstIdx + 2] += b * weight;
          } else if (params.blendMode === 'max') {
            result[dstIdx] = Math.max(result[dstIdx], r * weight);
            result[dstIdx + 1] = Math.max(result[dstIdx + 1], g * weight);
            result[dstIdx + 2] = Math.max(result[dstIdx + 2], b * weight);
          }
        }
      }
    }

    // Convert back to Uint8
    const output = new Uint8Array(pixelData);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * 3;
        const dstOffset = y * scanlineLength + 1 + x * bytesPerPixel;
        output[dstOffset] = Math.max(0, Math.min(255, Math.round(result[srcIdx])));
        output[dstOffset + 1] = Math.max(0, Math.min(255, Math.round(result[srcIdx + 1])));
        output[dstOffset + 2] = Math.max(0, Math.min(255, Math.round(result[srcIdx + 2])));
      }
    }
    return output;
  }
});

// 19. Melt - Pixels drip/rise based on value
registerEffect({
  id: 'melt',
  name: 'Melt',
  category: 'distortion',
  icon: '▼',
  parameters: [
    { id: 'direction', type: 'dropdown', label: 'Direction', default: 'down',
      options: [
        { value: 'down', label: 'Down' },
        { value: 'up', label: 'Up' },
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' }
      ]
    },
    { id: 'speed', type: 'slider', label: 'Speed', default: 40, min: 1, max: 100, step: 1, unit: '' },
    { id: 'threshold', type: 'slider', label: 'Threshold', default: 50, min: 0, max: 100, step: 5, unit: '%' },
    { id: 'viscosity', type: 'slider', label: 'Viscosity', default: 50, min: 1, max: 100, step: 1, unit: '' },
    { id: 'surface', type: 'slider', label: 'Surface Tension', default: 30, min: 0, max: 100, step: 5, unit: '' }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);

    const maxMelt = logScale(params.speed, 100, height / 3);
    const threshold = (params.threshold / 100) * 255;
    const viscosity = 1 - (params.viscosity / 100);
    const surface = params.surface / 100;

    const isVertical = params.direction === 'down' || params.direction === 'up';
    const isPositive = params.direction === 'down' || params.direction === 'right';

    const primary = isVertical ? height : width;
    const secondary = isVertical ? width : height;

    // Calculate melt amount per column/row
    const meltAmounts = new Float32Array(secondary);
    for (let s = 0; s < secondary; s++) {
      let sumLum = 0, count = 0;
      for (let p = 0; p < primary; p++) {
        const x = isVertical ? s : p;
        const y = isVertical ? p : s;
        const offset = y * scanlineLength + 1 + x * bytesPerPixel;
        const lum = (pixelData[offset] + pixelData[offset + 1] + pixelData[offset + 2]) / 3;
        if (lum > threshold) { sumLum += lum; count++; }
      }
      const avgLum = count > 0 ? sumLum / count : 0;
      meltAmounts[s] = (avgLum / 255) * maxMelt * (0.5 + rng() * 0.5);
    }

    // Apply surface tension smoothing
    if (surface > 0) {
      const smoothed = new Float32Array(meltAmounts);
      for (let s = 1; s < secondary - 1; s++) {
        smoothed[s] = meltAmounts[s] * (1 - surface) +
                     (meltAmounts[s-1] + meltAmounts[s+1]) / 2 * surface;
      }
      meltAmounts.set(smoothed);
    }

    // Apply melt
    for (let s = 0; s < secondary; s++) {
      const melt = Math.round(meltAmounts[s] * viscosity);

      for (let p = 0; p < primary; p++) {
        const srcP = isPositive ? p - melt : p + melt;
        if (srcP < 0 || srcP >= primary) continue;

        const dstX = isVertical ? s : p;
        const dstY = isVertical ? p : s;
        const srcX = isVertical ? s : srcP;
        const srcY = isVertical ? srcP : s;

        const dstOffset = dstY * scanlineLength + 1 + dstX * bytesPerPixel;
        const srcOffset = srcY * scanlineLength + 1 + srcX * bytesPerPixel;

        for (let c = 0; c < bytesPerPixel; c++) {
          result[dstOffset + c] = pixelData[srcOffset + c];
        }
      }
    }
    return result;
  }
});

// 20. Pixel Sort Pro - Advanced sorting with masking
registerEffect({
  id: 'pixel-sort-pro',
  name: 'Pixel Sort Pro',
  category: 'distortion',
  icon: '▥',
  parameters: [
    { id: 'sortBy', type: 'dropdown', label: 'Sort By', default: 'luminance',
      options: [
        { value: 'luminance', label: 'Luminance' },
        { value: 'hue', label: 'Hue' },
        { value: 'saturation', label: 'Saturation' },
        { value: 'red', label: 'Red' },
        { value: 'green', label: 'Green' },
        { value: 'blue', label: 'Blue' }
      ]
    },
    { id: 'thresholdMin', type: 'slider', label: 'Threshold Min', default: 25, min: 0, max: 100, step: 1, unit: '%' },
    { id: 'thresholdMax', type: 'slider', label: 'Threshold Max', default: 75, min: 0, max: 100, step: 1, unit: '%' },
    { id: 'direction', type: 'dropdown', label: 'Direction', default: 'horizontal',
      options: [
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical', label: 'Vertical' },
        { value: 'diagonal', label: 'Diagonal' }
      ]
    },
    { id: 'segmentLength', type: 'slider', label: 'Segment Length', default: 50, min: 5, max: 100, step: 5, unit: '%' },
    { id: 'reverse', type: 'checkbox', label: 'Reverse', default: false }
  ],
  apply: (pixelData, imageInfo, params, seed) => {
    const { width, height, bytesPerPixel, scanlineLength } = imageInfo;
    const result = new Uint8Array(pixelData);
    const rng = createSeededRNG(seed);

    const threshMin = (params.thresholdMin / 100) * 255;
    const threshMax = (params.thresholdMax / 100) * 255;
    const maxSegment = Math.round((params.segmentLength / 100) * (params.direction === 'vertical' ? height : width));

    const getValue = (offset) => {
      const r = pixelData[offset], g = pixelData[offset + 1], b = pixelData[offset + 2];
      switch (params.sortBy) {
        case 'luminance': return r * 0.299 + g * 0.587 + b * 0.114;
        case 'hue': {
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          if (max === min) return 0;
          let h;
          if (max === r) h = (g - b) / (max - min);
          else if (max === g) h = 2 + (b - r) / (max - min);
          else h = 4 + (r - g) / (max - min);
          return ((h * 60 + 360) % 360) / 360 * 255;
        }
        case 'saturation': {
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          return max === 0 ? 0 : ((max - min) / max) * 255;
        }
        case 'red': return r;
        case 'green': return g;
        case 'blue': return b;
        default: return r * 0.299 + g * 0.587 + b * 0.114;
      }
    };

    const sortLine = (pixels) => {
      // Find segments to sort (values within threshold)
      const segments = [];
      let segStart = -1;

      for (let i = 0; i < pixels.length; i++) {
        const val = getValue(pixels[i].offset);
        const inRange = val >= threshMin && val <= threshMax;

        if (inRange && segStart === -1) {
          segStart = i;
        } else if (!inRange && segStart !== -1) {
          if (i - segStart > 1) segments.push([segStart, i]);
          segStart = -1;
        }
      }
      if (segStart !== -1 && pixels.length - segStart > 1) {
        segments.push([segStart, pixels.length]);
      }

      // Sort each segment
      for (const [start, end] of segments) {
        const len = Math.min(end - start, maxSegment);
        const segment = pixels.slice(start, start + len);

        segment.sort((a, b) => {
          const diff = getValue(a.offset) - getValue(b.offset);
          return params.reverse ? -diff : diff;
        });

        // Write sorted pixels
        for (let i = 0; i < segment.length; i++) {
          const dstOffset = pixels[start + i].offset;
          const srcOffset = segment[i].offset;
          for (let c = 0; c < bytesPerPixel; c++) {
            result[dstOffset + c] = pixelData[srcOffset + c];
          }
        }
      }
    };

    if (params.direction === 'horizontal') {
      for (let y = 0; y < height; y++) {
        const pixels = [];
        for (let x = 0; x < width; x++) {
          pixels.push({ offset: y * scanlineLength + 1 + x * bytesPerPixel });
        }
        sortLine(pixels);
      }
    } else if (params.direction === 'vertical') {
      for (let x = 0; x < width; x++) {
        const pixels = [];
        for (let y = 0; y < height; y++) {
          pixels.push({ offset: y * scanlineLength + 1 + x * bytesPerPixel });
        }
        sortLine(pixels);
      }
    } else {
      // Diagonal
      for (let d = 0; d < width + height - 1; d++) {
        const pixels = [];
        for (let y = 0; y < height; y++) {
          const x = d - y;
          if (x >= 0 && x < width) {
            pixels.push({ offset: y * scanlineLength + 1 + x * bytesPerPixel });
          }
        }
        if (pixels.length > 1) sortLine(pixels);
      }
    }
    return result;
  }
});

// ========== EFFECT DESCRIPTIONS ==========

export const effectDescriptions = {
  // Filter
  'filter-byte': 'Modify PNG filter bytes for predictive decoding glitches',
  // Channel
  'channel-shift': 'Offset RGB channels horizontally for chromatic separation',
  'channel-swap': 'Swap color channels (R↔G, G↔B, B↔R)',
  'channel-orbit': 'Rotate hue with per-channel offsets',
  'chromatic-aberration': 'Simple RGB color fringing effect',
  'chromatic-aberration-pro': 'Advanced fringing with radial falloff and edge boost',
  'channel-blend-modes': 'Blend channels using multiply, screen, or overlay',
  // Distortion
  'scanline-corrupt': 'Corrupt random bytes on periodic scanlines',
  'pixel-sort': 'Sort pixels by luminance in segments',
  'displacement': 'Shift pixels based on their luminance value',
  'block-glitch': 'Shuffle rectangular blocks of the image',
  'bit-flip': 'Randomly flip bits in pixel data',
  'pixel-dropout': 'Random pixel deletion and repetition',
  'data-mosh': 'Simulate video compression artifacts',
  'glitch-lines': 'Insert horizontal glitch lines',
  'warp-field': 'Noise-based flowing pixel displacement',
  'echo-decay': 'Create trailing echo offset effect',
  'spiral-pull': 'Pull pixels toward center in a spiral',
  'spiral-warp': 'Twist pixels around a center point',
  'wave-mesh': 'Sine, triangle, or square wave displacement',
  'pixel-drift': 'Luminance-based pixel migration in a direction',
  'elastic-bounce': 'Spring pixels toward random attractors',
  'voronoi-shatter': 'Break image into displaced Voronoi cells',
  'radial-stretch': 'Stretch or compress from a center point',
  'scanline-shuffle': 'Rearrange scanlines by pattern (reverse, fibonacci, etc.)',
  'melt': 'Pixels drip or rise based on brightness',
  'pixel-sort-pro': 'Advanced sorting with thresholds and multiple criteria',
  // Color
  'color-quantize': 'Reduce color palette with optional dithering',
  'noise': 'Add random noise to pixel values',
  'sparkle': 'Random bright pixel highlights',
  'halftone': 'Simulate print halftone dot patterns',
  'neighbor-drift': 'Blend pixels with their neighbors',
  'pixel-plasma': 'Plasma-like color distortion',
  'color-bleed': 'Spread bright or saturated colors to neighbors',
  'palette-quantize': 'Color reduction with Floyd-Steinberg or Bayer dithering',
  'gradient-map-chaos': 'Map luminance to a shifting hue gradient',
  // Generative
  'turing-grow': 'Turing pattern simulation growth',
  'life-cycle': 'Game of Life-like cellular patterns',
  'cellular-automata': 'Apply elementary CA rules to pixel grid',
  'euclidean-rhythm': 'Apply Euclidean musical rhythm patterns',
  'fractal-displacement': 'Mandelbrot or Julia set-based distortion',
  'perlin-flow-field': 'Flow pixels along Perlin noise vectors',
  'reaction-diffusion': 'Gray-Scott reaction-diffusion simulation',
  // Stylize
  'crystal': 'Crystallize into geometric polygon regions',
  'erode': 'Morphological erosion darkening effect',
  'convolution': 'Apply kernel filters (sharpen, blur, edges)',
  // Blend
  'temporal-echo': 'Blend offset copies with decay and hue shift'
};
