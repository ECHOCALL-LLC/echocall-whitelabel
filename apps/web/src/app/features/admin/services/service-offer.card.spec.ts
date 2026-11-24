import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { formatMoney } from '../../../core/format/money';
import type { ResellerServiceOffer } from '../../../core/hub/hub.models';
import { ADMIN_TEXTS, provideTestI18n } from '../../../testing/i18n';
import { AdminServiceOfferCard } from './service-offer.card';

const SINGLE: ResellerServiceOffer = {
  positionId: 5,
  name: 'Rufnummer einrichten',
  nameEn: 'Number setup',
  enabled: true,
  price: { purchaseNet: 40, customerNet: 40, marginNet: 0, custom: false },
  variants: [],
  slaMinHours: 24,
  slaMaxHours: 48,
};

const VARIANTS: ResellerServiceOffer = {
  positionId: 6,
  name: 'Agent einrichten',
  nameEn: 'Agent setup',
  enabled: true,
  price: null,
  variants: [
    {
      key: 'basic',
      nameDe: 'Basis',
      nameEn: 'Basic',
      purchaseNet: 100,
      customerNet: 150,
      marginNet: 50,
      custom: true,
    },
    {
      key: 'pro',
      nameDe: 'Profi',
      nameEn: 'Pro',
      purchaseNet: 200,
      customerNet: 200,
      marginNet: 0,
      custom: false,
    },
  ],
  slaMinHours: null,
  slaMaxHours: null,
};

const URL = (id: number) => `/api/admin/hub/resellers/services/offers/${id}`;
const eur = (value: number) => formatMoney(value, 'en');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AdminServiceOfferCard', () => {
  let http: HttpTestingController;
  let snacks: string[];
  let saves: number;

  async function render(offer: ResellerServiceOffer) {
    snacks = [];
    saves = 0;
    await TestBed.configureTestingModule({
      imports: [AdminServiceOfferCard, provideTestI18n()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatSnackBar, useValue: { open: (message: string) => snacks.push(message) } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AdminServiceOfferCard);
    fixture.componentRef.setInput('offer', offer);
    fixture.componentInstance.saved.subscribe(() => saves++);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  const el = (fixture: { nativeElement: HTMLElement }, id: string) =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  function type(fixture: { nativeElement: HTMLElement; detectChanges(): void }, id: string, value: string) {
    const input = el(fixture, id) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  const saveButton = (fixture: { nativeElement: HTMLElement }) =>
    el(fixture, 'offer-save') as HTMLButtonElement;

  afterEach(() => http.verify());

  it('shows the purchase price, an empty own price and nothing earned yet', async () => {
    const fixture = await render(SINGLE);

    expect(fixture.nativeElement.textContent).toContain('Number setup');
    // The title names it; the single price line does not repeat the name.
    expect(fixture.nativeElement.textContent.split('Number setup').length - 1).toBe(1);
    expect(fixture.nativeElement.textContent).toContain(eur(40));
    expect((el(fixture, 'offer-price-base') as HTMLInputElement).value).toBe('');
    expect((el(fixture, 'offer-price-base') as HTMLInputElement).placeholder).toBe('40.00');
    expect(el(fixture, 'offer-margin-base')?.textContent).toContain(eur(0));
    expect(saveButton(fixture).disabled).toBe(true);
  });

  it('shows the margin of a price and saves it as the one price', async () => {
    const fixture = await render(SINGLE);

    type(fixture, 'offer-price-base', '55');
    expect(el(fixture, 'offer-margin-base')?.textContent).toContain('+' + eur(15));
    expect(saveButton(fixture).disabled).toBe(false);
    saveButton(fixture).click();
    const request = http.expectOne(URL(5));
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ enabled: true, price: 55 });
    request.flush({ data: { ok: true } });
    await settle();

    expect(snacks).toEqual([ADMIN_TEXTS.services.offers.saved.replace('{{name}}', 'Number setup')]);
    expect(saves).toBe(1);
  });

  it('will not save a price below the purchase price or one that is not a price', async () => {
    const fixture = await render(SINGLE);

    type(fixture, 'offer-price-base', '30');
    expect(fixture.nativeElement.textContent).toContain(
      ADMIN_TEXTS.services.offers.minimum.replace('{{price}}', eur(40)),
    );
    expect(saveButton(fixture).disabled).toBe(true);

    type(fixture, 'offer-price-base', '4o');
    expect(fixture.nativeElement.textContent).toContain(ADMIN_TEXTS.services.offers.errors.PRICE_INVALID);
    expect(saveButton(fixture).disabled).toBe(true);
  });

  it('prices each variant on its own and sends them together', async () => {
    const fixture = await render(VARIANTS);

    expect((el(fixture, 'offer-price-basic') as HTMLInputElement).value).toBe('150.00');
    expect(el(fixture, 'offer-margin-basic')?.textContent).toContain('+' + eur(50));
    expect((el(fixture, 'offer-price-pro') as HTMLInputElement).value).toBe('');
    type(fixture, 'offer-price-pro', '250.50');
    saveButton(fixture).click();
    const request = http.expectOne(URL(6));
    expect(request.request.body).toEqual({ enabled: true, variantPrices: { basic: 150, pro: 250.5 } });
    request.flush({ data: { ok: true } });
    await settle();
    expect(saves).toBe(1);
  });

  it('switches a service off for the customers', async () => {
    const fixture = await render(SINGLE);

    (fixture.nativeElement.querySelector('[data-testid="offer-enabled"] input') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(el(fixture, 'offer-off')?.textContent).toContain(ADMIN_TEXTS.services.offers.offHint);
    expect(el(fixture, 'offer-price-base')).toBeNull();
    saveButton(fixture).click();
    const request = http.expectOne(URL(5));
    expect(request.request.body).toEqual({ enabled: false, price: null });
    request.flush({ data: { ok: true } });
    await settle();
  });

  it('says in its own words when the service finds a price too low, and keeps the form', async () => {
    const fixture = await render(SINGLE);

    type(fixture, 'offer-price-base', '45');
    saveButton(fixture).click();
    http
      .expectOne(URL(5))
      .flush(
        { error: { code: 'validation_error', message: 'x', details: { reason: 'PRICE_BELOW_COST' } } },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle();

    expect(snacks).toEqual([ADMIN_TEXTS.services.offers.errors.PRICE_BELOW_COST]);
    expect(saves).toBe(0);
    expect((el(fixture, 'offer-price-base') as HTMLInputElement).value).toBe('45');
  });

  it('asks the page to read the list again when the service is gone', async () => {
    const fixture = await render(SINGLE);

    type(fixture, 'offer-price-base', '45');
    saveButton(fixture).click();
    http
      .expectOne(URL(5))
      .flush(
        { error: { code: 'not_found', message: 'x', details: { reason: 'NOT_FOUND' } } },
        { status: 404, statusText: 'Not Found' },
      );
    await settle();

    expect(snacks).toEqual([ADMIN_TEXTS.services.offers.errors.NOT_FOUND]);
    expect(saves).toBe(1);
  });
});
