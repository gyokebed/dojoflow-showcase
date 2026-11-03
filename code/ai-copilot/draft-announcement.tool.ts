/*
 * Exhibit from the private repository gyokebed/arquitechta-core @ fc229b40
 * Original path: packages/server/src/ai/tools/draft-announcement.tool.ts
 * Part of the DojoFlow engineering showcase — read-only excerpt.
 * The full production codebase (124K LOC TS) remains private; time-boxed
 * access available on request.
 */

import { z } from 'zod';
import { AgentsService } from '../../agents/agents.service';
import { AiToolDefinition } from './tool.types';

const draftAnnouncementParams = z.object({
  topic: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'What the announcement should be about, e.g. "the new Saturday schedule".',
    ),
});
type DraftAnnouncementParams = z.infer<typeof draftAnnouncementParams>;

export function buildDraftAnnouncementTool(
  tenantId: string,
  userId: string,
  agentsService: AgentsService,
): AiToolDefinition<DraftAnnouncementParams> {
  return {
    description:
      'Drafts a member-facing announcement about the given topic, runs it through automatic self-review (redrafting once if flagged), and if it passes queues it for OWNER/ADMIN approval. Does NOT send anything to members.',
    parameters: draftAnnouncementParams,
    execute: async (args) => {
      const run = await agentsService.startAnnouncementDraft(
        tenantId,
        userId,
        args.topic,
      );
      return {
        status: run.status,
        draftPreview: run.draftText ? run.draftText.slice(0, 200) : null,
        agentRunId: run.id,
        failureReason: run.failureReason ?? null,
      };
    },
  };
}
