/*
 * Exhibit from the private repository gyokebed/arquitechta-core @ fc229b40
 * Original path: packages/server/src/agents/announcement.graph.ts
 * Part of the DojoFlow engineering showcase — read-only excerpt.
 * The full production codebase (124K LOC TS) remains private; time-boxed
 * access available on request.
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import { AiService } from '../ai/ai.service';
import { LangfuseGenerationMetadata } from '../ai/langfuse.service';
import {
  AnnouncementState,
  AnnouncementGraphState,
} from './announcement.state';
import { buildDraftNode } from './nodes/draft.node';
import { buildReviewNode } from './nodes/review.node';
import { prepareApprovalNode, failGuardrailNode } from './nodes/terminal.nodes';
import {
  MAX_RETRIES,
  MAX_MODEL_CALLS_PER_RUN,
} from './announcement-graph.constants';

export interface AnnouncementGraphGuardrails {
  maxRetries: number;
  maxModelCalls: number;
}

export type RouteAfterReview = 'redraft' | 'approve' | 'fail';

export function routeAfterReview(
  state: AnnouncementGraphState,
): RouteAfterReview {
  if (state.failureReason) {
    return 'fail';
  }
  if (state.reviewApproved) {
    return 'approve';
  }
  return 'redraft';
}

// Built fresh per invocation, never cached on the service instance --
// compiling just wires node/edge functions (no model client attached to the
// graph object itself), so this is cheap. No checkpointer is passed: the
// entire Draft<->Review loop runs synchronously inside one .invoke() call,
// per the roadmap's decision to avoid LangGraph's interrupt()/checkpointer
// machinery entirely (see the Week 3 plan for why).
export function buildAnnouncementGraph(
  aiService: AiService,
  guardrails: AnnouncementGraphGuardrails = {
    maxRetries: MAX_RETRIES,
    maxModelCalls: MAX_MODEL_CALLS_PER_RUN,
  },
  metadata?: LangfuseGenerationMetadata,
) {
  return new StateGraph(AnnouncementState)
    .addNode('draft', buildDraftNode(aiService, guardrails, metadata))
    .addNode('review', buildReviewNode(aiService, guardrails, metadata))
    .addNode('prepareApproval', prepareApprovalNode)
    .addNode('failGuardrail', failGuardrailNode)
    .addEdge(START, 'draft')
    .addEdge('draft', 'review')
    .addConditionalEdges('review', routeAfterReview, {
      redraft: 'draft',
      approve: 'prepareApproval',
      fail: 'failGuardrail',
    })
    .addEdge('prepareApproval', END)
    .addEdge('failGuardrail', END)
    .compile();
}
