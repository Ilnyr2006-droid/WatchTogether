import { z } from "zod";

export const usernameSchema = z.string().trim().min(1).max(32);
export const roomIdSchema = z.string().regex(/^[a-z0-9]{10}$/);
export const roomTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const chatSchema = z.string().trim().min(1).max(500);
export const timeSchema = z.number().finite().min(0).max(60 * 60 * 24 * 7);

export const submittedUrlSchema = z.string().trim().url().max(2048);
export const localFileNameSchema = z.string().trim().min(1).max(180);

export const roomCreateSchema = z.object({ username: usernameSchema }).strict();
export const roomJoinSchema = z.object({ roomId: roomIdSchema, username: usernameSchema, roomToken: roomTokenSchema }).strict();
export const participantUpdateSchema = z.object({ muted: z.boolean().optional(), ready: z.boolean().optional() }).strict().refine((value) => value.muted !== undefined || value.ready !== undefined);
export const videoActionSchema = z.object({ action: z.enum(["play", "pause", "seek", "sync"]), currentTime: timeSchema }).strict();
export const videoSourceSelectionSchema = z.union([
  z.object({ input: submittedUrlSchema }).strict(),
  z.object({ localFileName: localFileNameSchema }).strict(),
]);
export const chatSendSchema = z.object({ text: chatSchema }).strict();

const socketTargetSchema = z.string().min(1).max(128);
const sessionDescriptionSchema = z.object({
  type: z.enum(["offer", "answer"]),
  sdp: z.string().min(1).max(64_000),
}).strict();

export const signalDescriptionSchema = z.object({
  to: socketTargetSchema,
  description: sessionDescriptionSchema,
}).strict();

export const signalCandidateSchema = z.object({
  to: socketTargetSchema,
  candidate: z.object({
    candidate: z.string().max(4_096),
    sdpMid: z.string().max(128).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(256).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  }).strict(),
}).strict();
