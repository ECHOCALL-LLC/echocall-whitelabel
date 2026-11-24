import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideTestI18n, TEXTS } from '../../testing/i18n';
import { WarningMailsPanel } from './warning-mails.panel';

const CUSTOMER_SETTINGS = {
  data: {
    partner: false,
    settings: [
      { category: 'numbers', interval: 'off' },
      { category: 'integrations', interval: 'daily' },
    ],
  },
};

const OPERATOR_SETTINGS = {
  data: {
    partner: true,
    settings: [
      { category: 'balance', interval: 'event' },
      { category: 'customer_orders', interval: 'off' },
    ],
  },
};

describe('WarningMailsPanel', () => {
  let http: HttpTestingController;
  let snacks: string[];

  beforeEach(async () => {
    snacks = [];
    await TestBed.configureTestingModule({
      imports: [WarningMailsPanel, provideTestI18n()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatSnackBar, useValue: { open: (message: string) => snacks.push(message) } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render(operator: boolean, body: object | null) {
    const fixture = TestBed.createComponent(WarningMailsPanel);
    fixture.componentRef.setInput('operator', operator);
    fixture.detectChanges();
    http
      .expectOne(operator ? '/api/admin/hub/users/me/warning-mails' : '/api/hub/users/me/warning-mails')
      .flush(body);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    return fixture;
  }

  it('lists the warnings the customer can get, with their own texts', async () => {
    const fixture = await render(false, CUSTOMER_SETTINGS);
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain(TEXTS.account.warningMails.categories.numbers.title);
    expect(text).toContain(TEXTS.account.warningMails.categories.integrations.description);
    expect(text).not.toContain(TEXTS.account.warningMails.categories.balance.title);
    expect(text).toContain(TEXTS.account.warningMails.alwaysSent);
  });

  it('names the portal balance and the customer purchases for the operator', async () => {
    const fixture = await render(true, OPERATOR_SETTINGS);
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain(TEXTS.account.warningMails.categories.balancePortal.title);
    expect(text).toContain(TEXTS.account.warningMails.categories.customerOrders.title);
    expect(text).toContain(TEXTS.account.warningMails.intervals.balance.event);
  });

  it('saves a choice at once through the same surface', async () => {
    const fixture = await render(true, OPERATOR_SETTINGS);

    const pending = fixture.componentInstance.change('customer_orders', 'weekly');
    const request = http.expectOne('/api/admin/hub/users/me/warning-mails/customer_orders');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ interval: 'weekly' });
    expect(fixture.componentInstance.settings()[1].interval).toBe('weekly');
    request.flush({ data: { category: 'customer_orders', interval: 'weekly' } });
    await pending;

    expect(snacks).toEqual([TEXTS.account.warningMails.savedOn]);
  });

  it('puts the old choice back when the save fails', async () => {
    const fixture = await render(false, CUSTOMER_SETTINGS);

    const pending = fixture.componentInstance.change('integrations', 'off');
    http
      .expectOne('/api/hub/users/me/warning-mails/integrations')
      .flush(
        { error: { code: 'impersonation_read_only', message: 'read only' } },
        { status: 403, statusText: 'Forbidden' },
      );
    await pending;

    expect(fixture.componentInstance.settings()[1].interval).toBe('daily');
    expect(snacks).toEqual([TEXTS.errors.impersonation_read_only]);
  });

  it('offers to try again when the settings cannot be loaded', async () => {
    const fixture = await render(false, null);
    // A body without data counts as a failed load.
    expect(fixture.componentInstance.state()).toBe('failed');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(TEXTS.account.warningMails.loadFailed);

    (fixture.nativeElement.querySelector('[data-testid="warning-mails-retry"]') as HTMLButtonElement).click();
    http.expectOne('/api/hub/users/me/warning-mails').flush(CUSTOMER_SETTINGS);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.componentInstance.state()).toBe('ready');
  });
});
