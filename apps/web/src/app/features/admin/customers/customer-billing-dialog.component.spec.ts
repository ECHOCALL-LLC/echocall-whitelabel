import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ADMIN_TEXTS, provideTestI18n } from '../../../testing/i18n';
import { type CustomerBilling, CustomerBillingDialogComponent } from './customer-billing-dialog.component';

const URL = '/api/admin/customers/501/billing';

const STORED: CustomerBilling = {
  companyName: 'Mayer GmbH',
  billingStreet: 'Hauptstr. 1',
  billingPostalCode: '10115',
  billingCity: 'Berlin',
  billingCountry: 'DE',
  vatId: null,
  billingEmail: 'rechnung@example.com',
  billingCcEmail: 'chef@example.com',
};

describe('CustomerBillingDialogComponent', () => {
  let http: HttpTestingController;
  let snacks: string[];
  let closed: unknown[];

  async function render(billing: CustomerBilling = STORED) {
    snacks = [];
    closed = [];
    await TestBed.configureTestingModule({
      imports: [CustomerBillingDialogComponent, provideTestI18n()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: { customerId: 501, billing } },
        { provide: MatDialogRef, useValue: { close: (value?: unknown) => closed.push(value) } },
        { provide: MatSnackBar, useValue: { open: (message: string) => snacks.push(message) } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(CustomerBillingDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  afterEach(() => http.verify());

  it('starts from what is on file and sends only what changed, an emptied field as empty', async () => {
    const fixture = await render();
    const dialog = fixture.componentInstance;

    expect(dialog.form.controls.billingEmail.value).toBe('rechnung@example.com');
    dialog.form.patchValue({ billingCcEmail: '', vatId: ' DE123456789 ', billingCity: 'Berlin' });
    const done = dialog.submit();
    const request = http.expectOne(URL);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ vatId: 'DE123456789', billingCcEmail: '' });
    request.flush({ success: true });
    await done;

    expect(closed).toEqual([true]);
  });

  it('closes without a request when nothing changed', async () => {
    const fixture = await render();

    await fixture.componentInstance.submit();

    http.expectNone(URL);
    expect(closed).toEqual([undefined]);
  });

  it('refuses an address that is not one before it asks the service', async () => {
    const fixture = await render();
    const dialog = fixture.componentInstance;

    dialog.form.patchValue({ billingEmail: 'keine-adresse' });
    await dialog.submit();

    http.expectNone(URL);
    expect(dialog.form.controls.billingEmail.invalid).toBe(true);
    expect(closed).toEqual([]);
  });

  it('marks the field the service says does not fit, with the reason', async () => {
    const fixture = await render();
    const dialog = fixture.componentInstance;

    dialog.form.patchValue({ billingPostalCode: '1' });
    const done = dialog.submit();
    http
      .expectOne(URL)
      .flush(
        { error: { code: 'invalid_billing_details', message: 'invalid_postal_code' } },
        { status: 400, statusText: 'Bad Request' },
      );
    await done;
    fixture.detectChanges();

    expect(dialog.form.controls.billingPostalCode.hasError('server')).toBe(true);
    expect(snacks).toEqual([ADMIN_TEXTS.customer.billing.errors.invalid_postal_code]);
    expect(fixture.nativeElement.textContent).toContain(
      ADMIN_TEXTS.customer.billing.errors.invalid_postal_code,
    );
    expect(closed).toEqual([]);
  });

  it('keeps a country it does not list selectable instead of losing it', async () => {
    const fixture = await render({ ...STORED, billingCountry: 'Deutschland' });

    expect(fixture.componentInstance.countries()[0]).toEqual({ code: 'Deutschland', name: 'Deutschland' });
    expect(fixture.componentInstance.form.controls.billingCountry.value).toBe('Deutschland');
  });
});
