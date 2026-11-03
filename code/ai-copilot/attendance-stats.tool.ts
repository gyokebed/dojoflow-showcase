/*
 * Exhibit from the private repository gyokebed/arquitechta-core @ fc229b40
 * Original path: packages/server/src/ai/tools/attendance-stats.tool.ts
 * Part of the DojoFlow engineering showcase — read-only excerpt.
 * The full production codebase (124K LOC TS) remains private; time-boxed
 * access available on request.
 */

import { z } from 'zod';
import { AttendanceService } from '../../domain/attendance/attendance.service';
import {
  AttendancePeriod,
  QueryAttendanceDto,
} from '../../domain/attendance/dto/query-attendance.dto';
import { AiToolDefinition } from './tool.types';

const attendanceStatsParams = z.object({
  sessionId: z
    .string()
    .optional()
    .describe(
      'Specific class/session ID to scope stats to. Omit to aggregate across all sessions in the tenant.',
    ),
  studentId: z
    .string()
    .optional()
    .describe('Specific student ID to scope stats to one student.'),
  period: z
    .enum(['TODAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'])
    .optional()
    .describe('Predefined time window. Omit for all-time.'),
});
type AttendanceStatsParams = z.infer<typeof attendanceStatsParams>;

export function buildAttendanceStatsTool(
  tenantId: string,
  attendanceService: AttendanceService,
): AiToolDefinition<AttendanceStatsParams> {
  return {
    description:
      'Get attendance statistics for this tenant, optionally scoped to a session/class, a student, and/or a time period (TODAY, WEEK, MONTH, QUARTER, YEAR). Returns total attendance records, present/absent counts, attendance rate, and the number of UNIQUE students who attended (use this field, not the raw record count, when asked "how many students").',
    parameters: attendanceStatsParams,
    execute: async (args) => {
      const { attendances, stats } = await attendanceService.findAll(
        {
          sessionId: args.sessionId,
          studentId: args.studentId,
          period: args.period as AttendancePeriod | undefined,
          includeStats: true,
        } as QueryAttendanceDto,
        tenantId,
      );

      const uniqueStudentsAttended = new Set(
        attendances.filter((a) => a.attended).map((a) => a.studentId),
      ).size;

      return {
        scope: args.sessionId
          ? 'session'
          : args.studentId
            ? 'student'
            : 'tenant',
        period: args.period ?? 'ALL_TIME',
        totalAttendanceRecords: stats?.total ?? 0,
        presentRecords: stats?.present ?? 0,
        absentRecords: stats?.absent ?? 0,
        attendanceRatePercent: stats
          ? Math.round(stats.attendanceRate * 10) / 10
          : 0,
        uniqueStudentsAttended,
        perStudentBreakdown: stats?.studentStats?.map((s: any) => ({
          studentName: s.studentName,
          present: s.present,
          absent: s.absent,
          attendanceRatePercent: Math.round(s.attendanceRate * 10) / 10,
        })),
      };
    },
  };
}
