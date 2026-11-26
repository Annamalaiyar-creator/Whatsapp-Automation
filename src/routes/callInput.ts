import { z } from 'zod';
import type { IncomingCall } from '../calls/service.js';
import { CHANNELS, FORWARD_REASONS } from '../routing/schema.js';

export const callInputSchema = z.object({
  at: z.iso.datetime({ offset: true }).optional(),
  channel: z.enum(CHANNELS),
  botNumberId: z.uuid().nullable(),
  forwardReason: z.enum(FORWARD_REASONS).nullable(),
  callerPhone: z.string().trim().regex(/^\+?[0-9]{6,15}$/, 'Enter a phone number, for example +919876543210'),
  callerKnown: z.boolean().default(true),
  callerTags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  language: z.string().trim().min(2).max(10).nullable().default(null),
});

export function toIncomingCall(input: z.infer<typeof callInputSchema>): IncomingCall {
  return {
    at: input.at ? new Date(input.at) : new Date(),
    channel: input.channel,
    botNumberId: input.botNumberId,
    forwardReason: input.forwardReason,
    callerPhone: input.callerPhone,
    callerKnown: input.callerKnown,
    callerTags: input.callerTags,
    language: input.language,
  };
}
