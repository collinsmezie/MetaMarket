'use client';

import { getApiBase } from './api';

interface QueuedEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  stack?: string;
  url: string;
  sessionId: string;
  timestamp: string;
}

let queue: QueuedEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

function getSessionId(): string {
  try {
    return localStorage.getItem('amke_chat_session_id') || 'no-session';
  } catch {
    return 'no-session';
  }
}

function stringifyArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

function flush() {
  flushTimer = null;
  if (queue.length === 0) return;
  const entries = queue;
  queue = [];
  const body = JSON.stringify({ entries });
  const endpoint = `${getApiBase()}/telemetry/client-log`;
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch {
    // Never let log shipping break the app.
  }
}

function enqueue(level: QueuedEntry['level'], message: string, stack?: string) {
  queue.push({ level, message, stack, url: window.location.pathname, sessionId: getSessionId(), timestamp: new Date().toISOString() });
  if (!flushTimer) flushTimer = setTimeout(flush, 1500);
  if (queue.length >= 25) flush();
}

/**
 * Mirrors browser console output and uncaught errors to the backend so the
 * full client + server system operation is visible in one unified log.
 */
export function initClientLogger() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  (['log', 'info', 'warn', 'error', 'debug'] as const).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      enqueue(level, stringifyArgs(args));
    };
  });

  window.addEventListener('error', (event) => {
    enqueue('error', `Uncaught: ${event.message}`, event.error?.stack);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    enqueue('error', `Unhandled rejection: ${reason?.message || reason}`, reason?.stack);
  });

  window.addEventListener('beforeunload', flush);
}
