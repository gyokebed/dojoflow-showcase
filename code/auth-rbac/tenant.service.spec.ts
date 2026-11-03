/*
 * Exhibit from the private repository gyokebed/arquitechta-core @ fc229b40
 * Original path: packages/server/src/tenant/tenant.service.spec.ts
 * Part of the DojoFlow engineering showcase — read-only excerpt.
 * The full production codebase (124K LOC TS) remains private; time-boxed
 * access available on request.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { PrismaService } from '../prisma.service';
import { TenantOwnerService } from '../tenant-owner/tenant-owner.service';
import { TenantSeedService } from './tenant-seed.service';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../test/mocks/prisma.mock';

describe('TenantService — bank accounts', () => {
  let service: TenantService;
  let mockPrisma: MockPrismaService;

  const TENANT_ID = 'tenant-123';
  const ACCOUNT_ID = 'bank-1';

  const validInput = {
    label: 'Cuenta principal',
    bankName: 'BBVA',
    accountHolderName: 'Samurai King',
    accountNumber: '0123456789',
    clabe: '012345678901234567',
  };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TenantOwnerService, useValue: {} },
        { provide: TenantSeedService, useValue: {} },
      ],
    }).compile();

    service = module.get<TenantService>(TenantService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('listBankAccounts', () => {
    it('lists accounts scoped to the tenant, ordered by sortOrder then createdAt', async () => {
      const rows = [{ id: ACCOUNT_ID, ...validInput }];
      mockPrisma.bankAccount.findMany.mockResolvedValue(rows);

      const result = await service.listBankAccounts(TENANT_ID);

      expect(result).toBe(rows);
      expect(mockPrisma.bankAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
      );
    });
  });

  describe('createBankAccount', () => {
    it('creates an account with sortOrder appended to the end of the list', async () => {
      mockPrisma.bankAccount.count.mockResolvedValue(2);
      mockPrisma.bankAccount.create.mockResolvedValue({
        id: ACCOUNT_ID,
        ...validInput,
      });

      await service.createBankAccount(TENANT_ID, validInput);

      expect(mockPrisma.bankAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: TENANT_ID, sortOrder: 2 }),
        }),
      );
    });

    it('throws BadRequestException when the account cap is reached', async () => {
      mockPrisma.bankAccount.count.mockResolvedValue(10);

      await expect(
        service.createBankAccount(TENANT_ID, validInput),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.bankAccount.create).not.toHaveBeenCalled();
    });
  });

  describe('updateBankAccount', () => {
    it('updates only when the account belongs to the tenant (IDOR guard)', async () => {
      mockPrisma.bankAccount.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.bankAccount.findUniqueOrThrow.mockResolvedValue({
        id: ACCOUNT_ID,
        ...validInput,
      });

      await service.updateBankAccount(TENANT_ID, ACCOUNT_ID, validInput);

      expect(mockPrisma.bankAccount.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ACCOUNT_ID, tenantId: TENANT_ID },
        }),
      );
    });

    it('throws NotFoundException when no row matches (wrong tenant or missing)', async () => {
      mockPrisma.bankAccount.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateBankAccount('other-tenant', ACCOUNT_ID, validInput),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.bankAccount.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });

  describe('deleteBankAccount', () => {
    it('deletes only when the account belongs to the tenant (IDOR guard)', async () => {
      mockPrisma.bankAccount.deleteMany.mockResolvedValue({ count: 1 });

      await service.deleteBankAccount(TENANT_ID, ACCOUNT_ID);

      expect(mockPrisma.bankAccount.deleteMany).toHaveBeenCalledWith({
        where: { id: ACCOUNT_ID, tenantId: TENANT_ID },
      });
    });

    it('throws NotFoundException when no row matches (wrong tenant or missing)', async () => {
      mockPrisma.bankAccount.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.deleteBankAccount('other-tenant', ACCOUNT_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
