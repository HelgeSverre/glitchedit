#!/usr/bin/env bun
/**
 * Bundle GlitchEdit into a single HTML file with inlined JS and CSS.
 * Usage: bun run scripts/bundle.js
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

async function bundle() {
  console.log('Bundling GlitchEdit...');

  // Bundle JS with Bun
  const result = await Bun.build({
    entrypoints: [join(rootDir, 'script.js')],
    minify: true,
    target: 'browser',
  });

  if (!result.success) {
    console.error('Build failed:', result.logs);
    process.exit(1);
  }

  const bundledJS = await result.outputs[0].text();
  console.log(`JS bundled: ${(bundledJS.length / 1024).toFixed(1)}KB`);

  // Read CSS
  const css = await readFile(join(rootDir, 'style.css'), 'utf-8');
  console.log(`CSS: ${(css.length / 1024).toFixed(1)}KB`);

  // Read HTML template
  let html = await readFile(join(rootDir, 'index.html'), 'utf-8');

  // Read effect previews and inline them
  let effectPreviews = '{}';
  try {
    effectPreviews = await readFile(join(rootDir, 'assets/effect-previews.json'), 'utf-8');
    console.log(`Effect previews: ${(effectPreviews.length / 1024).toFixed(1)}KB`);
  } catch (e) {
    console.warn('No effect previews found, run: npm run generate-previews');
  }

  // Replace external CSS with inline
  html = html.replace(
    '<link rel="stylesheet" href="./style.css">',
    `<style>\n${css}\n</style>`
  );

  // Fetch pako and inline it
  console.log('Fetching pako...');
  const pakoResponse = await fetch('https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js');
  const pakoJS = await pakoResponse.text();
  console.log(`Pako: ${(pakoJS.length / 1024).toFixed(1)}KB`);

  // Replace external JS with inline (including pako and effect previews)
  const inlineScript = `
<script>
${pakoJS}
</script>
<script>
// Inline effect previews for single-file build
window.__EFFECT_PREVIEWS__ = ${effectPreviews};
</script>
<script type="module">
${bundledJS}
</script>`;

  html = html.replace(
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js"></script>\n  <script type="module" src="./script.js"></script>',
    inlineScript
  );

  // Create dist directory
  await mkdir(join(rootDir, 'dist'), { recursive: true });

  // Write bundled HTML
  const outPath = join(rootDir, 'dist/glitchedit.html');
  await writeFile(outPath, html);

  const totalSize = (html.length / 1024).toFixed(1);
  console.log(`\nBundled to: dist/glitchedit.html (${totalSize}KB)`);
  console.log('Single-file build complete!');
}

bundle().catch(err => {
  console.error('Bundle failed:', err);
  process.exit(1);
});
