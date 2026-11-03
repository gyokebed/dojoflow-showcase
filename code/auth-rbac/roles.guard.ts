/*
 * Exhibit from the private repository gyokebed/arquitechta-core @ fc229b40
 * Original path: packages/server/src/auth/roles.guard.ts
 * Part of the DojoFlow engineering showcase — read-only excerpt.
 * The full production codebase (124K LOC TS) remains private; time-boxed
 * access available on request.
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from '../common/types/authenticated-request';
import { CapabilityService } from './capability.service';
import { Capability } from './capability.types';

/**
 * Authorizes a request against the `@Roles([...])` metadata on the handler.
 *
 * `@Roles` values are CAPABILITIES (OWNER | ADMIN | INSTRUCTOR | STUDENT |
 * GUARDIAN | USER), not just the coarse `Account.role`. A caller passes when any
 * of their capabilities is in the required list.
 *
 * Capabilities are resolved per-request (never baked into the JWT) so that a
 * freshly-granted role — e.g. an admin marking a member as an instructor, or a
 * guardian self-enrolling as an adult student — takes effect on the very next
 * request without a token reissue.
 *
 * To keep that resolution cheap, the guard short-circuits before touching the
 * database whenever the answer is knowable from the JWT alone:
 *   - any route allowing `USER` admits every authenticated member;
 *   - `OWNER` is read straight off `user.role`;
 *   - `ADMIN` fast-paths when the caller is an OWNER (OWNER always has ADMIN).
 * Only routes that require ADMIN for a non-OWNER or a functional capability
 * (INSTRUCTOR/STUDENT/GUARDIAN) incur a capability lookup. Tenant-scope
 * enforcement remains the job of `TenantMatchGuard`/`OwnerGuard`, unchanged.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private capabilityService: CapabilityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.get<string[]>(
      'roles',
      context.getHandler(),
    );
    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user || !user.role) {
      return false;
    }

    // Fast path: baseline membership. Any authenticated tenant member holds
    // USER, so a route that allows USER admits everyone without a DB read.
    if (requiredRoles.includes('USER')) {
      return true;
    }

    // Fast path: OWNER role — read directly from the token. Ownership of the
    // active tenant is enforced separately by TenantMatch/OwnerGuard.
    if (requiredRoles.includes('OWNER') && user.role === 'OWNER') {
      return true;
    }

    // Fast path: ADMIN route + OWNER caller. OWNER always has ADMIN
    // capabilities, so skip the DB lookup.
    if (requiredRoles.includes('ADMIN') && user.role === 'OWNER') {
      return true;
    }

    // Otherwise the route gates on ADMIN (for a non-OWNER caller) or a
    // functional capability (INSTRUCTOR/STUDENT/GUARDIAN). Resolve from
    // the records for the tenant the caller is acting in.
    const effectiveTenantId =
      user.role === 'OWNER' ? user.activeTenantId : user.tenantId;
    const capabilities = await this.capabilityService.getCapabilities(
      user.id,
      effectiveTenantId,
    );

    return requiredRoles.some((role) =>
      capabilities.includes(role as Capability),
    );
  }
}

export const Roles = (roles: string[]) => SetMetadata('roles', roles);
