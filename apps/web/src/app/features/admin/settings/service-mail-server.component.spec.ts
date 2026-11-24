import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import adminDe from '../../../../../public/i18n/admin/de.json';
import adminFr from '../../../../../public/i18n/admin/fr.json';
import { AuthStore } from '../../../core/auth/auth.store';
import type { ResellerSmtp } from '../../../core/hub/hub.models';
import type { SessionUser } from '../../../core/models';
import { ADMIN_TEXTS, provideTestI18n } from '../../../testing/i18n';
import { MAIL_SERVER_RESULTS, resultCode, ServiceMailServerComponent } from './service-mail-server.component';

const OPERATOR: SessionUser = {
  id: 1,
  email: 'operator@example.com',
  role: 'admin',
  firstName: 'Olga',
  lastName: 'Operator',
  language: 'en',
  echocallCustomerId: null,
};

const STORED: ResellerSmtp = {
  id: 7,
  host: 'smtp.example.com',
  port: 465,
  secure: true,
  username: 'mailer',
  fromEmail: 'rechnung@example.com',
  fromName: 'Muster Telekom',
  requireTLS: true,
  ignoreTLS: false,
  rejectUnauthorized: false,
  isActive: true,
  lastTestedAt: '2026-11-20T09:30:00.000Z',
  testStatus: 'success',
  testError: null,
  totalEmailsSent: 12,
  failedEmailsCount: 0,
  lastEmailSentAt: null,
};

const OWN = {
  source: 'reseller',
  host: 'smtp.example.com',
  fromEmail: 'rechnung@example.com',
  fromName: 'Muster',
};
const NONE = { source: 'none', host: null, fromEmail: null, fromName: null };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ServiceMailServerComponent', () => {
  let http: HttpTestingController;
  let fragment: string | null;

  beforeEach(async () => {
    fragment = null;
    await TestBed.configureTestingModule({
      imports: [ServiceMailServerComponent, provideTestI18n()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              get fragment() {
                return fragment;
              },
            },
          },
        },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function answerLoad(stored: ResellerSmtp | null, effective: object) {
    http.expectOne('/api/admin/hub/resellers/smtp').flush({ data: stored });
    http.expectOne('/api/admin/hub/resellers/smtp/effective').flush({ data: effective });
    await settle();
  }

  async function render(stored: ResellerSmtp | null = STORED, effective: object = OWN) {
    TestBed.inject(AuthStore).setUser(OPERATOR);
    const fixture = TestBed.createComponent(ServiceMailServerComponent);
    fixture.detectChanges();
    await settle();
    await answerLoad(stored, effective);
    fixture.detectChanges();
    return fixture;
  }

  const byTestId = (root: HTMLElement, id: string) =>
    root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  it('shows which server the mails go through and fills the form without the password', async () => {
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;

    expect(byTestId(root, 'mail-server-source')?.textContent).toContain('smtp.example.com');
    expect(byTestId(root, 'mail-server-last-test')).not.toBeNull();
    expect(fixture.componentInstance.form.getRawValue()).toEqual({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      username: 'mailer',
      password: '',
      fromEmail: 'rechnung@example.com',
      fromName: 'Muster Telekom',
      isActive: true,
    });
    expect(fixture.componentInstance.form.controls.password.valid).toBe(true);
    expect(root.textContent).toContain(ADMIN_TEXTS.settings.mailServer.passwordKeep);
  });

  it('says plainly when no mail can reach the customers', async () => {
    const fixture = await render(null, NONE);
    const root = fixture.nativeElement as HTMLElement;

    expect(byTestId(root, 'mail-server-source')?.textContent).toContain(
      ADMIN_TEXTS.settings.mailServer.source.none,
    );
    expect(byTestId(root, 'mail-server-last-test')).toBeNull();
    // Without a stored server a password has to be typed and nothing can be tested yet.
    expect(fixture.componentInstance.form.controls.password.hasError('required')).toBe(true);
    expect(fixture.componentInstance.canTest()).toBe(false);
    expect((byTestId(root, 'mail-server-test') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the stored password and TLS details when only other fields change', async () => {
    const fixture = await render();
    const form = fixture.componentInstance.form;

    form.controls.fromName.setValue('  Muster Telekom Service ');
    form.markAsDirty();
    void fixture.componentInstance.save();
    await settle();
    const request = http.expectOne('/api/admin/hub/resellers/smtp');

    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      username: 'mailer',
      fromEmail: 'rechnung@example.com',
      fromName: 'Muster Telekom Service',
      isActive: true,
      requireTLS: true,
      ignoreTLS: false,
      rejectUnauthorized: false,
    });
    expect('password' in request.request.body).toBe(false);

    request.flush({ data: { saved: true } });
    await settle();
    await answerLoad(STORED, OWN);
  });

  it('sends a typed password exactly as typed and safe TLS defaults for a first server', async () => {
    const fixture = await render(null, NONE);
    const form = fixture.componentInstance.form;

    form.setValue({
      host: 'mail.example.org',
      port: 587,
      secure: false,
      username: 'billing',
      password: ' pass word ',
      fromEmail: 'billing@example.org',
      fromName: 'Example',
      isActive: true,
    });
    void fixture.componentInstance.save();
    await settle();
    const request = http.expectOne('/api/admin/hub/resellers/smtp');

    expect(request.request.body.password).toBe(' pass word ');
    expect(request.request.body.requireTLS).toBe(false);
    expect(request.request.body.ignoreTLS).toBe(false);
    expect(request.request.body.rejectUnauthorized).toBe(true);

    request.flush({ data: { saved: true } });
    await settle();
    await answerLoad(STORED, OWN);
  });

  it('refuses a host with a path or spaces and a port out of range before sending', async () => {
    const fixture = await render();
    const form = fixture.componentInstance.form;

    form.controls.host.setValue('smtp.example.com/evil');
    expect(form.controls.host.hasError('pattern')).toBe(true);
    form.controls.host.setValue('smtp.example.com');
    form.controls.port.setValue(70000);
    expect(form.controls.port.hasError('port')).toBe(true);

    await fixture.componentInstance.save();
    http.expectNone('/api/admin/hub/resellers/smtp');
  });

  it('asks to save first while the form has unsaved changes', async () => {
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.canTest()).toBe(true);

    fixture.componentInstance.form.controls.host.setValue('smtp2.example.com');
    fixture.componentInstance.form.markAsDirty();
    fixture.detectChanges();

    expect(fixture.componentInstance.canTest()).toBe(false);
    expect(byTestId(root, 'mail-server-save-first')).not.toBeNull();
    expect((byTestId(root, 'mail-server-test') as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends the test mail to the signed-in operator and reports success', async () => {
    const fixture = await render();

    void fixture.componentInstance.sendTest();
    await settle();
    const request = http.expectOne('/api/admin/hub/resellers/smtp/test-email');

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ toEmail: 'operator@example.com' });

    request.flush({ data: { success: true } });
    await settle();
    await answerLoad(STORED, OWN);
    fixture.detectChanges();

    const outcome = byTestId(fixture.nativeElement, 'mail-server-outcome');
    expect(outcome?.textContent).toContain('operator@example.com');
    expect(outcome?.classList.contains('failed')).toBe(false);
  });

  it('explains a refused test in words the operator can act on', async () => {
    const fixture = await render();

    void fixture.componentInstance.sendTest();
    await settle();
    http
      .expectOne('/api/admin/hub/resellers/smtp/test-email')
      .flush({ data: { success: false, code: 'auth', message: 'raw server text' } });
    await settle();
    await answerLoad({ ...STORED, testStatus: 'failed' }, OWN);
    fixture.detectChanges();

    const outcome = byTestId(fixture.nativeElement, 'mail-server-outcome');
    expect(outcome?.textContent).toContain(ADMIN_TEXTS.settings.mailServer.result.auth);
    expect(outcome?.textContent).not.toContain('raw server text');
    expect(outcome?.classList.contains('failed')).toBe(true);
  });

  it('falls back to a general text for a code it does not know', () => {
    expect(resultCode('auth')).toBe('auth');
    expect(resultCode('something_new')).toBe('unknown');
    expect(resultCode(undefined)).toBe('unknown');
    expect(resultCode('constructor')).toBe('unknown');
  });

  it('has a text for every result in all three languages', () => {
    for (const code of MAIL_SERVER_RESULTS) {
      expect(ADMIN_TEXTS.settings.mailServer.result[code]).toBeTruthy();
      expect(adminDe.settings.mailServer.result[code]).toBeTruthy();
      expect(adminFr.settings.mailServer.result[code]).toBeTruthy();
    }
  });

  it('brings itself into view when the notice links straight to it', async () => {
    fragment = 'mail-server';
    let scrolled = 0;
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {
      scrolled++;
    };
    try {
      const fixture = await render();
      await settle();

      expect(scrolled).toBe(1);
      expect(document.activeElement?.id).toBe('mail-server');
      fixture.destroy();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
