export const runtime = 'nodejs';

export async function GET() {
  return Response.json(
    {
      service: 'sanmao-ai-studio',
      ok: true,
      networkMode: process.env.SANMAO_NETWORK_MODE === 'lan' ? 'lan' : 'local',
      time: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
