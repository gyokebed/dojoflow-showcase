/*
 * Exhibit from the private repository gyokebed/arquitechta-core @ fc229b40
 * Original path: packages/server/src/ai/tools/membership-status.tool.ts
 * Part of the DojoFlow engineering showcase — read-only excerpt.
 * The full production codebase (124K LOC TS) remains private; time-boxed
 * access available on request.
 */

import { z } from 'zod';
import { NotFoundException } from '@nestjs/common';
import { MembershipsService } from '../../memberships/memberships.service';
import { StudentsService } from '../../domain/students/students.service';
import { QueryStudentsDto } from '../../domain/students/dto/query-students.dto';
import { AiToolDefinition } from './tool.types';

const membershipStatusParams = z
  .object({
    studentId: z.string().optional().describe('Exact student ID, if known.'),
    studentName: z
      .string()
      .optional()
      .describe("Student's name to look up, if the ID is not known."),
  })
  .refine((v) => !!v.studentId || !!v.studentName, {
    message: 'Provide either studentId or studentName.',
  });
type MembershipStatusParams = z.infer<typeof membershipStatusParams>;

/**
 * `StudentsService.findAll`'s search does `firstName contains X OR lastName
 * contains X` against a single string — a full "First Last" query matches
 * neither field alone and returns zero results (confirmed live: searching
 * "Gabriela Vargas" found nothing even though the student exists). Retry
 * with just the first word (typically the first name), then narrow the
 * broader candidate set to names containing every word from the original
 * query, so a full-name question still resolves.
 */
async function findStudentsByName(
  studentsService: StudentsService,
  tenantId: string,
  name: string,
): Promise<{
  students: { id: string; firstName: string; lastName: string | null }[];
  total: number;
}> {
  const direct = await studentsService.findAll(
    { search: name, limit: 5 } as QueryStudentsDto,
    tenantId,
  );
  if (direct.total > 0) {
    return direct;
  }

  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return direct;
  }

  const { students: candidates } = await studentsService.findAll(
    { search: words[0], limit: 20 } as QueryStudentsDto,
    tenantId,
  );
  const lowerWords = words.map((w) => w.toLowerCase());
  const matches = candidates.filter((c) => {
    const fullName = `${c.firstName} ${c.lastName ?? ''}`.toLowerCase();
    return lowerWords.every((w) => fullName.includes(w));
  });
  return { students: matches, total: matches.length };
}

export function buildMembershipStatusTool(
  tenantId: string,
  membershipsService: MembershipsService,
  studentsService: StudentsService,
): AiToolDefinition<MembershipStatusParams> {
  return {
    description:
      "Get a student's membership/payment status: subscription status, payment method, current period, pause/suspension state, and most recent payment. Accepts either an exact studentId or a studentName to look up. NOTE: name lookup only finds actively-training students — if a name lookup fails but the caller has a studentId, use that instead.",
    parameters: membershipStatusParams,
    execute: async (args) => {
      let studentId = args.studentId;

      if (!studentId) {
        const { students, total } = await findStudentsByName(
          studentsService,
          tenantId,
          args.studentName,
        );
        if (total === 0) {
          return { error: `No student found matching "${args.studentName}".` };
        }
        if (total > 1) {
          return {
            disambiguationNeeded: true,
            candidates: students.map((s) => ({
              studentId: s.id,
              name: `${s.firstName} ${s.lastName ?? ''}`.trim(),
            })),
          };
        }
        studentId = students[0].id;
      }

      try {
        const detail =
          await membershipsService.getStudentMembershipDetailForAdmin(
            studentId,
            tenantId,
          );
        return {
          studentId: detail.studentId,
          studentName: detail.userName,
          isMinor: detail.isMinor,
          subscriptionStatus: detail.currentStatus,
          paymentMethod: detail.paymentMethod,
          periodStart: detail.periodStart,
          periodEnd: detail.periodEnd,
          suspendedAt: detail.suspendedAt,
          graceUntil: detail.graceUntil,
          pausedAt: detail.pausedAt,
          pauseReason: detail.pauseReason,
          effectiveAccess: detail.effectiveAccess,
          lastPayment: detail.payments?.[0]
            ? {
                // Payment.amount is stored in the smallest currency unit
                // (cents) -- format to a real amount before this reaches the
                // model, or it renders numbers 100x too large (confirmed
                // live: a $1,200 MXN payment displayed as "$120,000").
                amountFormatted: new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: detail.payments[0].currency,
                }).format(detail.payments[0].amount / 100),
                status: detail.payments[0].status,
                createdAt: detail.payments[0].createdAt,
              }
            : null,
        };
      } catch (error) {
        if (error instanceof NotFoundException) {
          return { error: `Student ${studentId} not found in this tenant.` };
        }
        throw error;
      }
    },
  };
}
