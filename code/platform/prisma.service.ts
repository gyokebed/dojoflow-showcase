/*
 * Exhibit from the private repository gyokebed/arquitechta-core @ fc229b40
 * Original path: packages/server/src/prisma.service.ts
 * Part of the DojoFlow engineering showcase — read-only excerpt.
 * The full production codebase (124K LOC TS) remains private; time-boxed
 * access available on request.
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma service with proper connection management for production
 * Uses lazy initialization to avoid prepared statement conflicts
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private prisma: PrismaClient;
  private isConnected = false;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL || '';

    // For the Supabase pooler, append connection parameters. We use the
    // SESSION-mode pooler (port 5432): each client connection gets a dedicated
    // Postgres backend for the lifetime of the session, so prepared statements
    // are safe and a small connection pool is fine.
    //
    // This previously hard-coded `connection_limit=1`, which serialized every
    // request in the whole server through a single connection. Under any
    // concurrent fan-out (e.g. the dashboard firing ~10 requests on mount) the
    // pool saturated and queries that waited past Prisma's `pool_timeout` threw
    // P2024 ("Timed out fetching a new connection from the connection pool"),
    // surfacing as sporadic 500s. A small pool removes that bottleneck.
    //
    // Both knobs are overridable via env so ops can tune per environment
    // (e.g. lower the limit when running many instances) without a code change.
    const connectionLimit = process.env.DB_CONNECTION_LIMIT ?? '5';
    const poolTimeout = process.env.DB_POOL_TIMEOUT ?? '20';
    let connectionUrl = databaseUrl;
    if (databaseUrl.includes('pooler.supabase.com')) {
      const separator = databaseUrl.includes('?') ? '&' : '?';
      const params: string[] = [];
      if (!databaseUrl.includes('pgbouncer=')) {
        params.push('pgbouncer=true');
      }
      if (!databaseUrl.includes('connection_limit=')) {
        params.push(`connection_limit=${connectionLimit}`);
      }
      if (!databaseUrl.includes('pool_timeout=')) {
        params.push(`pool_timeout=${poolTimeout}`);
      }
      if (params.length > 0) {
        connectionUrl = databaseUrl + separator + params.join('&');
      }
    }

    // Initialize PrismaClient with production-safe configuration
    this.prisma = new PrismaClient({
      ...(connectionUrl !== databaseUrl && {
        datasources: { db: { url: connectionUrl } },
      }),
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'info', 'warn', 'error']
          : ['error'],
      errorFormat: 'pretty',
    });
  }

  /**
   * Automatically connect when the module initializes
   */
  async onModuleInit() {
    await this.connect();
  }

  /**
   * Automatically disconnect when the module is destroyed
   */
  async onModuleDestroy() {
    await this.disconnect();
  }

  /**
   * Get the Prisma client instance (lazy initialization)
   */
  get client() {
    if (!this.isConnected) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.prisma;
  }

  /**
   * Explicit connection method for testing and initialization
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error('DATABASE_URL environment variable is not set');
      }

      // Parse URL to verify it's properly formatted (without exposing credentials)
      const url = new URL(databaseUrl);
      this.logger.log(
        `Connecting to database: ${url.protocol}//${url.hostname}:${url.port}${url.pathname}`,
      );

      await this.prisma.$connect();
      this.isConnected = true;
      this.logger.log('Database connected successfully');

      // Test the connection with a simple query that won't conflict
      await this.prisma.$queryRaw`SELECT 1 as test`;
      this.logger.log('Database connection verified successfully');
    } catch (error) {
      this.logger.error('Database connection failed:', error.message);

      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          'Database connection failed in production. Application cannot continue.',
        );
        throw new Error(`Database connection failed: ${error.message}`);
      }

      this.logger.warn(
        'Database connection failed in development mode. Application will continue without database functionality.',
      );
    }
  }

  /**
   * Disconnect from database
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      await this.prisma.$disconnect();
      this.isConnected = false;
      this.logger.log('Database disconnected successfully');
    } catch (error) {
      this.logger.error('Error disconnecting from database:', error.message);
    }
  }

  /**
   * Test database connectivity
   * @returns Promise resolving to connection status
   */
  async testConnection(): Promise<{
    success: boolean;
    error?: string;
    details?: any;
  }> {
    try {
      await this.connect();
      const result = await this.prisma
        .$queryRaw`SELECT version() as version, current_database() as database, current_user as user`;
      return {
        success: true,
        details: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get database connection info (without exposing credentials)
   * @returns Database connection information
   */
  getConnectionInfo() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      return { error: 'DATABASE_URL environment variable is not set' };
    }

    try {
      const url = new URL(databaseUrl);
      return {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        database: url.pathname.slice(1),
        username: url.username,
        hasPassword: !!url.password,
        // Don't expose the actual password or full URL
      };
    } catch (error) {
      return {
        error: 'Invalid DATABASE_URL format',
        rawUrl: databaseUrl.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@'), // Hide credentials in log
      };
    }
  }

  // Proxy all PrismaClient methods to the internal client
  async $connect() {
    return this.connect();
  }

  async $disconnect() {
    return this.disconnect();
  }

  async $queryRaw<T = any>(
    query: TemplateStringsArray | any,
    ...values: any[]
  ): Promise<T> {
    return this.client.$queryRaw<T>(query, ...values);
  }

  async $executeRaw<T = any>(
    query: TemplateStringsArray | any,
    ...values: any[]
  ): Promise<number> {
    return this.client.$executeRaw<T>(query, ...values);
  }

  async $transaction<T>(fn: (prisma: PrismaClient) => Promise<T>): Promise<T> {
    return this.client.$transaction(fn);
  }

  // Dynamic proxy for all Prisma model methods
  get account() {
    return this.client.account;
  }

  get student() {
    return this.client.student;
  }

  get studentGuardian() {
    return this.client.studentGuardian;
  }

  get household() {
    return this.client.household;
  }

  get householdMember() {
    return this.client.householdMember;
  }

  get tenant() {
    return this.client.tenant;
  }

  get membershipPlan() {
    return this.client.membershipPlan;
  }

  get bankAccount() {
    return this.client.bankAccount;
  }

  get belt() {
    return this.client.belt;
  }

  get beltPromotion() {
    return this.client.beltPromotion;
  }

  get level() {
    return this.client.level;
  }

  get tenantOwner() {
    return this.client.tenantOwner;
  }

  get tenantAdmin() {
    return this.client.tenantAdmin;
  }

  get invitation() {
    return this.client.invitation;
  }

  get provider() {
    return this.client.provider;
  }

  get session() {
    return this.client.session;
  }

  get sessionSchedule() {
    return this.client.sessionSchedule;
  }

  get scheduleException() {
    return this.client.scheduleException;
  }

  get enrollment() {
    return this.client.enrollment;
  }

  get attendance() {
    return this.client.attendance;
  }

  get appointment() {
    return this.client.appointment;
  }

  get availabilityWindow() {
    return this.client.availabilityWindow;
  }

  get martialArtsMemberProfile() {
    return this.client.martialArtsMemberProfile;
  }

  get fitnessMemberProfile() {
    return this.client.fitnessMemberProfile;
  }

  get wellnessMemberProfile() {
    return this.client.wellnessMemberProfile;
  }

  get event() {
    return this.client.event;
  }

  get eventRegistration() {
    return this.client.eventRegistration;
  }

  get payment() {
    return this.client.payment;
  }

  get communication() {
    return this.client.communication;
  }

  get sessionSummary() {
    return this.client.sessionSummary;
  }

  get processedWebhookEvent() {
    return this.client.processedWebhookEvent;
  }

  get whatsAppMessage() {
    return this.client.whatsAppMessage;
  }

  get agentRun() {
    return this.client.agentRun;
  }

  get copilotConversation() {
    return this.client.copilotConversation;
  }

  get copilotMessage() {
    return this.client.copilotMessage;
  }

  get member() {
    return this.client.member;
  }

  get memberType() {
    return this.client.memberType;
  }

  get $on() {
    return this.client.$on;
  }
}
