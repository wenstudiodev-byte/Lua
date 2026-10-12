import type { WorkerRequest, WorkerResponse } from "@/lib/prometheusTypes"
import { runLuaScript } from "./luaEngine"

// When server-side obfuscation is on, the browser never obfuscates locally,
// so the Prometheus engine import below is statically dead and gets dropped
// from the client bundle (the obfuscation sources never ship to browsers).
const SERVER_OBFUSCATE = import.meta.env.VITE_SERVER_OBFUSCATE === "1"

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data

  const result = await (async () => {
    if (request.action === "obfuscate") {
      if (!SERVER_OBFUSCATE) {
        const { runPrometheus } = await import("./prometheusRunner")
        return runPrometheus(request.options)
      }
      return {
        ok: false as const,
        error: "Obfuscation dilakukan di server (mode server-side aktif).",
        logs: [],
      }
    }

    return runLuaScript({ source: request.source, filename: request.filename }, (log) => {
      const logResponse: WorkerResponse = { id: request.id, type: "log", log }
      self.postMessage(logResponse)
    })
  })().catch((error) => ({
    ok: false as const,
    error:
      error instanceof Error
        ? `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`
        : String(error),
    logs: [],
  }))

  const response: WorkerResponse = { id: request.id, type: "result", result }
  self.postMessage(response)
}
