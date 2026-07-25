import { type NextRequest, NextResponse } from "next/server"
import { withX402, type RouteConfig } from "@x402/next"
import { BUILDER_CODE, declareBuilderCodeExtension } from "@x402/extensions/builder-code"
import { declareDiscoveryExtension } from "@x402/extensions/bazaar"
import { BASE_MAINNET, MY_BUILDER_CODE, getPayToAddress, getResourceServer } from "@/lib/x402"

// Payment settlement (and env reads) require the Node.js runtime.
export const runtime = "nodejs"
// This route depends on request-time query params and secrets, so it must never
// be statically cached.
export const dynamic = "force-dynamic"

type ConvertResult = {
  from: string
  to: string
  amount: number
  rate: number
  result: number
  asOf: string
}

/**
 * The actual, paid resource. This body only runs AFTER x402 has verified a
 * valid payment for the request (`withX402` settles once this returns < 400).
 *
 * Query params:
 *   from   - ISO 4217 currency code to convert from (e.g. "USD")
 *   to     - ISO 4217 currency code to convert to   (e.g. "EUR")
 *   amount - optional numeric amount to convert (defaults to 1)
 */
async function handler(request: NextRequest): Promise<NextResponse<ConvertResult | { error: string }>> {
  const { searchParams } = new URL(request.url)
  const from = (searchParams.get("from") ?? "USD").toUpperCase().trim()
  const to = (searchParams.get("to") ?? "EUR").toUpperCase().trim()
  const amount = Number.parseFloat(searchParams.get("amount") ?? "1")

  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
    return NextResponse.json(
      { error: "`from` and `to` must be 3-letter ISO 4217 currency codes." },
      { status: 400 },
    )
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: "`amount` must be a non-negative number." }, { status: 400 })
  }

  // Live reference rates from a free, key-less FX source.
  const res = await fetch(`https://open.er-api.com/v6/latest/${from}`, {
    // Rates change slowly; cache for a minute to stay responsive.
    next: { revalidate: 60 },
  })
  const data = (await res.json()) as {
    result?: string
    rates?: Record<string, number>
    time_last_update_utc?: string
  }

  if (data.result !== "success" || !data.rates) {
    return NextResponse.json({ error: `Unknown or unsupported base currency "${from}".` }, { status: 400 })
  }

  const rate = data.rates[to]
  if (typeof rate !== "number") {
    return NextResponse.json({ error: `Unknown or unsupported target currency "${to}".` }, { status: 400 })
  }

  return NextResponse.json({
    from,
    to,
    amount,
    rate,
    result: Number((amount * rate).toFixed(6)),
    asOf: data.time_last_update_utc ?? new Date().toUTCString(),
  })
}

/**
 * Payment configuration for this route.
 *
 * - Priced in USDC on Base mainnet, paid to PAY_TO_ADDRESS (from env).
 * - Extensions (builder-code for ERC-8021 attribution and discovery for Bazaar indexing)
 *   are SPREAD into the extensions object.
 */
const routeConfig: RouteConfig = {
  accepts: {
    scheme: "exact",
    network: BASE_MAINNET,
    price: "$0.002",
    payTo: getPayToAddress(),
    maxTimeoutSeconds: 120,
  },
  description: "Convert an amount from one fiat currency to another using live reference exchange rates.",
  mimeType: "application/json",
  serviceName: "currency-convert",
  tags: ["currency", "fx", "exchange-rate", "finance", "conversion"],
  extensions: {
    // ERC-8021 Builder Code attribution ("a" app code) on every settlement.
    // `declareBuilderCodeExtension` returns a bare { info, schema } object, so it
    // MUST be keyed under the extension name (BUILDER_CODE === "builder-code").
    [BUILDER_CODE]: declareBuilderCodeExtension(MY_BUILDER_CODE),
    // Bazaar discovery metadata. `declareDiscoveryExtension` already returns a
    // self-keyed { bazaar: { info, schema } } object, so it is SPREAD here.
    //
    // Note: we intentionally do NOT pass `method`. The v2 discovery schema
    // requires `input.method` to be one of GET/HEAD/DELETE, but that value is
    // injected at request time by the registered `bazaarResourceServerExtension`
    // (from the actual HTTP method of the route). Registering that server
    // extension in lib/x402.ts is what makes discovery validation pass.
    ...declareDiscoveryExtension({
      input: { from: "USD", to: "EUR", amount: 100 },
      inputSchema: {
        properties: {
          from: { type: "string", description: "ISO 4217 currency code to convert from (e.g. USD)." },
          to: { type: "string", description: "ISO 4217 currency code to convert to (e.g. EUR)." },
          amount: { type: "number", description: "Amount to convert. Defaults to 1." },
        },
        required: ["from", "to"],
      },
      output: {
        example: {
          from: "USD",
          to: "EUR",
          amount: 100,
          rate: 0.92,
          result: 92,
          asOf: "Fri, 04 Jul 2025 00:00:01 +0000",
        },
      },
    }),
  },
}

// Wrap the handler with x402 payment protection. The resource server syncs with
// the CDP facilitator to learn which schemes/networks are supported (needed to
// build the `exact` + Base USDC payment requirements) before serving the 402.
export const GET = withX402(handler, routeConfig, getResourceServer())
