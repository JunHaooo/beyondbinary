"use client";

import { useRef, useState } from "react";

type SpeechResponse = { text?: string; error?: string };

interface SiriRecorderProps {
  onTranscript?: (text: string) => void;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default function SiriRecorder({ onTranscript }: SiriRecorderProps) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "listening" | "transcribing" | "error"
  >("idle");
  const [transcript, setTranscript] = useState("");

  const start = async () => {
    try {
      setTranscript("");
      setStatus("listening");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        try {
          setStatus("transcribing");

          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          const arrayBuffer = await blob.arrayBuffer();
          const base64 = arrayBufferToBase64(arrayBuffer);

          const res = await fetch("/api/speech", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio: base64 }),
          });

          const data = (await res.json()) as SpeechResponse;

          if (!res.ok || data.error) {
            setStatus("error");
            setTranscript(data.error || "Transcription failed.");
          } else {
            const finalText = data.text || "";
            setStatus("idle");
            setTranscript(finalText);

            // 🔥 Push transcript to parent (Submit page)
            if (onTranscript && finalText.trim()) {
              onTranscript(finalText);
            }
          }
        } catch {
          setStatus("error");
          setTranscript("Transcription failed.");
        } finally {
          streamRef.current?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
      };

      recorder.start();
      setRecording(true);
    } catch {
      setStatus("error");
      setTranscript("Mic permission denied or unavailable.");
      setRecording(false);
    }
  };

  const stop = () => {
    recorderRef.current?.stop();
    setRecording(false);
  };

  const toggle = () => {
    recording ? stop() : start();
  };

  const hint =
    status === "listening"
      ? "Listening…"
      : status === "transcribing"
      ? "Transcribing…"
      : status === "error"
      ? "Error"
      : transcript
      ? "Transcript"
      : "Tap to speak";

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[9999]">
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl backdrop-blur-md
                      bg-black/35 border border-white/10 shadow-[0_12px_40px_rgba(0,0,0,0.35)]
                      w-[min(520px,calc(100vw-2rem))]">

        <button
          onClick={toggle}
          className={`w-11 h-11 rounded-full flex items-center justify-center
                      border transition-all
                      ${
                        recording
                          ? "bg-red-500/15 border-red-400/40 text-red-200"
                          : "bg-white/5 border-white/15 text-white/80 hover:bg-white/10"
                      }`}
        >
          {recording ? "■" : "●"}
        </button>

        <div className="flex-1 min-w-0">
          <div className="text-white/50 text-[11px] tracking-[0.25em] uppercase">
            {hint}
          </div>

          <div className="mt-1 text-white/85 text-sm leading-snug break-words">
            {transcript || "Your transcript will appear here."}
          </div>
        </div>
      </div>
    </div>
  );
}
