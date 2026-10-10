import { z } from 'zod';

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

export const stylistRequestSchema = {
  body: z
    .object({
      message: z
        .string({
          required_error: 'Message is required',
        })
        .trim()
        .min(1, 'Message cannot be empty')
        .max(500, 'Message cannot exceed 500 characters'),
      conversationId: z
        .string()
        .regex(OBJECT_ID_REGEX, 'Invalid conversation ID format')
        .optional(),
      imageRef: z.string().optional(),
    })
    .strict(),
};

export const requestIdParamSchema = {
  params: z
    .object({
      requestId: z.string().trim().min(1, 'requestId is required'),
    })
    .strict(),
};

export const stylistFeedbackSchema = {
  body: z
    .object({
      outfitId: z
        .string({ required_error: 'outfitId is required' })
        .regex(OBJECT_ID_REGEX, 'Invalid outfit ID format'),
      feedback: z.enum(['liked', 'disliked'], {
        errorMap: () => ({ message: "Feedback must be 'liked' or 'disliked'" }),
      }),
    })
    .strict(),
};

export const createConversationSchema = {
  body: z
    .object({
      title: z.string().trim().min(1).max(120).optional(),
    })
    .strict(),
};

export const conversationIdParamSchema = {
  params: z
    .object({
      conversationId: z
        .string({ required_error: 'conversationId is required' })
        .regex(OBJECT_ID_REGEX, 'Invalid conversation ID format'),
    })
    .strict(),
};

export const listConversationsSchema = {
  query: z
    .object({
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    })
    .strict(),
};

export const listMessagesSchema = {
  params: z
    .object({
      conversationId: z
        .string({ required_error: 'conversationId is required' })
        .regex(OBJECT_ID_REGEX, 'Invalid conversation ID format'),
    })
    .strict(),
  query: z
    .object({
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    })
    .strict(),
};

export const outfitIdParamSchema = {
  params: z
    .object({
      outfitId: z
        .string({ required_error: 'outfitId is required' })
        .regex(OBJECT_ID_REGEX, 'Invalid outfit ID format'),
    })
    .strict(),
};

export const listOutfitsSchema = {
  query: z
    .object({
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    })
    .strict(),
};

export const updatePreferencesSchema = {
  body: z
    .object({
      favoriteColors: z.array(z.string()).optional(),
      avoidedColors: z.array(z.string()).optional(),
      preferredFormality: z.string().nullable().optional(),
      sizes: z
        .object({
          top: z.string().trim().optional(),
          bottom: z.string().trim().optional(),
          shoes: z.string().trim().optional(),
          outerwear: z.string().trim().optional(),
        })
        .strict()
        .optional(),
      dislikedStyleTags: z.array(z.string().trim()).optional(),
      modestyPreference: z.enum(['modest', 'standard', 'relaxed']).optional(),
      notes: z.string().max(1000).trim().optional(),
    })
    .strict(),
};

export default {
  stylistRequestSchema,
  requestIdParamSchema,
  stylistFeedbackSchema,
  createConversationSchema,
  conversationIdParamSchema,
  listConversationsSchema,
  listMessagesSchema,
  outfitIdParamSchema,
  listOutfitsSchema,
  updatePreferencesSchema,
};
