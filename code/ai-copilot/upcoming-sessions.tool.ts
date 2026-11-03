/*
 * Exhibit from the private repository gyokebed/arquitechta-core @ fc229b40
 * Original path: packages/server/src/ai/tools/upcoming-sessions.tool.ts
 * Part of the DojoFlow engineering showcase — read-only excerpt.
 * The full production codebase (124K LOC TS) remains private; time-boxed
 * access available on request.
 */

import { z } from 'zod';
import { DateTime } from 'luxon';
import { SessionsService } from '../../domain/sessions/sessions.service';
import { AiToolDefinition } from './tool.types';

const upcomingSessionsParams = z.object({
  days: z
    .number()
    .int()
    .min(1)
    .max(90)
    .optional()
    .describe('How many days ahead to look. Defaults to 7.'),
  sessionName: z
    .string()
    .optional()
    .describe('Filter to sessions/classes whose name contains this text.'),
});
type UpcomingSessionsParams = z.infer<typeof upcomingSessionsParams>;

export function buildUpcomingSessionsTool(
  tenantId: string,
  sessionsService: SessionsService,
): AiToolDefinition<UpcomingSessionsParams> {
  return {
    description:
      "List upcoming class/session occurrences for this tenant within the next N days (default 7), expanded from each session's recurrence schedule. Includes class name, start/end time, instructor, and capacity/enrollment when available.",
    parameters: upcomingSessionsParams,
    execute: async (args) => {
      const days = args.days ?? 7;
      const start = DateTime.now();
      const end = start.plus({ days });

      const events = await sessionsService.generateTenantCalendar(
        start.toISODate(),
        end.toISODate(),
        tenantId,
        undefined, // no userId -> holiday events excluded, which is correct here
        true, // canViewEnrollment -- safe: copilot is OWNER/ADMIN/INSTRUCTOR only
      );

      const filtered = args.sessionName
        ? events.filter((e: any) =>
            e.className?.toLowerCase().includes(args.sessionName.toLowerCase()),
          )
        : events;

      return filtered.slice(0, 20).map((e: any) => ({
        sessionId: e.sessionId,
        className: e.className,
        start: e.start,
        end: e.end,
        instructor: e.provider?.name ?? null,
        capacity: e.capacity ?? null,
        enrollmentCount: e.enrollmentCount ?? null,
      }));
    },
  };
}
