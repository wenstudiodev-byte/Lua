// Prometheus obfuscation runner.
//
// PERBAIKAN: sumber Lua Prometheus (virtual:prometheus-lua) sekarang di-import
// secara dinamis (lazy) dengan retry, BUKAN static import. Efeknya chunk
// prometheusRunner jadi kecil, dan sumber Lua yang besar punya chunk sendiri
// yang di-download ulang otomatis kalau gagal ("Failed to fetch dynamically
// imported module"). bootstrapLua juga tidak lagi dibangun saat modul dimuat.
import type { PrometheusLog, PrometheusOptions, PrometheusResult } from "@/lib/prometheusTypes"
import { toLuaLongString } from "./luaString"
import {
  getLuaFactoryConstructor,
  glueWasmUrl,
  normalizeLogs,
  resolveWasmUri,
  runLuaScript,
  type LuaFactoryConstructor,
} from "./luaEngine"

// Re-export for backwards compatibility (worker/tests may import from here).
export { runLuaScript }

// ---------------------------------------------------------------------------
// Dynamic import dengan retry + exponential backoff
// ---------------------------------------------------------------------------
async function importWithRetry<T>(loader: () => Promise<T>, retries = 3, baseDelayMs = 500): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await loader()
    } catch (error) {
      if (attempt >= retries) throw error
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt))
    }
  }
}

// Banner prepended to the obfuscated output (cosmetic only — pure text,
// added after obfuscation, never touches the Prometheus pipeline itself).
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

export function withWenStudioBanner(output: string): string {
  return WEN_STUDIO_BANNER + output
}

// ---------------------------------------------------------------------------
// Bootstrap Lua: dibangun lazy, di-cache setelah pertama kali berhasil
// ---------------------------------------------------------------------------
let bootstrapLuaCache: string | null = null
let bootstrapLuaPromise: Promise<string> | null = null

function makeBootstrapLua(luaSources: Record<string, string>): string {
  return Object.entries(luaSources)
    .map(([name, source]) => {
      const chunkName = `@/src/${name.split(".").join("/")}.lua`
      return `
package.preload[ ${toLuaLongString(name)} ] = function(...)
  local chunk, err = load(${toLuaLongString(source)}, ${toLuaLongString(chunkName)}, "t")
  if not chunk then
    error(err)
  end
  return chunk(...)
end`
    })
    .join("\n")
}

/**
 * Load sumber Lua Prometheus (chunk terpisah) + retry, lalu cache hasilnya.
 * Kalau kode lain memanggil buildRunLua() langsung (worker/tests), panggil
 * `await loadBootstrapLua()` dulu sekali.
 */
export function loadBootstrapLua(): Promise<string> {
  if (bootstrapLuaCache !== null) return Promise.resolve(bootstrapLuaCache)
  if (!bootstrapLuaPromise) {
    bootstrapLuaPromise = importWithRetry(() => import("virtual:prometheus-lua"))
      .then((mod) => {
        const sources = (mod as { default: Record<string, string> }).default
        bootstrapLuaCache = makeBootstrapLua(sources)
        return bootstrapLuaCache
      })
      .catch((error) => {
        // jangan simpan promise gagal, supaya percobaan berikutnya bisa retry
        bootstrapLuaPromise = null
        throw error
      })
  }
  return bootstrapLuaPromise
}

export function buildRunLua(options: PrometheusOptions, bootstrapLua: string | null = bootstrapLuaCache): string {
  if (bootstrapLua === null) {
    throw new Error("Prometheus Lua sources belum dimuat. Panggil `await loadBootstrapLua()` sebelum buildRunLua().")
  }

  return `
_G.arg = _G.arg or {}
${bootstrapLua}

local logs = {}
local unpackFn = table.unpack or unpack
local function pushLog(level, ...)
  local parts = {}
  for i = 1, select("#", ...) do
    parts[#parts + 1] = tostring(select(i, ...))
  end
  if type(_G.__prometheusPushLog) == "function" then
    _G.__prometheusPushLog(level, unpackFn(parts))
  end
  logs[#logs + 1] = { level = level, message = table.concat(parts, " ") }
end

if not math.log10 then
  math.log10 = function(value)
    return math.log(value, 10)
  end
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
    for i = 1, select("#", ...) do
      parts[#parts + 1] = tostring(select(i, ...))
    end
    return parts
  end)(...), " "))
end

local ok, outputOrError = xpcall(function()
  local preset = ${toLuaLongString(options.preset)}
  local source = ${toLuaLongString(options.source)}
  local filename = ${toLuaLongString(options.filename)}
  local config = {}
  for key, value in pairs(Prometheus.Presets[preset]) do
    config[key] = value
  end

  config.LuaVersion = ${toLuaLongString(options.luaVersion)}
  config.PrettyPrint = ${options.prettyPrint ? "true" : "false"}
  config.Seed = ${Math.max(1, Math.floor(options.seed))}

  return Prometheus.Pipeline:fromConfig(config):apply(source, filename)
end, debug.traceback)

return { ok = ok, output = ok and outputOrError or "", error = ok and "" or outputOrError, logs = logs }
`
}

export async function runPrometheus(options: PrometheusOptions): Promise<PrometheusResult> {
  const logs: PrometheusLog[] = []
  let lua: Awaited<ReturnType<InstanceType<LuaFactoryConstructor>["createEngine"]>> | null = null

  try {
    const bootstrapLua = await loadBootstrapLua()
    const LuaFactory = await getLuaFactoryConstructor()
    lua = await new LuaFactory(resolveWasmUri(glueWasmUrl)).createEngine({ openStandardLibs: true })

    const result = (await lua.doString(buildRunLua(options, bootstrapLua))) as {
      ok?: unknown
      output?: unknown
      error?: unknown
      logs?: unknown
    }
    if (result.ok === false) {
      return {
        ok: false,
        error: String(result.error ?? "Prometheus failed"),
        logs: normalizeLogs(result.logs),
      }
    }

    return { ok: true, output: withWenStudioBanner(String(result.output ?? "")), logs: normalizeLogs(result.logs) }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      logs,
    }
  } finally {
    lua?.global.close()
  }
}
