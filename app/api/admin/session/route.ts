import { adminProtectionEnabled, isAdminRequest } from '@/lib/auth';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return Response.json({ required: adminProtectionEnabled(), authenticated: isAdminRequest(request) });
}
