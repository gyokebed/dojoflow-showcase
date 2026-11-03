/*
 * Exhibit from the private repository gyokebed/arquitechta-core @ fc229b40
 * Original path: packages/server/src/ai/ai.service.ts
 * Part of the DojoFlow engineering showcase — read-only excerpt.
 * The full production codebase (124K LOC TS) remains private; time-boxed
 * access available on request.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateText as aiGenerateText,
  generateObject as aiGenerateObject,
  streamText as aiStreamText,
  tool,
  stepCountIs,
} from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel, StreamTextResult, ToolSet } from 'ai';
import type { ZodType } from 'zod';
import type { AiToolRegistry } from './tools/tool.types';
import {
  LangfuseService,
  LangfuseGenerationMetadata,
} from './langfuse.service';

export interface LangfuseCallOptions {
  /** Trace/generation name shown in Langfuse, e.g. 'copilot-qa'. */
  name: string;
  metadata?: LangfuseGenerationMetadata;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private languageModel: LanguageModel | null = null;
  private model: string;

  constructor(
    private configService: ConfigService,
    private langfuseService: LangfuseService,
  ) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    this.model = this.configService.get<string>(
      'AI_MODEL',
      'claude-sonnet-4-5-20250929',
    );

    if (!apiKey) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not configured. AI features will be disabled.',
      );
      return;
    }

    const anthropicProvider = createAnthropic({ apiKey });
    this.languageModel = anthropicProvider(this.model);
    this.logger.log(`AI service initialized with model: ${this.model}`);
  }

  get isConfigured(): boolean {
    return this.languageModel !== null;
  }

  async generateText(
    prompt: string,
    systemPrompt?: string,
    langfuse?: LangfuseCallOptions,
  ): Promise<string | null> {
    if (!this.languageModel) {
      this.logger.warn('AI not configured, skipping generation');
      return null;
    }

    const generation = this.langfuseService.startGeneration({
      name: langfuse?.name ?? 'generateText',
      input: prompt,
      model: this.model,
      metadata: langfuse?.metadata,
    });

    try {
      const { text, usage } = await aiGenerateText({
        model: this.languageModel,
        maxOutputTokens: 1024,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        prompt,
      });

      generation.end({ output: text, usage });
      return text || null;
    } catch (error) {
      generation.end({ level: 'ERROR', statusMessage: error.message });
      this.logger.error(`AI generation failed: ${error.message}`);
      throw error;
    }
  }

  /** Zod-validated structured output, no tools. */
  async generateObject<T>(
    schema: ZodType<T>,
    prompt: string,
    systemPrompt?: string,
    langfuse?: LangfuseCallOptions,
  ): Promise<T | null> {
    if (!this.languageModel) {
      this.logger.warn('AI not configured, skipping generation');
      return null;
    }

    const generation = this.langfuseService.startGeneration({
      name: langfuse?.name ?? 'generateObject',
      input: prompt,
      model: this.model,
      metadata: langfuse?.metadata,
    });

    try {
      const { object, usage } = await aiGenerateObject<ZodType<T>, 'object', T>(
        {
          model: this.languageModel,
          schema,
          output: 'object',
          maxOutputTokens: 1024,
          ...(systemPrompt ? { system: systemPrompt } : {}),
          prompt,
        },
      );

      generation.end({ output: object, usage });
      return object;
    } catch (error) {
      generation.end({ level: 'ERROR', statusMessage: error.message });
      this.logger.error(`AI structured generation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Tool-calling loop. Returns the model's free-form final text plus
   * guardrail bookkeeping. The max-tool-calls guardrail lives here (not in
   * any feature-layer caller) so every consumer of this method inherits it.
   */
  async generateWithTools(params: {
    prompt: string;
    systemPrompt?: string;
    tools: AiToolRegistry;
    maxToolCalls?: number;
    langfuse?: LangfuseCallOptions;
  }): Promise<{
    text: string;
    toolCallsUsed: number;
    toolCallLimitReached: boolean;
  } | null> {
    if (!this.languageModel) {
      this.logger.warn('AI not configured, skipping generation');
      return null;
    }

    const maxToolCalls = params.maxToolCalls ?? 3;
    let toolCallsUsed = 0;
    let toolCallLimitReached = false;

    const guardedTools = Object.fromEntries(
      Object.entries(params.tools).map(([name, def]) => [
        name,
        tool({
          description: def.description,
          inputSchema: def.parameters,
          execute: async (args: unknown) => {
            if (toolCallsUsed >= maxToolCalls) {
              toolCallLimitReached = true;
              return {
                error: `Tool call limit (${maxToolCalls}) reached for this request. Answer using the information already gathered.`,
              };
            }
            toolCallsUsed++;
            try {
              return await def.execute(args);
            } catch (error) {
              this.logger.error(`Tool "${name}" failed: ${error.message}`);
              return { error: `The "${name}" tool failed: ${error.message}` };
            }
          },
        }),
      ]),
    );

    const generation = this.langfuseService.startGeneration({
      name: params.langfuse?.name ?? 'generateWithTools',
      input: params.prompt,
      model: this.model,
      metadata: params.langfuse?.metadata,
    });

    try {
      const { text, totalUsage } = await aiGenerateText({
        model: this.languageModel,
        tools: guardedTools,
        // +1 so the model gets a final text-only step after using its full
        // tool budget, instead of being cut off mid tool-call.
        stopWhen: stepCountIs(maxToolCalls + 1),
        maxOutputTokens: 2048,
        ...(params.systemPrompt ? { system: params.systemPrompt } : {}),
        prompt: params.prompt,
      });

      generation.end({ output: text, usage: totalUsage });
      return { text: text ?? '', toolCallsUsed, toolCallLimitReached };
    } catch (error) {
      generation.end({ level: 'ERROR', statusMessage: error.message });
      this.logger.error(`AI tool-calling generation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Streaming counterpart to generateWithTools. Same guardrail wrapping,
   * but calls streamText instead of generateText. Returns the raw Vercel
   * AI SDK StreamTextResult so the caller builds the HTTP response itself.
   *
   * Unlike generateWithTools, toolCallsUsed/toolCallLimitReached can't be
   * returned synchronously -- the stream hasn't finished when this method
   * returns -- so they're only logged in onFinish, not surfaced to callers.
   */
  async streamWithTools(params: {
    prompt: string;
    systemPrompt?: string;
    tools: AiToolRegistry;
    maxToolCalls?: number;
    abortSignal?: AbortSignal;
    langfuse?: LangfuseCallOptions;
  }): Promise<StreamTextResult<ToolSet, never> | null> {
    if (!this.languageModel) {
      this.logger.warn('AI not configured, skipping generation');
      return null;
    }

    const maxToolCalls = params.maxToolCalls ?? 3;
    let toolCallsUsed = 0;
    let toolCallLimitReached = false;

    const guardedTools = Object.fromEntries(
      Object.entries(params.tools).map(([name, def]) => [
        name,
        tool({
          description: def.description,
          inputSchema: def.parameters,
          execute: async (args: unknown) => {
            if (toolCallsUsed >= maxToolCalls) {
              toolCallLimitReached = true;
              return {
                error: `Tool call limit (${maxToolCalls}) reached for this request. Answer using the information already gathered.`,
              };
            }
            toolCallsUsed++;
            try {
              return await def.execute(args);
            } catch (error) {
              this.logger.error(`Tool "${name}" failed: ${error.message}`);
              return { error: `The "${name}" tool failed: ${error.message}` };
            }
          },
        }),
      ]),
    );

    const generation = this.langfuseService.startGeneration({
      name: params.langfuse?.name ?? 'streamWithTools',
      input: params.prompt,
      model: this.model,
      metadata: params.langfuse?.metadata,
    });

    try {
      return aiStreamText({
        model: this.languageModel,
        tools: guardedTools,
        stopWhen: stepCountIs(maxToolCalls + 1),
        maxOutputTokens: 2048,
        ...(params.systemPrompt ? { system: params.systemPrompt } : {}),
        prompt: params.prompt,
        abortSignal: params.abortSignal,
        onFinish: ({ finishReason, usage, totalUsage, text }) => {
          this.logger.log(
            `Copilot stream finished: toolCallsUsed=${toolCallsUsed}, toolCallLimitReached=${toolCallLimitReached}, finishReason=${finishReason}, outputTokens=${usage?.outputTokens ?? 'n/a'}`,
          );
          generation.end({ output: text, usage: totalUsage });
        },
        onError: ({ error }: { error: unknown }) => {
          const message =
            error instanceof Error ? error.message : JSON.stringify(error);
          this.logger.error(`Copilot stream error mid-stream: ${message}`);
          generation.end({ level: 'ERROR', statusMessage: message });
        },
      });
    } catch (error) {
      // Only catches synchronous setup errors -- errors once tokens are
      // already flowing surface via onError above instead, since headers
      // are already committed and can't become an HTTP error status then.
      generation.end({ level: 'ERROR', statusMessage: error.message });
      this.logger.error(`AI streaming generation failed: ${error.message}`);
      throw error;
    }
  }
}
