function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function isValidGTINFormat(gtin: string): boolean {
  const cleaned = digitsOnly(gtin);
  return (
    cleaned.length === 8 || cleaned.length === 12 || cleaned.length === 13 || cleaned.length === 14
  );
}

export function validateGTINChecksum(gtin: string): boolean {
  const cleaned = digitsOnly(gtin);
  if (!isValidGTINFormat(cleaned)) return false;

  const digits = cleaned.split('').map((d) => Number(d));
  const checkDigit = digits.pop();
  if (checkDigit === undefined) return false;

  while (digits.length < 13) digits.unshift(0);

  let sum = 0;
  for (const [index, digit] of digits.entries()) {
    sum += digit * (index % 2 === 0 ? 3 : 1);
  }

  const calculated = (10 - (sum % 10)) % 10;
  return calculated === checkDigit;
}

export function normalizeGTIN(gtin: string): string | null {
  const cleaned = digitsOnly(gtin);
  if (!isValidGTINFormat(cleaned)) return null;
  if (!validateGTINChecksum(cleaned)) return null;
  return cleaned.padStart(14, '0');
}
