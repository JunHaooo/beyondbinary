import { NextRequest, NextResponse } from "next/server";
import { SpeechClient } from "@google-cloud/speech";

export const runtime = "nodejs";

function makeClient() {
  const raw = process.env.GOOGLE_CLOUD_KEY_JSON;
  if (!raw) throw new Error("Missing GOOGLE_CLOUD_KEY_JSON");

  const creds = JSON.parse(raw);

  return new SpeechClient({
    credentials: {
      client_email: creds.client_email,
      private_key: creds.private_key,
    },
    projectId: creds.project_id,
  });
}

export async function POST(req: NextRequest) {
  try {
    const { audio } = await req.json();
    if (!audio) {
      return NextResponse.json({ error: "No audio provided." }, { status: 400 });
    }

    const client = makeClient();

    const [resp] = await client.recognize({
      audio: { content: audio },
      config: {
        encoding: "WEBM_OPUS",
        languageCode: "en-US",
        enableAutomaticPunctuation: true,
      },
    } as any);

    const text =
      resp.results?.map((r: any) => r.alternatives?.[0]?.transcript).filter(Boolean).join(" ")
      || "";

    return NextResponse.json({ text });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message || "Transcription failed." }, { status: 500 });
  }
}
