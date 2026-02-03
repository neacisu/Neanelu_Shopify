import { z } from 'zod';

export const ExtractedSpecificationSchema = z.object({
  name: z.string().describe('Numele atributului'),
  value: z.string().describe('Valoarea atributului'),
  unit: z.string().optional().describe('Unitatea de masura'),
});

export const ExtractedPriceSchema = z
  .object({
    amount: z.number().optional().describe('Pretul numeric'),
    currency: z.string().default('RON').describe('Moneda ISO 4217'),
    isPromotional: z.boolean().default(false).describe('Pret promotional'),
  })
  .optional();

export const ExtractionConfidenceSchema = z.object({
  overall: z.number().min(0).max(1).describe('Scor de incredere 0-1'),
  fieldsUncertain: z.array(z.string()).default([]).describe('Campuri incerte'),
});

export const ExtractedProductSchema = z.object({
  title: z.string().describe('Titlul complet al produsului'),
  brand: z.string().optional().describe('Marca/Brandul'),
  mpn: z.string().optional().describe('Manufacturer Part Number'),
  gtin: z.string().optional().describe('GTIN/EAN/UPC 8-14 cifre'),
  category: z.string().optional().describe('Categoria produsului'),
  specifications: z
    .array(ExtractedSpecificationSchema)
    .default([])
    .describe('Lista de specificatii tehnice'),
  price: ExtractedPriceSchema,
  images: z.array(z.string().url()).default([]).describe('URL imagini produs'),
  confidence: ExtractionConfidenceSchema,
});

export type ExtractedProduct = z.infer<typeof ExtractedProductSchema>;
export type ExtractedSpecification = z.infer<typeof ExtractedSpecificationSchema>;
export type ExtractionConfidence = z.infer<typeof ExtractionConfidenceSchema>;
