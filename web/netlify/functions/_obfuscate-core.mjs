// Core server-side obfuscation runner (Node, via wasmoon).
// Mirrors web/src/worker/prometheusRunner.ts but reads Lua sources from JSON.
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { LuaFactory } from "wasmoon"

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))

// Banner prepended to the obfuscated output (cosmetic only — pure text,
// added after obfuscation, never touches the Prometheus pipeline itself).
// Mirrors web/src/worker/prometheusRunner.ts's WEN_STUDIO_BANNER.
const WEN_STUDIO_BANNER = `--[[
\u2588\u2588\u2557    \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2557   \u2588\u2588\u2557
\u2588\u2588\u2551    \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551
\u2588\u2588\u2551 \u2588\u2557 \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2554\u2588\u2588\u2557 \u2588\u2588\u2551
\u2588\u2588\u2551\u2588\u2588\u2588\u2557\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u255d  \u2588\u2588\u2551\u255a\u2588\u2588\u2557\u2588\u2588\u2551
\u255a\u2588\u2588\u2588\u2554\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551 \u255a\u2588\u2588\u2588\u2588\u2551
 \u255a\u2550\u2550\u255d\u255a\u2550\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u2550\u2550\u255d
\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557
\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255d\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557
\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557   \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551
\u255a\u2550\u2550\u2550\u2550\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551
\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551   \u2588\u2588\u2551   \u255a\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2551\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d
\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d   \u255a\u2550\u255d    \u255a\u2550\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u255d

  Obfuscated with WEN STUDIO -- wenstudioobfus.netlify.app
]]--

`

// Lua sources: require() the JSON so the bundler can inline it (most robust in
// serverless); falls back to filesystem read when that's not possible.
let luaSourcesCache = null
async function loadSources() {
  if (luaSourcesCache) return luaSourcesCache
  try {
    luaSourcesCache = require("./_lua-sources.json")
  } catch {
    const { readFile } = await import("node:fs/promises")
    luaSourcesCache = JSON.parse(await readFile(path.join(here, "_lua-sources.json"), "utf8"))
  }
  return luaSourcesCache
}

// Resolve glue.wasm robustly: copy shipped beside the function, else wasmoon pkg.
function resolveWasmPath() {
  const local = path.join(here, "_glue.wasm")
  if (existsSync(local)) return local
  try {
    return require.resolve("wasmoon/dist/glue.wasm")
  } catch {
    return undefined
  }
}

function toLuaLongString(value) {
  let equals = ""
  while (value.includes(`]${equals}]`)) equals += "="
  return `[${equals}[${value}]${equals}]`
}

function buildBootstrap(luaSources) {
  return Object.entries(luaSources)
    .map(([name, source]) => {
      const chunkName = `@/src/${name.split(".").join("/")}.lua`
      return `
package.preload[ ${toLuaLongString(name)} ] = function(...)
  local chunk, err = load(${toLuaLongString(source)}, ${toLuaLongString(chunkName)}, "t")
  if not chunk then error(err) end
  return chunk(...)
end`
    })
    .join("\n")
}

function buildRunLua(bootstrap, options) {
  return `
_G.arg = _G.arg or {}
${bootstrap}

local logs = {}
local unpackFn = table.unpack or unpack
local function pushLog(level, ...)
  local parts = {}
  for i = 1, select("#", ...) do parts[#parts + 1] = tostring(select(i, ...)) end
  logs[#logs + 1] = { level = level, message = table.concat(parts, " ") }
end

if not math.log10 then
  math.log10 = function(value) return math.log(value, 10) end
end

local Prometheus = require("prometheus")
Prometheus.Logger.logLevel = Prometheus.Logger.LogLevel.Info
Prometheus.colors.enabled = false
Prometheus.Logger.debugCallback = function(...) pushLog("debug", ...) end
Prometheus.Logger.logCallback = function(...) pushLog("info", ...) end
Prometheus.Logger.warnCallback = function(...) pushLog("warn", ...) end
Prometheus.Logger.errorCallback = function(...)
  pushLog("error", ...)
  error(table.concat((function(...)
    local parts = {}
    for i = 1, select("#", ...) do parts[#parts + 1] = tostring(select(i, ...)) end
    return parts
  end)(...), " "))
end

local ok, outputOrError = xpcall(function()
  local preset = ${toLuaLongString(options.preset)}
  local source = ${toLuaLongString(options.source)}
  local filename = ${toLuaLongString(options.filename ?? "server-input.lua")}
  local config = {}
  for key, value in pairs(Prometheus.Presets[preset]) do config[key] = value end
  config.LuaVersion = ${toLuaLongString(options.luaVersion)}
  config.PrettyPrint = ${options.prettyPrint ? "true" : "false"}
  config.Seed = ${Math.max(1, Math.floor(options.seed ?? 1))}
  return Prometheus.Pipeline:fromConfig(config):apply(source, filename)
end, debug.traceback)

return { ok = ok, output = ok and outputOrError or "", error = ok and "" or outputOrError, logs = logs }
`
}

function normalizeLogs(logs) {
  if (!Array.isArray(logs)) return []
  return logs.map((e) => ({
    level: e?.level === "warn" || e?.level === "error" || e?.level === "debug" ? e.level : "info",
    message: String(e?.message ?? ""),
  }))
}

const VALID_PRESETS = new Set(["Minify", "Weak", "Medium", "Strong"])
const VALID_LUA = new Set(["Lua51", "LuaU"])

export async function runPrometheusNode(options) {
  if (!options || typeof options.source !== "string") {
    return { ok: false, error: "Source tidak valid.", logs: [] }
  }
  if (!VALID_PRESETS.has(options.preset)) {
    return { ok: false, error: "Preset tidak valid.", logs: [] }
  }
  if (!VALID_LUA.has(options.luaVersion)) {
    return { ok: false, error: "Versi Lua tidak valid.", logs: [] }
  }

  const sources = await loadSources()
  const bootstrap = buildBootstrap(sources)

  let lua = null
  try {
    const wasmPath = resolveWasmPath()
    const factory = wasmPath ? new LuaFactory(wasmPath) : new LuaFactory()
    lua = await factory.createEngine({ openStandardLibs: true })
    const result = await lua.doString(buildRunLua(bootstrap, options))
    if (result?.ok === false) {
      return { ok: false, error: String(result.error ?? "Obfuscation gagal"), logs: normalizeLogs(result.logs) }
    }
    return { ok: true, output: WEN_STUDIO_BANNER + String(result?.output ?? ""), logs: normalizeLogs(result?.logs) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), logs: [] }
  } finally {
    try {
      lua?.global?.close()
    } catch {
      /* ignore */
    }
  }
}
