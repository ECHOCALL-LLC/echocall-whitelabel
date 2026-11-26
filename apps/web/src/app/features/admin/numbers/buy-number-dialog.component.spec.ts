import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { NotifyService } from '../../../core/notify/notify.service';
import { ADMIN_TEXTS, provideTestI18n } from '../../../testing/i18n';
import { BuyNumberDialogComponent } from './buy-number-dialog.component';

const OFFERS = {
  data: [
    {
      id: 31,
      phoneNumber: '+4922177788',
      friendlyName: null,
      countryCode: 'DE',
      country: 'Germany',
      numberType: 'local',
      monthlyPrice: '2.50',
    },
    {
      id: 32,
      phoneNumber: '+4930444555',
      friendlyName: null,
      countryCode: 'DE',
      country: 'Germany',
      numberType: 'local',
      monthlyPrice: '4.00',
    },
  ],
  vatPercent: 19,
  paymentReady: false,
};

const OFFERS_URL = '/api/admin/hub/resellers/phone-numbers/stock-offers';
const BUY_URL = '/api/admin/hub/resellers/phone-numbers/stock';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('BuyNumberDialogComponent', () => {
  let http: HttpTestingController;
  let closed: unknown;
  let notices: string[];

  beforeEach(async () => {
    closed = undefined;
    notices = [];
    await TestBed.configureTestingModule({
      imports: [BuyNumberDialogComponent, provideTestI18n()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatDialogRef, useValue: { close: (value: unknown) => (closed = value) } },
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

  async function render(offers: object = OFFERS) {
    const fixture = TestBed.createComponent(BuyNumberDialogComponent);
    await fixture.whenStable();
    http.expectOne(OFFERS_URL).flush(offers);
    await settle();
    fixture.detectChanges();
    return fixture;
  }

  const submitButton = (fixture: { nativeElement: HTMLElement }) =>
    fixture.nativeElement.querySelector('[data-testid="submit"]') as HTMLButtonElement;

  it('lists the platform numbers with their net monthly price', async () => {
    const fixture = await render();
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('+4922177788');
    expect(text).toContain('+4930444555');
    expect(text).toContain('€2.50');
    expect(submitButton(fixture).disabled).toBe(true);
  });

  it('names what the balance pays, VAT included, before anything is bought', async () => {
    const fixture = await render();

    fixture.componentInstance.form.setValue({ phoneNumberId: 31 });
    fixture.detectChanges();

    const summary = fixture.nativeElement.querySelector('[data-testid="buy-summary"]') as HTMLElement;
    expect(summary.textContent).toContain('€2.98');
    expect(summary.textContent).toContain('+4922177788');
    expect(submitButton(fixture).textContent).toContain('€2.98');
    expect(submitButton(fixture).disabled).toBe(false);
  });

  it('buys the chosen number and reports it back to the page', async () => {
    const fixture = await render();
    fixture.componentInstance.form.setValue({ phoneNumberId: 32 });

    void fixture.componentInstance.submit();
    const request = http.expectOne(BUY_URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ phoneNumberId: 32 });
    request.flush(
      {
        success: true,
        phoneNumber: { id: 32, phoneNumber: '+4930444555', monthlyPrice: '4.00' },
        invoiceId: 5,
      },
      { status: 201, statusText: 'Created' },
    );
    await settle();

    expect(closed).toEqual({ phoneNumber: '+4930444555' });
  });

  it('stays open on a refusal and reads the offers again', async () => {
    const fixture = await render();
    fixture.componentInstance.form.setValue({ phoneNumberId: 31 });

    void fixture.componentInstance.submit();
    http
      .expectOne(BUY_URL)
      .flush(
        { error: { code: 'insufficient_balance', message: 'Insufficient balance' } },
        { status: 402, statusText: 'Payment Required' },
      );
    await settle();

    expect(closed).toBeUndefined();
    expect(notices).toEqual(['apiError']);
    http.expectOne(OFFERS_URL).flush({ ...OFFERS, data: [OFFERS.data[1]] });
    await settle();
    expect(fixture.componentInstance.offers()).toHaveLength(1);
  });

  it('says so when the platform has no free number', async () => {
    const fixture = await render({ data: [], vatPercent: 19, paymentReady: true });

    expect(fixture.nativeElement.querySelector('[data-testid="buy-empty"]')?.textContent).toContain(
      ADMIN_TEXTS.numbers.buyDialog.empty,
    );
    expect(submitButton(fixture).disabled).toBe(true);
  });
});
