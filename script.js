import {
  effectRegistry,
  createSeededRNG,
  logScale,
  logScaleBidirectional,
  simplexNoise,
  getDefaultParams,
  effectDescriptions
} from './effects.mjs';

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

    // Generate unique layer ID
    function generateLayerId() {
      return 'layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
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
      btnSave: document.getElementById('btn-save'),
      btnRandomizeEffects: document.getElementById('btn-randomize-effects'),
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
      main: document.getElementById('main'),
      // Help dialog
      btnHelp: document.getElementById('btn-help'),
      helpDialog: document.getElementById('help-dialog'),
      helpClose: document.getElementById('help-close'),
      helpContent: document.querySelector('.help-content')
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
      elements.btnAddEffect.disabled = !state.pixelData;
      elements.btnRandomizeEffects.disabled = !state.pixelData;
      updateChunkList();
      refreshHexView();
      updatePreview();
      updateStatus();
      renderLayerList();
      renderEffectPicker();
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

    // Save button
    elements.btnSave.addEventListener('click', () => saveFile(true));

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

    // ========== HELP DIALOG ==========

    let effectPreviews = {};

    async function loadEffectPreviews() {
      if (Object.keys(effectPreviews).length > 0) return;
      // Check for inlined previews (single-file build)
      if (window.__EFFECT_PREVIEWS__ && Object.keys(window.__EFFECT_PREVIEWS__).length > 0) {
        effectPreviews = window.__EFFECT_PREVIEWS__;
        return;
      }
      // Load from external file
      try {
        const response = await fetch('./assets/effect-previews.json');
        if (response.ok) {
          effectPreviews = await response.json();
        }
      } catch (e) {
        console.warn('Could not load effect previews:', e);
      }
    }

    function formatParamInfo(param) {
      if (param.type === 'slider') {
        const unit = param.unit || '';
        return `${param.min}–${param.max}${unit}`;
      } else if (param.type === 'dropdown') {
        return param.options.map(o => o.label).slice(0, 3).join(' / ') + (param.options.length > 3 ? '...' : '');
      } else if (param.type === 'checkbox') {
        return 'on/off';
      }
      return '';
    }

    async function populateHelpDialog() {
      await loadEffectPreviews();

      const categories = {};
      const categoryOrder = ['filter', 'channel', 'distortion', 'color', 'generative', 'stylize', 'blend'];

      for (const [id, effect] of effectRegistry) {
        const cat = effect.category || 'other';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push({ id, ...effect });
      }

      let html = '';
      for (const category of categoryOrder) {
        const effects = categories[category];
        if (!effects || effects.length === 0) continue;

        html += `<section class="help-category">
          <h3>${category} (${effects.length})</h3>
          <div class="help-grid">
            ${effects.map(effect => `
              <div class="help-card">
                <img class="help-card-preview" src="${effectPreviews[effect.id] || ''}" alt="${effect.name}">
                <div class="help-card-body">
                  <div class="help-card-header">
                    <span class="help-card-icon">${effect.icon || ''}</span>
                    <span class="help-card-name">${effect.name}</span>
                  </div>
                  <div class="help-card-desc">${effectDescriptions[effect.id] || ''}</div>
                  <div class="help-card-params">
                    ${effect.parameters.slice(0, 4).map(p => `
                      <div class="help-param">
                        <span class="help-param-name">${p.label}</span>
                        <span class="help-param-info">${formatParamInfo(p)}</span>
                      </div>
                    `).join('')}
                    ${effect.parameters.length > 4 ? `<div class="help-param"><span class="help-param-name">...</span><span class="help-param-info">+${effect.parameters.length - 4} more</span></div>` : ''}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </section>`;
      }

      elements.helpContent.innerHTML = html;
    }

    // Help dialog event handlers
    elements.btnHelp.addEventListener('click', async () => {
      if (!elements.helpContent.innerHTML) {
        await populateHelpDialog();
      }
      elements.helpDialog.showModal();
    });

    elements.helpClose.addEventListener('click', () => {
      elements.helpDialog.close();
    });

    // Window resize
    window.addEventListener('resize', () => {
      updateVirtualScroll();
    });

    // Initialize
    updateStatus();
    loadRandomImage(); // Load a random image on startup
