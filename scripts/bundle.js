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

  // Fetch fflate and inline it
  console.log('Fetching fflate...');
  const fflateResponse = await fetch('https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js');
  const fflateJS = await fflateResponse.text();
  console.log(`fflate: ${(fflateJS.length / 1024).toFixed(1)}KB`);

  // Split HTML at </head> to avoid replacing inside bundled JS
  const headEndIdx = html.indexOf('</head>');
  if (headEndIdx === -1) {
    throw new Error('Could not find </head> in index.html');
  }

  let headSection = html.slice(0, headEndIdx);
  const bodySection = html.slice(headEndIdx);

  // Replace external CSS with inline in head section only
  headSection = headSection.replace(
    '<link rel="stylesheet" href="./style.css">',
    `<style>\n${css}\n</style>`
  );

  // Escape $ characters in JS to prevent special replacement patterns
  // In String.replace(), $ has special meaning ($&, $1, $<name>, etc.)
  const escapedFflateJS = fflateJS.replace(/\$/g, '$$$$');
  const escapedBundledJS = bundledJS.replace(/\$/g, '$$$$');
  const escapedPreviews = effectPreviews.replace(/\$/g, '$$$$');

  // Build inline scripts block
  const inlineScript = `<!-- Bundled Scripts -->
<script>
${escapedFflateJS}
</script>
<script>
// Inline effect previews for single-file build
window.__EFFECT_PREVIEWS__ = ${escapedPreviews};
</script>
<script type="module">
${escapedBundledJS}
</script>`;

  // Replace external scripts with inline scripts in head section only
  const scriptPattern = /\s*<!--\s*Scripts\s*-->\s*<script\s+src="[^"]*fflate[^"]*"><\/script>\s*<script\s+type="module"\s+src="\.\/script\.js"><\/script>/;
  headSection = headSection.replace(scriptPattern, inlineScript);

  // Rejoin head and body
  html = headSection + bodySection;

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
