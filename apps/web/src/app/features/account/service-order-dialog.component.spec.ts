import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { formatMoney } from '../../core/format/money';
import { provideTestI18n, TEXTS, USER_TEXTS } from '../../testing/i18n';
import { ServiceOrderDialogComponent, type ServiceOrderDialogData } from './service-order-dialog.component';
import type { ServiceOffer } from './services.model';

const SETUP: ServiceOffer = {
  id: 7,
  name: 'Einrichtung',
  nameEn: 'Setup',
  description: 'Wir richten es ein.',
  descriptionEn: 'We set it up.',
  priceNet: 0,
  placement: 'list',
  fields: [
    { key: 'company', type: 'text', required: true, labelDe: 'Firma', labelEn: 'Company' },
    { key: 'country', type: 'country', required: true, labelDe: 'Land', labelEn: 'Country' },
    { key: 'when', type: 'datetime', required: false, labelDe: 'Termin', labelEn: 'Appointment' },
    { key: 'notes', type: 'textarea', required: false, labelDe: 'Notizen', labelEn: 'Notes' },
  ],
  variants: [
    { key: 'small', nameDe: 'Klein', nameEn: 'Small', priceNet: 50 },
    { key: 'large', nameDe: 'Groß', nameEn: 'Large', priceNet: 100 },
  ],
  slaMinHours: 24,
  slaMaxHours: 48,
};

describe('ServiceOrderDialogComponent', () => {
  let http: HttpTestingController;
  let snacks: string[];
  let closed: unknown[];

  async function render(data: Partial<ServiceOrderDialogData> = {}) {
    snacks = [];
    closed = [];
    await TestBed.configureTestingModule({
      imports: [ServiceOrderDialogComponent, provideTestI18n()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: { service: SETUP, vatPercent: 19, balanceEur: 500, ...data } },
        { provide: MatDialogRef, useValue: { close: (value: unknown) => closed.push(value) } },
        { provide: MatSnackBar, useValue: { open: (message: string) => snacks.push(message) } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ServiceOrderDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  afterEach(() => http.verify());

  it('shows the price with VAT once a variant is chosen and orders with the answers', async () => {
    const fixture = await render();
    const dialog = fixture.componentInstance;

    expect(dialog.price()).toBeNull();
    expect(dialog.ready()).toBe(false);
    dialog.variantKey.set('large');
    expect(dialog.price()).toEqual({ net: 100, vat: 19, gross: 119 });
    // Required answers are still missing.
    expect(dialog.ready()).toBe(false);

    dialog.answer('company', '  Praxis Sonne ');
    dialog.answer('country', 'at');
    dialog.answer('when', '2030-05-04T10:30');
    expect(dialog.ready()).toBe(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(formatMoney(119, 'en'));

    const pending = dialog.order();
    const request = http.expectOne('/api/hub/billing/services/orders');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      positionId: 7,
      variantKey: 'large',
      answers: { company: 'Praxis Sonne', country: 'AT', when: new Date('2030-05-04T10:30').toISOString() },
    });
    request.flush({ data: { orderId: 31, ticketId: 812, grossEur: 119 } });
    await pending;

    expect(closed).toEqual([{ orderId: 31, ticketId: 812, grossEur: 119 }]);
  });

  it('says how much is missing and does not offer to order with too little balance', async () => {
    const fixture = await render({ balanceEur: 20 });
    fixture.componentInstance.variantKey.set('small');
    fixture.detectChanges();

    expect(fixture.componentInstance.missing()).toBe(39.5);
    expect(fixture.nativeElement.querySelector('[data-testid="service-balance-short"]')).not.toBeNull();
    const submit = fixture.nativeElement.querySelector(
      '[data-testid="service-order-submit"]',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('names the shortfall the service reports', async () => {
    const fixture = await render();
    const dialog = fixture.componentInstance;
    dialog.variantKey.set('small');
    dialog.answer('company', 'Praxis');
    dialog.answer('country', 'DE');

    const pending = dialog.order();
    http.expectOne('/api/hub/billing/services/orders').flush(
      {
        error: {
          code: 'payment_required',
          message: 'short',
          details: { reason: 'INSUFFICIENT_BALANCE', balanceEur: 40, grossEur: 59.5 },
        },
      },
      { status: 402, statusText: 'Payment Required' },
    );
    await pending;

    expect(snacks).toEqual([
      USER_TEXTS.services.order.errors.balance.replace('{{missing}}', formatMoney(19.5, 'en')),
    ]);
    expect(closed).toEqual([]);
  });

  it('marks the field the service refused', async () => {
    const fixture = await render();
    const dialog = fixture.componentInstance;
    dialog.variantKey.set('small');
    dialog.answer('company', 'Praxis');
    dialog.answer('country', 'DE');

    const pending = dialog.order();
    http.expectOne('/api/hub/billing/services/orders').flush(
      {
        error: {
          code: 'validation_error',
          message: 'bad',
          details: { reason: 'ANSWER_INVALID', field: 'country' },
        },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await pending;

    expect(dialog.fieldErrors()).toEqual({ country: 'invalid' });
    expect(snacks).toEqual([USER_TEXTS.services.order.errors.invalid]);
    // Changing the answer clears the mark.
    dialog.answer('country', 'AT');
    expect(dialog.fieldErrors()).toEqual({});
  });

  it('asks for the billing details when they are incomplete', async () => {
    const fixture = await render({ service: { ...SETUP, variants: [], priceNet: 10, fields: [] } });
    const dialog = fixture.componentInstance;
    expect(dialog.ready()).toBe(true);

    const pending = dialog.order();
    const request = http.expectOne('/api/hub/billing/services/orders');
    expect(request.request.body).toEqual({ positionId: 7, answers: {} });
    request.flush(
      {
        error: {
          code: 'precondition_failed',
          message: 'x',
          details: { reason: 'BILLING_PROFILE_INCOMPLETE' },
        },
      },
      { status: 412, statusText: 'Precondition Failed' },
    );
    await pending;

    expect(snacks).toEqual([TEXTS.errors.billing_profile_incomplete]);
  });
});
