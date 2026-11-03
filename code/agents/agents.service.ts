/*
 * Exhibit from the private repository gyokebed/arquitechta-core @ fc229b40
 * Original path: packages/server/src/agents/agents.service.ts
 * Part of the DojoFlow engineering showcase — read-only excerpt.
 * The full production codebase (124K LOC TS) remains private; time-boxed
 * access available on request.
 */

import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AgentRun, AgentRunStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AiService } from '../ai/ai.service';
import { buildAnnouncementGraph } from './announcement.graph';
import { AnnouncementGraphState } from './announcement.state';
import { GRAPH_TIMEOUT_MS } from './announcement-graph.constants';

// unref() so a pending timeout never keeps the Node process (or a Jest
// worker) alive on its own once the graph settles via the other race branch
// -- this is a background guardrail timer, not real work to wait for.
function timeoutRejection(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('AGENT_RUN_TIMEOUT')), ms);
    timer.unref?.();
  });
}

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  async startAnnouncementDraft(
    tenantId: string,
    userId: string,
    topic: string,
  ): Promise<AgentRun> {
    if (!this.aiService.isConfigured) {
      throw new ServiceUnavailableException('AI copilot is not configured.');
    }

    // Fresh graph instance per invocation -- compiling is cheap (just wires
    // node/edge functions, no model client attached) -- secondary hygiene
    // against LangGraph's known heap-growth issue on long-lived processes.
    const graph = buildAnnouncementGraph(this.aiService, undefined, {
      tenantId,
      userId,
    });
    const initialState: AnnouncementGraphState = {
      topic,
      draftText: null,
      reviewFeedback: null,
      reviewApproved: false,
      retryCount: 0,
      modelCallsUsed: 0,
      failureReason: null,
    };

    let finalState: AnnouncementGraphState;
    try {
      // Nodes always resolve (they catch their own model-call errors), so
      // a rejection here is either the timeout race below or an unexpected
      // LangGraph/runtime failure. Distinguish them: labeling a real graph
      // error TIMEOUT hides the actual cause in the persisted row.
      finalState = await Promise.race([
        graph.invoke(initialState),
        timeoutRejection(GRAPH_TIMEOUT_MS),
      ]);
    } catch (error) {
      const timedOut =
        error instanceof Error && error.message === 'AGENT_RUN_TIMEOUT';
      if (!timedOut) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Announcement graph invocation failed unexpectedly: ${message}`,
        );
      }
      return this.persistRun(
        tenantId,
        userId,
        topic,
        {
          ...initialState,
          failureReason: timedOut ? 'TIMEOUT' : 'GRAPH_ERROR',
        },
        AgentRunStatus.FAILED,
      );
    }

    return this.persistRun(
      tenantId,
      userId,
      topic,
      finalState,
      finalState.failureReason
        ? AgentRunStatus.FAILED
        : AgentRunStatus.PENDING_APPROVAL,
    );
  }

  async listPendingRuns(tenantId: string): Promise<AgentRun[]> {
    return this.prisma.agentRun.findMany({
      where: { tenantId, status: AgentRunStatus.PENDING_APPROVAL },
      orderBy: { createdAt: 'asc' },
    });
  }

  async countPendingRuns(tenantId: string): Promise<number> {
    return this.prisma.agentRun.count({
      where: { tenantId, status: AgentRunStatus.PENDING_APPROVAL },
    });
  }

  async approveRun(
    tenantId: string,
    runId: string,
    approverId: string,
  ): Promise<AgentRun> {
    const run = await this.findPendingRunOrFail(tenantId, runId);
    return this.prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: AgentRunStatus.FINALIZED,
        finalText: run.draftText,
        resolvedByUserId: approverId,
        resolvedAt: new Date(),
      },
    });
  }

  async rejectRun(
    tenantId: string,
    runId: string,
    rejecterId: string,
  ): Promise<AgentRun> {
    const run = await this.findPendingRunOrFail(tenantId, runId);
    return this.prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: AgentRunStatus.REJECTED,
        resolvedByUserId: rejecterId,
        resolvedAt: new Date(),
      },
    });
  }

  private async findPendingRunOrFail(
    tenantId: string,
    runId: string,
  ): Promise<AgentRun> {
    const run = await this.prisma.agentRun.findFirst({
      where: { id: runId, tenantId },
    });
    if (!run) {
      throw new NotFoundException('Agent run not found');
    }
    if (run.status !== AgentRunStatus.PENDING_APPROVAL) {
      throw new ConflictException(
        `Run is not awaiting approval (status: ${run.status})`,
      );
    }
    return run;
  }

  private async persistRun(
    tenantId: string,
    userId: string,
    topic: string,
    state: AnnouncementGraphState,
    status: AgentRunStatus,
  ): Promise<AgentRun> {
    return this.prisma.agentRun.create({
      data: {
        tenantId,
        userId,
        topic,
        status,
        draftText: state.draftText,
        reviewFeedback: state.reviewFeedback,
        retryCount: state.retryCount,
        modelCallsUsed: state.modelCallsUsed,
        failureReason: state.failureReason ?? undefined,
      },
    });
  }
}
