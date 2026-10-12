// Plain Lua execution engine (wasmoon) — does NOT include the Prometheus
// obfuscation sources. Used for "Run" and reused by prometheusRunner.
import glueWasmUrl from "wasmoon/dist/glue.wasm?url"

import type { PrometheusLog, PrometheusResult } from "@/lib/prometheusTypes"
import { toLuaLongString } from "./luaString"

export type LuaFactoryConstructor = new (
  customWasmUri?: string,
  environmentVariables?: Record<string, string>,
) => {
  createEngine(options?: { openStandardLibs?: boolean }): Promise<{
    doString(luaCode: string): Promise<unknown>
    global: { close(): void }
  }>
}

let luaFactoryCtorPromise: Promise<LuaFactoryConstructor> | null = null

export function resolveWasmUri(wasmUrl: string): string {
  if (typeof process !== "undefined" && process.versions?.node) {
    let path = wasmUrl.startsWith("/@fs/") ? wasmUrl.slice("/@fs".length) : wasmUrl
    if (path.startsWith("file://")) {
      try {
        return new URL(path).pathname.replace(/^\/([A-Za-z]:)/, "$1")
      } catch {
        // fall through
      }
    }
    path = path.replace(/^\/([A-Za-z]:)/, "$1")
    return path
  }
  return wasmUrl
}

export { glueWasmUrl }

export async function getLuaFactoryConstructor(): Promise<LuaFactoryConstructor> {
  if (luaFactoryCtorPromise) {
    return luaFactoryCtorPromise
  }

  luaFactoryCtorPromise = import("wasmoon/dist/index.js").then((mod) => {
    const globalCandidate = (globalThis as { wasmoon?: { LuaFactory?: unknown } }).wasmoon?.LuaFactory
    const moduleCandidate = (mod as { LuaFactory?: unknown }).LuaFactory
    const defaultCandidate = (mod as { default?: { LuaFactory?: unknown } }).default?.LuaFactory
    const candidate = (globalCandidate ?? moduleCandidate ?? defaultCandidate) as LuaFactoryConstructor | undefined

    if (typeof candidate !== "function") {
      throw new Error("Unable to resolve LuaFactory export from wasmoon.")
    }

    return candidate
  })

  return luaFactoryCtorPromise
}

export function normalizeLogs(logs: unknown): PrometheusLog[] {
  if (!Array.isArray(logs)) {
    return []
  }
  return logs.map((entry) => {
    const candidate = entry as { level?: unknown; message?: unknown }
    return {
      level:
        candidate.level === "warn" || candidate.level === "error" || candidate.level === "debug"
          ? candidate.level
          : "info",
      message: String(candidate.message ?? ""),
    }
  })
}

interface LuaScriptOptions {
  source: string
  filename: string
}

export function buildScriptRunLua(options: LuaScriptOptions): string {
  return `
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

print = function(...)
  pushLog("info", ...)
end

local ok, err = xpcall(function()
  local chunk, loadErr = load(${toLuaLongString(options.source)}, ${toLuaLongString(options.filename)}, "t")
  if not chunk then
    error(loadErr)
  end
  chunk()
end, debug.traceback)

if not ok then
  pushLog("error", err)
end

return { ok = ok, output = "", error = ok and "" or err, logs = logs }
`
}

export async function runLuaScript(
  options: LuaScriptOptions,
  onLog?: (log: PrometheusLog) => void,
): Promise<PrometheusResult> {
  let lua: Awaited<ReturnType<InstanceType<LuaFactoryConstructor>["createEngine"]>> | null = null

  try {
    const LuaFactory = await getLuaFactoryConstructor()
    lua = await new LuaFactory(resolveWasmUri(glueWasmUrl)).createEngine({ openStandardLibs: true })
    if (onLog) {
      const luaGlobal = lua.global as unknown as {
        set?: (name: string, value: (...args: unknown[]) => void) => void
      }
      luaGlobal.set?.("__prometheusPushLog", (level: unknown, ...parts: unknown[]) => {
        const normalized: PrometheusLog = {
          level: level === "warn" || level === "error" || level === "debug" ? level : "info",
          message: parts.map((part) => String(part)).join(" "),
        }
        onLog(normalized)
      })
    }

    const result = (await lua.doString(buildScriptRunLua(options))) as {
      ok?: unknown
      output?: unknown
      error?: unknown
      logs?: unknown
    }
    if (result.ok === false) {
      return {
        ok: false,
        error: String(result.error ?? "Script execution failed"),
        logs: normalizeLogs(result.logs),
      }
    }

    return { ok: true, output: String(result.output ?? ""), logs: normalizeLogs(result.logs) }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      logs: [],
    }
  } finally {
    lua?.global.close()
  }
}
