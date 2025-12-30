#!/usr/bin/env node
/**
 * CPU Performance Profiler for GlitchEdit
 *
 * Uses Playwright + Chrome DevTools Protocol to capture CPU profiles
 * while interacting with the Glitch button.
 *
 * Usage:
 *   npm run profile
 *   # or with custom options:
 *   node scripts/profile-performance.js --clicks=10 --headless
 *
 * Output:
 *   profiles/glitch-<timestamp>.cpuprofile
 *
 * Load in Chrome DevTools → Performance panel → Load profile...
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const PROFILE_DIR = join(rootDir, 'profiles');

// Parse CLI arguments
const args = process.argv.slice(2);
const getArg = (name, defaultValue) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  if (arg) return arg.split('=')[1];
  if (args.includes(`--${name}`)) return true;
  return defaultValue;
};

const CONFIG = {
  clicks: parseInt(getArg('clicks', '5'), 10),
  headless: getArg('headless', false) === true || getArg('headless', false) === 'true',
  port: parseInt(getArg('port', '3000'), 10),
  samplingInterval: parseInt(getArg('interval', '100'), 10), // microseconds
};

async function profileGlitchButton() {
  console.log('='.repeat(50));
  console.log('GlitchEdit CPU Profiler');
  console.log('='.repeat(50));
  console.log(`Config: ${JSON.stringify(CONFIG, null, 2)}`);
  console.log('');

  // Ensure profiles directory exists
  mkdirSync(PROFILE_DIR, { recursive: true });

  // Launch browser
  console.log(`Launching browser (headless: ${CONFIG.headless})...`);
  const browser = await chromium.launch({
    headless: CONFIG.headless,
    args: ['--disable-web-security'], // Allow local file access if needed
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // Create CDP session for profiling
  const client = await context.newCDPSession(page);

  try {
    // Debug: Check for console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`  [Browser Error] ${msg.text()}`);
      }
    });
    page.on('pageerror', err => {
      console.log(`  [Page Error] ${err.message}`);
    });

    // Navigate to app
    const url = `http://localhost:${CONFIG.port}`;
    console.log(`Navigating to ${url}...`);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    console.log(`  Response status: ${response?.status()}`);

    // Wait for app to be ready (Glitch button enabled means image loaded)
    console.log('Waiting for app to load...');

    // Debug: Check page content
    const title = await page.title();
    console.log(`  Page title: ${title}`);

    // Wait for network to settle
    await page.waitForLoadState('networkidle');
    console.log('  Network idle');

    // First wait for the button to exist
    const buttonExists = await page.locator('#btn-randomize-effects').count();
    console.log(`  Button count: ${buttonExists}`);

    if (buttonExists === 0) {
      // Debug: Take screenshot
      await page.screenshot({ path: join(PROFILE_DIR, 'debug-screenshot.png') });
      console.log('  Screenshot saved to profiles/debug-screenshot.png');
      throw new Error('Button not found in DOM');
    }

    await page.waitForSelector('#btn-randomize-effects', { timeout: 10000 });
    console.log('  Button found, waiting for it to be enabled...');

    // Check button state periodically
    const startWait = Date.now();
    while (Date.now() - startWait < 30000) {
      const isDisabled = await page.locator('#btn-randomize-effects').getAttribute('disabled');
      if (isDisabled === null) {
        break;
      }
      await page.waitForTimeout(500);
    }

    const isStillDisabled = await page.locator('#btn-randomize-effects').getAttribute('disabled');
    if (isStillDisabled !== null) {
      throw new Error('Button never became enabled - image may have failed to load');
    }

    console.log('App ready!');

    // Enable and configure profiler
    console.log(`Configuring profiler (sampling interval: ${CONFIG.samplingInterval}μs)...`);
    await client.send('Profiler.enable');
    await client.send('Profiler.setSamplingInterval', {
      interval: CONFIG.samplingInterval,
    });

    // Start profiling
    console.log('Starting CPU profiler...');
    await client.send('Profiler.start');
    const startTime = Date.now();

    // Perform profiled actions
    console.log(`\nClicking Glitch button ${CONFIG.clicks} times...`);
    for (let i = 0; i < CONFIG.clicks; i++) {
      console.log(`  Click ${i + 1}/${CONFIG.clicks}...`);
      await page.click('#btn-randomize-effects');

      // Wait for effects to render (check for layer items)
      await page.waitForSelector('#layer-list .layer-item', { timeout: 10000 });

      // Additional wait for render completion
      await page.waitForTimeout(1500);
    }

    // Stop profiling
    console.log('\nStopping profiler...');
    const { profile } = await client.send('Profiler.stop');
    const duration = Date.now() - startTime;

    // Save profile
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = join(PROFILE_DIR, `glitch-${timestamp}.cpuprofile`);
    writeFileSync(filename, JSON.stringify(profile, null, 2));

    // Print summary
    console.log('\n' + '='.repeat(50));
    console.log('PROFILING COMPLETE');
    console.log('='.repeat(50));
    console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`Samples: ${profile.samples?.length || 0}`);
    console.log(`Nodes: ${profile.nodes?.length || 0}`);
    console.log(`Profile saved: ${filename}`);
    console.log('');
    console.log('To analyze:');
    console.log('  1. Open Chrome DevTools');
    console.log('  2. Go to Performance panel');
    console.log('  3. Click "Load profile..." button');
    console.log(`  4. Select: ${filename}`);

    // Quick analysis
    if (profile.nodes && profile.nodes.length > 0) {
      console.log('\n' + '-'.repeat(50));
      console.log('QUICK ANALYSIS');
      console.log('-'.repeat(50));
      analyzeProfile(profile);
    }

  } catch (error) {
    console.error('Profiling failed:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

/**
 * Quick analysis of profile data
 */
function analyzeProfile(profile) {
  const { nodes, samples, timeDeltas } = profile;

  if (!nodes || !samples || !timeDeltas) {
    console.log('Incomplete profile data');
    return;
  }

  // Build node map
  const nodeMap = new Map();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // Calculate time per node (self time)
  const selfTime = new Map();
  for (let i = 0; i < samples.length; i++) {
    const nodeId = samples[i];
    const delta = timeDeltas[i] || 0;
    selfTime.set(nodeId, (selfTime.get(nodeId) || 0) + delta);
  }

  // Sort by self time
  const sortedNodes = [...selfTime.entries()]
    .map(([id, time]) => ({
      id,
      time,
      node: nodeMap.get(id),
    }))
    .filter(n => n.node && n.node.callFrame)
    .sort((a, b) => b.time - a.time);

  // Print top 15 functions
  console.log('\nTop 15 functions by self-time:');
  console.log('');

  const totalTime = timeDeltas.reduce((a, b) => a + b, 0);

  for (let i = 0; i < Math.min(15, sortedNodes.length); i++) {
    const { time, node } = sortedNodes[i];
    const { functionName, url, lineNumber } = node.callFrame;

    const name = functionName || '(anonymous)';
    const location = url
      ? `${url.split('/').pop()}:${lineNumber + 1}`
      : '(native)';
    const percent = ((time / totalTime) * 100).toFixed(1);
    const timeMs = (time / 1000).toFixed(1);

    console.log(`  ${(i + 1).toString().padStart(2)}. ${percent.padStart(5)}%  ${timeMs.padStart(7)}ms  ${name}`);
    console.log(`              ${location}`);
  }

  console.log('');
  console.log(`Total profiled time: ${(totalTime / 1000000).toFixed(2)}s`);
}

// Run
profileGlitchButton().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
