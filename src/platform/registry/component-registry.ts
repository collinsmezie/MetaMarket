/**
 * Deployment contract registry (Overarching TDR §49.1, §49.8; Directive §49.1–§49.2).
 *
 * The single place that declares which component versions and wire/schema versions this build
 * implements. Every specialist adapter stamps its envelopes from here, every persisted decision
 * records these values, and the boot-time preflight fails if a registered schema disagrees with
 * the pinned version. Component version and wire version are deliberately separate: a component
 * revision may harden behaviour without breaking the wire contract.
 */

export const COMPONENTS = {
  MCOS: 'MCOS',
  LANGGRAPH: 'LANGGRAPH',
  IDCE: 'IDCE',
  CSRE: 'CSRE',
  ENRICHMENT: 'ENRICHMENT',
  GPC_RESOLVER: 'GPC_RESOLVER',
  WRS: 'WRS',
  EVIDENCE: 'EVIDENCE',
  MKG: 'MKG',
  CAPABILITY_PROJECTION: 'CAPABILITY_PROJECTION',
  MATCHING_FANOUT: 'MATCHING_FANOUT',
  WORKFLOW: 'WORKFLOW',
  WALLET: 'WALLET',
  PLATFORM: 'PLATFORM',
} as const;

export type ComponentName = (typeof COMPONENTS)[keyof typeof COMPONENTS];

export interface ComponentContract {
  readonly component: ComponentName;
  /** Deployed component/document version (Overarching §49.1). */
  readonly componentVersion: string;
  /** Wire/schema versions this build speaks, keyed by role. */
  readonly wire: Readonly<Record<string, string>>;
  /** `$id`s of the executable schemas that must be registered for this component. */
  readonly schemaIds: readonly string[];
}

export const COMPONENT_REGISTRY: Readonly<Record<ComponentName, ComponentContract>> = {
  MCOS: {
    component: 'MCOS',
    componentVersion: '4.4',
    wire: { internal: '1.0' },
    schemaIds: [],
  },
  LANGGRAPH: {
    component: 'LANGGRAPH',
    componentVersion: '4.4',
    wire: { prompts: '1.0' },
    schemaIds: [],
  },
  IDCE: {
    component: 'IDCE',
    componentVersion: '1.6',
    wire: { output: '1.0', envelope: '1.1' },
    schemaIds: [],
  },
  CSRE: {
    component: 'CSRE',
    componentVersion: '5.4',
    wire: { response: '5.0', request: '5.1' },
    schemaIds: [],
  },
  ENRICHMENT: {
    component: 'ENRICHMENT',
    componentVersion: '4.4',
    wire: { response: '4.0', request: '4.1' },
    schemaIds: [],
  },
  GPC_RESOLVER: {
    component: 'GPC_RESOLVER',
    componentVersion: '4.4',
    wire: { request: '4.0', response: '4.0' },
    schemaIds: [],
  },
  WRS: {
    component: 'WRS',
    componentVersion: '4.4',
    wire: { request: '4.0', response: '4.0' },
    schemaIds: [],
  },
  EVIDENCE: {
    component: 'EVIDENCE',
    componentVersion: '4.4',
    wire: { request: '4.0', response: '4.0' },
    schemaIds: [],
  },
  MKG: {
    component: 'MKG',
    componentVersion: '1.1',
    wire: { graphSchema: '1.0' },
    schemaIds: [],
  },
  CAPABILITY_PROJECTION: {
    component: 'CAPABILITY_PROJECTION',
    componentVersion: '1.0',
    wire: { internal: '1.0' },
    schemaIds: [],
  },
  MATCHING_FANOUT: {
    component: 'MATCHING_FANOUT',
    componentVersion: '1.0',
    wire: { internal: '1.0' },
    schemaIds: [],
  },
  WORKFLOW: {
    component: 'WORKFLOW',
    componentVersion: '1.0',
    wire: { internal: '1.0' },
    schemaIds: [],
  },
  WALLET: {
    component: 'WALLET',
    componentVersion: '1.0',
    wire: { internal: '1.0' },
    schemaIds: [],
  },
  PLATFORM: {
    component: 'PLATFORM',
    componentVersion: '1.0',
    wire: { events: '1.0', trace: '1.0' },
    schemaIds: [],
  },
};

/** Blueprint/directive versions this implementation was built against. */
export const SPECIFICATION_REGISTRY = {
  overarchingBlueprint: '1.3',
  implementationDirective: '1.2',
  finalLock: '2026-09-12',
} as const;

export function componentVersion(component: ComponentName): string {
  return COMPONENT_REGISTRY[component].componentVersion;
}
