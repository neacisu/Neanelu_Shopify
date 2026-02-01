export interface ShopPreferences {
  timezone: string;
  language: 'ro' | 'en';
  notificationsEnabled?: boolean;
}

export interface ShopGeneralSettings {
  shopName: string | null;
  shopDomain: string;
  shopEmail: string | null;
  preferences: ShopPreferences;
}
