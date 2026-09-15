import { z } from 'zod';
import {
  WARDROBE_CATEGORIES,
  WARDROBE_PATTERNS,
  WARDROBE_FORMALITIES,
  WARDROBE_SEASONS,
  WARDROBE_MATERIALS,
  WARDROBE_FITS,
  WARDROBE_COLOR_FAMILIES,
  WARDROBE_GENDER_PRESENTATIONS,
} from './wardrobe-item.model.js';

// Internal upload reference pattern produced by POST /uploads/wardrobe:
// murafiq/wardrobe/<userId>/<uuid>
// Verifiable on write against req.user.id to eliminate SSRF and cross-user classification abuse.
export const createWardrobeItemSchema = {
  body: z.object({
    uploadRef: z
      .string()
      .min(1, 'uploadRef is required')
      .regex(
        /^murafiq\/wardrobe\/[a-f0-9]{24}\/[a-zA-Z0-9_-]+$/,
        'uploadRef must be a valid namespaced Cloudinary reference from POST /uploads/wardrobe'
      ),
  }).strict(),
};

export const updateWardrobeItemSchema = {
  body: z.object({
    category: z.enum(WARDROBE_CATEGORIES).optional(),
    subcategory: z.string().min(1).max(50).optional(),
    primaryColor: z.string().min(1).max(50).optional(),
    secondaryColors: z.array(z.string().min(1).max(50)).optional(),
    pattern: z.enum(WARDROBE_PATTERNS).optional(),
    formality: z.enum(WARDROBE_FORMALITIES).optional(),
    season: z.array(z.enum(WARDROBE_SEASONS)).optional(),
    material: z.enum(WARDROBE_MATERIALS).optional(),
    fit: z.enum(WARDROBE_FITS).optional(),
    colorFamily: z.enum(WARDROBE_COLOR_FAMILIES).optional(),
    genderPresentation: z.enum(WARDROBE_GENDER_PRESENTATIONS).optional(),
    isArchived: z.boolean().optional(),
    lastWornAt: z.coerce.date().optional(),
    wearCount: z.coerce.number().int().min(0).optional(),
    styleTags: z.array(z.string().min(1).max(50)).optional(),
    aiDescription: z.string().min(1).max(500).optional(),
  }).strict(),
};

export const wardrobeQuerySchema = {
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    category: z.enum(WARDROBE_CATEGORIES).optional(),
    formality: z.enum(WARDROBE_FORMALITIES).optional(),
    genderPresentation: z.enum(WARDROBE_GENDER_PRESENTATIONS).optional(),
    subcategory: z.string().optional(),
    isArchived: z.enum(['true', 'false', 'all']).optional(),
    season: z.string().optional(),
    search: z.string().optional(),
  }),
};

export const saveFromChatSchema = {
  body: z
    .object({
      messageId: z
        .string({ required_error: 'messageId is required' })
        .trim()
        .min(1, 'messageId cannot be empty'),
    })
    .strict(),
};
