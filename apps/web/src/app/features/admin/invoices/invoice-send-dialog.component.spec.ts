import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { ADMIN_TEXTS, provideTestI18n, TEXTS } from '../../../testing/i18n';
import { InvoiceSendDialogComponent } from './invoice-send-dialog.component';

const PREVIEW_URL = '/api/admin/hub/resellers/invoices/21/email-preview';
const SEND_URL = '/api/admin/hub/resellers/invoices/21/send';

const PREVIEW = {
  invoiceId: 21,
  invoiceNumber: 'R7-202609-0001',
  status: 'draft',
  customerId: 501,
  to: 'rechnung@example.com',
  cc: 'chef@example.com',
  bccAddress: 'partner@example.com',
  lang: 'de',
  templateLang: 'de',
  customTemplate: false,
  subject: 'Ihre Rechnung R7-202609-0001',
  bodyText: 'Guten Tag,\nanbei Ihre Rechnung.',
  hasOwnSmtp: true,
  fromName: 'Partner GmbH',
  fromAddress: 'billing@partner.example',
  hasLogo: true,
  pdfFileName: 'R7-202609-0001.pdf',
  portalLink: 'https://service.example/r/partner/login',
  emailSentAt: null,
  emailSentTo: null,
  missingCompanyFields: [],
  dailyLimit: 200,
  sentToday: 3,
  problem: null,
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('InvoiceSendDialogComponent', () => {
  let http: HttpTestingController;
  let snacks: string[];
  let closed: unknown[];

  const previewRequest = (lang?: string): TestRequest =>
    http.expectOne(
      (req) => req.url === PREVIEW_URL && (lang ? req.params.get('lang') === lang : !req.params.has('lang')),
    );

  async function render(preview: object = PREVIEW) {
    snacks = [];
    closed = [];
    await TestBed.configureTestingModule({
      imports: [InvoiceSendDialogComponent, provideTestI18n()],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: { invoiceId: 21, invoiceNumber: 'R7-202609-0001' } },
        { provide: MatDialogRef, useValue: { close: (value: unknown) => closed.push(value) } },
        { provide: MatSnackBar, useValue: { open: (message: string) => snacks.push(message) } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(InvoiceSendDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    previewRequest().flush(preview);
    await settle();
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => http.verify());

  it('shows where the mail goes and sends it without the link into the service portal', async () => {
    const fixture = await render();
    const dialog = fixture.componentInstance;
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('rechnung@example.com');
    expect(text).toContain('chef@example.com');
    expect(text).toContain('Partner GmbH <billing@partner.example>');
    expect(text).toContain('R7-202609-0001.pdf');
    expect(dialog.form.controls.subject.value).toBe(PREVIEW.subject);
    expect(dialog.blocked()).toBe(false);

    dialog.form.patchValue({ subject: '  Ihre Rechnung für September ', bcc: true });
    const done = dialog.submit();
    const send = http.expectOne(SEND_URL);
    expect(send.request.method).toBe('POST');
    expect(send.request.body).toEqual({
      lang: 'de',
      subject: 'Ihre Rechnung für September',
      bodyText: PREVIEW.bodyText,
      bcc: true,
      portalLink: false,
    });
    const result = {
      success: true,
      invoiceId: 21,
      invoiceNumber: 'R7-202609-0001',
      status: 'sent',
      emailSentAt: '2026-11-24T09:00:00.000Z',
      emailSentTo: 'rechnung@example.com',
      via: 'own',
    };
    send.flush(result);
    await done;

    expect(closed).toEqual([result]);
  });

  it('blocks sending and leads to the customer when no billing email is on file', async () => {
    const fixture = await render({ ...PREVIEW, to: null, cc: null, problem: 'no_billing_email' });
    const problem = fixture.nativeElement.querySelector('[data-testid="mail-problem"]') as HTMLElement;
    const link = fixture.nativeElement.querySelector('[data-testid="mail-fix-customer"]') as HTMLAnchorElement;
    const send = fixture.nativeElement.querySelector('[data-testid="mail-send"]') as HTMLButtonElement;

    expect(problem.textContent).toContain(ADMIN_TEXTS.invoices.mail.problem.no_billing_email);
    expect(link.getAttribute('href')).toBe('/admin/customers/501');
    expect(send.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="mail-to"]').textContent).toContain(
      ADMIN_TEXTS.invoices.mail.noAddress,
    );

    await fixture.componentInstance.submit();
    http.expectNone(SEND_URL);
  });

  it('names the missing company details by the labels of the settings page', async () => {
    const fixture = await render({
      ...PREVIEW,
      problem: 'company_incomplete',
      missingCompanyFields: ['companyName', 'companyVatId'],
    });
    const problem = fixture.nativeElement.querySelector('[data-testid="mail-problem"]') as HTMLElement;

    expect(problem.textContent).toContain(ADMIN_TEXTS.settings.hub.companyName);
    expect(problem.textContent).toContain(ADMIN_TEXTS.settings.hub.vatId);
    expect(fixture.nativeElement.querySelector('[data-testid="mail-fix-company"]').getAttribute('href')).toBe(
      '/admin/settings',
    );
  });

  it('loads the text of another language and says when no template exists for it', async () => {
    const fixture = await render();
    const dialog = fixture.componentInstance;

    dialog.changeLanguage('fr');
    previewRequest('fr').flush({ ...PREVIEW, lang: 'fr', templateLang: 'en', subject: 'Your invoice' });
    await settle();
    fixture.detectChanges();

    expect(dialog.form.controls.subject.value).toBe('Your invoice');
    expect(fixture.nativeElement.textContent).toContain(ADMIN_TEXTS.invoices.mail.fallbackLang);
  });

  it('reports a refusal, stays open and reads the preview again so the reason shows', async () => {
    const fixture = await render();
    const dialog = fixture.componentInstance;

    const done = dialog.submit();
    http
      .expectOne(SEND_URL)
      .flush(
        { error: { code: 'invoice_email_no_billing_email', message: 'No billing email' } },
        { status: 409, statusText: 'Conflict' },
      );
    await done;
    previewRequest('de').flush({ ...PREVIEW, to: null, problem: 'no_billing_email' });
    await settle();

    expect(snacks).toEqual([TEXTS.errors.invoice_email_no_billing_email]);
    expect(closed).toEqual([]);
    expect(dialog.blocked()).toBe(true);
  });

  it('sends nothing when the subject is only spaces', async () => {
    const fixture = await render();
    const dialog = fixture.componentInstance;

    dialog.form.patchValue({ subject: '   ' });
    await dialog.submit();

    http.expectNone(SEND_URL);
    expect(dialog.form.controls.subject.hasError('required')).toBe(true);
  });

  it('offers to load the preview again when it could not be read', async () => {
    snacks = [];
    closed = [];
    await TestBed.configureTestingModule({
      imports: [InvoiceSendDialogComponent, provideTestI18n()],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: { invoiceId: 21, invoiceNumber: 'R7-202609-0001' } },
        { provide: MatDialogRef, useValue: { close: (value: unknown) => closed.push(value) } },
        { provide: MatSnackBar, useValue: { open: (message: string) => snacks.push(message) } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(InvoiceSendDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    previewRequest().flush({ error: { code: 'upstream_error' } }, { status: 502, statusText: 'Bad Gateway' });
    await settle();
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('[data-testid="mail-load-error"]') as HTMLElement;
    expect(error.textContent).toContain(ADMIN_TEXTS.invoices.mail.loadError);
    expect(fixture.componentInstance.blocked()).toBe(true);

    (error.querySelector('button') as HTMLButtonElement).click();
    previewRequest().flush(PREVIEW);
    await settle();
    expect(fixture.componentInstance.blocked()).toBe(false);
  });
});
