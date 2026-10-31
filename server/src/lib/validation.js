import { z } from 'zod';
import { HttpError } from './errors.js';
export const password = z
  .string()
  .min(10)
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Use at most 72 UTF-8 bytes.');
export const userInput = z
  .object({
    name: z.string().trim().min(2).max(80),
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password,
  })
  .strict();
export const loginInput = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z
      .string()
      .min(1)
      .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Use at most 72 UTF-8 bytes.'),
  })
  .strict();
export const chatInput = z
  .object({
    subject: z.string().trim().min(3).max(120),
    category: z.enum(['booking', 'amenities', 'general', 'urgent']).default('general'),
  })
  .strict();
export const messageInput = z
  .object({ body: z.string().trim().min(1).max(2000), clientMessageId: z.uuid().optional() })
  .strict();
export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid chat or message ID.');
export const roomInput = z.object({ chatId: objectId }).strict();
export const socketMessageInput = messageInput.extend({
  chatId: objectId,
  clientMessageId: z.uuid(),
});
export const syncInput = z
  .object({ after: objectId.optional(), limit: z.coerce.number().int().min(1).max(20).default(20) })
  .strict();
export const pageInput = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(20).default(20),
  })
  .strict();
const calendarDate = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Use a real calendar date in YYYY-MM-DD format.');
export const historyInput = pageInput
  .extend({
    search: z
      .string()
      .trim()
      .max(80)
      .regex(/^[^\u0000-\u001f\u007f]*$/, 'Control characters are not allowed.')
      .default(''),
    start: calendarDate.optional(),
    end: calendarDate.optional(),
    snapshot: z.union([objectId, z.literal('empty')]).optional(),
  })
  .refine((input) => !input.start || !input.end || input.start <= input.end, {
    message: 'Start date must not be after end date.',
    path: ['end'],
  });
export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(
      400,
      result.error.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; '),
    );
  return result.data;
}
export const inboxInput = pageInput.extend({
  status: z.enum(['waiting', 'active', 'closed']).default('waiting'),
});
export const readInput = z.object({ messageId: objectId }).strict();
export const olderInput = z
  .object({ before: objectId, limit: z.coerce.number().int().min(1).max(20).default(20) })
  .strict();
export function validId(req, res, next) {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) return next(new HttpError(400, 'Invalid chat ID.'));
  next();
}
