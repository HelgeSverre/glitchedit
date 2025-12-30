#!/usr/bin/env node
/**
 * GlitchEdit CLI - Serves the bundled app on an available port
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { exec } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const DEFAULT_PORT = 3000;
const MAX_PORT_ATTEMPTS = 100;

// Find the bundled HTML file
function findHtmlFile() {
  const paths = [
    join(rootDir, "dist", "glitchedit.html"),
    join(__dirname, "..", "dist", "glitchedit.html"),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      return p;
    }
  }

  console.error("Error: Could not find glitchedit.html");
  console.error("Run 'npm run build:bundle' first or ensure the package is properly installed.");
  process.exit(1);
}

// Find sample.png
function findSamplePng() {
  const paths = [
    join(rootDir, "assets", "sample.png"),
    join(__dirname, "..", "assets", "sample.png"),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      return p;
    }
  }
  return null;
}

// Check if port is available
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

// Find available port
async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + MAX_PORT_ATTEMPTS; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found in range ${startPort}-${startPort + MAX_PORT_ATTEMPTS}`);
}

// Open URL in browser
function openBrowser(url) {
  const platform = process.platform;
  let command;

  if (platform === "darwin") {
    command = `open "${url}"`;
  } else if (platform === "win32") {
    command = `start "" "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  exec(command, { stdio: "ignore" });
}

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    port: DEFAULT_PORT,
    noBrowser: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--no-browser") {
      options.noBrowser = true;
    } else if (arg.startsWith("--port=")) {
      options.port = parseInt(arg.split("=")[1], 10);
    }
  }

  return options;
}

// Main
async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
GlitchEdit - PNG Glitch Art Editor

Usage: glitchedit [options]

Options:
  --port=PORT     Start server on specified port (default: 3000)
  --no-browser    Don't open browser automatically
  -h, --help      Show this help message

Examples:
  glitchedit                    # Start on port 3000, open browser
  glitchedit --port=8080        # Start on port 8080
  glitchedit --no-browser       # Start without opening browser
`);
    process.exit(0);
  }

  const htmlPath = findHtmlFile();
  const samplePath = findSamplePng();

  console.log("🎨 GlitchEdit Server");
  console.log("Finding available port...");

  const port = await findAvailablePort(options.port);
  const url = `http://localhost:${port}`;

  // Read files
  const htmlContent = readFileSync(htmlPath);
  const sampleContent = samplePath ? readFileSync(samplePath) : null;

  // Create server
  const server = createServer((req, res) => {
    const pathname = new URL(req.url, `http://localhost:${port}`).pathname;

    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(htmlContent);
    } else if (pathname === "/assets/sample.png" && sampleContent) {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(sampleContent);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  });

  server.listen(port, () => {
    console.log(`\n✨ Server running at: ${url}`);
    console.log("Press Ctrl+C to stop\n");

    if (!options.noBrowser) {
      console.log("Opening browser...");
      openBrowser(url);
    }
  });

  // Handle shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
