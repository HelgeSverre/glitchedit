
    // ========== PNG PARSER ==========

    // CRC-32 lookup table (PNG polynomial 0xEDB88320)
    const crcTable = new Uint32Array(256);
    (function initCrcTable() {
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        crcTable[n] = c;
      }
    })();

    function crc32(data, start = 0, length = data.length - start) {
      let crc = 0xFFFFFFFF;
      const end = start + length;
      for (let i = start; i < end; i++) {
        crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
      }
      return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    // PNG signature
    const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    function parsePNG(buffer) {
      const chunks = [];
      const errors = [];

      // Check signature
      let validSignature = true;
      for (let i = 0; i < 8; i++) {
        if (buffer[i] !== PNG_SIGNATURE[i]) {
          validSignature = false;
          break;
        }
      }

      if (!validSignature) {
        errors.push('Invalid PNG signature');
      }

      // Add signature as pseudo-chunk for visualization
      chunks.push({
        offset: 0,
        length: 8,
        type: 'SIG',
        typeBytes: null,
        dataOffset: 0,
        dataLength: 8,
        crcOffset: -1,
        crc: 0,
        crcValid: validSignature,
        isCritical: true,
        isSignature: true
      });

      // Parse chunks
      let offset = 8;
      while (offset < buffer.length - 4) {
        if (offset + 8 > buffer.length) {
          errors.push(`Truncated chunk at offset ${offset}`);
          break;
        }

        // Read chunk length (big-endian, >>> 0 for unsigned)
        const length = ((buffer[offset] << 24) | (buffer[offset + 1] << 16) |
                        (buffer[offset + 2] << 8) | buffer[offset + 3]) >>> 0;

        // Read chunk type
        const typeBytes = buffer.slice(offset + 4, offset + 8);
        const type = String.fromCharCode(...typeBytes);

        // Check if we have enough data
        const totalChunkLength = 12 + length; // 4 length + 4 type + data + 4 crc
        if (offset + totalChunkLength > buffer.length) {
          errors.push(`Truncated ${type} chunk at offset ${offset}`);
          break;
        }

        // Read stored CRC (use >>> 0 to force unsigned 32-bit)
        const crcOffset = offset + 8 + length;
        const storedCrc = ((buffer[crcOffset] << 24) | (buffer[crcOffset + 1] << 16) |
                           (buffer[crcOffset + 2] << 8) | buffer[crcOffset + 3]) >>> 0;

        // Calculate actual CRC (over type + data)
        const calculatedCrc = crc32(buffer, offset + 4, 4 + length);
        const crcValid = storedCrc === calculatedCrc;

        if (!crcValid) {
          errors.push(`Invalid CRC for ${type} at offset ${offset}`);
        }

        // First letter uppercase = critical chunk
        const isCritical = type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90;

        chunks.push({
          offset,
          length: totalChunkLength,
          type,
          typeBytes,
          dataOffset: offset + 8,
          dataLength: length,
          crcOffset,
          crc: storedCrc,
          calculatedCrc,
          crcValid,
          isCritical
        });

        offset += totalChunkLength;

        // Stop after IEND
        if (type === 'IEND') break;
      }

      // Validate structure
      if (chunks.length > 1 && chunks[1].type !== 'IHDR') {
        errors.push('First chunk must be IHDR');
      }

      const lastChunk = chunks[chunks.length - 1];
      if (!lastChunk || lastChunk.type !== 'IEND') {
        errors.push('Last chunk must be IEND');
      }

      return {
        chunks,
        errors,
        isValid: errors.length === 0
      };
    }

    function getChunkColor(chunk) {
      if (chunk.isSignature) return 'chunk-signature';
      switch (chunk.type) {
        case 'IHDR': return 'chunk-ihdr';
        case 'PLTE': return 'chunk-plte';
        case 'IDAT': return 'chunk-idat';
        case 'IEND': return 'chunk-iend';
        default: return chunk.isCritical ? 'chunk-idat' : 'chunk-ancillary';
      }
    }

    function getChunkColorHex(chunk) {
      if (chunk.isSignature) return '#ff6b6b';
      switch (chunk.type) {
        case 'IHDR': return '#4ecdc4';
        case 'PLTE': return '#ffe66d';
        case 'IDAT': return '#95e1d3';
        case 'IEND': return '#aa96da';
        default: return chunk.isCritical ? '#95e1d3' : '#606060';
      }
    }

    function findChunkAtOffset(chunks, offset) {
      for (const chunk of chunks) {
        if (offset >= chunk.offset && offset < chunk.offset + chunk.length) {
          return chunk;
        }
      }
      return null;
    }

    function recalculateCRC(buffer, chunk) {
      if (chunk.isSignature) return;
      const newCrc = crc32(buffer, chunk.offset + 4, 4 + chunk.dataLength);
      buffer[chunk.crcOffset] = (newCrc >>> 24) & 0xFF;
      buffer[chunk.crcOffset + 1] = (newCrc >>> 16) & 0xFF;
      buffer[chunk.crcOffset + 2] = (newCrc >>> 8) & 0xFF;
      buffer[chunk.crcOffset + 3] = newCrc & 0xFF;
      return newCrc;
    }

    // ========== EDITOR STATE ==========

    const state = {
      buffer: null,
      originalBuffer: null,
      filename: '',
      chunks: [],
      errors: [],
      isValid: false,

      cursorOffset: 0,
      selectionStart: null,
      selectionEnd: null,

      history: [],
      historyIndex: -1,

      editingByte: null,
      editingValue: '',

      previewUrl: null,
      previewDebounce: null,

      // Pixel mode
      editMode: 'pixel', // 'pixel' or 'raw'
      pixelData: null,   // Decompressed IDAT data
      imageInfo: null,   // { width, height, bitDepth, colorType, bytesPerPixel, scanlineLength }

      // Layer-based effects system
      layerStack: {
        layers: [],              // Array of { id, effectId, enabled, params, seed }
        originalPixelData: null, // Pristine copy (never modified)
        cachedResults: new Map(),// layerId -> computed Uint8Array
        dirtyFromIndex: -1       // First layer needing recalc
      }
    };

    // ========== EFFECT REGISTRY ==========

    const effectRegistry = new Map();

    function registerEffect(descriptor) {
      effectRegistry.set(descriptor.id, descriptor);
    }

    // Seeded random number generator (mulberry32)
    function createSeededRNG(seed) {
      return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }

    // Logarithmic scale for subtle effect control
    // Maps slider value (0-max) to actual value using power curve
    // Low slider values = very subtle, high values = stronger
    function logScale(value, max, actualMax, power = 2) {
      return Math.pow(value / max, power) * actualMax;
    }

    // Bidirectional log scale (for values that can be negative)
    function logScaleBidirectional(value, max, actualMax, power = 2) {
      const sign = value < 0 ? -1 : 1;
      return sign * Math.pow(Math.abs(value) / max, power) * actualMax;
    }

    // Simplex noise implementation (fast 2D noise)
    const simplexNoise = (() => {
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
        return 70 * (n0 + n1 + n2); // Returns -1 to 1
      }

      // Fractal Brownian Motion (layered noise)
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

    // Generate unique layer ID
    function generateLayerId() {
      return 'layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Get default parameters for an effect
    function getDefaultParams(effectId) {
      const effect = effectRegistry.get(effectId);
      if (!effect) return {};
      const params = {};
      for (const param of effect.parameters) {
        params[param.id] = param.default;
      }
      return params;
    }

    // ========== IHDR PARSING ==========

    function parseIHDR(buffer, chunks) {
      const ihdr = chunks.find(c => c.type === 'IHDR');
      if (!ihdr) return null;

      const data = buffer.slice(ihdr.dataOffset, ihdr.dataOffset + 13);
      const width = ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
      const height = ((data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]) >>> 0;
      const bitDepth = data[8];
      const colorType = data[9];

      // Calculate bytes per pixel based on color type
      let channels;
      switch (colorType) {
        case 0: channels = 1; break; // Grayscale
        case 2: channels = 3; break; // RGB
        case 3: channels = 1; break; // Indexed
        case 4: channels = 2; break; // Grayscale + Alpha
        case 6: channels = 4; break; // RGBA
        default: channels = 4;
      }

      const bytesPerPixel = Math.ceil((channels * bitDepth) / 8);
      const scanlineLength = 1 + width * bytesPerPixel; // 1 byte filter + pixel data

      return { width, height, bitDepth, colorType, bytesPerPixel, scanlineLength, channels };
    }

    // ========== IDAT COMPRESSION ==========

    function decompressIDAT(buffer, chunks) {
      // Concatenate all IDAT chunk data
      const idatChunks = chunks.filter(c => c.type === 'IDAT');
      if (idatChunks.length === 0) return null;

      let totalLength = 0;
      for (const chunk of idatChunks) {
        totalLength += chunk.dataLength;
      }

      const compressed = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of idatChunks) {
        compressed.set(buffer.slice(chunk.dataOffset, chunk.dataOffset + chunk.dataLength), offset);
        offset += chunk.dataLength;
      }

      try {
        return pako.inflate(compressed);
      } catch (e) {
        console.error('Failed to decompress IDAT:', e);
        return null;
      }
    }

    function recompressAndRebuildBuffer() {
      if (!state.pixelData || !state.imageInfo) return;

      try {
        // Compress pixel data
        const compressed = pako.deflate(state.pixelData);

        // Find IDAT chunks in original buffer
        const idatChunks = state.chunks.filter(c => c.type === 'IDAT');
        if (idatChunks.length === 0) return;

        const firstIDAT = idatChunks[0];
        const lastIDAT = idatChunks[idatChunks.length - 1];

        // Calculate new buffer size
        // Remove old IDAT chunks, add one new IDAT chunk
        const beforeIDAT = firstIDAT.offset;
        const afterIDAT = lastIDAT.offset + lastIDAT.length;
        const newIDATLength = 12 + compressed.length; // 4 length + 4 type + data + 4 CRC

        const newBufferSize = beforeIDAT + newIDATLength + (state.buffer.length - afterIDAT);
        const newBuffer = new Uint8Array(newBufferSize);

        // Copy before IDAT
        newBuffer.set(state.buffer.slice(0, beforeIDAT), 0);

        // Write new IDAT chunk
        let pos = beforeIDAT;

        // Length (big-endian)
        newBuffer[pos++] = (compressed.length >>> 24) & 0xFF;
        newBuffer[pos++] = (compressed.length >>> 16) & 0xFF;
        newBuffer[pos++] = (compressed.length >>> 8) & 0xFF;
        newBuffer[pos++] = compressed.length & 0xFF;

        // Type "IDAT"
        newBuffer[pos++] = 0x49; // I
        newBuffer[pos++] = 0x44; // D
        newBuffer[pos++] = 0x41; // A
        newBuffer[pos++] = 0x54; // T

        // Data
        newBuffer.set(compressed, pos);
        pos += compressed.length;

        // CRC (over type + data)
        const crcData = newBuffer.slice(beforeIDAT + 4, pos);
        const crc = crc32(crcData, 0, crcData.length);
        newBuffer[pos++] = (crc >>> 24) & 0xFF;
        newBuffer[pos++] = (crc >>> 16) & 0xFF;
        newBuffer[pos++] = (crc >>> 8) & 0xFF;
        newBuffer[pos++] = crc & 0xFF;

        // Copy after IDAT (IEND and any trailing chunks)
        newBuffer.set(state.buffer.slice(afterIDAT), pos);

        // Update state
        state.buffer = newBuffer;

        // Re-parse chunks
        const parsed = parsePNG(state.buffer);
        state.chunks = parsed.chunks;
        state.errors = parsed.errors;
        state.isValid = parsed.isValid;

      } catch (e) {
        console.error('Failed to recompress:', e);
      }
    }

    // ========== DOM ELEMENTS ==========

    const elements = {
      dropzone: document.getElementById('dropzone'),
      previewCanvas: document.getElementById('preview-canvas'),
      previewError: document.getElementById('preview-error'),
      previewLoading: document.getElementById('preview-loading'),
      errorMessage: document.getElementById('error-message'),
      chunkList: document.getElementById('chunk-list'),
      hexScroll: document.getElementById('hex-scroll'),
      hexContent: document.getElementById('hex-content'),
      fileInput: document.getElementById('file-input'),
      btnLoad: document.getElementById('btn-load'),
      btnRandom: document.getElementById('btn-random'),
      modeToggle: document.getElementById('mode-toggle'),
      btnSave: document.getElementById('btn-save'),
      btnSaveRaw: document.getElementById('btn-save-raw'),
      statusMode: document.getElementById('status-mode'),
      statusFilename: document.getElementById('status-filename'),
      statusSize: document.getElementById('status-size'),
      statusCursor: document.getElementById('status-cursor'),
      statusSelection: document.getElementById('status-selection'),
      statusValid: document.getElementById('status-valid'),
      statusValidText: document.getElementById('status-valid-text'),
      editDialog: document.getElementById('edit-dialog'),
      dialogTitle: document.getElementById('dialog-title'),
      dialogInput: document.getElementById('dialog-input'),
      dialogOk: document.getElementById('dialog-ok'),
      dialogCancel: document.getElementById('dialog-cancel'),
      resizer: document.getElementById('resizer'),
      previewPanel: document.getElementById('preview-panel'),
      editorPanel: document.getElementById('editor-panel'),
      // Effects panel
      effectsPanel: document.getElementById('effects-panel'),
      effectsPicker: document.getElementById('effect-picker'),
      layerList: document.getElementById('layer-list'),
      btnAddEffect: document.getElementById('btn-add-effect'),
      resizerEffects: document.getElementById('resizer-effects'),
      main: document.getElementById('main')
    };

    // ========== VIRTUAL SCROLLING ==========

    const ROW_HEIGHT = 20;
    const BYTES_PER_ROW = 16;
    const BUFFER_ROWS = 10; // Extra rows to render above/below viewport

    let visibleRows = { start: 0, end: 0 };
    let rowElements = new Map(); // offset -> element

    function getActiveBuffer() {
      if (state.editMode === 'pixel' && state.pixelData) {
        return state.pixelData;
      }
      return state.buffer;
    }

    function getTotalRows() {
      const buffer = getActiveBuffer();
      if (!buffer) return 0;
      return Math.ceil(buffer.length / BYTES_PER_ROW);
    }

    function updateVirtualScroll() {
      if (!state.buffer) return;

      const scrollTop = elements.hexScroll.scrollTop;
      const containerHeight = elements.hexScroll.clientHeight;
      const totalRows = getTotalRows();

      // Set total content height
      elements.hexContent.style.height = `${totalRows * ROW_HEIGHT}px`;

      // Calculate visible range with buffer
      const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
      const endRow = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + BUFFER_ROWS);

      // Remove rows that are no longer visible
      for (const [offset, element] of rowElements) {
        const row = Math.floor(offset / BYTES_PER_ROW);
        if (row < startRow || row >= endRow) {
          element.remove();
          rowElements.delete(offset);
        }
      }

      // Add new visible rows
      for (let row = startRow; row < endRow; row++) {
        const offset = row * BYTES_PER_ROW;
        if (!rowElements.has(offset)) {
          const element = createHexRow(offset);
          elements.hexContent.appendChild(element);
          rowElements.set(offset, element);
        }
      }

      visibleRows = { start: startRow, end: endRow };
    }

    function createHexRow(offset) {
      const buffer = getActiveBuffer();
      const isPixelMode = state.editMode === 'pixel' && state.pixelData;

      const row = document.createElement('div');
      row.className = 'hex-row';
      row.style.top = `${Math.floor(offset / BYTES_PER_ROW) * ROW_HEIGHT}px`;
      row.dataset.offset = offset;

      // Offset column
      const offsetSpan = document.createElement('span');
      offsetSpan.className = 'offset';
      offsetSpan.textContent = offset.toString(16).padStart(8, '0').toUpperCase();
      row.appendChild(offsetSpan);

      // Hex bytes
      const hexBytes = document.createElement('span');
      hexBytes.className = 'hex-bytes';

      for (let i = 0; i < BYTES_PER_ROW; i++) {
        const byteOffset = offset + i;
        const byteSpan = document.createElement('span');
        byteSpan.className = 'hex-byte';
        byteSpan.dataset.offset = byteOffset;

        if (byteOffset < buffer.length) {
          const byte = buffer[byteOffset];
          byteSpan.textContent = byte.toString(16).padStart(2, '0').toUpperCase();

          if (isPixelMode && state.imageInfo) {
            // Pixel mode: color by scanline
            const scanlineLength = state.imageInfo.scanlineLength;
            const scanlineIndex = Math.floor(byteOffset / scanlineLength);
            const posInScanline = byteOffset % scanlineLength;

            if (posInScanline === 0) {
              // Filter byte at start of each scanline
              byteSpan.classList.add('filter-byte');
            } else {
              // Alternate colors per scanline
              byteSpan.classList.add(scanlineIndex % 2 === 0 ? 'scanline-even' : 'scanline-odd');
            }
          } else {
            // Raw mode: color by chunk
            const chunk = findChunkAtOffset(state.chunks, byteOffset);
            if (chunk) {
              byteSpan.classList.add(getChunkColor(chunk));

              // Mark CRC bytes
              if (!chunk.isSignature && byteOffset >= chunk.crcOffset && byteOffset < chunk.crcOffset + 4) {
                byteSpan.classList.remove(getChunkColor(chunk));
                byteSpan.classList.add('chunk-crc');
              }
            }
          }

          // Selection and cursor
          if (byteOffset === state.cursorOffset) {
            byteSpan.classList.add('cursor');
          }
          if (state.selectionStart !== null && state.selectionEnd !== null) {
            const selStart = Math.min(state.selectionStart, state.selectionEnd);
            const selEnd = Math.max(state.selectionStart, state.selectionEnd);
            if (byteOffset >= selStart && byteOffset <= selEnd) {
              byteSpan.classList.add('selected');
            }
          }
          if (state.editingByte === byteOffset) {
            byteSpan.classList.add('editing');
            byteSpan.textContent = state.editingValue.padEnd(2, '_');
          }
        } else {
          byteSpan.textContent = '  ';
          byteSpan.style.visibility = 'hidden';
        }

        hexBytes.appendChild(byteSpan);
      }
      row.appendChild(hexBytes);

      // ASCII column
      const ascii = document.createElement('span');
      ascii.className = 'ascii';
      let asciiText = '';
      for (let i = 0; i < BYTES_PER_ROW; i++) {
        const byteOffset = offset + i;
        if (byteOffset < buffer.length) {
          const byte = buffer[byteOffset];
          asciiText += (byte >= 32 && byte < 127) ? String.fromCharCode(byte) : '.';
        }
      }
      ascii.textContent = asciiText;
      row.appendChild(ascii);

      return row;
    }

    function refreshHexView() {
      // Clear and rebuild visible rows
      rowElements.forEach(el => el.remove());
      rowElements.clear();
      updateVirtualScroll();
    }

    function scrollToOffset(offset) {
      const row = Math.floor(offset / BYTES_PER_ROW);
      const targetScroll = row * ROW_HEIGHT - elements.hexScroll.clientHeight / 2;
      elements.hexScroll.scrollTop = Math.max(0, targetScroll);
      updateVirtualScroll();
    }

    // ========== PREVIEW ==========

    function updatePreview() {
      if (!state.buffer) return;

      // Revoke old URL
      if (state.previewUrl) {
        URL.revokeObjectURL(state.previewUrl);
      }

      // Create new blob and URL
      const blob = new Blob([state.buffer], { type: 'image/png' });
      state.previewUrl = URL.createObjectURL(blob);

      const img = new Image();
      img.onload = () => {
        const canvas = elements.previewCanvas;
        const ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        elements.previewError.classList.remove('visible');
        elements.previewCanvas.style.display = 'block';
      };

      img.onerror = () => {
        elements.previewError.classList.add('visible');
        elements.errorMessage.textContent = state.errors.join(', ') || 'Unable to decode image';
      };

      img.src = state.previewUrl;
    }

    function debouncedPreview() {
      clearTimeout(state.previewDebounce);
      state.previewDebounce = setTimeout(updatePreview, 50);
    }

    // ========== CHUNK NAVIGATOR ==========

    function updateChunkList() {
      elements.chunkList.innerHTML = '';

      for (const chunk of state.chunks) {
        const item = document.createElement('div');
        item.className = 'chunk-item';
        item.dataset.offset = chunk.offset;
        item.tabIndex = 0;
        item.setAttribute('role', 'option');

        const colorBox = document.createElement('div');
        colorBox.className = 'chunk-color';
        colorBox.style.background = getChunkColorHex(chunk);
        item.appendChild(colorBox);

        const typeSpan = document.createElement('span');
        typeSpan.className = 'chunk-type';
        typeSpan.textContent = chunk.isSignature ? 'PNG' : chunk.type;
        item.appendChild(typeSpan);

        const infoSpan = document.createElement('span');
        infoSpan.className = 'chunk-info';
        if (chunk.isSignature) {
          infoSpan.textContent = '8 bytes';
        } else {
          infoSpan.textContent = `${chunk.dataLength} bytes @ 0x${chunk.offset.toString(16).toUpperCase()}`;
        }
        item.appendChild(infoSpan);

        if (!chunk.isSignature) {
          const crcSpan = document.createElement('span');
          crcSpan.className = 'chunk-crc ' + (chunk.crcValid ? 'valid' : 'invalid');
          crcSpan.textContent = chunk.crcValid ? 'CRC OK' : 'CRC ERR';
          item.appendChild(crcSpan);
        }

        const selectChunk = () => {
          state.cursorOffset = chunk.offset;
          state.selectionStart = chunk.offset;
          state.selectionEnd = chunk.offset + chunk.length - 1;
          scrollToOffset(chunk.offset);
          refreshHexView();
          updateStatus();
        };

        item.addEventListener('click', selectChunk);
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectChunk();
          }
        });

        elements.chunkList.appendChild(item);
      }
    }

    // ========== STATUS BAR ==========

    function updateStatus() {
      elements.statusFilename.textContent = state.filename || '-';

      const buffer = getActiveBuffer();
      elements.statusSize.textContent = buffer ? `${buffer.length} bytes` : '-';
      elements.statusCursor.textContent = buffer ?
        `0x${state.cursorOffset.toString(16).toUpperCase()}` : '-';

      if (state.selectionStart !== null && state.selectionEnd !== null) {
        const start = Math.min(state.selectionStart, state.selectionEnd);
        const end = Math.max(state.selectionStart, state.selectionEnd);
        elements.statusSelection.textContent = `${end - start + 1} bytes`;
      } else {
        elements.statusSelection.textContent = '-';
      }

      elements.statusValid.className = 'status-indicator ' + (state.isValid ? 'valid' : 'invalid');
      elements.statusValidText.textContent = state.isValid ? 'Valid' : 'Invalid';

      // Show mode
      if (state.buffer) {
        const modeLabel = state.editMode === 'pixel' ? 'Pixel' : 'Raw';
        const sizeInfo = state.editMode === 'pixel' && state.pixelData
          ? ` (${state.pixelData.length} decompressed)`
          : '';
        elements.statusMode.textContent = modeLabel + sizeInfo;
      } else {
        elements.statusMode.textContent = '-';
      }
    }

    // ========== FILE OPERATIONS ==========

    function loadFile(file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const buffer = new Uint8Array(e.target.result);
        loadBuffer(buffer, file.name);
      };
      reader.readAsArrayBuffer(file);
    }

    function loadBuffer(buffer, filename) {
      state.buffer = buffer;
      state.originalBuffer = buffer.slice();
      state.filename = filename;
      state.cursorOffset = 0;
      state.selectionStart = null;
      state.selectionEnd = null;
      state.history = [];
      state.historyIndex = -1;
      state.editingByte = null;
      state.editingValue = '';

      // Parse PNG
      const parsed = parsePNG(buffer);
      state.chunks = parsed.chunks;
      state.errors = parsed.errors;
      state.isValid = parsed.isValid;

      // Parse IHDR and decompress IDAT for pixel mode
      state.imageInfo = parseIHDR(buffer, state.chunks);
      state.pixelData = decompressIDAT(buffer, state.chunks);

      // Initialize layer stack with original pixel data
      state.layerStack.layers = [];
      state.layerStack.originalPixelData = state.pixelData ? state.pixelData.slice() : null;
      state.layerStack.cachedResults.clear();
      state.layerStack.dirtyFromIndex = -1;

      // Default to pixel mode if we have pixel data
      state.editMode = state.pixelData ? 'pixel' : 'raw';

      // Update UI
      elements.dropzone.classList.add('hidden');
      elements.btnSave.disabled = false;
      elements.btnSaveRaw.disabled = false;
      elements.modeToggle.disabled = false;
      elements.btnAddEffect.disabled = !state.pixelData;

      updateModeToggle();
      updateChunkList();
      refreshHexView();
      updatePreview();
      updateStatus();
      renderLayerList();
      renderEffectPicker();
    }

    function updateModeToggle() {
      // Checkbox checked = Raw mode, unchecked = Pixel mode
      elements.modeToggle.checked = state.editMode === 'raw';
    }

    function saveFile(fixCrc = true) {
      if (!state.buffer) return;

      let buffer = state.buffer;

      if (fixCrc) {
        // Create a copy and fix all CRCs
        buffer = state.buffer.slice();
        for (const chunk of state.chunks) {
          if (!chunk.isSignature) {
            recalculateCRC(buffer, chunk);
          }
        }
      }

      const blob = new Blob([buffer], { type: 'image/png' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = state.filename.replace('.png', '') + '_glitched.png';
      a.click();

      URL.revokeObjectURL(url);
    }

    // ========== EDITING ==========

    function pushHistory(entry) {
      // Remove any redo history
      state.history = state.history.slice(0, state.historyIndex + 1);
      state.history.push(entry);
      state.historyIndex = state.history.length - 1;

      // Limit history size
      if (state.history.length > 100) {
        state.history.shift();
        state.historyIndex--;
      }
    }

    function undo() {
      if (state.historyIndex < 0) return;

      const entry = state.history[state.historyIndex];

      // Handle layer operations
      if (entry.type && entry.type.startsWith('layer-')) {
        state.layerStack.layers = JSON.parse(JSON.stringify(entry.oldLayers));
        state.historyIndex--;
        invalidateFromLayer(0);
        renderLayerStack();
        renderLayerList();
        return;
      }

      // Switch to the mode the edit was made in
      if (entry.mode && entry.mode !== state.editMode) {
        state.editMode = entry.mode;
        updateModeButtons();
      }

      // Get the appropriate buffer
      const buffer = entry.mode === 'pixel' ? state.pixelData : state.buffer;

      // Restore old data
      for (let i = 0; i < entry.oldData.length; i++) {
        buffer[entry.offset + i] = entry.oldData[i];
      }

      state.historyIndex--;
      afterEdit();
    }

    function redo() {
      if (state.historyIndex >= state.history.length - 1) return;

      state.historyIndex++;
      const entry = state.history[state.historyIndex];

      // Handle layer operations
      if (entry.type && entry.type.startsWith('layer-')) {
        state.layerStack.layers = JSON.parse(JSON.stringify(entry.newLayers));
        invalidateFromLayer(0);
        renderLayerStack();
        renderLayerList();
        return;
      }

      // Switch to the mode the edit was made in
      if (entry.mode && entry.mode !== state.editMode) {
        state.editMode = entry.mode;
        updateModeButtons();
      }

      // Get the appropriate buffer
      const buffer = entry.mode === 'pixel' ? state.pixelData : state.buffer;

      // Apply new data
      for (let i = 0; i < entry.newData.length; i++) {
        buffer[entry.offset + i] = entry.newData[i];
      }

      afterEdit();
    }

    function editByte(offset, newValue) {
      const buffer = getActiveBuffer();
      if (offset >= buffer.length) return;

      const oldValue = buffer[offset];
      if (oldValue === newValue) return;

      pushHistory({
        type: 'edit',
        offset,
        mode: state.editMode,
        oldData: new Uint8Array([oldValue]),
        newData: new Uint8Array([newValue]),
        timestamp: Date.now(),
        description: `Edit byte at 0x${offset.toString(16).toUpperCase()}`
      });

      buffer[offset] = newValue;
      afterEdit();
    }

    function afterEdit() {
      if (state.editMode === 'pixel' && state.pixelData) {
        // Pixel mode: recompress and rebuild buffer
        recompressAndRebuildBuffer();
      } else {
        // Raw mode: recalculate CRCs for all chunks to keep PNG valid
        for (const chunk of state.chunks) {
          if (!chunk.isSignature) {
            recalculateCRC(state.buffer, chunk);
          }
        }
        // Re-parse PNG with fixed CRCs
        const parsed = parsePNG(state.buffer);
        state.chunks = parsed.chunks;
        state.errors = parsed.errors;
        state.isValid = parsed.isValid;
      }

      // Update UI
      updateChunkList();
      refreshHexView();
      debouncedPreview();
      updateStatus();
    }

    function fillSelection(value) {
      if (state.selectionStart === null || state.selectionEnd === null) return;

      const buffer = getActiveBuffer();
      const start = Math.min(state.selectionStart, state.selectionEnd);
      const end = Math.max(state.selectionStart, state.selectionEnd);
      const length = end - start + 1;

      const oldData = buffer.slice(start, start + length);
      const newData = new Uint8Array(length).fill(value);

      pushHistory({
        type: 'fill',
        offset: start,
        mode: state.editMode,
        oldData,
        newData,
        timestamp: Date.now(),
        description: `Fill ${length} bytes with 0x${value.toString(16).toUpperCase()}`
      });

      for (let i = start; i <= end; i++) {
        buffer[i] = value;
      }

      afterEdit();
    }

    function randomizeSelection() {
      if (state.selectionStart === null || state.selectionEnd === null) return;

      const buffer = getActiveBuffer();
      const start = Math.min(state.selectionStart, state.selectionEnd);
      const end = Math.max(state.selectionStart, state.selectionEnd);
      const length = end - start + 1;

      const oldData = buffer.slice(start, start + length);
      const newData = new Uint8Array(length);
      crypto.getRandomValues(newData);

      pushHistory({
        type: 'randomize',
        offset: start,
        mode: state.editMode,
        oldData,
        newData,
        timestamp: Date.now(),
        description: `Randomize ${length} bytes`
      });

      for (let i = 0; i < length; i++) {
        buffer[start + i] = newData[i];
      }

      afterEdit();
    }

    // ========== EFFECT DEFINITIONS ==========

    // Filter Byte Effect
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
        { id: 'probability', type: 'slider', label: 'Amount', default: 15, min: 1, max: 100, unit: '%' }
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
        { id: 'redShift', type: 'slider', label: 'Red', default: 5, min: -50, max: 50, unit: '' },
        { id: 'greenShift', type: 'slider', label: 'Green', default: 0, min: -50, max: 50, unit: '' },
        { id: 'blueShift', type: 'slider', label: 'Blue', default: -5, min: -50, max: 50, unit: '' }
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
        { id: 'interval', type: 'slider', label: 'Interval', default: 30, min: 5, max: 100, unit: 'px' },
        { id: 'intensity', type: 'slider', label: 'Intensity', default: 20, min: 1, max: 100, unit: '' },
        { id: 'shift', type: 'slider', label: 'Shift', default: 20, min: 1, max: 100, unit: '' }
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
        { id: 'threshold', type: 'slider', label: 'Threshold', default: 140, min: 0, max: 255, unit: '' },
        { id: 'rowSkip', type: 'slider', label: 'Row Skip', default: 4, min: 1, max: 20, unit: '' },
        { id: 'maxLength', type: 'slider', label: 'Max Length', default: 50, min: 10, max: 500, unit: 'px' }
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
        { id: 'amount', type: 'slider', label: 'Amount', default: 20, min: 1, max: 100, unit: '' },
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
        { id: 'blockSize', type: 'slider', label: 'Block Size', default: 32, min: 8, max: 128, unit: 'px' },
        { id: 'probability', type: 'slider', label: 'Probability', default: 15, min: 1, max: 100, unit: '' },
        { id: 'maxShift', type: 'slider', label: 'Max Shift', default: 20, min: 1, max: 100, unit: '' }
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
        { id: 'levels', type: 'slider', label: 'Levels', default: 8, min: 2, max: 32, unit: '' },
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
        { id: 'amount', type: 'slider', label: 'Amount', default: 15, min: 1, max: 100, unit: '' },
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
        { id: 'probability', type: 'slider', label: 'Probability', default: 15, min: 1, max: 100, unit: '' },
        { id: 'blockSize', type: 'slider', label: 'Block Size', default: 16, min: 4, max: 64, unit: 'px' },
        { id: 'maxDistance', type: 'slider', label: 'Distance', default: 20, min: 1, max: 100, unit: '' }
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
        { id: 'probability', type: 'slider', label: 'Probability', default: 15, min: 1, max: 100, unit: '' },
        { id: 'maxShift', type: 'slider', label: 'Max Shift', default: 15, min: 1, max: 100, unit: '' },
        { id: 'thickness', type: 'slider', label: 'Thickness', default: 3, min: 1, max: 20, unit: 'px' }
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
        { id: 'amount', type: 'slider', label: 'Amount', default: 10, min: 1, max: 100, unit: '' },
        { id: 'angle', type: 'slider', label: 'Angle', default: 0, min: 0, max: 360, unit: '°' }
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
        { id: 'amount', type: 'slider', label: 'Amount', default: 20, min: 1, max: 100, unit: '' },
        { id: 'scale', type: 'slider', label: 'Scale', default: 30, min: 5, max: 100, unit: '' },
        { id: 'octaves', type: 'slider', label: 'Detail', default: 3, min: 1, max: 6, unit: '' }
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
        { id: 'levels', type: 'slider', label: 'Levels', default: 4, min: 2, max: 16, unit: '' },
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
        { id: 'waves', type: 'slider', label: 'Waves', default: 3, min: 1, max: 8, unit: '' },
        { id: 'amplitude', type: 'slider', label: 'Amplitude', default: 20, min: 1, max: 100, unit: '' },
        { id: 'frequency', type: 'slider', label: 'Frequency', default: 30, min: 5, max: 100, unit: '' }
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
        { id: 'memory', type: 'slider', label: 'Memory', default: 5, min: 2, max: 20, unit: 'px' },
        { id: 'blend', type: 'slider', label: 'Blend', default: 30, min: 1, max: 100, unit: '' },
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
        { id: 'iterations', type: 'slider', label: 'Growth', default: 10, min: 1, max: 50, unit: '' },
        { id: 'feed', type: 'slider', label: 'Feed', default: 55, min: 1, max: 100, unit: '' },
        { id: 'kill', type: 'slider', label: 'Kill', default: 62, min: 1, max: 100, unit: '' },
        { id: 'blend', type: 'slider', label: 'Blend', default: 50, min: 1, max: 100, unit: '' }
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
        { id: 'generations', type: 'slider', label: 'Generations', default: 5, min: 1, max: 30, unit: '' },
        { id: 'threshold', type: 'slider', label: 'Threshold', default: 50, min: 1, max: 100, unit: '' },
        { id: 'blend', type: 'slider', label: 'Blend', default: 40, min: 1, max: 100, unit: '' }
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
        { id: 'cells', type: 'slider', label: 'Cells', default: 30, min: 10, max: 200, unit: '' },
        { id: 'edgeWidth', type: 'slider', label: 'Edge', default: 0, min: 0, max: 10, unit: 'px' },
        { id: 'jitter', type: 'slider', label: 'Jitter', default: 50, min: 0, max: 100, unit: '' }
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
        { id: 'echoes', type: 'slider', label: 'Echoes', default: 5, min: 2, max: 15, unit: '' },
        { id: 'scale', type: 'slider', label: 'Scale', default: 85, min: 50, max: 99, unit: '%' },
        { id: 'rotation', type: 'slider', label: 'Rotation', default: 10, min: -45, max: 45, unit: '°' },
        { id: 'decay', type: 'slider', label: 'Decay', default: 20, min: 5, max: 50, unit: '' }
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
        { id: 'twist', type: 'slider', label: 'Twist', default: 20, min: -100, max: 100, unit: '' },
        { id: 'pull', type: 'slider', label: 'Pull', default: 0, min: -50, max: 50, unit: '' },
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
        { id: 'iterations', type: 'slider', label: 'Strength', default: 2, min: 1, max: 10, unit: '' },
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
        { id: 'strength', type: 'slider', label: 'Strength', default: 50, min: 1, max: 100, unit: '' }
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
        { id: 'frequency', type: 'slider', label: 'Frequency', default: 30, min: 5, max: 100, unit: '' },
        { id: 'amplitude', type: 'slider', label: 'Amplitude', default: 30, min: 1, max: 100, unit: '' },
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
        { id: 'iterations', type: 'slider', label: 'Spread', default: 5, min: 1, max: 20, unit: '' },
        { id: 'threshold', type: 'slider', label: 'Threshold', default: 30, min: 1, max: 100, unit: '' },
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

    // ========== LAYER MANAGEMENT ==========

    function addLayer(effectId) {
      if (!state.layerStack.originalPixelData) return;

      const layer = {
        id: generateLayerId(),
        effectId: effectId,
        enabled: true,
        params: getDefaultParams(effectId),
        seed: Math.floor(Math.random() * 2147483647)
      };

      // Save state for undo
      const oldLayers = JSON.parse(JSON.stringify(state.layerStack.layers));
      state.layerStack.layers.push(layer);

      pushHistory({
        type: 'layer-add',
        offset: 0,
        mode: 'pixel',
        oldLayers: oldLayers,
        newLayers: JSON.parse(JSON.stringify(state.layerStack.layers)),
        timestamp: Date.now(),
        description: `Add ${effectRegistry.get(effectId).name}`
      });

      invalidateFromLayer(state.layerStack.layers.length - 1);
      renderLayerStack();
      renderLayerList();
    }

    function removeLayer(layerId) {
      const index = state.layerStack.layers.findIndex(l => l.id === layerId);
      if (index === -1) return;

      const oldLayers = JSON.parse(JSON.stringify(state.layerStack.layers));
      state.layerStack.layers.splice(index, 1);

      pushHistory({
        type: 'layer-remove',
        offset: 0,
        mode: 'pixel',
        oldLayers: oldLayers,
        newLayers: JSON.parse(JSON.stringify(state.layerStack.layers)),
        timestamp: Date.now(),
        description: 'Remove layer'
      });

      invalidateFromLayer(index);
      renderLayerStack();
      renderLayerList();
    }

    function updateLayerParam(layerId, paramId, value) {
      const layer = state.layerStack.layers.find(l => l.id === layerId);
      if (!layer) return;

      const index = state.layerStack.layers.indexOf(layer);
      const oldLayers = JSON.parse(JSON.stringify(state.layerStack.layers));

      layer.params[paramId] = value;

      pushHistory({
        type: 'layer-param',
        offset: 0,
        mode: 'pixel',
        oldLayers: oldLayers,
        newLayers: JSON.parse(JSON.stringify(state.layerStack.layers)),
        timestamp: Date.now(),
        description: `Update ${paramId}`
      });

      invalidateFromLayer(index);
      debouncedRenderStack();
    }

    function toggleLayer(layerId) {
      const layer = state.layerStack.layers.find(l => l.id === layerId);
      if (!layer) return;

      const index = state.layerStack.layers.indexOf(layer);
      const oldLayers = JSON.parse(JSON.stringify(state.layerStack.layers));

      layer.enabled = !layer.enabled;

      pushHistory({
        type: 'layer-toggle',
        offset: 0,
        mode: 'pixel',
        oldLayers: oldLayers,
        newLayers: JSON.parse(JSON.stringify(state.layerStack.layers)),
        timestamp: Date.now(),
        description: layer.enabled ? 'Enable layer' : 'Disable layer'
      });

      invalidateFromLayer(index);
      renderLayerStack();
      renderLayerList();
    }

    function reorderLayers(fromIndex, toIndex) {
      if (fromIndex === toIndex) return;

      const oldLayers = JSON.parse(JSON.stringify(state.layerStack.layers));
      const [layer] = state.layerStack.layers.splice(fromIndex, 1);
      state.layerStack.layers.splice(toIndex, 0, layer);

      pushHistory({
        type: 'layer-reorder',
        offset: 0,
        mode: 'pixel',
        oldLayers: oldLayers,
        newLayers: JSON.parse(JSON.stringify(state.layerStack.layers)),
        timestamp: Date.now(),
        description: 'Reorder layers'
      });

      invalidateFromLayer(Math.min(fromIndex, toIndex));
      renderLayerStack();
      renderLayerList();
    }

    function invalidateFromLayer(index) {
      state.layerStack.dirtyFromIndex = index;
      // Clear caches from this layer onwards
      for (let i = index; i < state.layerStack.layers.length; i++) {
        state.layerStack.cachedResults.delete(state.layerStack.layers[i].id);
      }
    }

    // Debounced render for parameter changes
    let renderStackTimeout = null;
    function debouncedRenderStack() {
      if (renderStackTimeout) clearTimeout(renderStackTimeout);
      renderStackTimeout = setTimeout(() => {
        renderLayerStack();
      }, 100);
    }

    function renderLayerStack() {
      if (!state.layerStack.originalPixelData || !state.imageInfo) return;

      let data = state.layerStack.originalPixelData;
      const layers = state.layerStack.layers;

      // Apply each enabled layer
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        if (!layer.enabled) continue;

        const effect = effectRegistry.get(layer.effectId);
        if (!effect) continue;

        // Check cache
        const cached = state.layerStack.cachedResults.get(layer.id);
        if (cached && i >= state.layerStack.dirtyFromIndex) {
          data = cached;
          continue;
        }

        // Apply effect
        data = effect.apply(data, state.imageInfo, layer.params, layer.seed);
        state.layerStack.cachedResults.set(layer.id, data);
      }

      state.layerStack.dirtyFromIndex = -1;
      state.pixelData = data;

      // Recompress and update preview
      recompressAndRebuildBuffer();
      const parsed = parsePNG(state.buffer);
      state.chunks = parsed.chunks;
      state.errors = parsed.errors;
      state.isValid = parsed.isValid;

      updateChunkList();
      refreshHexView();
      debouncedPreview();
      updateStatus();
    }

    // ========== LAYER UI ==========

    function renderEffectPicker() {
      const byCategory = new Map();
      for (const [id, effect] of effectRegistry) {
        const list = byCategory.get(effect.category) || [];
        list.push(effect);
        byCategory.set(effect.category, list);
      }

      const categoryNames = {
        filter: 'Filter',
        channel: 'Channel',
        distortion: 'Distortion',
        color: 'Color',
        sorting: 'Sorting',
        generative: 'Generative',
        stylize: 'Stylize'
      };

      // Sort categories for consistent order
      const categoryOrder = ['distortion', 'color', 'channel', 'generative', 'stylize', 'filter', 'sorting'];
      const sortedCategories = [...byCategory.entries()].sort((a, b) => {
        const aIdx = categoryOrder.indexOf(a[0]);
        const bIdx = categoryOrder.indexOf(b[0]);
        return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
      });

      let html = '';
      for (const [category, effects] of sortedCategories) {
        html += `<div class="effect-category">`;
        html += `<div class="category-header">${categoryNames[category] || category}</div>`;
        html += `<div class="category-effects">`;
        for (const effect of effects) {
          html += `<div class="effect-option" data-effect="${effect.id}" tabindex="0" role="option">${effect.name}</div>`;
        }
        html += `</div>`;
        html += `</div>`;
      }

      elements.effectsPicker.innerHTML = html;
    }

    function renderLayerList() {
      const layers = state.layerStack.layers;
      let html = '';

      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const effect = effectRegistry.get(layer.effectId);
        if (!effect) continue;

        const checkedAttr = layer.enabled ? 'checked' : '';

        html += `<div class="layer-item" data-layer-id="${layer.id}">`;
        html += `<div class="layer-header">`;
        html += `<span class="layer-drag-handle" draggable="true">⋮⋮</span>`;
        html += `<input type="checkbox" class="layer-toggle" ${checkedAttr}>`;
        html += `<span class="layer-name">${effect.name}</span>`;
        html += `<button class="layer-delete-btn">×</button>`;
        html += `</div>`;
        html += `<div class="layer-params">`;

        for (const param of effect.parameters) {
          const value = layer.params[param.id];
          html += `<div class="param-row" data-param-id="${param.id}">`;
          html += `<span class="param-label">${param.label}</span>`;

          if (param.type === 'slider') {
            html += `<input type="range" min="${param.min}" max="${param.max}" value="${value}" step="${param.step || 1}">`;
            html += `<span class="param-value">${value}${param.unit || ''}</span>`;
          } else if (param.type === 'dropdown') {
            html += `<select>`;
            for (const opt of param.options) {
              const selected = opt.value === value ? 'selected' : '';
              html += `<option value="${opt.value}" ${selected}>${opt.label}</option>`;
            }
            html += `</select>`;
          } else if (param.type === 'checkbox') {
            const checked = value ? 'checked' : '';
            html += `<input type="checkbox" ${checked}>`;
          }

          html += `</div>`;
        }

        html += `</div></div>`;
      }

      elements.layerList.innerHTML = html;
    }

    // ========== EVENT HANDLERS ==========

    // File loading
    elements.btnLoad.addEventListener('click', () => {
      elements.fileInput.click();
    });

    elements.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        loadFile(e.target.files[0]);
      }
    });

    // Dropzone keyboard activation
    elements.dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        elements.fileInput.click();
      }
    });

    // Drag and drop
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      elements.dropzone.classList.add('dragover');
    });

    document.addEventListener('dragleave', (e) => {
      e.preventDefault();
      elements.dropzone.classList.remove('dragover');
    });

    document.addEventListener('drop', (e) => {
      e.preventDefault();
      elements.dropzone.classList.remove('dragover');

      const files = e.dataTransfer.files;
      if (files.length > 0 && files[0].type === 'image/png') {
        loadFile(files[0]);
      }
    });

    // Save buttons
    elements.btnSave.addEventListener('click', () => saveFile(true));
    elements.btnSaveRaw.addEventListener('click', () => saveFile(false));

    // Mode toggle switch
    elements.modeToggle.addEventListener('change', () => {
      const newMode = elements.modeToggle.checked ? 'raw' : 'pixel';
      if (state.editMode === newMode) return;
      if (newMode === 'pixel' && !state.pixelData) {
        elements.modeToggle.checked = true; // Stay on raw
        return;
      }
      state.editMode = newMode;
      state.cursorOffset = 0;
      state.selectionStart = null;
      state.selectionEnd = null;
      refreshHexView();
      updateStatus();
    });

    // ========== EFFECTS PANEL EVENT HANDLERS ==========

    // Add effect button - toggle picker
    elements.btnAddEffect.addEventListener('click', () => {
      const isVisible = elements.effectsPicker.classList.toggle('visible');
      elements.btnAddEffect.setAttribute('aria-expanded', isVisible);
    });

    // Effect picker - add layer when effect is clicked or activated via keyboard
    const handleEffectSelect = (option) => {
      if (!option) return;
      const effectId = option.dataset.effect;
      addLayer(effectId);
      elements.effectsPicker.classList.remove('visible');
      elements.btnAddEffect.setAttribute('aria-expanded', 'false');
      elements.btnAddEffect.focus();
    };

    elements.effectsPicker.addEventListener('click', (e) => {
      handleEffectSelect(e.target.closest('.effect-option'));
    });

    elements.effectsPicker.addEventListener('keydown', (e) => {
      const option = e.target.closest('.effect-option');
      if (option && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        handleEffectSelect(option);
      }
    });

    // Close picker when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#effects-header-buttons')) {
        elements.effectsPicker.classList.remove('visible');
        elements.btnAddEffect.setAttribute('aria-expanded', 'false');
      }
    });

    // Layer list interactions (delegated)
    elements.layerList.addEventListener('click', (e) => {
      const layerItem = e.target.closest('.layer-item');
      if (!layerItem) return;
      const layerId = layerItem.dataset.layerId;

      // Toggle enable/disable
      if (e.target.classList.contains('layer-toggle')) {
        toggleLayer(layerId);
        return;
      }

      // Delete layer
      if (e.target.classList.contains('layer-delete-btn')) {
        removeLayer(layerId);
        return;
      }
    });

    // Parameter changes (delegated)
    elements.layerList.addEventListener('input', (e) => {
      const layerItem = e.target.closest('.layer-item');
      const paramRow = e.target.closest('.param-row');
      if (!layerItem || !paramRow) return;

      const layerId = layerItem.dataset.layerId;
      const paramId = paramRow.dataset.paramId;
      let value;

      if (e.target.type === 'range' || e.target.type === 'number') {
        value = parseFloat(e.target.value);
        // Update value display
        const valueSpan = paramRow.querySelector('.param-value');
        if (valueSpan) {
          const layer = state.layerStack.layers.find(l => l.id === layerId);
          const effect = effectRegistry.get(layer?.effectId);
          const param = effect?.parameters.find(p => p.id === paramId);
          valueSpan.textContent = value + (param?.unit || '');
        }
      } else if (e.target.type === 'checkbox') {
        value = e.target.checked;
      } else if (e.target.tagName === 'SELECT') {
        const optValue = e.target.value;
        // Try to parse as number
        value = isNaN(Number(optValue)) ? optValue : Number(optValue);
      }

      updateLayerParam(layerId, paramId, value);
    });

    // Drag and drop reordering - only from drag handle
    let draggedLayerIndex = null;
    let draggedLayerItem = null;

    elements.layerList.addEventListener('dragstart', (e) => {
      // Only allow drag from the handle
      if (!e.target.classList.contains('layer-drag-handle')) {
        e.preventDefault();
        return;
      }
      const layerItem = e.target.closest('.layer-item');
      if (!layerItem) return;
      draggedLayerItem = layerItem;
      draggedLayerIndex = [...elements.layerList.children].indexOf(layerItem);
      // Need a small delay for the drag image to work
      setTimeout(() => layerItem.classList.add('dragging'), 0);
    });

    elements.layerList.addEventListener('dragend', (e) => {
      if (draggedLayerItem) {
        draggedLayerItem.classList.remove('dragging');
      }
      draggedLayerItem = null;
      draggedLayerIndex = null;
      // Remove all drop targets
      elements.layerList.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    });

    elements.layerList.addEventListener('dragover', (e) => {
      e.preventDefault();
      const layerItem = e.target.closest('.layer-item');
      if (!layerItem || draggedLayerIndex === null) return;

      // Remove previous drop target
      elements.layerList.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
      if (layerItem !== draggedLayerItem) {
        layerItem.classList.add('drop-target');
      }
    });

    elements.layerList.addEventListener('drop', (e) => {
      e.preventDefault();
      const layerItem = e.target.closest('.layer-item');
      if (!layerItem || draggedLayerIndex === null) return;

      const toIndex = [...elements.layerList.children].indexOf(layerItem);
      if (toIndex !== draggedLayerIndex) {
        reorderLayers(draggedLayerIndex, toIndex);
      }
    });

    // Effects panel resize
    let isResizingEffects = false;
    let effectsResizeStartX = 0;
    let effectsStartWidth = 0;
    if (elements.resizerEffects) {
      elements.resizerEffects.addEventListener('mousedown', (e) => {
        isResizingEffects = true;
        effectsResizeStartX = e.clientX;
        effectsStartWidth = elements.effectsPanel.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        elements.resizerEffects.classList.add('active');
        e.preventDefault();
      });
    }

    // Load random image from Lorem Picsum
    async function loadRandomImage() {
      try {
        elements.btnRandom.disabled = true;
        elements.btnRandom.textContent = 'Loading...';

        // Show loading state
        elements.dropzone.classList.add('hidden');
        elements.previewCanvas.style.display = 'none';
        elements.previewError.classList.remove('visible');
        elements.previewLoading.classList.add('visible');

        // Fetch random image from Lorem Picsum
        const response = await fetch('https://picsum.photos/800/600');
        const blob = await response.blob();

        // Convert to PNG via canvas (picsum returns JPG)
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);

        const pngBlob = await new Promise(resolve =>
          canvas.toBlob(resolve, 'image/png')
        );

        const buffer = new Uint8Array(await pngBlob.arrayBuffer());

        // Hide loading state before showing the image
        elements.previewLoading.classList.remove('visible');

        loadBuffer(buffer, 'random_' + Date.now() + '.png');

        URL.revokeObjectURL(img.src);
      } catch (e) {
        console.error('Failed to load random image:', e);
        // On error, show dropzone again
        elements.previewLoading.classList.remove('visible');
        elements.dropzone.classList.remove('hidden');
      } finally {
        elements.btnRandom.disabled = false;
        elements.btnRandom.textContent = 'Random';
      }
    }

    // Random image button
    elements.btnRandom.addEventListener('click', loadRandomImage);

    // Hex scroll
    elements.hexScroll.addEventListener('scroll', updateVirtualScroll);

    // Hex editor click
    elements.hexContent.addEventListener('click', (e) => {
      const byteEl = e.target.closest('.hex-byte');
      if (!byteEl) return;

      const buffer = getActiveBuffer();
      const offset = parseInt(byteEl.dataset.offset);
      if (isNaN(offset) || offset >= buffer.length) return;

      if (e.shiftKey && state.cursorOffset !== null) {
        // Extend selection
        state.selectionStart = state.cursorOffset;
        state.selectionEnd = offset;
      } else {
        // Move cursor and select single byte
        state.cursorOffset = offset;
        state.selectionStart = offset;
        state.selectionEnd = offset;
      }

      state.editingByte = null;
      state.editingValue = '';

      refreshHexView();
      updateStatus();
    });

    // Keyboard handling
    document.addEventListener('keydown', (e) => {
      if (!state.buffer) return;

      const buffer = getActiveBuffer();
      const bufLen = buffer ? buffer.length : 0;

      // Dialog handling
      if (elements.editDialog.classList.contains('visible')) {
        if (e.key === 'Escape') {
          elements.editDialog.classList.remove('visible');
        } else if (e.key === 'Enter') {
          elements.dialogOk.click();
        }
        return;
      }

      // Editing mode
      if (state.editingByte !== null) {
        const key = e.key.toUpperCase();
        if (/^[0-9A-F]$/.test(key)) {
          state.editingValue += key;
          if (state.editingValue.length === 2) {
            const newValue = parseInt(state.editingValue, 16);
            editByte(state.editingByte, newValue);
            state.cursorOffset = Math.min(state.editingByte + 1, bufLen - 1);
            state.editingByte = null;
            state.editingValue = '';
          }
          refreshHexView();
          return;
        } else if (e.key === 'Escape') {
          state.editingByte = null;
          state.editingValue = '';
          refreshHexView();
          return;
        }
      }

      // Undo/Redo
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
          return;
        }
        if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
          e.preventDefault();
          redo();
          return;
        }
        if (e.key === 'g') {
          e.preventDefault();
          showGotoDialog();
          return;
        }
        if (e.key === 'a') {
          e.preventDefault();
          state.selectionStart = 0;
          state.selectionEnd = bufLen - 1;
          refreshHexView();
          updateStatus();
          return;
        }
      }

      // Navigation
      let newOffset = state.cursorOffset;
      switch (e.key) {
        case 'ArrowLeft':
          newOffset = Math.max(0, state.cursorOffset - 1);
          break;
        case 'ArrowRight':
          newOffset = Math.min(bufLen - 1, state.cursorOffset + 1);
          break;
        case 'ArrowUp':
          newOffset = Math.max(0, state.cursorOffset - BYTES_PER_ROW);
          break;
        case 'ArrowDown':
          newOffset = Math.min(bufLen - 1, state.cursorOffset + BYTES_PER_ROW);
          break;
        case 'PageUp':
          newOffset = Math.max(0, state.cursorOffset - BYTES_PER_ROW * 20);
          break;
        case 'PageDown':
          newOffset = Math.min(bufLen - 1, state.cursorOffset + BYTES_PER_ROW * 20);
          break;
        case 'Home':
          newOffset = e.ctrlKey ? 0 : Math.floor(state.cursorOffset / BYTES_PER_ROW) * BYTES_PER_ROW;
          break;
        case 'End':
          newOffset = e.ctrlKey ? bufLen - 1 :
            Math.min(bufLen - 1, Math.floor(state.cursorOffset / BYTES_PER_ROW) * BYTES_PER_ROW + BYTES_PER_ROW - 1);
          break;
        case 'Delete':
          // Randomize selection or current byte
          if (state.selectionStart !== null && state.selectionEnd !== null) {
            randomizeSelection();
          }
          return;
        default:
          // Start editing if hex key pressed
          if (/^[0-9a-fA-F]$/.test(e.key)) {
            state.editingByte = state.cursorOffset;
            state.editingValue = e.key.toUpperCase();
            refreshHexView();
          }
          return;
      }

      e.preventDefault();

      // Handle selection with shift
      if (e.shiftKey) {
        if (state.selectionStart === null) {
          state.selectionStart = state.cursorOffset;
        }
        state.selectionEnd = newOffset;
      } else {
        state.selectionStart = null;
        state.selectionEnd = null;
      }

      state.cursorOffset = newOffset;

      // Scroll to cursor
      const cursorRow = Math.floor(newOffset / BYTES_PER_ROW);
      const scrollTop = elements.hexScroll.scrollTop;
      const visibleStart = Math.floor(scrollTop / ROW_HEIGHT);
      const visibleEnd = visibleStart + Math.floor(elements.hexScroll.clientHeight / ROW_HEIGHT);

      if (cursorRow < visibleStart + 2) {
        elements.hexScroll.scrollTop = Math.max(0, (cursorRow - 2) * ROW_HEIGHT);
      } else if (cursorRow > visibleEnd - 2) {
        elements.hexScroll.scrollTop = (cursorRow - visibleEnd + 4) * ROW_HEIGHT + scrollTop;
      }

      refreshHexView();
      updateStatus();
    });

    // Go to offset dialog
    function showGotoDialog() {
      elements.dialogTitle.textContent = 'Go to Offset';
      elements.dialogInput.value = '';
      elements.dialogInput.placeholder = 'Enter hex offset (e.g., 0x100 or 256)';
      elements.editDialog.classList.add('visible');
      elements.dialogInput.focus();
    }

    elements.dialogCancel.addEventListener('click', () => {
      elements.editDialog.classList.remove('visible');
    });

    elements.dialogOk.addEventListener('click', () => {
      const value = elements.dialogInput.value.trim();
      let offset;

      if (value.startsWith('0x') || value.startsWith('0X')) {
        offset = parseInt(value, 16);
      } else if (/^[0-9a-fA-F]+$/.test(value) && value.length <= 8) {
        offset = parseInt(value, 16);
      } else {
        offset = parseInt(value, 10);
      }

      const buffer = getActiveBuffer();
      if (!isNaN(offset) && offset >= 0 && buffer && offset < buffer.length) {
        state.cursorOffset = offset;
        state.selectionStart = null;
        state.selectionEnd = null;
        scrollToOffset(offset);
        refreshHexView();
        updateStatus();
      }

      elements.editDialog.classList.remove('visible');
    });

    // Preview panel resizer
    let isResizing = false;
    elements.resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    // Consolidated mousemove handler for both resizers
    document.addEventListener('mousemove', (e) => {
      // Effects panel resize (right side, drag left to widen)
      if (isResizingEffects) {
        const delta = effectsResizeStartX - e.clientX;
        const newWidth = effectsStartWidth + delta;
        if (newWidth >= 180 && newWidth <= 500) {
          elements.effectsPanel.style.width = newWidth + 'px';
        }
        return;
      }

      // Preview panel resize
      if (isResizing) {
        const containerRect = elements.main.getBoundingClientRect();
        const newWidth = e.clientX - containerRect.left;
        if (newWidth >= 200 && newWidth < containerRect.width - 400) {
          elements.previewPanel.style.flex = 'none';
          elements.previewPanel.style.width = `${newWidth}px`;
        }
        return;
      }
    });

    // Consolidated mouseup handler for both resizers
    document.addEventListener('mouseup', () => {
      if (isResizingEffects) {
        isResizingEffects = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (elements.resizerEffects) {
          elements.resizerEffects.classList.remove('active');
        }
      }
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });

    // Window resize
    window.addEventListener('resize', () => {
      updateVirtualScroll();
    });

    // Initialize
    updateStatus();
    loadRandomImage(); // Load a random image on startup
