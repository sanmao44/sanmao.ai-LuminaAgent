export const runtime = 'nodejs';

export async function GET() {
  return Response.json(
    {
      service: 'sanmao-ai-studio',
      ok: true,
      networkMode: process.env.SANMAO_NETWORK_MODE === 'lan' ? 'lan' : 'local',
      lifecycleEnabled: process.env.SANMAO_LIFECYCLE === '1',
      time: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
