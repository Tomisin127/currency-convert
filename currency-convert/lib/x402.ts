import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server"
import { ExactEvmScheme } from "@x402/evm/exact/server"
import { createFacilitatorConfig } from "@coinbase/x402"
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar"
import { builderCodeResourceServerExtension } from "@x402/extensions/builder-code"

/**
 * Base mainnet in CAIP-2 format. USDC settlement happens on this network.
 */
export const BASE_MAINNET = "eip155:8453" as const

/**
 * The Base Builder Code declared on every payment challenge so the CDP
 * facilitator appends the ERC-8021 attribution suffix to settlement calldata.
 * Get yours at https://dashboard.base.org (Settings -> Builder Codes).
 */
export const MY_BUILDER_CODE = process.env.BUILDER_CODE ?? "bc_replace_me"

/**
 * The wallet that receives USDC for every paid request. Read from the
 * environment — never hardcoded. Required to build the 402 payment challenge.
 */
export function getPayToAddress(): string {
  const addr = process.env.PAY_TO_ADDRESS
  if (!addr || addr.trim() === "") {
    throw new Error(
      `[x402] Missing PAY_TO_ADDRESS environment variable. ` +
        `Set it to your USDC receiving wallet address on Base mainnet (see .env.example).`,
    )
  }
  return addr
}

/**
 * A shared x402 resource server wired to the Coinbase CDP facilitator.
 *
 * The CDP facilitator verifies payments and settles them on Base. It requires
 * CDP_API_KEY_ID and CDP_API_KEY_SECRET. Those credentials are only exercised
 * when a real payment is verified/settled — at which point a missing/invalid
 * key surfaces as a loud facilitator error. Producing the 402 challenge itself
 * does not require the network, so Bazaar discovery crawlers still get a valid
 * challenge before keys are set.
 *
 * Extensions (builder-code and discovery) are declared in the route config
 * and spread into the extensions object, not registered here.
 *
 * We register the EVM `exact` scheme for Base mainnet so USDC payment
 * requirements can be produced locally.
 */
let cachedServer: x402ResourceServer | undefined

export function getResourceServer(): x402ResourceServer {
  if (cachedServer) return cachedServer

  if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
    console.error(
      "[x402] CDP_API_KEY_ID / CDP_API_KEY_SECRET are not set. " +
        "The 402 challenge will still be served, but payment verification and " +
        "settlement through the Coinbase CDP facilitator will fail until they are configured.",
    )
  }

  const facilitatorClient = new HTTPFacilitatorClient(
    createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET),
  )

  cachedServer = new x402ResourceServer(facilitatorClient)
    .register(BASE_MAINNET, new ExactEvmScheme())
    // Register the resource-server extensions that back the route declarations.
    // Without these, `enrichExtensions` cannot enrich the declared extensions:
    //   - bazaar: injects `input.method` (from the request's HTTP method) into the
    //     discovery declaration. This is REQUIRED for v2 Bazaar discovery validation
    //     ("input.method must be one of GET/HEAD/DELETE"); without it the
    //     declaration ships without a method and validation fails.
    //   - builder-code: echoes the ERC-8021 app code so attribution is advertised.
    .registerExtension(bazaarResourceServerExtension)
    .registerExtension(builderCodeResourceServerExtension)

  return cachedServer
}
