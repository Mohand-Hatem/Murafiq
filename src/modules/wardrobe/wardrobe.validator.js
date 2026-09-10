import { z } from 'zod';
import { WARDROBE_CATEGORIES } from './wardrobe-item.model.js';

// Trusted-host allowlist, mirroring the pattern already used for KYC document
// references (user.validator.js): the classification worker (gemini.config.js)
// server-side fetches whatever URL is stored here, so an unrestricted URL is an
// SSRF vector (internal network addresses, cloud metadata endpoints, etc).
// Wardrobe photos are only ever expected to arrive via POST /uploads/wardrobe,
// which stores them on Cloudinary and returns a res.cloudinary.com secure_url —
// so that host is the only one ever legitimately needed here.
const isCloudinaryUrl = (val) => {
  try {
    return new URL(val).hostname === 'res.cloudinary.com';
  } catch {
    return false;
  }
};

export const createWardrobeItemSchema = {
  body: z.object({
    imageUrl: z
      .string()
      .url('Invalid image URL format')
      .refine(isCloudinaryUrl, 'imageUrl must be a Cloudinary URL obtained via POST /uploads/wardrobe'),
  }).strict(),
};

export const updateWardrobeItemSchema = {
  body: z.object({
    category: z.enum(WARDROBE_CATEGORIES).optional(),
    primaryColor: z.string().min(1).max(50).optional(),
    secondaryColors: z.array(z.string().min(1).max(50)).optional(),
    pattern: z.string().min(1).max(50).optional(),
    formality: z.string().min(1).max(50).optional(),
    season: z.array(z.string().min(1).max(50)).optional(),
    material: z.string().min(1).max(50).optional(),
    styleTags: z.array(z.string().min(1).max(50)).optional(),
    aiDescription: z.string().min(1).max(500).optional(),
  }).strict(),
};

export const wardrobeQuerySchema = {
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    category: z.enum(WARDROBE_CATEGORIES).optional(),
    formality: z.string().optional(),
    season: z.string().optional(),
    search: z.string().optional(),
  }),
};
