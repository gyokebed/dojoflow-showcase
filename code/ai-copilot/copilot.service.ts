/*
 * Exhibit from the private repository gyokebed/arquitechta-core @ fc229b40
 * Original path: packages/server/src/copilot/copilot.service.ts
 * Part of the DojoFlow engineering showcase — read-only excerpt.
 * The full production codebase (124K LOC TS) remains private; time-boxed
 * access available on request.
 */

import {
  Injectable,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import type { StreamTextResult, ToolSet } from 'ai';
import { AiService } from '../ai/ai.service';
import { AttendanceService } from '../domain/attendance/attendance.service';
import { MembershipsService } from '../memberships/memberships.service';
import { StudentsService } from '../domain/students/students.service';
import { SessionsService } from '../domain/sessions/sessions.service';
import { AgentsService } from '../agents/agents.service';
import { buildCopilotTools } from '../ai/tools';
import { copilotAnswerSchema } from './copilot-answer.schema';
import {
  buildCopilotSystemPrompt,
  buildCopilotStructuringSystemPrompt,
  buildCopilotFinalizePrompt,
} from './prompts/copilot.prompt';
import { CopilotAskResponseDto } from './dto/copilot-answer-response.dto';

const MAX_TOOL_CALLS_PER_REQUEST = 3;

@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);

  constructor(
    private readonly aiService: AiService,
    private readonly attendanceService: AttendanceService,
    private readonly membershipsService: MembershipsService,
    private readonly studentsService: StudentsService,
    private readonly sessionsService: SessionsService,
    private readonly agentsService: AgentsService,
  ) {}

  async ask(
    question: string,
    tenantId: string,
    userId: string,
  ): Promise<CopilotAskResponseDto> {
    if (!this.aiService.isConfigured) {
      throw new ServiceUnavailableException('AI copilot is not configured.');
    }

    const tools = buildCopilotTools(tenantId, userId, {
      attendanceService: this.attendanceService,
      membershipsService: this.membershipsService,
      studentsService: this.studentsService,
      sessionsService: this.sessionsService,
      agentsService: this.agentsService,
    });

    const toolResult = await this.aiService.generateWithTools({
      prompt: question,
      systemPrompt: buildCopilotSystemPrompt(),
      tools,
      maxToolCalls: MAX_TOOL_CALLS_PER_REQUEST,
      langfuse: { name: 'copilot-qa', metadata: { tenantId, userId } },
    });

    if (!toolResult) {
      throw new ServiceUnavailableException(
        'AI copilot did not return an answer.',
      );
    }

    const structured = await this.aiService.generateObject(
      copilotAnswerSchema,
      buildCopilotFinalizePrompt(question, toolResult.text),
      buildCopilotStructuringSystemPrompt(),
      { name: 'copilot-qa-structuring', metadata: { tenantId, userId } },
    );

    // Graceful degrade: if the strict structuring pass fails/returns null
    // (e.g. schema violation, refusal), fall back to the raw phase-1 text
    // rather than discarding an otherwise-successful answer.
    if (!structured) {
      this.logger.warn(
        'Structuring pass returned null; falling back to raw text answer',
      );
    }
    const answer = structured ?? { answer: toolResult.text, keyNumbers: [] };

    return {
      question,
      answer: answer.answer,
      keyNumbers: answer.keyNumbers ?? [],
      toolCallsUsed: toolResult.toolCallsUsed,
      toolCallLimitReached: toolResult.toolCallLimitReached,
    };
  }

  /**
   * Streaming counterpart to ask(). Drops the generateObject structuring
   * pass entirely -- the model's tool-calling already happens within one
   * streamText call, so the client gets the final prose answer directly.
   */
  async streamAsk(
    question: string,
    tenantId: string,
    userId: string,
    options?: { abortSignal?: AbortSignal },
  ): Promise<StreamTextResult<ToolSet, never>> {
    if (!this.aiService.isConfigured) {
      throw new ServiceUnavailableException('AI copilot is not configured.');
    }

    const tools = buildCopilotTools(tenantId, userId, {
      attendanceService: this.attendanceService,
      membershipsService: this.membershipsService,
      studentsService: this.studentsService,
      sessionsService: this.sessionsService,
      agentsService: this.agentsService,
    });

    const streamResult = await this.aiService.streamWithTools({
      prompt: question,
      systemPrompt: buildCopilotSystemPrompt(),
      tools,
      maxToolCalls: MAX_TOOL_CALLS_PER_REQUEST,
      abortSignal: options?.abortSignal,
      langfuse: {
        name: 'copilot-qa-streaming',
        metadata: { tenantId, userId },
      },
    });

    if (!streamResult) {
      throw new ServiceUnavailableException(
        'AI copilot did not return a stream.',
      );
    }

    return streamResult;
  }
}
