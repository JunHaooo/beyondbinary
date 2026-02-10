import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center gap-10 px-6">
      {/* Brand */}
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-white/80 text-3xl font-light tracking-[0.35em] uppercase">
          Echo
        </h1>
        <p className="text-white/25 text-xs tracking-[0.3em] uppercase">
          Connection without Performance
        </p>
      </div>

      {/* Navigation */}
      <div className="flex flex-col items-center gap-3 w-full max-w-xs">
        <Link
          href="/submit"
          className="w-full py-3.5 rounded-xl border border-white/15
                     text-white/60 text-xs tracking-widest uppercase text-center
                     hover:text-white/80 hover:border-white/30
                     transition-all duration-200 bg-white/[0.02]"
        >
          release your echo
        </Link>
        <Link
          href="/mural"
          className="w-full py-3.5 rounded-xl border border-white/8
                     text-white/30 text-xs tracking-widest uppercase text-center
                     hover:text-white/50 hover:border-white/15
                     transition-all duration-200"
        >
          view the mural
        </Link>
        <Link
          href="/me"
          className="w-full py-3 text-white/20 text-xs tracking-widest uppercase
                     text-center hover:text-white/40 transition-colors duration-200"
        >
          your echoes →
        </Link>
      </div>
    </main>
  );
}
