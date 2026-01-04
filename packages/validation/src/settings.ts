import { z } from 'zod';

export const SettingsSchema = z.object({
  email: z.string().email('Email invalid'),
  shopDomain: z
    .string()
    .min(1, 'Shop domain este obligatoriu')
    .regex(/^[a-z0-9-]+\.myshopify\.com$/i, 'Format: store.myshopify.com'),
});

export type SettingsInput = z.infer<typeof SettingsSchema>;
