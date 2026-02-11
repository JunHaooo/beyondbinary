import Link from "next/link";
import Mural from "@/components/Mural";
import SiriRecorder from "@/components/SiriRecorder";

export default function MuralPage() {
  return (
    <div className="relative w-full h-screen overflow-hidden">
      <Mural />

      {/* Back button — top-left */}
      <Link
        href="/"
        className="fixed top-6 left-6 z-10
                   text-white/40 text-xs tracking-widest uppercase
                   hover:text-white/60 transition-colors"
      >
        ← back
      </Link>

      {/* Title — top-center */}
      <div className="fixed top-6 left-1/2 -translate-x-1/2 pointer-events-none z-10">
        <span className="text-white/40 text-xs tracking-[0.4em] uppercase">
          echo
        </span>
      </div>

      {/* Me link — top-right */}
      <Link
        href="/me"
        className="fixed top-6 right-6 z-10
                   text-white/30 text-xs tracking-widest uppercase
                   hover:text-white/55 transition-colors"
        aria-label="Your echoes"
      >
        me
      </Link>

      {/* FAB — bottom-right */}
      <Link
        href="/submit"
        className="fixed bottom-8 right-8 z-10
                   w-12 h-12 rounded-full
                   bg-[#6366f1]/15 border border-[#6366f1]/35
                   flex items-center justify-center
                   text-[#6366f1] text-2xl leading-none
                   hover:bg-[#6366f1]/25 hover:border-[#6366f1]/55
                   transition-all duration-200 backdrop-blur-sm"
        aria-label="Submit an echo"
      >
        +
      </Link>
    </div>
  );
}
