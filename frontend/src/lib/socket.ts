import { io, Socket } from 'socket.io-client';

export const getWsBase = (): string => {
  // 1. Dynamic Browser Runtime: Always derive public backend FQDN when running on Render
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host.includes('.onrender.com')) {
      return `https://${host.replace('frontend', 'backend')}`;
    }
  }

  let url = (process.env.NEXT_PUBLIC_WS_URL || process.env.NEXT_PUBLIC_API_URL || '').trim();

  // 2. Handle internal Docker service name or localhost fallbacks
  if (!url || url === 'utml-backend' || url === 'utml-backend/' || url.includes('localhost')) {
    url = 'http://localhost:4000';
  } else if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('ws://') && !url.startsWith('wss://')) {
    url = `https://${url}`;
  }
  return url.replace(/\/$/, '');
};

const WS_BASE = getWsBase();

let socket: Socket | null = null;

export function getTelemetrySocket(): Socket {
  if (!socket) {
    socket = io(`${WS_BASE}/telemetry`, {
      transports: ['polling', 'websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      autoConnect: true,
    });
  }
  return socket;
}
