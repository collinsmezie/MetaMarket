'use client';

import { useEffect } from 'react';
import { initClientLogger } from '@/lib/clientLogger';

export function ClientLoggerInit() {
  useEffect(() => {
    initClientLogger();
  }, []);
  return null;
}
