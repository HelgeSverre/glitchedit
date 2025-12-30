# GĻƗŦÇĦɆĐƗŦ

[![npm version](https://img.shields.io/npm/v/glitchedit.svg?style=flat)](https://www.npmjs.com/package/glitchedit)
[![CI](https://github.com/helgesverre/glitchedit/actions/workflows/ci.yml/badge.svg)](https://github.com/helgesverre/glitchedit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat)](https://opensource.org/licenses/MIT)
[![Demo](https://img.shields.io/badge/demo-live-brightgreen?style=flat)](https://helgesverre.github.io/glitchedit/)

A browser-based PNG glitch art editor with 48 real-time effects and direct byte manipulation.

**[Try it live](https://helgesverre.github.io/glitchedit/)**

![Screenshot](screenshot.png)

## Features

- **48 Glitch Effects** - Channel shifts, pixel sorting, data moshing, cellular automata, and more
- **Hex Editor** - Edit PNG bytes directly with real-time preview
- **Layer System** - Stack multiple effects with adjustable parameters
- **Chunk Navigator** - Visual breakdown of PNG structure (IHDR, IDAT, IEND, etc.)
- **CRC Auto-fix** - Automatically recalculates checksums on save

## Installation

### Option 1: npx (recommended)

```bash
npx glitchedit
```

Opens the editor in your browser automatically.

### Option 2: Standalone binary

Download the latest release for your platform from [Releases](https://github.com/helgesverre/glitchedit/releases):

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | `glitchedit-darwin-arm64.tar.gz` |
| macOS (Intel) | `glitchedit-darwin-x64.tar.gz` |
| Linux (x64) | `glitchedit-linux-x64.tar.gz` |
| Windows (x64) | `glitchedit-windows-x64.zip` |

```bash
# Extract and run
tar -xzf glitchedit-darwin-arm64.tar.gz
./glitchedit-darwin-arm64
```

### Option 3: From source

```bash
git clone https://github.com/helgesverre/glitchedit.git
cd glitchedit
npm install
npm start
```

Then open http://localhost:3000 in your browser.

### Option 4: Single HTML file

Download `glitchedit.html` from [Releases](https://github.com/helgesverre/glitchedit/releases) and open it in your browser. No server required.

## Development

```bash
# Install dependencies
npm install

# Run dev server
npm start

# Run tests
npm test

# Generate effect previews (for help dialog)
npm run generate-previews

# Build single-file distribution
npm run build:bundle
```

### Build Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start local dev server at localhost:3000 |
| `npm test` | Run Playwright e2e tests |
| `npm run build:bundle` | Create single-file `dist/glitchedit.html` (~3.7MB) |
| `npm run build:exe` | Build standalone binary for current platform |
| `npm run build:exe:all` | Build binaries for all platforms |
| `npm run generate-previews` | Regenerate effect preview thumbnails |
| `npm run profile` | Profile CPU performance with Playwright + CDP |

### Single-File Build

The `build:bundle` command creates a standalone HTML file with all assets inlined:
- CSS embedded in `<style>` tags
- JavaScript bundled and minified with [Bun](https://bun.sh)
- Effect preview images as base64 data URIs
- [fflate](https://github.com/101arrowz/fflate) compression library inlined

**Requires:** [Bun](https://bun.sh) runtime (`npm install -g bun` or see bun.sh for installation)

## Usage

1. Open the app - a random image loads automatically
2. Click **+ Add** to apply glitch effects
3. Adjust effect parameters with sliders
4. Stack multiple effects by adding more layers
5. Click **Download** to save your glitched image

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Arrow keys` | Navigate hex view |
| `0-9, A-F` | Edit byte at cursor |
| `Shift+Click` | Select range |
| `Ctrl+G` | Go to offset |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Delete` | Randomize selection |

## Effects

48 effects across 7 categories:

| Category | Effects |
|----------|---------|
| **Filter** | Filter Byte manipulation |
| **Channel** | Channel Shift, Swap, Orbit, Chromatic Aberration |
| **Distortion** | Pixel Sort, Block Glitch, Data Mosh, Warp Field, Spiral, Melt |
| **Color** | Quantize, Noise, Halftone, Plasma, Color Bleed |
| **Generative** | Turing Patterns, Game of Life, Cellular Automata, Perlin Flow |
| **Stylize** | Crystal, Erode, Convolution kernels |
| **Blend** | Temporal Echo with hue shifting |

Click the **?** button in the app for a full effects guide with previews.

## How It Works

PNG files have a specific structure: signature bytes followed by chunks (IHDR, IDAT, IEND, etc.). Each chunk has a CRC checksum. GĻƗŦÇĦɆĐƗŦ:

- Decompresses IDAT chunks to raw pixel data
- Applies effects to the pixel buffer
- Recompresses and updates CRCs automatically
- Provides both "fixed" and "raw" export options

## Project Structure

```
├── index.html          # Main HTML
├── style.css           # Styles
├── script.js           # App logic
├── effects.mjs         # 48 effect implementations (shared module)
├── server.ts           # Bun server for standalone binary
├── bin/
│   └── cli.js          # Node.js CLI for npx
├── assets/
│   └── effect-previews.json  # Pre-generated effect thumbnails
├── scripts/
│   ├── generate-help-previews.mjs  # Preview generator
│   ├── bundle.js       # Single-file bundler
│   └── profile-performance.js      # CPU profiler (Playwright + CDP)
├── .github/
│   └── workflows/      # CI/CD pipelines
└── tests/
    └── app.spec.js     # Playwright e2e tests
```

## Browser Support

Chrome 90+, Firefox 88+, Safari 14+, Edge 90+

## License

MIT
