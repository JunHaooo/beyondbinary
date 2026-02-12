import { GoogleGenerativeAI } from '@google/generative-ai';
import { pipeline, FeatureExtractionPipeline } from '@xenova/transformers';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export interface EmotionAnalysis {
  color: string;
  shape: 'spiky' | 'smooth' | 'jagged';
  intensity: number;
  category: 'work' | 'relationships' | 'self';
  embedding: number[];
}

type GeminiEmotion = Omit<EmotionAnalysis, 'embedding'>;

// Lazy-loaded pipeline — initialised once and reused
let embedder: FeatureExtractionPipeline | null = null;

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!embedder) {
    embedder = await pipeline(
      'feature-extraction',
      'Xenova/paraphrase-MiniLM-L6-v2'
    ) as FeatureExtractionPipeline;
  }
  return embedder;
}

async function analyseEmotion(message: string): Promise<GeminiEmotion> {
  const fallback: GeminiEmotion = {
    color: '#888888',
    shape: 'smooth',
    intensity: 5,
    category: 'self',
  };

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `You are an emotion-to-art translator. Analyze this emotional expression and return ONLY valid JSON with no markdown formatting.

Rules for mapping:
- shape: "spiky" for sharp emotions (anger, anxiety, frustration), "smooth" for soft emotions (sadness, contentment, peace), "jagged" for chaotic emotions (overwhelm, confusion, panic)
- colour: use hex codes - warm colors (#FF4444, #FF8800) for anger/energy, cool colours (#4444FF, #88CCFF) for sadness/calm, dark colours (#663399, #333333) for heavy emotions, bright colours (#FFDD00, #44FF44) for positive emotions. Mix colours if there is a combination of emotions.
- intensity: 1-10 scale, where 1 is barely felt and 10 is overwhelming
- category: "work" for school/job/career, "relationships" for people/family/friends, "self" for internal/identity/health

Message: "${message}"

Return JSON: {"color": "#RRGGBB", "shape": "spiky|smooth|jagged", "intensity": 1-10, "category": "work|relationships|self"}`;

    const result = await model.generateContent(prompt);
    let raw = result.response.text().trim();

    // Strip markdown code fences if present
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');

    const parsed = JSON.parse(raw) as GeminiEmotion;
    return parsed;
  } catch (err) {
    console.error('[ai] Gemini analysis failed:', err);
    return fallback;
  }
}

async function generateEmbedding(message: string): Promise<number[]> {
  try {
    const pipe = await getEmbedder();
    const output = await pipe(message, { pooling: 'mean', normalize: true });
    return Array.from(output.data) as number[];
  } catch (err) {
    console.error('[ai] Embedding generation failed:', err);
    return new Array(384).fill(0);
  }
}

export async function analyseEntry(message: string): Promise<EmotionAnalysis> {
  const [emotion, embedding] = await Promise.all([
    analyseEmotion(message),
    generateEmbedding(message),
  ]);

  return { ...emotion, embedding };
}
