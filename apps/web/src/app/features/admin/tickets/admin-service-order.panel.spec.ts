import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { formatMoney } from '../../../core/format/money';
import { ADMIN_TEXTS, provideTestI18n } from '../../../testing/i18n';
import { AdminServiceOrderPanel } from './admin-service-order.panel';
import { ServiceOrderCancelDialogComponent } from './service-order-cancel-dialog.component';

const ORDER_URL = '/api/admin/hub/resellers/services/orders/by-ticket/31';
const BASE = '/api/admin/hub/resellers/services/orders/88';

const ORDER = {
  id: 88,
  ticketId: 31,
  status: 'open',
  name: 'Rufnummer einrichten',
  nameEn: 'Number setup',
  variantName: 'Mit Weiterleitung',
  variantNameEn: 'With forwarding',
  answers: { company: 'Mayer GmbH' },
  priceNet: 50,
  vatEur: 9.5,
  priceGross: 59.5,
  refundedEur: 0,
  customerId: 501,
  ownService: false,
  refundable: true,
  forwarded: null,
  forwardQuote: { netEur: 40, vatEur: 7.6, grossEur: 47.6, balanceEur: 120 },
  forwardBlocked: null,
  slaMinHours: 24,
  slaMaxHours: 48,
};

const eur = (value: number) => formatMoney(value, 'en');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AdminServiceOrderPanel', () => {
  let http: HttpTestingController;
  let snacks: string[];
  let opened: { component: unknown; data: unknown }[];
  let dialogResult: unknown;
  let changes: number;

  async function render(order: object | null = ORDER, status = 200) {
    snacks = [];
    opened = [];
    changes = 0;
    await TestBed.configureTestingModule({
      imports: [AdminServiceOrderPanel, provideTestI18n()],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatSnackBar, useValue: { open: (message: string) => snacks.push(message) } },
        {
          provide: MatDialog,
          useValue: {
            open: (component: unknown, config: { data: unknown }) => {
              opened.push({ component, data: config.data });
              return { afterClosed: () => of(dialogResult) };
            },
          },
        },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AdminServiceOrderPanel);
    fixture.componentRef.setInput('ticketId', '31');
    fixture.componentInstance.changed.subscribe(() => changes++);
    fixture.detectChanges();
    await fixture.whenStable();
    const request = http.expectOne(ORDER_URL);
    if (status === 200) request.flush({ data: order });
    else request.flush({ error: { code: 'not_found', message: 'Not found' } }, { status, statusText: 'Error' });
    await settle();
    fixture.detectChanges();
    return fixture;
  }

  const byTestId = (fixture: { nativeElement: HTMLElement }, id: string) =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  beforeEach(() => {
    dialogResult = undefined;
  });

  afterEach(() => http.verify());

  it('stays away when the ticket holds no order', async () => {
    const fixture = await render(null);

    expect(byTestId(fixture, 'service-order')).toBeNull();
  });

  it('stays quiet when the service does not know the ticket', async () => {
    const fixture = await render(null, 404);

    expect(byTestId(fixture, 'service-order')).toBeNull();
    expect(snacks).toEqual([]);
  });

  it('shows what was ordered, by whom, for how much and how fast', async () => {
    const fixture = await render();
    const text = byTestId(fixture, 'service-order')?.textContent ?? '';

    expect(text).toContain('Number setup');
    expect(text).toContain('With forwarding');
    expect(byTestId(fixture, 'service-status')?.textContent).toContain(ADMIN_TEXTS.serviceOrders.status.open);
    expect(byTestId(fixture, 'service-price')?.textContent).toContain(eur(59.5));
    expect(byTestId(fixture, 'service-buyer')?.getAttribute('href')).toBe('/admin/customers/501');
    expect(text).not.toContain('Mayer GmbH');
  });

  it('starts the work, says so and lets the page read the ticket again', async () => {
    const fixture = await render();

    expect(byTestId(fixture, 'service-finish')).toBeNull();
    byTestId(fixture, 'service-start')?.click();
    const request = http.expectOne(`${BASE}/status`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ status: 'in_progress' });
    request.flush({ data: { ...ORDER, status: 'in_progress' } });
    await settle();
    fixture.detectChanges();

    expect(snacks[0]).toContain(ADMIN_TEXTS.serviceOrders.status.in_progress);
    expect(changes).toBe(1);
    expect(byTestId(fixture, 'service-finish')).not.toBeNull();
    expect(byTestId(fixture, 'service-ask')).not.toBeNull();
  });

  it('explains how to ask the customer while it waits for them', async () => {
    const fixture = await render({ ...ORDER, status: 'waiting_customer' });

    expect(byTestId(fixture, 'service-ask-hint')?.textContent).toContain(ADMIN_TEXTS.serviceOrders.askHint);
    expect(byTestId(fixture, 'service-resume')).not.toBeNull();
    expect(byTestId(fixture, 'service-finish')).not.toBeNull();
  });

  it('cancels with the money back when asked to and names the amount', async () => {
    const fixture = await render();
    dialogResult = { refund: true };

    byTestId(fixture, 'service-cancel')?.click();
    expect(opened[0].component).toBe(ServiceOrderCancelDialogComponent);
    expect(opened[0].data).toEqual({ refundAmount: eur(59.5) });
    const request = http.expectOne(`${BASE}/cancel`);
    expect(request.request.body).toEqual({ refund: true });
    request.flush({ data: { ...ORDER, status: 'cancelled', refundedEur: 59.5 } });
    await settle();
    fixture.detectChanges();

    expect(snacks[0]).toContain(eur(59.5));
    expect(changes).toBe(1);
    expect(byTestId(fixture, 'service-actions')).toBeNull();
    expect(byTestId(fixture, 'service-refunded')?.textContent).toContain(eur(59.5));
  });

  it('offers no money back for an order that cost nothing', async () => {
    const fixture = await render({ ...ORDER, priceNet: 0, vatEur: 0, priceGross: 0, refundable: false });

    byTestId(fixture, 'service-cancel')?.click();

    expect(opened[0].data).toEqual({ refundAmount: null });
    expect(byTestId(fixture, 'service-price')?.textContent).toContain(ADMIN_TEXTS.serviceOrders.free);
  });

  it('hands the order on only after the cost was confirmed', async () => {
    const fixture = await render();
    dialogResult = true;

    byTestId(fixture, 'service-forward-open')?.click();
    expect((opened[0].data as { params: { gross: string } }).params.gross).toBe(eur(47.6));
    http
      .expectOne(`${BASE}/forward`)
      .flush({
        data: { orderId: 88, forwardedOrderId: 900, ticketId: 4711, netEur: 40, vatEur: 7.6, grossEur: 47.6, balanceAfter: 72.4 },
      });
    await settle();
    http.expectOne(ORDER_URL).flush({
      data: { ...ORDER, forwardQuote: null, forwarded: { orderId: 900, ticketId: 4711, status: 'open', priceGross: 47.6 } },
    });
    await settle();
    fixture.detectChanges();

    expect(snacks[0]).toContain('4711');
    expect(byTestId(fixture, 'service-forwarded')?.textContent).toContain('4711');
    expect(byTestId(fixture, 'service-forward')).toBeNull();
  });

  it('sends nothing when the forwarding is not confirmed', async () => {
    const fixture = await render();
    dialogResult = false;

    byTestId(fixture, 'service-forward-open')?.click();

    http.expectNone(`${BASE}/forward`);
  });

  it('says the balance is short instead of offering to hand the order on', async () => {
    const fixture = await render({ ...ORDER, forwardQuote: { ...ORDER.forwardQuote, balanceEur: 10 } });
    const button = byTestId(fixture, 'service-forward-open') as HTMLButtonElement;

    expect(byTestId(fixture, 'service-forward-short')?.textContent).toContain(eur(10));
    expect(button.disabled).toBe(true);
    fixture.componentInstance.forward(fixture.componentInstance.order()!);
    expect(opened).toEqual([]);
  });

  it('names a refusal of the forwarding in its own words', async () => {
    const fixture = await render();
    dialogResult = true;

    byTestId(fixture, 'service-forward-open')?.click();
    http
      .expectOne(`${BASE}/forward`)
      .flush(
        { error: { code: 'payment_required', message: 'Refused', details: { reason: 'INSUFFICIENT_BALANCE' } } },
        { status: 402, statusText: 'Payment Required' },
      );
    await settle();
    http.expectOne(ORDER_URL).flush({ data: ORDER });
    await settle();

    expect(snacks).toEqual([ADMIN_TEXTS.serviceOrders.forwardErrors.INSUFFICIENT_BALANCE]);
    expect(changes).toBe(0);
  });

  it('keeps the operator to their own service', async () => {
    const fixture = await render({ ...ORDER, ownService: true, forwardQuote: null });

    expect(byTestId(fixture, 'service-own')?.textContent).toContain(ADMIN_TEXTS.serviceOrders.ownHint);
    expect(byTestId(fixture, 'service-forward')).toBeNull();
    expect(byTestId(fixture, 'service-forward-blocked')).toBeNull();
  });

  it('says when the platform no longer offers the service', async () => {
    const fixture = await render({ ...ORDER, forwardQuote: null, forwardBlocked: 'NOT_AVAILABLE' });

    expect(byTestId(fixture, 'service-forward-blocked')?.textContent).toContain(
      ADMIN_TEXTS.serviceOrders.forwardErrors.NOT_AVAILABLE,
    );
  });
});
