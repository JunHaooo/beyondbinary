export async function GET() {
    return Response.json({
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      keyLength: process.env.GEMINI_API_KEY?.length,
      keyPrefix: process.env.GEMINI_API_KEY?.substring(0, 10) + '...'
    });
  }