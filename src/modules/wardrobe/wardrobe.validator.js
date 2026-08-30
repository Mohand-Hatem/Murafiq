import { z } from 'zod';
import { WARDROBE_CATEGORIES } from './wardrobe-item.model.js';

export const createWardrobeItemSchema = {
  body: z.object({
    imageUrl: z.string().url('Invalid image URL format'),
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
