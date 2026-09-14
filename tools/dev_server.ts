/**
 * Run the whole thing locally: the real Worker code, the real migrations and
 * the real triggers, on an in-memory SQLite standing in for D1, serving the
 * built web app.
 *
 * This needs no Cloudflare account and no wrangler. It is for looking at the
 * app and for automated checks; `wrangler dev` is the real thing.
 *
 *   deno task dev:server            (then open http://127.0.0.1:8799)
 *
 * The seeded login is printed on startup.
 */
import worker from "../src/worker/index.ts";
import { createTestEnv, seedItems, seedUser } from "../tests/support/fake_d1.ts";

const PORT = Number(Deno.env.get("PORT") ?? 8799);
const EMAIL = Deno.env.get("DEV_EMAIL") ?? "omar@casacavco.com";
const PASSWORD = Deno.env.get("DEV_PASSWORD") ?? "development password";
const DIST = new URL("../web/dist/", import.meta.url);

const env = createTestEnv();
seedItems(env);
await seedUser(env, EMAIL, PASSWORD, "Omar");
await seedUser(env, "mum@casacavco.com", PASSWORD, "Mum");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

async function serveStatic(pathname: string): Promise<Response> {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  for (const candidate of [relative, "index.html"]) {
    try {
      const file = await Deno.readFile(new URL(candidate, DIST));
      const extension = candidate.slice(candidate.lastIndexOf("."));
      return new Response(file, {
        headers: { "content-type": TYPES[extension] ?? "application/octet-stream" },
      });
    } catch {
      continue; // fall through to the single-page fallback
    }
  }
  return new Response("web/dist is missing — run: deno task build:web", { status: 404 });
}

console.log(`Casa Cava dev server   http://127.0.0.1:${PORT}`);
console.log(`  sign in as           ${EMAIL}`);
console.log(`  password             ${PASSWORD}`);
console.log(`  (in-memory database — everything is forgotten when this stops)`);

Deno.serve({ port: PORT, hostname: "127.0.0.1" }, async (request) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return await worker.fetch(request, env);
  return await serveStatic(url.pathname);
});
