import { EndpointPlayground } from "@/components/endpoint-playground"

export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 py-12 md:px-8">
      <header className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary font-mono text-sm font-bold text-primary-foreground">
          fx
        </div>
        <span className="font-mono text-sm font-semibold tracking-tight">currency-convert</span>
      </header>

      <section id="playground" className="flex flex-col gap-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Live playground</h1>
        <EndpointPlayground />
      </section>
    </main>
  )
}
