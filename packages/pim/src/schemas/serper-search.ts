import { z } from 'zod';

export const SerperOrganicResultSchema = z.object({
  title: z.string(),
  link: z.string().url(),
  snippet: z.string().optional(),
  position: z.number(),
  sitelinks: z
    .array(
      z.object({
        title: z.string(),
        link: z.string().url(),
      })
    )
    .optional(),
});

export const SerperShoppingResultSchema = z.object({
  title: z.string(),
  link: z.string().url(),
  price: z.string().optional(),
  source: z.string().optional(),
  rating: z.number().optional(),
  ratingCount: z.number().optional(),
  delivery: z.string().optional(),
});

export const SerperKnowledgeGraphSchema = z.object({
  title: z.string().optional(),
  type: z.string().optional(),
  description: z.string().optional(),
  descriptionSource: z.string().optional(),
  descriptionLink: z.string().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
});

export const SerperResponseSchema = z.object({
  searchParameters: z.object({
    q: z.string(),
    type: z.string().optional(),
    engine: z.string().optional(),
  }),
  organic: z.array(SerperOrganicResultSchema).optional().default([]),
  shopping: z.array(SerperShoppingResultSchema).optional().default([]),
  knowledgeGraph: SerperKnowledgeGraphSchema.optional(),
  credits: z.number().optional(),
});

export type SerperResponse = z.infer<typeof SerperResponseSchema>;
export type SerperOrganicResult = z.infer<typeof SerperOrganicResultSchema>;
export type SerperShoppingResult = z.infer<typeof SerperShoppingResultSchema>;
