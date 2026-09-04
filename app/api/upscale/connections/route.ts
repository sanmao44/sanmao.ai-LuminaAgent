import { isAdminRequest } from '@/lib/auth';
import { getPublicState, getUpscaleConnectionWithCredentials, saveUpscaleConnection, type UpscaleConnectionCredentials } from '@/lib/store';
import { createUpscaleProvider, isUpscaleProviderError, UpscaleProviderError } from '@/lib/upscale-providers';
import type { UpscaleProviderId } from '@/lib/types';
import { beginRuntimeRequest, RuntimeDrainingError } from '@/lib/runtime-operation';

export const runtime = 'nodejs';

function providerId(value: unknown): UpscaleProviderId | null {
  return value === 'tencent-ci' || value === 'aliyun-viapi' ? value : null;
}

function credentialsFromBody(provider: UpscaleProviderId, body: Record<string, unknown>, saved: Awaited<ReturnType<typeof getUpscaleConnectionWithCredentials>>) {
  const value = (key: string, fallback = '') => String(body[key] || fallback).trim();
  return provider === 'tencent-ci'
    ? { provider, secretId: value('secretId', saved?.secretId), secretKey: value('secretKey', saved?.secretKey), bucket: value('bucket', saved?.bucket), region: value('region', saved?.region) } satisfies UpscaleConnectionCredentials
    : { provider, accessKeyId: value('accessKeyId', saved?.accessKeyId), accessKeySecret: value('accessKeySecret', saved?.accessKeySecret) } satisfies UpscaleConnectionCredentials;
}

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  return Response.json((await getPublicState()).upscaleConnections, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  let releaseRuntimeRequest = async () => {};
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('upscale-connection-test');
    const body = await request.json() as Record<string, unknown>;
    const providerIdValue = providerId(body.provider);
    if (!providerIdValue) return Response.json({ error: '不支持的高清服务商。' }, { status: 400 });
    const saved = await getUpscaleConnectionWithCredentials(providerIdValue);
    const credentials = credentialsFromBody(providerIdValue, body, saved);
    const provider = createUpscaleProvider(providerIdValue, credentials);
    const result = await provider.testConnection();
    if (providerIdValue === 'tencent-ci' && result.buckets && result.buckets.length === 0) throw new UpscaleProviderError('当前腾讯云账号还没有可用存储桶，请先创建或授权一个存储桶。', 'PERMISSION_DENIED');
    if (providerIdValue === 'tencent-ci' && result.buckets && result.buckets.length > 1 && !credentials.bucket) {
      return Response.json({ ok: false, requiresBucketSelection: true, provider: providerIdValue, buckets: result.buckets }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const selectedBucket = result.bucket || credentials.bucket;
    const selectedRegion = result.region || credentials.region;
    const savedConnection = await saveUpscaleConnection({ ...credentials, ...(selectedBucket ? { bucket: selectedBucket } : {}), ...(selectedRegion ? { region: selectedRegion } : {}) }, 'healthy');
    return Response.json({ ok: true, connection: { provider: savedConnection.provider }, state: await getPublicState() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof RuntimeDrainingError) return Response.json({ error: error.message, retryable: true }, { status: 409 });
    const providerError = isUpscaleProviderError(error) ? error : null;
    const errorMessage = error instanceof Error ? error.message : '高清服务连接失败。';
    const requiresBucketSetup = errorMessage.includes('存储桶') || errorMessage.includes('COS');
    return Response.json({ error: errorMessage, code: providerError?.code, ...(requiresBucketSetup ? { requiresBucketSetup: true } : {}) }, { status: providerError?.status && providerError.status >= 400 ? providerError.status : 502, headers: { 'Cache-Control': 'no-store' } });
  } finally {
    await releaseRuntimeRequest();
  }
}
