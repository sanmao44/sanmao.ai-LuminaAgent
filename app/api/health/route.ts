import { offlineSpeechSupported } from '@/lib/clone/offline-speech';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json(
    {
      service: 'sanmao-ai-studio',
      ok: true,
      networkMode: process.env.SANMAO_NETWORK_MODE === 'lan' ? 'lan' : 'local',
      lifecycleEnabled: process.env.SANMAO_LIFECYCLE === '1',
      // 一个在线配音模型都没配时，客户端据此提示「本机离线配音」兜底是否可用。
      offlineSpeech: offlineSpeechSupported(),
      time: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
