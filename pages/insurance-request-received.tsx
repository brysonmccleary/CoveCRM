import Head from "next/head";

export default function InsuranceRequestReceived() {
  return (
    <>
      <Head>
        <title>Request Received</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <main className="min-h-screen bg-slate-950 px-5 py-16 text-white">
        <section className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-2xl text-emerald-300">
            ✓
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Your request was received</h1>
          <p className="mt-4 text-base leading-7 text-slate-300">
            A licensed insurance agent will review your information and contact you about available options.
          </p>
          <p className="mt-5 text-sm leading-6 text-slate-400">
            Coverage, rates, and eligibility vary by carrier, state, age, health, underwriting, and policy terms. Submitting a request does not create coverage or require a purchase.
          </p>
          <div className="mt-7 flex justify-center gap-5 text-sm text-slate-300">
            <a className="underline hover:text-white" href="/legal/privacy">Privacy</a>
            <a className="underline hover:text-white" href="/legal/terms">Terms</a>
          </div>
        </section>
      </main>
    </>
  );
}
