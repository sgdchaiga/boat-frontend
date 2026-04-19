import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { MessageChannel, MessageRecord, MessageStatus, MessagingProvider, SendMessageRequest } from "./types.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function organizationIdForPrisma(id: string | undefined): string | undefined {
  if (!id || typeof id !== "string") return undefined;
  const t = id.trim();
  return UUID_RE.test(t) ? t : undefined;
}

function wrapPrismaError(err: unknown): Error {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021") {
    return new Error(
      "Database table notification_messages is missing. Apply supabase/migrations/20260618120000_notification_messages.sql to the database used by DATABASE_URL, then restart boat-server."
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/relation .* does not exist|does not exist in the current database/i.test(msg)) {
    return new Error(
      "Database table notification_messages is missing. Apply the BOAT migration that creates notification_messages, then restart boat-server."
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

export type ChannelProviderPreference = Partial<Record<MessageChannel, string[]>>;

export interface NotificationServiceOptions {
  providerPreferences?: {
    default?: ChannelProviderPreference;
    organizations?: Record<string, ChannelProviderPreference>;
  };
}

function toMessageRecord(row: {
  id: string;
  channel: string;
  to: string;
  provider: string;
  providerMessageId: string;
  status: string;
  templateId: string | null;
  text: string | null;
  variables: Prisma.JsonValue | null;
  organizationId: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}): MessageRecord {
  return {
    id: row.id,
    channel: row.channel as MessageChannel,
    to: row.to,
    provider: row.provider,
    providerMessageId: row.providerMessageId,
    status: row.status as MessageStatus,
    templateId: row.templateId ?? undefined,
    text: row.text ?? undefined,
    variables: (row.variables as Record<string, string | number | boolean> | null) ?? undefined,
    organizationId: row.organizationId ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class NotificationService {
  private readonly providersByChannel = new Map<MessageChannel, MessagingProvider[]>();
  private readonly providerPreferences?: NotificationServiceOptions["providerPreferences"];

  public constructor(
    private readonly prisma: PrismaClient,
    options?: NotificationServiceOptions
  ) {
    this.providerPreferences = options?.providerPreferences;
  }

  public registerProvider(provider: MessagingProvider): void {
    for (const channel of provider.supportedChannels) {
      const list = this.providersByChannel.get(channel) ?? [];
      list.push(provider);
      this.providersByChannel.set(channel, list);
    }
  }

  private getProviderPreference(request: SendMessageRequest): string[] | null {
    const organizationId = request.organizationId;
    if (organizationId) {
      const orgPreferred = this.providerPreferences?.organizations?.[organizationId]?.[request.channel];
      if (orgPreferred && orgPreferred.length > 0) {
        return orgPreferred;
      }
    }
    const defaultPreferred = this.providerPreferences?.default?.[request.channel];
    return defaultPreferred && defaultPreferred.length > 0 ? defaultPreferred : null;
  }

  private resolveProviders(request: SendMessageRequest): MessagingProvider[] {
    const providers = this.providersByChannel.get(request.channel) ?? [];
    const preferredOrder = this.getProviderPreference(request);
    if (!preferredOrder) {
      return providers;
    }
    const rank = new Map(preferredOrder.map((name, index) => [name, index]));
    return [...providers].sort((left, right) => {
      const leftRank = rank.get(left.providerName) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rank.get(right.providerName) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank;
    });
  }

  public async send(request: SendMessageRequest): Promise<MessageRecord> {
    const providers = this.resolveProviders(request);
    if (providers.length === 0) {
      throw new Error(`No provider configured for channel: ${request.channel}`);
    }

    const recordId = randomUUID();
    let providerError: unknown;
    for (const provider of providers) {
      try {
        const result = await provider.send(request);
        const orgId = organizationIdForPrisma(request.organizationId);
        try {
          const row = await this.prisma.notificationMessage.create({
            data: {
              id: recordId,
              channel: request.channel,
              to: request.to,
              provider: provider.providerName,
              providerMessageId: result.providerMessageId,
              status: result.status,
              templateId: request.templateId,
              text: request.text,
              variables: (request.variables as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
              organizationId: orgId ?? null,
            },
          });
          return toMessageRecord(row);
        } catch (e) {
          throw wrapPrismaError(e);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("notification_messages")) {
          throw error;
        }
        providerError = error;
      }
    }

    if (request.channel === "whatsapp" && request.fallbackToSms) {
      return this.send({
        ...request,
        channel: "sms",
        fallbackToSms: false,
      });
    }

    const orgId = organizationIdForPrisma(request.organizationId);
    try {
      const row = await this.prisma.notificationMessage.create({
        data: {
          id: recordId,
          channel: request.channel,
          to: request.to,
          provider: "none",
          providerMessageId: randomUUID(),
          status: "failed",
          templateId: request.templateId,
          text: request.text,
          variables: (request.variables as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
          organizationId: orgId ?? null,
          error: providerError instanceof Error ? providerError.message : "Unknown messaging error",
        },
      });
      return toMessageRecord(row);
    } catch (e) {
      throw wrapPrismaError(e);
    }
  }

  public async getById(id: string): Promise<MessageRecord | null> {
    const row = await this.prisma.notificationMessage.findUnique({ where: { id } });
    return row ? toMessageRecord(row) : null;
  }

  public async getByProviderMessageId(providerMessageId: string): Promise<MessageRecord | null> {
    const row = await this.prisma.notificationMessage.findUnique({ where: { providerMessageId } });
    return row ? toMessageRecord(row) : null;
  }

  public async updateStatusByProviderMessageId(
    providerMessageId: string,
    status: MessageStatus,
    error?: string
  ): Promise<MessageRecord | null> {
    const existing = await this.prisma.notificationMessage.findUnique({
      where: { providerMessageId },
    });
    if (!existing) {
      return null;
    }

    const updated = await this.prisma.notificationMessage.update({
      where: { id: existing.id },
      data: {
        status,
        error: error ?? existing.error,
      },
    });
    return toMessageRecord(updated);
  }
}
