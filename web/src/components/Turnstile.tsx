import { useEffect, useRef } from "react"

// Cloudflare Turnstile (CAPTCHA). Aktif hanya jika VITE_TURNSTILE_SITE_KEY diisi.
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined
export const isCaptchaEnabled = Boolean(TURNSTILE_SITE_KEY)

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
      reset: (id?: string) => void
      remove: (id?: string) => void
    }
    onTurnstileLoad?: () => void
  }
}

let scriptPromise: Promise<void> | null = null
function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve()
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve) => {
    const s = document.createElement("script")
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    document.head.appendChild(s)
  })
  return scriptPromise
}

export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const widgetId = useRef<string | null>(null)

  useEffect(() => {
    if (!isCaptchaEnabled) return
    let cancelled = false
    void loadScript().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "dark",
        callback: (token: string) => onToken(token),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      })
    })
    return () => {
      cancelled = true
      try {
        if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current)
      } catch {
        /* ignore */
      }
    }
  }, [onToken])

  if (!isCaptchaEnabled) return null
  return <div ref={ref} className="flex justify-center" />
}
