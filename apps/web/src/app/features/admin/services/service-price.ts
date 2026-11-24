import type { AbstractControl, ValidationErrors } from '@angular/forms';

/** The highest net price a service may have, as the service enforces it. */
export const MAX_SERVICE_PRICE = 100000;

/** "79,00", "79.00" or "79" to 79; null for anything that is not a price in euros and cents. */
export function parsePrice(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value <= MAX_SERVICE_PRICE ? value : null;
}

/** A price as the input shows it in the operator's language: a comma in German and French. */
export function priceInput(value: number, language: string): string {
  const fixed = value.toFixed(2);
  return language === 'en' ? fixed : fixed.replace('.', ',');
}

/** Accepts an empty field (the required check speaks for that) or a price. */
export function priceValidator(control: AbstractControl): ValidationErrors | null {
  const raw = control.value;
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  return parsePrice(raw) === null ? { price: true } : null;
}
