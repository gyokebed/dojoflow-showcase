/*
 * Exhibit from the private repository gyokebed/arquitechta-core @ fc229b40
 * Original path: packages/server/src/agents/nodes/draft.node.ts
 * Part of the DojoFlow engineering showcase — read-only excerpt.
 * The full production codebase (124K LOC TS) remains private; time-boxed
 * access available on request.
 */

import { AiService } from '../../ai/ai.service';
import { LangfuseGenerationMetadata } from '../../ai/langfuse.service';
import { AnnouncementGraphState } from '../announcement.state';
import {
  buildDraftSystemPrompt,
  buildInitialDraftPrompt,
  buildRedraftPrompt,
} from '../prompts/announcement.prompt';

export interface DraftNodeGuardrails {
  maxModelCalls: number;
}

// generateText resolves null only when AiService is not configured; a real
// API error throws. Every node must always resolve (never reject) so the
// service's outer catch is unambiguous -- its only job is the GRAPH_TIMEOUT_MS
// race, not guessing why invoke() rejected.
//
// `metadata` (tenantId/userId) is closed over here for Langfuse tracing only
// -- it deliberately never enters AnnouncementGraphState, preserving Week 3's
// tenant-isolation guarantee that no tenant data flows through graph state.
export function buildDraftNode(
  aiService: AiService,
  guardrails: DraftNodeGuardrails,
  metadata?: LangfuseGenerationMetadata,
) {
  return async function draftNode(
    state: AnnouncementGraphState,
  ): Promise<Partial<AnnouncementGraphState>> {
    if (state.failureReason) {
      return {};
    }
    if (state.modelCallsUsed >= guardrails.maxModelCalls) {
      return { failureReason: 'MODEL_CALL_CEILING_EXCEEDED' };
    }

    const prompt = state.reviewFeedback
      ? buildRedraftPrompt(state.topic, state.draftText, state.reviewFeedback)
      : buildInitialDraftPrompt(state.topic);

    let text: string | null;
    try {
      text = await aiService.generateText(prompt, buildDraftSystemPrompt(), {
        name: 'announcement-draft',
        metadata,
      });
    } catch {
      return { failureReason: 'MODEL_ERROR' };
    }

    if (text === null) {
      return { failureReason: 'MODEL_UNAVAILABLE' };
    }

    return { draftText: text, modelCallsUsed: state.modelCallsUsed + 1 };
  };
}
