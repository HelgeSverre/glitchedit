# ĞŁİŦČĦƎĐİŦ

A browser-based PNG hex editor for creating glitch art through direct byte manipulation.

**[Try it live](https://helgesverre.github.io/glitchedit/)** | Single HTML file | No dependencies | Works offline

## Features

- **Hex Editor** - Edit PNG bytes directly with real-time preview
- **Chunk Navigator** - Visual breakdown of PNG structure (IHDR, IDAT, IEND, etc.)
- **Live Preview** - See glitch effects instantly as you edit
- **CRC Auto-fix** - Automatically recalculates checksums on save
- **Virtual Scrolling** - Handles large files smoothly
- **Keyboard Navigation** - Full keyboard support for efficient editing

## Usage

1. Open `index.html` in your browser
2. Drag & drop a PNG file (or click Load)
3. Click bytes in the hex view to edit them
4. Save with fixed CRCs or export raw

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Arrow keys` | Navigate hex view |
| `0-9, A-F` | Edit byte at cursor |
| `Shift+Click` | Select range |
| `Ctrl+G` | Go to offset |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+A` | Select all |
| `Delete` | Randomize selection |

## How It Works

PNG files have a specific structure: signature bytes followed by chunks (IHDR, IDAT, IEND, etc.). Each chunk has a CRC checksum. GLITCHEDIT lets you:

- Edit any byte while visualizing which chunk it belongs to
- See chunk boundaries color-coded in the hex view
- Auto-fix CRCs so your glitched PNG remains valid
- Export "raw" to keep intentional CRC errors

## Self-Contained

Everything is in a single `index.html` file (~43KB). No build step, no npm, no frameworks. Just open it in a browser.

## Browser Support

Chrome 90+, Firefox 88+, Safari 14+, Edge 90+

## License

MIT
