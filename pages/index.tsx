import Link from "next/link";

export default function HomePage() {
  return (
    <div className="bg-[#0f172a] text-white min-h-screen flex flex-col">
      <header className="p-6 flex justify-between items-center border-b border-gray-700">
        <div className="flex items-center space-x-2">
          <img src="/logo.png" alt="CoveCRM Logo" className="h-10" />
          <h1 className="text-xl font-bold">CoveCRM</h1>
        </div>
        <Link href="/auth/signin" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
          Log In
        </Link>
      </header>

      <main className="flex-1 px-6 py-12 flex flex-col items-center text-center">
        <h2 className="text-4xl font-extrabold mb-4">The CRM that feels like it was built just for you.</h2>
        <p className="text-lg text-gray-300 max-w-2xl mb-8">
          CoveCRM helps agents move fast, stay organized, and actually enjoy managing leads and clients — all in one modern, easy-to-use platform.
        </p>
        <Link href="/auth/signin" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded font-semibold mb-16">
          Get Started Free
        </Link>

        {/* Features section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl w-full">
          <Feature title="Built-in Dialer" desc="Call leads directly from your CRM with seamless one-click calling and auto-logging." />
          <Feature title="Smart Workflows" desc="Automate your follow-ups, reminders, and tasks so you never miss a deal." />
          <Feature title="Powerful Pipelines" desc="Easily track prospects and move them through custom stages visually." />
          <Feature title="Instant Notes & AI Summaries" desc="Record every interaction and get instant AI-generated call summaries." />
          <Feature title="Live Reporting" desc="Real-time dashboards to keep your team aligned and hitting goals." />
          <Feature title="Simple Integrations" desc="Connect with your favorite tools in seconds, no headaches." />
        </div>
      </main>

      {/* Testimonials section */}
      <section className="bg-[#1e293b] py-12 mt-16 w-full text-center">
        <h3 className="text-2xl font-bold mb-6">Agents love CoveCRM</h3>
        <p className="text-gray-300 max-w-3xl mx-auto mb-4">
          "CoveCRM is the most intuitive CRM we've ever used. Our team is closing deals faster and spending less time clicking around." — Real user
        </p>
      </section>

      {/* Final call to action */}
      <section className="py-12 flex flex-col items-center text-center">
        <h4 className="text-3xl font-bold mb-4">Ready to transform your workflow?</h4>
        <Link href="/auth/signin" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded font-semibold">
          Start Now — Free
        </Link>
      </section>

      <footer className="p-4 text-center text-gray-500 border-t border-gray-700">
        © {new Date().getFullYear()} CoveCRM. All rights reserved.
      </footer>
    </div>
  );
}

function Feature({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="bg-[#1e293b] p-6 rounded shadow hover:shadow-lg transition">
      <h4 className="text-xl font-bold mb-2">{title}</h4>
      <p className="text-gray-300">{desc}</p>
    </div>
  );
}

