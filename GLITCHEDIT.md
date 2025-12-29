# GLITCHEDIT

**A Self-Contained PNG Glitch Art Editor**

A browser-based, single HTML file application for creating glitch art through direct PNG byte manipulation with real-time visual feedback.

---

## Vision

GLITCHEDIT is a precision tool for digital artists and glitch enthusiasts who want to understand and manipulate the raw structure of PNG images. Unlike automated glitch filters, GLITCHEDIT provides direct byte-level control while maintaining PNG validity, enabling intentional corruption aesthetics with predictable results.

---

## Core Concept

```
┌─────────────────────────────────────────────────────────────────────┐
│  GLITCHEDIT                                          [Load] [Save]  │
├────────────────────────────────┬────────────────────────────────────┤
│                                │  IHDR ████████████████             │
│                                │  gAMA ████                         │
│                                │  IDAT ████████████████████████████ │
│      IMAGE PREVIEW             │       ████████████████████████████ │
│                                │       ████████████████████████████ │
│      [Live rendered PNG]       │       ████████████████████████████ │
│                                │  IEND ████                         │
│                                │                                    │
│                                │  ─────────────────────────────     │
│                                │  00000000  89 50 4E 47 0D 0A 1A 0A │
│                                │  00000008  00 00 00 0D 49 48 44 52 │
│                                │  00000010  00 00 01 00 00 00 01 00 │
│                                │  ...                               │
├────────────────────────────────┴────────────────────────────────────┤
│  Chunk: IDAT  │  Offset: 0x00A4  │  Selection: 16 bytes  │  Valid ● │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Design Language

### Color Palette

| Element | Color | Usage |
|---------|-------|-------|
| Background | `#0a0a0a` | Main canvas |
| Surface | `#141414` | Panels, cards |
| Border | `#2a2a2a` | Dividers, edges |
| Text Primary | `#e0e0e0` | Main content |
| Text Secondary | `#707070` | Labels, hints |
| Text Muted | `#404040` | Disabled states |

### Chunk Accent Colors

Each PNG chunk type receives a distinct accent color for instant recognition:

| Chunk | Color | Hex |
|-------|-------|-----|
| Signature | `#ff6b6b` | Red - File identity |
| IHDR | `#4ecdc4` | Cyan - Header/dimensions |
| PLTE | `#ffe66d` | Yellow - Palette |
| IDAT | `#95e1d3` | Mint - Image data (safe zone) |
| IDAT (compressed) | `#f38181` | Coral - Risky edit zone |
| IEND | `#aa96da` | Lavender - Terminator |
| Ancillary | `#606060` | Gray - Metadata |
| CRC | `#ffc857` | Amber - Checksums |
| Invalid | `#ff0040` | Hot red - Errors |

### Typography

- **Monospace throughout**: `"SF Mono", "Fira Code", "Consolas", monospace`
- **Hex view**: 13px, letter-spacing: 1px
- **UI labels**: 11px uppercase, letter-spacing: 2px
- **Status text**: 12px normal

### Visual Style

- Sharp corners (no border-radius)
- 1px borders only
- No shadows
- Subtle scanline overlay option for CRT aesthetic
- High contrast selection highlights
- Minimal animation (instant feedback preferred)

---

## Technical Architecture

### PNG Format Handling

```
PNG Structure:
┌──────────────────────────────────────────┐
│ Signature: 89 50 4E 47 0D 0A 1A 0A       │  8 bytes, immutable
├──────────────────────────────────────────┤
│ Chunk: IHDR                              │
│   Length: 4 bytes                        │
│   Type: 4 bytes ("IHDR")                 │
│   Data: 13 bytes (dimensions, depth)     │
│   CRC: 4 bytes                           │
├──────────────────────────────────────────┤
│ Chunk: IDAT (repeatable)                 │
│   Length: 4 bytes                        │
│   Type: 4 bytes ("IDAT")                 │
│   Data: variable (compressed pixels)     │
│   CRC: 4 bytes                           │
├──────────────────────────────────────────┤
│ Chunk: IEND                              │
│   Length: 4 bytes (always 0)             │
│   Type: 4 bytes ("IEND")                 │
│   CRC: 4 bytes                           │
└──────────────────────────────────────────┘
```

### Validity Preservation Strategy

To maintain PNG validity while enabling glitch effects:

1. **CRC Auto-Recalculation**: After any edit, automatically recalculate affected chunk CRCs
2. **Chunk Structure Lock**: Prevent edits that break length/type boundaries unless explicitly unlocked
3. **Safe Zones**: Mark areas safe for glitching (IDAT payload, ancillary chunks)
4. **Danger Zones**: Warn before editing critical structure (IHDR dimensions, signature)
5. **Validation on Save**: Full PNG validation before export with error highlighting

### Glitch-Safe Edit Modes

| Mode | Description | Risk Level |
|------|-------------|------------|
| **Ancillary Only** | Edit metadata chunks only | None |
| **IDAT Surface** | Modify uncompressed-safe bytes | Low |
| **IDAT Deep** | Edit compressed stream | Medium |
| **Structure Edit** | Modify chunk boundaries | High |
| **Raw Mode** | No protection, full access | Extreme |

---

## Features

### Core Features

#### 1. Drag & Drop / File Picker
- Accept PNG files via drag-drop onto window
- Standard file picker as fallback
- Show file info on load (dimensions, size, chunk count)

#### 2. Split View Interface
- **Left Panel**: Live image preview with zoom/pan
- **Right Panel**: Hex editor with chunk visualization
- Resizable split (drag divider)
- Keyboard shortcut to toggle focus (Tab)

#### 3. Hex Editor
- Traditional hex view: offset | hex bytes | ASCII
- 16 bytes per row (configurable: 8, 16, 32)
- Chunk-aware coloring (bytes colored by parent chunk)
- Selection spanning (click-drag, shift-click)
- Keyboard navigation (arrows, Page Up/Down, Home/End)
- Direct hex input (type to replace selected bytes)
- ASCII input mode toggle

#### 4. Chunk Navigator
- Collapsible list of all chunks
- Click to jump to chunk in hex view
- Expand to see chunk details (length, CRC, data summary)
- Quick actions per chunk (delete, duplicate, edit)

#### 5. Live Preview
- Real-time render as bytes change
- Debounced updates (50ms delay to batch rapid edits)
- Error state visualization (red tint + error icon when invalid)
- Toggle between "live" and "manual refresh"

#### 6. Edit Operations
- **Single byte edit**: Click byte, type new value
- **Range fill**: Select range, fill with pattern/value
- **Find & Replace**: Hex pattern search and replace
- **Insert bytes**: Add bytes at cursor (for ancillary chunks)
- **Delete bytes**: Remove selected bytes (with warnings)
- **Randomize**: Fill selection with random values
- **Bit flip**: Toggle specific bits in selection
- **Shift**: Arithmetic shift bytes left/right

#### 7. Undo/Redo
- Full history stack (configurable depth, default 100)
- Keyboard shortcuts (Ctrl+Z, Ctrl+Shift+Z)
- History panel showing edit descriptions

#### 8. Export
- Save modified PNG (with auto CRC fix)
- Export as-is (preserve intentional CRC errors)
- Download with timestamp filename
- Copy to clipboard as data URL

### Advanced Features

#### 9. Glitch Presets
Pre-built glitch operations:

| Preset | Effect |
|--------|--------|
| **Channel Shift** | Offset color channel data |
| **Scanline Corrupt** | Randomize every Nth row |
| **Block Glitch** | Corrupt random IDAT blocks |
| **Color Bleed** | Shift palette indices |
| **Data Bend** | Treat image data as audio-style waveform |
| **Chunk Shuffle** | Reorder IDAT chunks |

#### 10. Comparison View
- Side-by-side original vs modified
- Difference highlight overlay
- Toggle between comparison modes

#### 11. Byte Inspector
Detailed view of selected byte(s):
- Binary representation
- Decimal value
- Signed/unsigned interpretation
- Parent chunk context
- Offset from chunk start

#### 12. Bookmarks
- Mark interesting offsets for quick return
- Named bookmarks with notes
- Persisted in localStorage

#### 13. Templates
- Save current edit state as template
- Apply template to new images
- Share templates (export/import JSON)

---

## Performance Requirements

### Targets

| Metric | Target |
|--------|--------|
| Initial load | < 100ms |
| File open (5MB PNG) | < 500ms |
| Hex view scroll | 60fps |
| Edit to preview | < 100ms |
| Export | < 1s |

### Optimization Strategies

1. **Virtual Scrolling**: Only render visible hex rows (critical for large files)
2. **Canvas Rendering**: Use Canvas 2D for hex view, not DOM elements
3. **Web Workers**: PNG parsing and CRC calculation off main thread
4. **Typed Arrays**: Use Uint8Array throughout, never convert to regular arrays
5. **Incremental Updates**: Only re-render changed portions of preview
6. **RequestAnimationFrame**: Batch visual updates to frame boundaries
7. **Lazy Chunk Parsing**: Parse chunk details on-demand, not upfront

### Memory Management

- Stream large files, don't load entirely into memory
- Limit undo history by memory, not just count
- Clear preview canvas when switching files
- Use WeakMap for chunk metadata caching

---

## Keyboard Shortcuts

### Navigation
| Key | Action |
|-----|--------|
| `Tab` | Toggle focus between panels |
| `↑↓←→` | Move cursor in hex view |
| `Page Up/Down` | Scroll hex view |
| `Home/End` | Jump to start/end of file |
| `Ctrl+G` | Go to offset (dialog) |
| `Ctrl+F` | Find hex pattern |

### Editing
| Key | Action |
|-----|--------|
| `0-9, A-F` | Input hex digit |
| `Delete` | Delete selected bytes |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+C` | Copy selection as hex |
| `Ctrl+V` | Paste hex at cursor |
| `Ctrl+A` | Select all |

### View
| Key | Action |
|-----|--------|
| `Ctrl++/-` | Zoom preview |
| `Ctrl+0` | Reset zoom |
| `Ctrl+B` | Toggle bookmark |
| `Ctrl+L` | Toggle live preview |
| `Escape` | Clear selection |

---

## Data Structures

### Internal State

```javascript
interface EditorState {
  // File data
  buffer: Uint8Array;
  filename: string;
  originalBuffer: Uint8Array; // For comparison

  // Parsed structure
  chunks: Chunk[];
  isValid: boolean;
  validationErrors: ValidationError[];

  // View state
  cursorOffset: number;
  selectionStart: number | null;
  selectionEnd: number | null;
  scrollOffset: number;
  zoomLevel: number;

  // Edit state
  editMode: 'ancillary' | 'idat-surface' | 'idat-deep' | 'structure' | 'raw';
  history: HistoryEntry[];
  historyIndex: number;

  // UI state
  activePanel: 'preview' | 'hex';
  showChunkNav: boolean;
  livePreview: boolean;
  bookmarks: Bookmark[];
}

interface Chunk {
  offset: number;      // Byte offset in file
  length: number;      // Data length (from chunk header)
  type: string;        // 4-char type code
  dataOffset: number;  // Offset of data portion
  crcOffset: number;   // Offset of CRC
  crc: number;         // Stored CRC value
  crcValid: boolean;   // Does CRC match?
  isCritical: boolean; // Uppercase first letter = critical
}

interface HistoryEntry {
  type: 'edit' | 'insert' | 'delete';
  offset: number;
  oldData: Uint8Array;
  newData: Uint8Array;
  timestamp: number;
  description: string;
}
```

---

## PNG Validity Rules

### Always Enforced
1. Signature bytes (0-7) must be: `89 50 4E 47 0D 0A 1A 0A`
2. First chunk must be IHDR
3. Last chunk must be IEND
4. IHDR must have exactly 13 bytes of data
5. All CRCs recalculated on save (unless raw export)

### Warnings Only
1. IDAT chunks should be contiguous
2. Unknown critical chunks present
3. Duplicate singleton chunks (IHDR, PLTE, etc.)

### Allowed for Glitch
1. Invalid/creative ancillary chunks
2. Corrupted IDAT data (will render with artifacts)
3. Wrong palette indices
4. Unusual but valid dimension combinations

---

## Implementation Notes

### CRC-32 Calculation

PNG uses CRC-32 with polynomial 0xEDB88320 (reflected). Implementation must:
- Calculate over chunk type + chunk data (not length or CRC itself)
- Use lookup table for performance
- Run in Web Worker for large chunks

### Zlib/Deflate Awareness

IDAT chunks contain zlib-compressed data. The editor should:
- Identify zlib header (78 01/9C/DA)
- Show compression level indicator
- Warn when editing might break decompression
- Optionally: decompress for "safe" editing, recompress on save

### Canvas Preview Rendering

```javascript
// Approach: Create blob URL from modified buffer, load as Image
async function updatePreview(buffer: Uint8Array): Promise<void> {
  const blob = new Blob([buffer], { type: 'image/png' });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    showInvalidState();
    URL.revokeObjectURL(url);
  };
  img.src = url;
}
```

---

## File Size & Constraints

### Self-Contained HTML Requirements
- Single `.html` file, no external dependencies
- Target size: < 100KB minified
- No build step required (development version readable)
- Works offline after initial load

### Browser Support
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### Required APIs
- File API (FileReader, Blob)
- Canvas 2D
- Web Workers (inline via Blob URL)
- Clipboard API
- localStorage
- requestAnimationFrame
- Typed Arrays

---

## Future Considerations

These features are out of scope for v1 but worth noting:

1. **GIF Support**: Extend to GIF format (similar chunk structure)
2. **Batch Processing**: Apply edits to multiple files
3. **Plugin System**: User-defined glitch algorithms
4. **Audio Export**: Sonification of image data
5. **Diff/Patch**: Export edits as patch files
6. **Collaborative**: Real-time shared editing session
7. **WASM PNG Decoder**: Custom decoder tolerant of glitches

---

## Success Criteria

GLITCHEDIT is successful when:

1. **Functional**: Can load any PNG, edit bytes, save valid output
2. **Educational**: Users understand PNG structure through the interface
3. **Performant**: Handles 10MB+ files without lag
4. **Self-Contained**: Single HTML file, works offline
5. **Aesthetic**: Matches the black/white/accent design spec
6. **Predictable**: Glitch effects are reproducible and controllable

---

## Appendix: PNG Chunk Reference

| Type | Critical | Description |
|------|----------|-------------|
| IHDR | Yes | Image header (dimensions, bit depth, color type) |
| PLTE | Yes* | Palette for indexed-color images |
| IDAT | Yes | Compressed image data |
| IEND | Yes | Image trailer (marks end) |
| cHRM | No | Primary chromaticities |
| gAMA | No | Gamma |
| iCCP | No | Embedded ICC profile |
| sBIT | No | Significant bits |
| sRGB | No | Standard RGB color space |
| bKGD | No | Background color |
| hIST | No | Histogram |
| tRNS | No | Transparency |
| pHYs | No | Physical pixel dimensions |
| sPLT | No | Suggested palette |
| tIME | No | Last modification time |
| iTXt | No | International textual data |
| tEXt | No | Textual data |
| zTXt | No | Compressed textual data |

*PLTE is critical for indexed-color images, optional for others.

---

*GLITCHEDIT - Precision glitch, predictable chaos.*
