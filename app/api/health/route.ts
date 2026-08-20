export const runtime = 'nodejs';

export async function GET() {
  return Response.json(
    {
      service: 'sanmao-ai-studio',
      ok: true,
      time: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
