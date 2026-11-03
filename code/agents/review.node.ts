/*
 * Exhibit from the private repository gyokebed/arquitechta-core @ fc229b40
 * Original path: packages/server/src/agents/nodes/review.node.ts
 * Part of the DojoFlow engineering showcase — read-only excerpt.
 * The full production codebase (124K LOC TS) remains private; time-boxed
 * access available on request.
 */

import { AiService } from '../../ai/ai.service';
import { LangfuseGenerationMetadata } from '../../ai/langfuse.service';
import { AnnouncementGraphState } from '../announcement.state';
import {
  announcementReviewSchema,
  AnnouncementReview,
} from '../schemas/announcement-review.schema';
import {
  buildReviewPrompt,
  buildReviewSystemPrompt,
} from '../prompts/announcement.prompt';

export interface ReviewNodeGuardrails {
  maxRetries: number;
  maxModelCalls: number;
}

// See draft.node.ts: metadata is closed over for tracing only, never added
// to AnnouncementGraphState.
export function buildReviewNode(
  aiService: AiService,
  guardrails: ReviewNodeGuardrails,
  metadata?: LangfuseGenerationMetadata,
) {
  return async function reviewNode(
    state: AnnouncementGraphState,
  ): Promise<Partial<AnnouncementGraphState>> {
    if (state.failureReason) {
      return {};
    }
    if (state.modelCallsUsed >= guardrails.maxModelCalls) {
      return { failureReason: 'MODEL_CALL_CEILING_EXCEEDED' };
    }

    let result: AnnouncementReview | null;
    try {
      result = await aiService.generateObject(
        announcementReviewSchema,
        buildReviewPrompt(state.topic, state.draftText ?? ''),
        buildReviewSystemPrompt(),
        { name: 'announcement-review', metadata },
      );
    } catch {
      return { failureReason: 'MODEL_ERROR' };
    }

    if (result === null) {
      return { failureReason: 'MODEL_UNAVAILABLE' };
    }

    const modelCallsUsed = state.modelCallsUsed + 1;

    if (result.approved) {
      return {
        reviewApproved: true,
        reviewFeedback: result.feedback,
        modelCallsUsed,
      };
    }

    if (state.retryCount >= guardrails.maxRetries) {
      return {
        reviewFeedback: result.feedback,
        failureReason: 'MAX_RETRIES_EXCEEDED',
        modelCallsUsed,
      };
    }

    return {
      reviewFeedback: result.feedback,
      retryCount: state.retryCount + 1,
      modelCallsUsed,
    };
  };
}
