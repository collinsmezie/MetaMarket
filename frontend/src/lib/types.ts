export type ActorRole = 'SELLER' | 'BUYER';
export type ChatMode = 'BUYER' | 'VENDOR';

export interface BusinessAccount {
  id: string;
  uniqueBusinessName: string;
  rawBusinessName: string;
  discriminatorNumber: number;
  createdAt?: string;
  updatedAt?: string;
}

export type PipelineStage =
  | 'STAGE_1_INPUT_RECEIVED'
  | 'STAGE_2_PREFILTER_LOOKUP'
  | 'STAGE_3_CONTEXT_ASSEMBLY'
  | 'STAGE_4_AI_EXTRACTION'
  | 'STAGE_5_GRAPH_TRANSACTION'
  | 'STAGE_COMPLETE'
  | 'STAGE_ERROR';

export interface TelemetryEvent {
  sessionId: string;
  businessAccountId?: string;
  actorId: string;
  actorRole: string;
  chatMode?: ChatMode;
  stage: PipelineStage;
  stageLabel: string;
  timestamp: string;
  durationMs?: number;
  status: 'PENDING' | 'SUCCESS' | 'WARNING' | 'ERROR';
  provider?: string;
  data: {
    rawInput?: string;
    extractedPayload?: any;
    resolvedConcepts?: Array<{ concept: string; score: number; sprouted: boolean }>;
    severedSupplyEdgesCount?: number;
    committedEdgesCount?: number;
    isolatedNoise?: string;
    errorDetails?: string;
    totalDurationMs?: number;
    activeMacroFamilies?: string[];
    candidatesDiscovered?: Array<{ name: string }>;
    antiCollisionBlocked?: Array<{ attemptedConcept: string; targetDomain: string; blockedConcept: string; existingDomain: string }>;
    fulfillmentMatches?: SupplierMatchCard[];
    confidenceScore?: number;
    hydrationTriggered?: boolean;
    hydrationQuestion?: string;
    cypherQuery?: string;
  };
}

export interface ResolvedConceptBadge {
  normalizedName: string;
  resolvedConcept: string;
  parentMacroFamily?: string;
  isNewConcept: boolean;
  score: number;
  unit: string;
  isAvailable: boolean;
}

export interface SupplierMatchCard {
  vendorId: string;
  vendorName: string;
  location: string;
  phone?: string;
  matchedConcept: string;
  unit: string;
  similarityScore: number;
  macroFamily?: string;
  matchType?: 'EXACT' | 'CLUSTER_PEER' | 'MACRO_WHOLESALER';
  matchAccuracyTier?: 'Direct Stock Match' | 'MacroFamily Category Match' | string;
  databaseNodeDistance?: number;
  businessType?: string;
  description?: string;
  rating?: number;
  reviewCount?: number;
  updatedAt?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'bot' | 'system';
  role: ActorRole;
  chatMode?: ChatMode;
  text: string;
  timestamp: string;
  sessionId: string;
  businessAccountId?: string;
  uniqueBusinessName?: string;
  actorName?: string;
  actorLocation?: string;
  hydrationTriggered?: boolean;
  hydrationQuestion?: string;
  quickActionChips?: string[];
  originalInput?: string;
  synthesizedText?: string;
  resolvedConcepts?: ResolvedConceptBadge[];
  parsedConcepts?: any[];
  matchingSuppliers?: SupplierMatchCard[];
  isolatedNoise?: string;
  summaryText?: string;
  telemetryTrace?: TelemetryEvent[];
  isContinuousSearchActive?: boolean;
  radarCorridor?: string;
  radarTarget?: string;
}

export interface GraphNode {
  id: string;
  name: string;
  title?: string;
  code?: string;
  group: 'CONCEPT' | 'PHRASE' | 'SELLER' | 'BUYER' | 'MACRO_FAMILY' | 'GPC_CLASS' | 'GPC_FAMILY' | 'GPC_SEGMENT' | string;
  val: number;
  color?: string;
  details?: any;
  properties?: any;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  label?: string;
  unit?: string;
  value?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface ConceptCatalogItem {
  conceptName: string;
  supplierCount: number;
  demandCount: number;
  phraseCount: number;
  status: 'UNDERSERVED' | 'BALANCED' | 'HIGH_SUPPLY';
  samplePhrases: string[];
}

// ==========================================
// ADMIN DASHBOARD OBSERVABILITY TYPES
// ==========================================

export interface AdminChatSessionItem {
  sessionId: string;
  businessAccountId?: string;
  uniqueBusinessName?: string;
  actorId: string;
  actorRole: 'BUYER' | 'SELLER' | 'VENDOR' | string;
  chatMode?: ChatMode;
  latestMessage: string;
  latestMessageAt: string;
  messageCount: number;
  metadata?: Record<string, any>;
}

export interface AdminWorkflowStage {
  id: string;
  workflowId: string;
  stageName: string;
  stageOrder: number;
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED' | string;
  latencyMs: number;
  inputData: any;
  outputData: any;
  promptKey?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface AdminWorkflowExecution {
  id: string;
  sessionId: string;
  messageId?: string;
  businessAccountId?: string;
  actorId: string;
  actorRole: string;
  chatMode?: ChatMode;
  workflowType: 'INGESTION' | 'BUYER_SEARCH' | 'HYDRATION_EVALUATION' | 'INTENT_SYNTHESIS' | string;
  status: 'PENDING' | 'SUCCESS' | 'REQUIRES_HYDRATION' | 'FAILED' | string;
  totalLatencyMs: number;
  rawInput: string;
  finalOutput?: any;
  createdAt: string;
  stages: AdminWorkflowStage[];
}

export interface AdminRawMessageLog {
  id: string;
  sessionId: string;
  businessAccountId?: string;
  actorId: string;
  actorRole: string;
  chatMode?: ChatMode;
  rawText: string;
  clientIp?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  extractions?: any[];
  businessAccount?: BusinessAccount;
}

export interface AdminSessionDetails {
  sessionId: string;
  businessAccount?: BusinessAccount | null;
  messages: AdminRawMessageLog[];
  workflows: AdminWorkflowExecution[];
}

export interface PromptTemplateItem {
  id: string;
  promptKey: string;
  name: string;
  description?: string;
  systemPrompt: string;
  userTemplate: string;
  modelProvider: string;
  modelName: string;
  temperature: number;
  isActive: boolean;
  version: number;
  updatedAt: string;
  createdAt: string;
}
