/*
 * Exhibit from the private repository gyokebed/arquitechta-core @ fc229b40
 * Original path: packages/server/src/auth/capability.service.ts
 * Part of the DojoFlow engineering showcase — read-only excerpt.
 * The full production codebase (124K LOC TS) remains private; time-boxed
 * access available on request.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Capability } from './capability.types';

/**
 * Derives a user's authorization capabilities within a given tenant from
 * platform role (OWNER|USER), tenant-scoped permissions (TenantAdmin), and
 * persisted `MemberType` rows (one per account/tenant/type), which are kept in
 * sync with the satellite profile tables by `MemberTypeSyncService`.
 *
 * Resolution is done with sequential reads, never `Promise.all`: the database
 * runs through session-mode PgBouncer, which rejects concurrent prepared
 * statements (see CLAUDE.md).
 */
@Injectable()
export class CapabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param userId   the caller
   * @param tenantId the tenant to evaluate against. For OWNER users this is the
   *   active tenant; for USER it is their own `tenantId`. Null/undefined
   *   (e.g. an OWNER who has not selected a tenant yet) yields no capabilities.
   */
  async getCapabilities(
    userId: string,
    tenantId: string | null | undefined,
  ): Promise<Capability[]> {
    if (!tenantId) {
      return [];
    }

    const user = await this.prisma.account.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) {
      return [];
    }

    const caps = new Set<Capability>();
    // Baseline: any authenticated tenant member. Preserves the existing
    // `@Roles([...,'USER'])` semantics of "any member".
    caps.add('USER');

    if (user.role === 'OWNER') {
      const owns = await this.prisma.tenantOwner.findFirst({
        where: { userId, tenantId },
        select: { id: true },
      });
      if (owns) {
        caps.add('OWNER');
      }
      // OWNER always has ADMIN privileges within their tenant.
      caps.add('ADMIN');
    } else {
      // ADMIN is a tenant-scoped permission (TenantAdmin table), not a
      // platform role. A USER may be an admin in one tenant but not another.
      const adminRow = await this.prisma.tenantAdmin.findFirst({
        where: { userId, tenantId },
        select: { id: true },
      });
      if (adminRow) {
        caps.add('ADMIN');
      }
    }

    // Functional roles (INSTRUCTOR / STUDENT / GUARDIAN) come from persisted
    // MemberType. A user may hold several at once. MemberTypeSyncService keeps
    // these in sync with the Student / Provider / StudentGuardian satellites.
    const memberTypes = await this.prisma.memberType.findMany({
      where: { userId, tenantId },
      select: { type: true },
    });
    for (const mt of memberTypes) {
      if (mt.type === 'STUDENT') {
        caps.add('STUDENT');
      } else if (mt.type === 'INSTRUCTOR') {
        caps.add('INSTRUCTOR');
      } else if (mt.type === 'GUARDIAN') {
        caps.add('GUARDIAN');
      }
    }

    return Array.from(caps);
  }
}
