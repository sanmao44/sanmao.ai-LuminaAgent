import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(process.cwd()),
  outputFileTracingIncludes: {
    '/api/canvas/video-trim': ['./node_modules/ffmpeg-static/ffmpeg*'],
    '/api/canvas/video-depth/probe': ['./node_modules/ffmpeg-static/ffmpeg*'],
    '/api/canvas/video-depth/encode': ['./node_modules/ffmpeg-static/ffmpeg*'],
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
