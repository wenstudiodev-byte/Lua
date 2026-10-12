// Prometheus obfuscation runner. Imports the bundled Prometheus Lua sources —
// so any chunk that includes this module ships the obfuscation engine.
import luaSources from "virtual:prometheus-lua"
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

const bootstrapLua = Object.entries(luaSources)
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

export function buildRunLua(options: PrometheusOptions): string {
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
    const LuaFactory = await getLuaFactoryConstructor()
    lua = await new LuaFactory(resolveWasmUri(glueWasmUrl)).createEngine({ openStandardLibs: true })

    const result = (await lua.doString(buildRunLua(options))) as {
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
