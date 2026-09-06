import {
  AdminChatSessionItem,
  AdminSessionDetails,
  AdminWorkflowExecution,
  PromptTemplateItem,
  BusinessAccount,
} from './types';

export const getApiBase = (): string => {
  // 1. Explicit environment variable if configured
  const envUrl = (process.env.NEXT_PUBLIC_API_URL || '').trim();
  if (
    envUrl &&
    envUrl !== 'utml-backend' &&
    envUrl !== 'utml-backend/' &&
    !envUrl.includes('localhost')
  ) {
    const normalized =
      envUrl.startsWith('http://') || envUrl.startsWith('https://')
        ? envUrl
        : `https://${envUrl}`;
    return normalized.replace(/\/$/, '');
  }

  // 2. Dynamic Browser Runtime: Derive public backend FQDN when running on Render
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host.includes('.onrender.com') && host.includes('frontend')) {
      return `https://${host.replace('frontend', 'backend')}`;
    }
  }

  // 3. Fallback for localhost or default local development
  if (
    !envUrl ||
    envUrl === 'utml-backend' ||
    envUrl === 'utml-backend/' ||
    envUrl.includes('localhost')
  ) {
    return 'http://localhost:4000';
  }

  const fallback =
    envUrl.startsWith('http://') || envUrl.startsWith('https://')
      ? envUrl
      : `https://${envUrl}`;
  return fallback.replace(/\/$/, '');
};

export const API_BASE = getApiBase();

export async function resolveBusinessAccount(businessName: string, sessionId?: string): Promise<BusinessAccount> {
  const res = await fetch(`${getApiBase()}/amke/business/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName, sessionId }),
  });
  if (!res.ok) throw new Error(`Business account resolution failed: ${res.statusText}`);
  return await res.json();
}

export async function ingestMarketStream(data: {
  actorId: string;
  actorType: 'SELLER' | 'BUYER';
  rawMessySpeech: string;
  actorName?: string;
  actorLocation?: string;
  actorPhone?: string;
  businessRole?: string;
  businessName?: string;
  businessAccountId?: string;
  chatMode?: 'BUYER' | 'VENDOR';
  sessionId?: string;
  chatHistory?: Array<{ sender: string; text: string; role?: string }>;
}) {
  const res = await fetch(`${getApiBase()}/amke/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Stream ingestion failed: ${res.statusText}`);
  const payload = await res.json();
  if (payload?.success === false) throw new Error(payload.message || payload.error || 'Stream ingestion failed');
  return payload;
}

export async function searchBuyerMarketplace(data: {
  buyerId: string;
  rawSearchQuery: string;
  buyerLocation?: string;
  businessName?: string;
  businessAccountId?: string;
  chatMode?: 'BUYER' | 'VENDOR';
  sessionId?: string;
  chatHistory?: Array<{ sender: string; text: string; role?: string }>;
}) {
  const res = await fetch(`${getApiBase()}/amke/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Buyer search failed: ${res.statusText}`);
  const payload = await res.json();
  if (payload?.success === false) throw new Error(payload.message || payload.error || 'Buyer search failed');
  return payload;
}

export async function evaluateHydration(rawInputText: string) {
  const res = await fetch(`${getApiBase()}/amke/evaluate-hydration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawInputText }),
  });
  if (!res.ok) throw new Error(`Hydration evaluation failed: ${res.statusText}`);
  return await res.json();
}

export async function synthesizeIntent(data: {
  originalInput: string;
  probingQuestion: string;
  userClarification: string;
}) {
  const res = await fetch(`${getApiBase()}/amke/synthesize-intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Intent synthesis failed: ${res.statusText}`);
  return await res.json();
}

export async function getGraphState(limit = 150) {
  const res = await fetch(`${getApiBase()}/amke/graph-state?limit=${limit}`);
  if (!res.ok) throw new Error(`Graph state fetch failed: ${res.statusText}`);
  return await res.json();
}

export async function getConceptsCatalog() {
  const res = await fetch(`${getApiBase()}/amke/concepts`);
  if (!res.ok) throw new Error(`Concepts fetch failed: ${res.statusText}`);
  return await res.json();
}

export async function getSupplyDemandGaps() {
  const res = await fetch(`${getApiBase()}/amke/analytics/supply-demand-gaps`);
  if (!res.ok) throw new Error(`Supply gaps fetch failed: ${res.statusText}`);
  return await res.json();
}

export async function getTrainingPairs(limit = 100) {
  const res = await fetch(`${getApiBase()}/amke/analytics/training-pairs?limit=${limit}`);
  if (!res.ok) throw new Error(`Training data fetch failed: ${res.statusText}`);
  return await res.json();
}

export async function getRecentLogs(limit = 50) {
  const res = await fetch(`${getApiBase()}/amke/analytics/recent-logs?limit=${limit}`);
  if (!res.ok) throw new Error(`Logs fetch failed: ${res.statusText}`);
  return await res.json();
}

// ==========================================
// ADMIN DASHBOARD API CLIENT METHODS
// ==========================================

export async function fetchAdminChats(params?: {
  query?: string;
  actorRole?: string;
  chatMode?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}): Promise<{ totalCount: number; sessions: AdminChatSessionItem[]; messages: any[] }> {
  const queryParams = new URLSearchParams();
  if (params?.query) queryParams.set('query', params.query);
  if (params?.actorRole && params.actorRole !== 'ALL') queryParams.set('actorRole', params.actorRole);
  if (params?.chatMode && params.chatMode !== 'ALL') queryParams.set('chatMode', params.chatMode);
  if (params?.startDate) queryParams.set('startDate', params.startDate);
  if (params?.endDate) queryParams.set('endDate', params.endDate);
  if (params?.limit) queryParams.set('limit', String(params.limit));
  if (params?.offset) queryParams.set('offset', String(params.offset));

  const res = await fetch(`${getApiBase()}/amke/admin/chats?${queryParams.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch admin chats: ${res.statusText}`);
  return await res.json();
}

export async function fetchAdminSession(sessionId: string): Promise<AdminSessionDetails> {
  const res = await fetch(`${getApiBase()}/amke/admin/chats/${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error(`Failed to fetch session ${sessionId}: ${res.statusText}`);
  return await res.json();
}

export async function fetchPromptTemplates(): Promise<PromptTemplateItem[]> {
  const res = await fetch(`${getApiBase()}/amke/admin/prompts`);
  if (!res.ok) throw new Error(`Failed to fetch prompt templates: ${res.statusText}`);
  return await res.json();
}

export async function updatePromptTemplate(
  key: string,
  data: Partial<PromptTemplateItem>
): Promise<PromptTemplateItem> {
  const res = await fetch(`${getApiBase()}/amke/admin/prompts/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update prompt ${key}: ${res.statusText}`);
  return await res.json();
}

export async function fetchWorkflowDetails(workflowId: string): Promise<AdminWorkflowExecution> {
  const res = await fetch(`${getApiBase()}/amke/admin/workflows/${encodeURIComponent(workflowId)}`);
  if (!res.ok) throw new Error(`Failed to fetch workflow ${workflowId}: ${res.statusText}`);
  return await res.json();
}

export async function seedDemoData(): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${getApiBase()}/amke/admin/seed-demo`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Failed to seed demo data: ${res.statusText}`);
  return await res.json();
}

export async function seedTaxonomyData(): Promise<{ success: boolean; message: string; segmentsCount?: number; familiesCount?: number; classesCount?: number }> {
  const res = await fetch(`${getApiBase()}/amke/admin/seed-taxonomy`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Failed to seed taxonomy: ${res.statusText}`);
  return await res.json();
}
