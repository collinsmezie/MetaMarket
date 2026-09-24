import { END, START, StateGraph, type BaseCheckpointSaver } from '@langchain/langgraph';
import { isPlanSettled } from '../../domain/scheduler-policy';
import type { ConversationGraphNodes } from '../conversation-graph.nodes';
import { ConversationGraphState, type ConversationGraphStateType } from './conversation-graph.state';

/**
 * The conversation orchestrator graph (MCOS TDR §11 topology).
 *
 *   START → ingest → fastPath ─┬─ handled ──────────────────────────────→ deliver → commit → END
 *                              ├─ empty input ─────────────→ responsePlan → compose → deliver → commit
 *                              ├─ tapped workflow/system action → plan → …
 *                              └─ understand → idce ∥ csre → joinUnderstanding ─┬─ ready → plan → clarifyGate → schedule → execute ⟲ → responsePlan
 *                                                                              └─ not ready → triage → responsePlan
 *
 * Understanding fans out to IDCE and CSRE in one superstep (§65.3) and joins before anything
 * routes (§13). The schedule/execute loop runs until the plan is settled (§17, §24).
 */
export function buildConversationGraph(nodes: ConversationGraphNodes, checkpointer: BaseCheckpointSaver) {
  return new StateGraph(ConversationGraphState)
    .addNode('ingest', (state, config) => nodes.ingest(state, config))
    .addNode('fastPathCheck', (state, config) => nodes.fastPath(state, config))
    .addNode('idceSpecialist', (state, config) => nodes.idceNode(state, config))
    .addNode('csreSpecialist', (state, config) => nodes.csreNode(state, config))
    .addNode('joinUnderstanding', (state, config) => nodes.joinUnderstanding(state, config))
    .addNode('triage', (state) => nodes.triage(state))
    .addNode('planActions', (state, config) => nodes.plan(state, config))
    .addNode('clarifyGate', (state, config) => nodes.clarifyGate(state, config))
    .addNode('schedule', (state) => nodes.schedule(state))
    .addNode('execute', (state, config) => nodes.execute(state, config))
    .addNode('responsePlan', (state, config) => nodes.responsePlan(state, config))
    .addNode('compose', (state, config) => nodes.compose(state, config))
    .addNode('deliver', (state, config) => nodes.deliver(state, config))
    .addNode('commit', (state, config) => nodes.commit(state, config))
    .addEdge(START, 'ingest')
    .addEdge('ingest', 'fastPathCheck')
    .addConditionalEdges('fastPathCheck', routeAfterFastPath, [
      'idceSpecialist',
      'csreSpecialist',
      'planActions',
      'responsePlan',
      'deliver',
    ])
    .addEdge(['idceSpecialist', 'csreSpecialist'], 'joinUnderstanding')
    .addConditionalEdges(
      'joinUnderstanding',
      (state) => (state.understanding.ready ? 'planActions' : 'triage'),
      ['planActions', 'triage'],
    )
    .addEdge('triage', 'responsePlan')
    .addEdge('planActions', 'clarifyGate')
    .addEdge('clarifyGate', 'schedule')
    .addEdge('schedule', 'execute')
    .addConditionalEdges(
      'execute',
      (state) => (isPlanSettled(state.plan.actions, state.execution) ? 'responsePlan' : 'schedule'),
      ['responsePlan', 'schedule'],
    )
    .addEdge('responsePlan', 'compose')
    .addEdge('compose', 'deliver')
    .addEdge('deliver', 'commit')
    .addEdge('commit', END)
    .compile({ checkpointer });
}

function routeAfterFastPath(state: ConversationGraphStateType): string | string[] {
  switch (state.fastPath.kind) {
    case 'EMPTY_INPUT':
      return 'responsePlan';
    case 'VENDOR_RESPONSE':
      return 'deliver';
    case 'SYSTEM_ACTION':
    case 'WORKFLOW_ACTION':
      return 'planActions';
    default:
      return ['idceSpecialist', 'csreSpecialist'];
  }
}

export type ConversationGraph = ReturnType<typeof buildConversationGraph>;
