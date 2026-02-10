'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import BlobPreview from '@/components/BlobPreview';
import { getUserId } from '@/lib/user';

const MAX_CHARS = 284;

interface BlobResult {
  id: string;
  color: string;
  shape: 'spiky' | 'smooth' | 'jagged';
  x: number;
  y: number;
  intensity: number;
  category: string;
}

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function SubmitPage() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<BlobResult | null>(null);
  const [visible, setVisible] = useState(false); // drives the fade-in
  const router = useRouter();
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const remaining = MAX_CHARS - text.length;
  const isOverLimit = remaining < 0;
  const isEmpty = text.trim().length === 0;

  // Fade in success state and schedule redirect
  useEffect(() => {
    if (status !== 'success') return;
    requestAnimationFrame(() => setVisible(true));
    redirectTimer.current = setTimeout(() => router.push('/mural'), 3000);
    return () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, [status, router]);

  const handleSubmit = async () => {
    if (isEmpty || isOverLimit || status !== 'idle') return;

    setStatus('loading');
    try {
      const res = await fetch('/api/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), user_id: getUserId() }),
      });

      if (!res.ok) throw new Error('api error');

      const data: BlobResult = await res.json();
      setResult(data);
      setStatus('success');
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2000);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
  };

  // ── Success view ─────────────────────────────────────────────────────────
  if (status === 'success' && result) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center gap-8 p-6">
        <div
          className={`flex flex-col items-center gap-6 transition-opacity duration-700 ${
            visible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <BlobPreview id={result.id} color={result.color} shape={result.shape} />

          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-white/70 text-sm tracking-wide">
              your echo is out there
            </p>
            <p className="text-white/20 text-xs tracking-widest uppercase">
              returning to mural...
            </p>
          </div>

          <button
            onClick={() => {
              if (redirectTimer.current) clearTimeout(redirectTimer.current);
              router.push('/mural');
            }}
            className="text-white/30 text-xs tracking-widest uppercase hover:text-white/60 transition-colors"
          >
            go now →
          </button>
        </div>
      </div>
    );
  }

  // ── Input view ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col p-6">
      {/* Nav */}
      <div className="flex items-center justify-between mb-12">
        <Link
          href="/mural"
          className="text-white/40 text-xs tracking-widest uppercase hover:text-white/50 transition-colors"
        >
          ← back
        </Link>
        <span className="text-white/40 text-xs tracking-[0.4em] uppercase">
          echo
        </span>
        <Link
          href="/me"
          className="text-white/25 text-xs tracking-widest uppercase hover:text-white/45 transition-colors"
        >
          me
        </Link>
      </div>

      {/* Form */}
      <div className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto gap-5">
        <p className="text-white/55 text-sm leading-relaxed">
          say what you feel.
        </p>

        {/* Textarea */}
        <div className="relative">
          <textarea
            autoFocus
            rows={6}
            maxLength={MAX_CHARS}
            placeholder="something happened today..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={status === 'loading'}
            className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-4
                       text-white/80 placeholder-white/15 text-sm leading-relaxed
                       resize-none focus:outline-none focus:border-white/20
                       disabled:opacity-40 transition-colors"
          />
          {/* Char counter */}
          <span
            className={`absolute bottom-3 right-4 text-xs tabular-nums transition-colors ${
              remaining <= 20
                ? remaining <= 5
                  ? 'text-red-400/70'
                  : 'text-amber-400/60'
                : 'text-white/20'
            }`}
          >
            {remaining}
          </span>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={isEmpty || isOverLimit || status === 'loading'}
          className="w-full py-3.5 rounded-xl border border-white/10 text-sm
                     tracking-widest uppercase transition-all
                     text-white hover:text-white/80 hover:border-white/20
                     disabled:opacity-25 disabled:cursor-not-allowed"
        >
          {status === 'loading' ? (
            <span className="animate-pulse">thinking...</span>
          ) : status === 'error' ? (
            <span className="text-red-400/70">something went wrong</span>
          ) : (
            'release'
          )}
        </button>

        <p className="text-white/20 text-xs text-center">
          ⌘ + enter to release
        </p>
      </div>
    </div>
  );
}
