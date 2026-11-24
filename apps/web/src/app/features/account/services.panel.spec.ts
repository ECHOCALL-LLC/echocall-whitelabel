import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { formatMoney } from '../../core/format/money';
import { provideTestI18n, USER_TEXTS } from '../../testing/i18n';
import { ServicesPanel } from './services.panel';

const CATALOG = {
  data: {
    eligible: true,
    vatPercent: 19,
    balanceEur: 200,
    services: [
      {
        id: 7,
        name: 'Einrichtung',
        nameEn: 'Setup',
        description: '',
        descriptionEn: 'We set it up.',
        priceNet: 0,
        placement: 'list',
        fields: [],
        variants: [
          { key: 'small', nameDe: 'Klein', nameEn: 'Small', priceNet: 50 },
          { key: 'large', nameDe: 'Groß', nameEn: 'Large', priceNet: 100 },
        ],
        slaMinHours: 24,
        slaMaxHours: 48,
      },
    ],
  },
};

const ORDERS = {
  data: [
    {
      id: 41,
      ticketId: 812,
      status: 'waiting_customer',
      name: 'Einrichtung',
      nameEn: 'Setup',
      variantName: 'Groß',
      variantNameEn: 'Large',
      priceGross: 119,
      refundedEur: 0,
      createdAt: '2026-11-20T09:00:00.000Z',
    },
  ],
};

describe('ServicesPanel', () => {
  let http: HttpTestingController;
  let snacks: string[];
  let dialogResult: unknown;

  beforeEach(async () => {
    snacks = [];
    dialogResult = undefined;
    await TestBed.configureTestingModule({
      imports: [ServicesPanel, provideTestI18n()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(dialogResult) }) } },
        { provide: MatSnackBar, useValue: { open: (message: string) => snacks.push(message) } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function flush(catalog: object | null = CATALOG, orders: object = ORDERS): void {
    http.expectOne('/api/hub/billing/services').flush(catalog);
    http.expectOne((req) => req.url === '/api/hub/billing/services/orders').flush(orders);
  }

  async function render(catalog: object | null = CATALOG, orders: object = ORDERS) {
    const fixture = TestBed.createComponent(ServicesPanel);
    fixture.detectChanges();
    flush(catalog, orders);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('lists the services with their starting price and turnaround, and the orders', async () => {
    const fixture = await render();
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Setup');
    expect(text).toContain('We set it up.');
    expect(text).toContain(USER_TEXTS.services.priceFrom.replace('{{amount}}', formatMoney(50, 'en')));
    expect(text).toContain(
      USER_TEXTS.services.turnaround.range.replace('{{min}}', '24').replace('{{max}}', '48'),
    );
    expect(text).toContain(USER_TEXTS.services.statuses.waiting_customer);
    expect(text).toContain('Large');
    expect(fixture.nativeElement.querySelector('a[href="/app/tickets/812"]')).not.toBeNull();
  });

  it('says when the account cannot order and shows no orders card without orders', async () => {
    const fixture = await render({ data: { ...CATALOG.data, eligible: false, services: [] } }, { data: [] });

    expect(fixture.nativeElement.textContent).toContain(USER_TEXTS.services.notEligible);
    expect(fixture.nativeElement.querySelector('[data-testid="services-orders"]')).toBeNull();
  });

  it('reports an answer given in the ticket', async () => {
    const fixture = await render();

    (fixture.nativeElement.querySelector('[data-testid="service-answered-41"]') as HTMLButtonElement).click();
    const request = http.expectOne('/api/hub/billing/services/orders/41/answered');
    expect(request.request.method).toBe('POST');
    request.flush({ data: { ...ORDERS.data[0], status: 'in_progress' } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fixture.componentInstance.orders()[0].status).toBe('in_progress');
    expect(snacks).toEqual([USER_TEXTS.services.orders.answeredSaved]);
  });

  it('names the ticket of a new order and loads the orders again', async () => {
    dialogResult = { orderId: 42, ticketId: 813, grossEur: 59.5 };
    const fixture = await render();

    const pending = fixture.componentInstance.open(fixture.componentInstance.catalog()!.services[0]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    flush();
    await pending;

    expect(snacks).toEqual([USER_TEXTS.services.ordered.replace('{{id}}', '813')]);
  });

  it('offers to try again when the services cannot be loaded', async () => {
    const fixture = await render(null);
    expect(fixture.componentInstance.state()).toBe('failed');

    (fixture.nativeElement.querySelector('[data-testid="services-retry"]') as HTMLButtonElement).click();
    flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.componentInstance.state()).toBe('ready');
  });
});
