// Generate netlify/functions/_lua-sources.json from the Prometheus Lua sources.
// Run from the `web` directory: node scripts/gen-lua-bundle.mjs
import { readdir, readFile, writeFile, mkdir, copyFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const webRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const repoRoot = path.resolve(webRoot, "..")
const srcRoot = path.join(repoRoot, "src")
const outFile = path.join(webRoot, "netlify", "functions", "_lua-sources.json")

function moduleName(absolute) {
  const rel = path.relative(srcRoot, absolute).split(path.sep).join("/")
  return rel.replace(/\.lua$/, "").split("/").join(".")
}

async function findLua(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const out = []
  for (const e of entries) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await findLua(abs)))
    else if (e.isFile() && e.name.endsWith(".lua")) out.push(abs)
  }
  return out
}

const modules = {}
for (const abs of await findLua(srcRoot)) {
  modules[moduleName(abs)] = await readFile(abs, "utf8")
}
await mkdir(path.dirname(outFile), { recursive: true })
await writeFile(outFile, JSON.stringify(modules))
console.log(`Wrote ${Object.keys(modules).length} Lua modules -> ${path.relative(webRoot, outFile)}`)

// Copy wasmoon's glue.wasm next to the function as a fallback for serverless.
try {
  const require = createRequire(import.meta.url)
  const wasmSrc = require.resolve("wasmoon/dist/glue.wasm")
  const wasmDst = path.join(webRoot, "netlify", "functions", "_glue.wasm")
  await copyFile(wasmSrc, wasmDst)
  console.log(`Copied glue.wasm -> ${path.relative(webRoot, wasmDst)}`)
} catch (e) {
  console.warn("Lewati salin glue.wasm:", e?.message)
}
