import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@anthropic-ai/claude-agent-sdk'],
  outputFileTracingRoot: path.resolve(process.cwd()),
  outputFileTracingIncludes: {
    '/api/canvas/video-trim': ['./node_modules/ffmpeg-static/ffmpeg*'],
    '/api/canvas/video-depth/probe': ['./node_modules/ffmpeg-static/ffmpeg*'],
    '/api/canvas/video-depth/encode': ['./node_modules/ffmpeg-static/ffmpeg*'],
  },
  webpack(config, { isServer, nextRuntime }) {
    if (isServer) {
      const currentExternals = config.externals;
      const serverExternals = [
        { sharp: 'commonjs sharp' },
        { 'ffmpeg-static': 'commonjs ffmpeg-static' },
        ...(nextRuntime === 'edge' ? [{ './instrumentation.node': 'commonjs ./instrumentation.node' }] : []),
      ];
      config.externals = currentExternals
        ? [...(Array.isArray(currentExternals) ? currentExternals : [currentExternals]), ...serverExternals]
        : serverExternals;
    }
    return config;
  },
  headers: async () => [
    {
      source: '/',
      headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0, must-revalidate' }],
    },
    {
      source: '/canvas',
      headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0, must-revalidate' }],
    },
  ],
};

export default nextConfig;
