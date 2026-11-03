/*
 * Exhibit from the private repository gyokebed/arquitechta-core @ fc229b40
 * Original path: packages/server/src/agents/agents.service.concurrency.spec.ts
 * Part of the DojoFlow engineering showcase — read-only excerpt.
 * The full production codebase (124K LOC TS) remains private; time-boxed
 * access available on request.
 */

import { AgentsService } from './agents.service';
import { AiService } from '../ai/ai.service';
import { PrismaService } from '../prisma.service';
import { createMockAiService } from '../test/mocks/services.mock';
import { createMockPrismaService } from '../test/mocks/prisma.mock';

// Deliberately does NOT mock ./announcement.graph -- this exercises the real
// buildAnnouncementGraph + a fresh-per-invocation compiled StateGraph, which
// is the actual tenant-isolation guarantee (no tenantId/userId ever enters
// graph state; see announcement.state.ts). A mock AiService that returns a
// FIXED string regardless of input would make cross-tenant contamination
// undetectable, so the mock here echoes the prompt (which embeds `topic`)
// back into the "draft" instead.
describe('AgentsService concurrency / tenant isolation', () => {
  it('does not cross-contaminate draft text between concurrent requests from different tenants', async () => {
    const mockAiService = createMockAiService({
      generateText: jest.fn(async (prompt: string) => `DRAFT: ${prompt}`),
      generateObject: jest
        .fn()
        .mockResolvedValue({ approved: true, feedback: 'Looks good.' }),
    });
    const mockPrisma = createMockPrismaService();
    const createdRuns: any[] = [];
    mockPrisma.agentRun.create.mockImplementation(
      async ({ data }: { data: any }) => {
        const run = { id: `run-${createdRuns.length + 1}`, ...data };
        createdRuns.push(run);
        return run;
      },
    );

    const service = new AgentsService(
      mockPrisma as unknown as PrismaService,
      mockAiService as unknown as AiService,
    );

    await Promise.all([
      service.startAnnouncementDraft(
        'tenant-a',
        'user-a',
        'the new Saturday schedule',
      ),
      service.startAnnouncementDraft(
        'tenant-b',
        'user-b',
        'the holiday party',
      ),
    ]);

    expect(createdRuns).toHaveLength(2);

    const tenantARun = createdRuns.find((r) => r.tenantId === 'tenant-a');
    const tenantBRun = createdRuns.find((r) => r.tenantId === 'tenant-b');

    expect(tenantARun.userId).toBe('user-a');
    expect(tenantARun.topic).toBe('the new Saturday schedule');
    expect(tenantARun.draftText).toContain('the new Saturday schedule');
    expect(tenantARun.draftText).not.toContain('holiday party');

    expect(tenantBRun.userId).toBe('user-b');
    expect(tenantBRun.topic).toBe('the holiday party');
    expect(tenantBRun.draftText).toContain('the holiday party');
    expect(tenantBRun.draftText).not.toContain('Saturday schedule');
  });

  it('holds up under a larger concurrent fan-out across many tenants', async () => {
    const mockAiService = createMockAiService({
      generateText: jest.fn(async (prompt: string) => `DRAFT: ${prompt}`),
      generateObject: jest
        .fn()
        .mockResolvedValue({ approved: true, feedback: 'ok' }),
    });
    const mockPrisma = createMockPrismaService();
    const createdRuns: any[] = [];
    mockPrisma.agentRun.create.mockImplementation(
      async ({ data }: { data: any }) => {
        const run = { id: `run-${createdRuns.length + 1}`, ...data };
        createdRuns.push(run);
        return run;
      },
    );

    const service = new AgentsService(
      mockPrisma as unknown as PrismaService,
      mockAiService as unknown as AiService,
    );

    const tenantCount = 10;
    await Promise.all(
      Array.from({ length: tenantCount }, (_, i) =>
        service.startAnnouncementDraft(
          `tenant-${i}`,
          `user-${i}`,
          `topic-${i}`,
        ),
      ),
    );

    expect(createdRuns).toHaveLength(tenantCount);
    for (let i = 0; i < tenantCount; i++) {
      const run = createdRuns.find((r) => r.tenantId === `tenant-${i}`);
      expect(run.userId).toBe(`user-${i}`);
      expect(run.topic).toBe(`topic-${i}`);
      expect(run.draftText).toContain(`topic-${i}`);
    }
  });
});
