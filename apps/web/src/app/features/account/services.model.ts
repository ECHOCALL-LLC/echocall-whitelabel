/** A service the account can order, as the catalog lists it. Prices are net in EUR. */
export interface ServiceField {
  key: string;
  type: 'text' | 'textarea' | 'country' | 'datetime';
  required: boolean;
  labelDe: string;
  labelEn: string;
}

export interface ServiceVariant {
  key: string;
  nameDe: string;
  nameEn: string;
  priceNet: number;
}

export interface ServiceOffer {
  id: number;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  priceNet: number;
  placement: 'list' | 'phone_numbers' | 'integration';
  integrationKey?: string | null;
  fields: ServiceField[];
  variants: ServiceVariant[];
  slaMinHours?: number | null;
  slaMaxHours?: number | null;
}

export interface ServiceCatalog {
  eligible: boolean;
  vatPercent: number;
  balanceEur: number;
  services: ServiceOffer[];
}

export type ServiceOrderStatus = 'open' | 'in_progress' | 'waiting_customer' | 'done' | 'cancelled';

export interface ServiceOrder {
  id: number;
  ticketId?: number | null;
  status: ServiceOrderStatus;
  name: string;
  nameEn: string;
  variantName?: string | null;
  variantNameEn?: string | null;
  priceGross: number;
  refundedEur: number;
  createdAt?: string | null;
}

/** The service texts come in German and English; French readers get the English ones. */
export function pickText(
  language: string,
  de: string | null | undefined,
  en: string | null | undefined,
): string {
  const german = (de ?? '').trim();
  const english = (en ?? '').trim();
  return language === 'de' ? german || english : english || german;
}

/** The lowest price to show in the list: a service with variants starts at its cheapest one. */
export function startingPrice(service: ServiceOffer): { net: number; from: boolean } {
  if (service.variants.length === 0) return { net: service.priceNet, from: false };
  const prices = service.variants.map((v) => v.priceNet);
  const net = Math.min(...prices);
  return { net, from: prices.some((p) => p !== net) };
}

/** Net, VAT and gross as the service books them: VAT rounded to the cent, gross the sum. */
export function vatSplit(net: number, vatPercent: number): { net: number; vat: number; gross: number } {
  const cents = Math.round(net * 100);
  const vatCents = Math.round((cents * vatPercent) / 100);
  return { net: cents / 100, vat: vatCents / 100, gross: (cents + vatCents) / 100 };
}

/** Which turnaround text applies, with its hours, or null when the service names none. */
export function turnaround(service: {
  slaMinHours?: number | null;
  slaMaxHours?: number | null;
}): { key: 'range' | 'upTo' | 'about'; min: number; max: number } | null {
  const min = service.slaMinHours ?? null;
  const max = service.slaMaxHours ?? null;
  if (min !== null && max !== null) {
    return min === max ? { key: 'about', min, max } : { key: 'range', min, max };
  }
  if (max !== null) return { key: 'upTo', min: 0, max };
  if (min !== null) return { key: 'about', min, max: min };
  return null;
}
