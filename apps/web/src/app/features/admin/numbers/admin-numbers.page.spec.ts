import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { NotifyService } from '../../../core/notify/notify.service';
import { ADMIN_TEXTS, provideTestI18n } from '../../../testing/i18n';
import { AdminNumbersPage } from './admin-numbers.page';

const FREE = {
  id: 7,
  phoneNumber: '+4930111222',
  friendlyName: 'Berlin',
  country: 'Germany',
  numberType: 'local',
  monthlyPrice: '3.00',
  status: 'active',
  supportsInbound: true,
  supportsOutbound: false,
  ownerId: null,
};

/** The operator's own imported number, offered to its customers. */
const OWN_ON_SALE = {
  ...FREE,
  id: 9,
  phoneNumber: '+4989555666',
  monthlyPrice: '4.50',
  ownership: 'partner' as const,
  isAvailableForPurchase: true,
};

/** A platform number the operator bought into the portal’s stock (API 1.26.0). */
const BOUGHT = {
  ...FREE,
  id: 11,
  phoneNumber: '+4922177788',
  monthlyPrice: '2.50',
  ownership: 'platform' as const,
  resellerPoolSince: '2026-11-20T00:00:00.000Z',
  resellerPoolPrice: '2.50',
  isAvailableForPurchase: false,
};

const TAKEN = {
  phoneNumber: {
    id: 8,
    phoneNumber: '+4940333444',
    friendlyName: 'Hamburg',
    country: 'Germany',
    numberType: 'local',
    monthlyPrice: '3.00',
    status: 'active',
    supportsInbound: true,
    supportsOutbound: true,
    ownerId: 501,
    purchasedAt: '2026-09-01T00:00:00.000Z',
  },
  owner: { id: 501, email: 'lina@example.com', name: 'Lina Mayer' },
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AdminNumbersPage', () => {
  let http: HttpTestingController;
  let dialogResult: unknown;
  let notices: string[];

  beforeEach(async () => {
    dialogResult = undefined;
    notices = [];
    await TestBed.configureTestingModule({
      imports: [AdminNumbersPage, provideTestI18n()],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(dialogResult) }) } },
        {
          provide: NotifyService,
          useValue: {
            success: (key: string) => notices.push(key),
            error: (key: string) => notices.push(key),
            apiError: () => notices.push('apiError'),
          },
        },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function answerLoad(free: unknown[] = [FREE], taken: unknown[] = [TAKEN]) {
    http.expectOne('/api/admin/hub/resellers/phone-numbers/available').flush({ data: free });
    http.expectOne('/api/admin/hub/resellers/phone-numbers/assigned').flush({ data: taken });
    await settle();
  }

  async function render(free: unknown[] = [FREE], taken: unknown[] = [TAKEN]) {
    const fixture = TestBed.createComponent(AdminNumbersPage);
    await fixture.whenStable();
    await answerLoad(free, taken);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const tableRows = (fixture: { nativeElement: HTMLElement }, testId: string) =>
    Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${testId}"] tbody tr`)) as HTMLElement[];

  it('keeps the pool and the handed out numbers apart', async () => {
    const fixture = await render();

    const free = tableRows(fixture, 'available-table');
    expect(free).toHaveLength(1);
    expect(free[0].textContent).toContain('+4930111222');

    const taken = tableRows(fixture, 'assigned-table');
    expect(taken).toHaveLength(1);
    expect(taken[0].textContent).toContain('+4940333444');
    expect(taken[0].textContent).toContain('Lina Mayer');
  });

  it('says what each number can do', async () => {
    const fixture = await render();
    const row = tableRows(fixture, 'available-table')[0];

    expect(row.textContent).toContain(ADMIN_TEXTS.numbers.inbound);
    expect(row.textContent).not.toContain(ADMIN_TEXTS.numbers.outbound);
  });

  it('hands a number to the chosen customer and reads both lists again', async () => {
    const fixture = await render();
    dialogResult = { customerId: 501, chargeCustomer: false };

    fixture.componentInstance.assign(FREE);
    await settle();
    const request = http.expectOne('/api/admin/hub/resellers/phone-numbers/7/assign');

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ customerId: 501, chargeCustomer: false });
    request.flush({ success: true, charged: false, monthlyPrice: null, invoiceId: null });
    await settle();

    await answerLoad([], [TAKEN, { ...TAKEN, phoneNumber: { ...FREE, ownerId: 501 } }]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(tableRows(fixture, 'available-table')).toHaveLength(0);
    expect(tableRows(fixture, 'assigned-table')).toHaveLength(2);
  });

  it('does not call the hub when no customer was chosen', async () => {
    const fixture = await render();

    fixture.componentInstance.assign(FREE);
    await settle();

    http.expectNone('/api/admin/hub/resellers/phone-numbers/7/assign');
  });

  it('asks before taking a number back from a customer', async () => {
    const fixture = await render();

    fixture.componentInstance.release(TAKEN);
    await settle();
    http.expectNone('/api/admin/hub/resellers/phone-numbers/8/release');

    dialogResult = true;
    fixture.componentInstance.release(TAKEN);
    await settle();
    const request = http.expectOne('/api/admin/hub/resellers/phone-numbers/8/release');
    expect(request.request.method).toBe('POST');
    request.flush({ success: true });
    await settle();
    await answerLoad();
  });

  it('asks before removing a number from the pool for good', async () => {
    const fixture = await render();

    fixture.componentInstance.remove(FREE);
    await settle();
    http.expectNone('/api/admin/hub/resellers/phone-numbers/7');

    dialogResult = true;
    fixture.componentInstance.remove(FREE);
    await settle();
    const request = http.expectOne('/api/admin/hub/resellers/phone-numbers/7');
    expect(request.request.method).toBe('DELETE');
    request.flush({ success: true });
    await settle();
    await answerLoad();
  });

  it('reads both lists again after a number was imported', async () => {
    const fixture = await render();
    dialogResult = { phoneNumber: '+4930999888' };

    fixture.componentInstance.importNumber();
    await settle();
    await answerLoad();
  });

  it('says so instead of showing two empty tables', async () => {
    const fixture = await render([], []);
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain(ADMIN_TEXTS.numbers.empty);
    expect(text).toContain(ADMIN_TEXTS.numbers.emptyAssigned);
  });

  it('offers only the operator’s own numbers for sale and says which are on offer', async () => {
    const fixture = await render([{ ...FREE, ownership: 'platform' }, OWN_ON_SALE]);
    const [platform, own] = tableRows(fixture, 'available-table');

    expect(platform.querySelector('[data-testid="sale-start"]')).toBeNull();
    expect(platform.querySelector('[data-testid="sale-stop"]')).toBeNull();
    expect(own.querySelector('[data-testid="sale-state"]')?.textContent).toContain(
      ADMIN_TEXTS.numbers.onSale,
    );
    expect(own.querySelector('[data-testid="sale-stop"]')).not.toBeNull();
  });

  it('puts an own number on sale at the price the dialog asked for', async () => {
    const own = { ...OWN_ON_SALE, isAvailableForPurchase: false };
    const fixture = await render([own]);
    expect(tableRows(fixture, 'available-table')[0].textContent).toContain(ADMIN_TEXTS.numbers.notOnSale);
    dialogResult = { monthlyPrice: 5 };

    fixture.componentInstance.offer(own);
    await settle();
    const sale = http.expectOne('/api/admin/hub/resellers/phone-numbers/9/sale');

    expect(sale.request.method).toBe('PATCH');
    expect(sale.request.body).toEqual({ onSale: true, monthlyPrice: 5 });
    sale.flush({ success: true });
    await settle();
    await answerLoad();
  });

  it('takes a number off sale only after the confirmation', async () => {
    const fixture = await render([OWN_ON_SALE]);

    dialogResult = false;
    fixture.componentInstance.withdraw(OWN_ON_SALE);
    await settle();
    http.expectNone('/api/admin/hub/resellers/phone-numbers/9/sale');

    dialogResult = true;
    fixture.componentInstance.withdraw(OWN_ON_SALE);
    await settle();
    const sale = http.expectOne('/api/admin/hub/resellers/phone-numbers/9/sale');
    expect(sale.request.body).toEqual({ onSale: false });
    sale.flush({ success: true });
    await settle();
    await answerLoad();
  });

  it('marks a bought platform number and lets it go back instead of being removed', async () => {
    const fixture = await render([BOUGHT, OWN_ON_SALE, { ...FREE, ownership: 'platform' }]);
    const [bought, own, platform] = tableRows(fixture, 'available-table');

    expect(bought.querySelector('[data-testid="bought"]')).not.toBeNull();
    expect(bought.querySelector('[data-testid="return"]')).not.toBeNull();
    expect(bought.querySelector('[data-testid="delete"]')).toBeNull();
    expect(bought.querySelector('[data-testid="sale-start"]')).not.toBeNull();

    expect(own.querySelector('[data-testid="bought"]')).toBeNull();
    expect(own.querySelector('[data-testid="return"]')).toBeNull();
    expect(own.querySelector('[data-testid="delete"]')).not.toBeNull();

    // Neither the operator's nor bought: nothing to remove or give back, only to hand out.
    expect(platform.querySelector('[data-testid="return"]')).toBeNull();
    expect(platform.querySelector('[data-testid="delete"]')).toBeNull();
    expect(platform.querySelector('[data-testid="assign"]')).not.toBeNull();
  });

  it('says that a bought number on offer sells with the markup', async () => {
    const fixture = await render([{ ...BOUGHT, isAvailableForPurchase: true }]);
    const row = tableRows(fixture, 'available-table')[0];

    expect(row.querySelector('[data-testid="sale-state"]')?.textContent).toContain(
      ADMIN_TEXTS.numbers.onSaleMarkup,
    );
    expect(row.querySelector('[data-testid="sale-stop"]')).not.toBeNull();
    expect(row.querySelector('[data-testid="sale-price-change"]')).toBeNull();
  });

  it('offers a bought number without asking for a price, after the confirmation', async () => {
    const fixture = await render([BOUGHT]);

    dialogResult = false;
    fixture.componentInstance.offerBought(BOUGHT);
    await settle();
    http.expectNone('/api/admin/hub/resellers/phone-numbers/11/sale');

    dialogResult = true;
    fixture.componentInstance.offerBought(BOUGHT);
    await settle();
    const sale = http.expectOne('/api/admin/hub/resellers/phone-numbers/11/sale');
    expect(sale.request.method).toBe('PATCH');
    expect(sale.request.body).toEqual({ onSale: true });
    sale.flush({ success: true });
    await settle();
    await answerLoad();
  });

  it('gives a bought number back only after the confirmation', async () => {
    const fixture = await render([BOUGHT]);

    dialogResult = false;
    fixture.componentInstance.giveBack(BOUGHT);
    await settle();
    http.expectNone('/api/admin/hub/resellers/phone-numbers/11/return');

    dialogResult = true;
    fixture.componentInstance.giveBack(BOUGHT);
    await settle();
    const request = http.expectOne('/api/admin/hub/resellers/phone-numbers/11/return');
    expect(request.request.method).toBe('POST');
    request.flush({ success: true });
    await settle();
    await answerLoad([], [TAKEN]);
    expect(notices).toContain('admin.numbers.returned');
  });

  it('reads both lists again after a number was bought', async () => {
    const fixture = await render();
    dialogResult = { phoneNumber: '+4922177788' };

    fixture.componentInstance.buyNumber();
    await settle();
    await answerLoad([FREE, BOUGHT]);
    expect(notices).toContain('admin.numbers.bought');
  });

  it('bills the number to the customer when the dialog says so', async () => {
    const fixture = await render([BOUGHT]);
    dialogResult = { customerId: 501, chargeCustomer: true };

    fixture.componentInstance.assign(BOUGHT);
    await settle();
    const request = http.expectOne('/api/admin/hub/resellers/phone-numbers/11/assign');
    expect(request.request.body).toEqual({ customerId: 501, chargeCustomer: true });
    request.flush({ success: true, charged: true, monthlyPrice: '3.00', invoiceId: 77 });
    await settle();
    await answerLoad([], [TAKEN]);

    expect(notices).toEqual(['admin.numbers.assignedCharged']);
  });

  it('names the customer’s side when a billed assignment is refused', async () => {
    const fixture = await render([BOUGHT]);
    dialogResult = { customerId: 501, chargeCustomer: true };

    fixture.componentInstance.assign(BOUGHT);
    await settle();
    http
      .expectOne('/api/admin/hub/resellers/phone-numbers/11/assign')
      .flush(
        { error: { code: 'insufficient_balance', message: 'Insufficient balance of the customer' } },
        { status: 402, statusText: 'Payment Required' },
      );
    await settle();

    expect(notices).toEqual(['admin.numbers.chargeErrors.insufficient_balance']);
  });

  it('says for each handed out number whether the customer pays for it', async () => {
    const paid = {
      ...TAKEN,
      phoneNumber: { ...TAKEN.phoneNumber, id: 12, monthlyPrice: '4.00', resellerBaseMonthlyPrice: '3.00' },
    };
    const fixture = await render([], [TAKEN, paid]);
    const [free, charged] = tableRows(fixture, 'assigned-table');

    expect(free.querySelector('[data-testid="billing"]')?.textContent).toContain(
      ADMIN_TEXTS.numbers.customerFree,
    );
    expect(charged.querySelector('[data-testid="billing"]')?.textContent).toContain('Customer pays');
  });

  it('takes back only the operator’s own and bought numbers', async () => {
    const own = { ...TAKEN, phoneNumber: { ...TAKEN.phoneNumber, id: 13, ownership: 'partner' } };
    const bought = {
      ...TAKEN,
      phoneNumber: { ...TAKEN.phoneNumber, id: 14, ownership: 'platform', resellerPoolSince: '2026-11-20' },
    };
    const fixture = await render([], [TAKEN, own, bought]);
    const [platform, ownRow, boughtRow] = tableRows(fixture, 'assigned-table');

    expect(platform.querySelector('[data-testid="release"]')).toBeNull();
    expect(ownRow.querySelector('[data-testid="release"]')).not.toBeNull();
    expect(boughtRow.querySelector('[data-testid="release"]')).not.toBeNull();
  });
});
