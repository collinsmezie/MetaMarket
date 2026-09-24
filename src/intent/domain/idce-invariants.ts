import { EXECUTION_RELATION_TYPES, isIntentType } from './intent-taxonomy';

/**
 * Semantic invariants over a schema-valid IDCE wire resolution (IDCE TDR v1.6 §18.3 rules 7–12,
 * §22.5). JSON Schema checks shape; these checks enforce meaning:
 *
 *  - every intent type belongs to the taxonomy;
 *  - intent ids are unique; every relation endpoint, dependency, related intent, clarification
 *    target and unresolved-issue reference names an intent in this response;
 *  - execution relations (DEPENDS_ON / REQUIRES / PRECEDES) plus `dependencies` are acyclic;
 *  - `clarification.required` ⇔ a question and targets exist;
 *  - confidence/priority lie in [0,1] (schema) and PRIMARY appears at most once per turn.
 *
 * A violation is a typed failure for the runtime's single bounded repair; it is never patched
 * into a guessed intent.
 */

export interface InvariantViolation {
  readonly path: string;
  readonly keyword: string;
  readonly message: string;
  readonly params: Readonly<Record<string, unknown>>;
}

interface WireIntent {
  intent_id: string;
  type: string;
  role: string;
  dependencies: string[];
  related_intents: string[];
}

interface WireResolution {
  intents: WireIntent[];
  relations: { from: string; type: string; to: string }[];
  clarification: { required: boolean; question: string | null; target_intent_ids: string[] } | null;
  unresolved: { issue_id: string; related_intent_ids: string[] }[];
}

export function validateIdceInvariants(payload: unknown): InvariantViolation[] {
  const resolution = payload as WireResolution;
  const violations: InvariantViolation[] = [];
  const ids = new Set<string>();

  resolution.intents.forEach((intent, index) => {
    if (ids.has(intent.intent_id)) {
      violations.push(
        violation(
          `/intents/${index}/intent_id`,
          'unique_intent_id',
          `Duplicate intent_id "${intent.intent_id}"`,
        ),
      );
    }
    ids.add(intent.intent_id);

    if (!isIntentType(intent.type)) {
      violations.push(
        violation(
          `/intents/${index}/type`,
          'intent_taxonomy',
          `"${intent.type}" is not in the IDCE intent taxonomy; use UNKNOWN_INTENT or OUT_OF_SCOPE when no supported objective applies`,
          { type: intent.type },
        ),
      );
    }
  });

  const primaries = resolution.intents.filter((intent) => intent.role === 'PRIMARY');
  if (primaries.length > 1) {
    violations.push(
      violation(
        '/intents',
        'single_primary',
        `Exactly one PRIMARY intent is allowed per turn; found ${primaries.length}`,
        {
          primaries: primaries.map((intent) => intent.intent_id),
        },
      ),
    );
  }

  const known = (id: string) => ids.has(id);

  resolution.intents.forEach((intent, index) => {
    intent.dependencies.forEach((dependency, depIndex) => {
      if (!known(dependency)) {
        violations.push(
          violation(
            `/intents/${index}/dependencies/${depIndex}`,
            'dangling_reference',
            `Unknown intent "${dependency}"`,
          ),
        );
      }
    });
    intent.related_intents.forEach((related, relIndex) => {
      if (!known(related)) {
        violations.push(
          violation(
            `/intents/${index}/related_intents/${relIndex}`,
            'dangling_reference',
            `Unknown intent "${related}"`,
          ),
        );
      }
    });
  });

  resolution.relations.forEach((relation, index) => {
    if (!known(relation.from))
      violations.push(
        violation(`/relations/${index}/from`, 'dangling_reference', `Unknown intent "${relation.from}"`),
      );
    if (!known(relation.to))
      violations.push(
        violation(`/relations/${index}/to`, 'dangling_reference', `Unknown intent "${relation.to}"`),
      );
    if (relation.from === relation.to)
      violations.push(violation(`/relations/${index}`, 'self_relation', 'An intent cannot relate to itself'));
  });

  resolution.unresolved.forEach((issue, index) => {
    issue.related_intent_ids.forEach((id, idIndex) => {
      if (!known(id))
        violations.push(
          violation(
            `/unresolved/${index}/related_intent_ids/${idIndex}`,
            'dangling_reference',
            `Unknown intent "${id}"`,
          ),
        );
    });
  });

  const clarification = resolution.clarification;
  if (clarification !== null) {
    if (clarification.required) {
      if (clarification.question === null || clarification.question.trim().length === 0) {
        violations.push(
          violation('/clarification/question', 'clarification_consistency', 'required=true needs a question'),
        );
      }
      if (clarification.target_intent_ids.length === 0) {
        violations.push(
          violation(
            '/clarification/target_intent_ids',
            'clarification_consistency',
            'required=true needs at least one target intent',
          ),
        );
      }
    } else if (clarification.question !== null || clarification.target_intent_ids.length > 0) {
      violations.push(
        violation(
          '/clarification',
          'clarification_consistency',
          'required=false must have question=null and no target ids (or be null)',
        ),
      );
    }
    clarification.target_intent_ids.forEach((id, idIndex) => {
      if (!known(id))
        violations.push(
          violation(
            `/clarification/target_intent_ids/${idIndex}`,
            'dangling_reference',
            `Unknown intent "${id}"`,
          ),
        );
    });
  }

  const cycle = findExecutionCycle(resolution);
  if (cycle !== null) {
    violations.push(
      violation(
        '/relations',
        'acyclic_dependencies',
        `Execution dependencies form a cycle: ${cycle.join(' → ')}`,
        { cycle },
      ),
    );
  }

  return violations;
}

function findExecutionCycle(resolution: WireResolution): string[] | null {
  const edges = new Map<string, Set<string>>();
  const add = (from: string, to: string) => {
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from)!.add(to);
  };
  for (const intent of resolution.intents)
    for (const dependency of intent.dependencies) add(intent.intent_id, dependency);
  for (const relation of resolution.relations) {
    if ((EXECUTION_RELATION_TYPES as readonly string[]).includes(relation.type))
      add(relation.from, relation.to);
  }

  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (node: string): string[] | null => {
    const current = state.get(node);
    if (current === 'done') return null;
    if (current === 'visiting') {
      const start = stack.indexOf(node);
      return [...stack.slice(start), node];
    }
    state.set(node, 'visiting');
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      const found = visit(next);
      if (found !== null) return found;
    }
    stack.pop();
    state.set(node, 'done');
    return null;
  };

  for (const node of edges.keys()) {
    const found = visit(node);
    if (found !== null) return found;
  }
  return null;
}

function violation(
  path: string,
  keyword: string,
  message: string,
  params: Record<string, unknown> = {},
): InvariantViolation {
  return { path, keyword, message, params };
}
