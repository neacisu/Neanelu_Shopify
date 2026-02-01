import { z } from 'zod';

const timezones =
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

export const ShopPreferencesSchema = z.object({
  timezone: z.string().refine((tz) => timezones.includes(tz), { message: 'Timezone invalid' }),
  language: z.enum(['ro', 'en']),
  notificationsEnabled: z.boolean().optional(),
});

export type ShopPreferencesInput = z.infer<typeof ShopPreferencesSchema>;
