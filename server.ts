#!/usr/bin/env bun
/**
 * GlitchEdit Server - Self-contained executable
 *
 * When compiled with `bun build --compile`, this creates a standalone binary
 * that embeds the HTML app and serves it on an available port.
 */

// Embed the bundled HTML file
import htmlPath from "./dist/glitchedit.html" with { type: "file" };
import samplePath from "./assets/sample.png" with { type: "file" };

const DEFAULT_PORT = 3000;
const MAX_PORT_ATTEMPTS = 100;

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + MAX_PORT_ATTEMPTS; port++) {
    try {
      // Try to create a temporary server to test if port is available
      const testServer = Bun.serve({
        port,
        fetch() {
          return new Response("test");
        },
      });
      testServer.stop();
      return port;
    } catch (e) {
      // Port is in use, try next one
      continue;
    }
  }
  throw new Error(`No available port found in range ${startPort}-${startPort + MAX_PORT_ATTEMPTS}`);
}

/**
 * Open URL in the default browser
 */
function openBrowser(url: string) {
  const platform = process.platform;
  let command: string;

  if (platform === "darwin") {
    command = `open "${url}"`;
  } else if (platform === "win32") {
    command = `start "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  Bun.spawn(["sh", "-c", command], {
    stdout: "ignore",
    stderr: "ignore",
  });
}

async function main() {
  const args = process.argv.slice(2);
  const noBrowser = args.includes("--no-browser");
  const portArg = args.find(arg => arg.startsWith("--port="));
  const requestedPort = portArg ? parseInt(portArg.split("=")[1], 10) : DEFAULT_PORT;

  console.log("🎨 GlitchEdit Server");
  console.log("Finding available port...");

  const port = await findAvailablePort(requestedPort);
  const url = `http://localhost:${port}`;

  const server = Bun.serve({
    port,
    static: {
      // Serve the main HTML at root
      "/": new Response(Bun.file(htmlPath), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
      // Serve sample image
      "/assets/sample.png": new Response(Bun.file(samplePath), {
        headers: { "Content-Type": "image/png" },
      }),
    },
    fetch(req) {
      const pathname = new URL(req.url).pathname;

      // Fallback: serve index.html for SPA-style routing
      if (pathname === "/" || pathname === "/index.html") {
        return new Response(Bun.file(htmlPath), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`\n✨ Server running at: ${url}`);
  console.log("Press Ctrl+C to stop\n");

  if (!noBrowser) {
    console.log("Opening browser...");
    openBrowser(url);
  }
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
