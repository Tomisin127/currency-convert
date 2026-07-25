"use client"

import { useState } from "react"
import { Loader2, ShieldCheck, TriangleAlert } from "lucide-react"

type ChallengeState = {
  status: number
  builderCode?: string
  hasBuilderCodeExtension: boolean
  hasDiscoveryExtension: boolean
  raw: string
} | null

const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "NGN", "CAD", "AUD", "CHF", "CNY", "INR"]

/**
 * Recursively hunt for the builder-code extension so we can surface the `a`
 * (app) attribution code regardless of where the challenge nests it.
 */
function findBuilderCode(value: unknown): { found: boolean; code?: string } {
  if (!value || typeof value !== "object") return { found: false }
  const obj = value as Record<string, unknown>
  if ("builder-code" in obj && obj["builder-code"] && typeof obj["builder-code"] === "object") {
    const info = (obj["builder-code"] as Record<string, unknown>).info as Record<string, unknown> | undefined
    return { found: true, code: info?.a as string | undefined }
  }
  for (const key of Object.keys(obj)) {
    const nested = findBuilderCode(obj[key])
    if (nested.found) return nested
  }
  return { found: false }
}

function hasKeyDeep(value: unknown, target: string): boolean {
  if (!value || typeof value !== "object") return false
  const obj = value as Record<string, unknown>
  if (target in obj) return true
  return Object.values(obj).some((v) => hasKeyDeep(v, target))
}

export function EndpointPlayground() {
  const [from, setFrom] = useState("USD")
  const [to, setTo] = useState("EUR")
  const [amount, setAmount] = useState("100")
  const [loading, setLoading] = useState(false)
  const [challenge, setChallenge] = useState<ChallengeState>(null)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    setLoading(true)
    setError(null)
    setChallenge(null)
    try {
      const res = await fetch(`/api/currency-convert?from=${from}&to=${to}&amount=${amount}`, {
        headers: { Accept: "application/json" },
      })

      // The x402 challenge travels in the base64 `payment-required` header,
      // and (as JSON) in the 402 body. Prefer the header, fall back to body.
      let parsed: unknown
      const header = res.headers.get("payment-required")
      if (header) {
        parsed = JSON.parse(atob(header))
      } else {
        parsed = await res.clone().json()
      }

      const bc = findBuilderCode(parsed)
      setChallenge({
        status: res.status,
        builderCode: bc.code,
        hasBuilderCodeExtension: bc.found,
        hasDiscoveryExtension: hasKeyDeep(parsed, "discovery") || hasKeyDeep(parsed, "input"),
        raw: JSON.stringify(parsed, null, 2),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-end">
        <Field label="From">
          <Select value={from} onChange={setFrom} />
        </Field>
        <Field label="To">
          <Select value={to} onChange={setTo} />
        </Field>
        <Field label="Amount">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </Field>
        <button
          type="button"
          onClick={send}
          disabled={loading}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-5 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          Send request
        </button>
      </div>

      <div className="p-5">
        {!challenge && !error && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {'Send a request to hit the live endpoint. Without a payment it responds with '}
            <span className="font-mono text-foreground">402 Payment Required</span>
            {" and returns the signed payment challenge — including the builder-code attribution."}
          </p>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span>{error}</span>
          </div>
        )}

        {challenge && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 font-mono text-xs font-semibold ${
                  challenge.status === 402
                    ? "bg-accent/15 text-accent"
                    : "bg-secondary text-secondary-foreground"
                }`}
              >
                HTTP {challenge.status}
              </span>
              {challenge.hasBuilderCodeExtension && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 font-mono text-xs font-semibold text-primary">
                  <ShieldCheck className="size-3.5" />
                  builder-code{challenge.builderCode ? `: a="${challenge.builderCode}"` : ""}
                </span>
              )}
              {challenge.hasDiscoveryExtension && (
                <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-1 font-mono text-xs font-semibold text-secondary-foreground">
                  bazaar discovery
                </span>
              )}
            </div>
            <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-background p-4 text-xs leading-relaxed">
              <code className="font-mono text-card-foreground">{challenge.raw}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex w-full flex-col gap-1.5">
      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function Select({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {CURRENCIES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  )
}
