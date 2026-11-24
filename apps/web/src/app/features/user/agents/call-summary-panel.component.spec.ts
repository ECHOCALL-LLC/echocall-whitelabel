import { Clipboard } from '@angular/cdk/clipboard';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { provideTestI18n, USER_TEXTS } from '../../../testing/i18n';
import { CallSummaryPanelComponent, type CallSummaryView, phoneShape } from './call-summary-panel.component';

const URL = '/api/hub/agents/agent_12/call-summary';

const VIEW: CallSummaryView = {
  agentId: 'agent_12',
  available: true,
  enabled: false,
  email: null,
  anonymous: false,
  vipNumbers: [],
  phoneNumbers: [
    {
      number: '+493012345678',
      forwardingCodes: [
        { kind: 'busy', on: '**67*03012345678#', off: '##67#' },
        { kind: 'noAnswer', on: '**61*03012345678#', off: '##61#' },
        { kind: 'unreachable', on: '**62*03012345678#', off: '##62#' },
        { kind: 'allConditional', on: '**004*03012345678#', off: '##004#' },
      ],
    },
  ],
};

describe('CallSummaryPanelComponent', () => {
  let http: HttpTestingController;
  let snacks: string[];
  let copyWorks: boolean;
  let copiedText: string | null;

  beforeEach(async () => {
    snacks = [];
    copyWorks = true;
    copiedText = null;
    await TestBed.configureTestingModule({
      imports: [CallSummaryPanelComponent, provideTestI18n()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MatSnackBar, useValue: { open: (message: string) => snacks.push(message) } },
        {
          provide: Clipboard,
          useValue: {
            copy: (text: string) => {
              copiedText = text;
              return copyWorks;
            },
          },
        },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render(view: CallSummaryView | null = VIEW) {
    const fixture = TestBed.createComponent(CallSummaryPanelComponent);
    fixture.componentRef.setInput('agentId', 'agent_12');
    fixture.detectChanges();
    http.expectOne(URL).flush(view ? { data: view } : null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function text(fixture: { nativeElement: HTMLElement }): string {
    return fixture.nativeElement.textContent ?? '';
  }

  it('starts switched off and lists the forwarding codes of the number', async () => {
    const fixture = await render();
    const cs = USER_TEXTS.agents.callSummary;

    expect(fixture.componentInstance.form.controls.enabled.value).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="call-summary-email"]')).toBeNull();
    expect(text(fixture)).toContain(cs.forwarding.kind.noAnswer);
    expect(text(fixture)).toContain('**61*03012345678#');
    expect(text(fixture)).toContain(cs.forwarding.howTo);
    // Nothing changed yet, so there is nothing to save.
    const save = fixture.nativeElement.querySelector(
      '[data-testid="call-summary-save"]',
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('switches on with the address and the important numbers', async () => {
    const fixture = await render();
    const panel = fixture.componentInstance;

    panel.form.controls.enabled.setValue(true);
    panel.form.markAsDirty();
    // On without an address is not ready to save.
    expect(panel.form.invalid).toBe(true);
    panel.form.controls.email.setValue(' praxis@example.org ');
    panel.addVip();
    panel.vipNumbers.at(0).setValue({ label: ' Mama ', number: '0171 1234567' });
    expect(panel.form.valid).toBe(true);

    const pending = panel.save();
    const request = http.expectOne(URL);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({
      enabled: true,
      email: 'praxis@example.org',
      anonymous: false,
      vipNumbers: [{ label: 'Mama', number: '0171 1234567' }],
    });
    request.flush({
      data: {
        ...VIEW,
        enabled: true,
        email: 'praxis@example.org',
        vipNumbers: [{ label: 'Mama', number: '+491711234567' }],
      },
    });
    await pending;

    expect(snacks).toEqual([USER_TEXTS.agents.callSummary.savedOn]);
    expect(panel.vipNumbers.at(0).controls.number.value).toBe('+491711234567');
    expect(panel.form.pristine).toBe(true);
  });

  it('switches off with only the switch, even with a half typed address', async () => {
    const fixture = await render({ ...VIEW, enabled: true, email: 'praxis@example.org' });
    const panel = fixture.componentInstance;

    panel.form.controls.email.setValue('kaputt');
    panel.form.controls.enabled.setValue(false);
    panel.form.markAsDirty();
    expect(panel.form.valid).toBe(true);

    const pending = panel.save();
    const request = http.expectOne(URL);
    expect(request.request.body).toEqual({ enabled: false });
    request.flush({ data: { ...VIEW, email: 'praxis@example.org' } });
    await pending;

    expect(snacks).toEqual([USER_TEXTS.agents.callSummary.savedOff]);
  });

  it('explains an agent without call data and keeps the switch off', async () => {
    const fixture = await render({ ...VIEW, available: false });

    expect(fixture.nativeElement.querySelector('[data-testid="call-summary-zero-pii"]')).not.toBeNull();
    expect(text(fixture)).toContain(USER_TEXTS.agents.callSummary.zeroPii.title);
    expect(fixture.componentInstance.form.controls.enabled.disabled).toBe(true);
  });

  it('marks the important number the service refused', async () => {
    const fixture = await render({
      ...VIEW,
      enabled: true,
      email: 'praxis@example.org',
      vipNumbers: [
        { label: 'Mama', number: '+491711234567' },
        { label: 'Papa', number: '+491711234568' },
      ],
    });
    const panel = fixture.componentInstance;
    panel.form.markAsDirty();

    const pending = panel.save();
    http
      .expectOne(URL)
      .flush(
        { error: { code: 'validation_error', message: 'bad', details: { reason: 'INVALID_VIP', index: 1 } } },
        { status: 400, statusText: 'Bad Request' },
      );
    await pending;

    expect(snacks).toEqual([USER_TEXTS.agents.callSummary.errors.invalidVip.replace('{{n}}', '2')]);
    expect(panel.vipNumbers.at(1).controls.number.errors).toEqual({ server: true });
    expect(panel.vipNumbers.at(0).controls.number.errors).toBeNull();
  });

  it('names the reasons the service gives, and a failure on its side', async () => {
    const fixture = await render({ ...VIEW, enabled: true, email: 'praxis@example.org' });
    const panel = fixture.componentInstance;
    panel.form.markAsDirty();

    let pending = panel.save();
    http
      .expectOne(URL)
      .flush(
        { error: { code: 'conflict', message: 'zero pii', details: { reason: 'ZERO_PII' } } },
        { status: 409, statusText: 'Conflict' },
      );
    await pending;
    expect(panel.available()).toBe(false);

    pending = panel.save();
    http
      .expectOne(URL)
      .flush({ error: { code: 'internal', message: 'x' } }, { status: 500, statusText: 'Error' });
    await pending;

    expect(snacks).toEqual([
      USER_TEXTS.agents.callSummary.errors.zeroPii,
      USER_TEXTS.agents.callSummary.errors.provider,
    ]);
  });

  it('copies a code and says so when copying fails', async () => {
    const fixture = await render();

    (
      fixture.nativeElement.querySelector('[data-testid="forwarding-code-##61#"]') as HTMLButtonElement
    ).click();
    expect(copiedText).toBe('##61#');
    expect(fixture.componentInstance.copied()).toBe('##61#');

    copyWorks = false;
    fixture.componentInstance.copy('**004*03012345678#');
    expect(snacks).toEqual([USER_TEXTS.agents.callSummary.forwarding.copyFailed]);
  });

  it('points to the phone numbers when the agent has none', async () => {
    const fixture = await render({ ...VIEW, phoneNumbers: [] });

    expect(fixture.nativeElement.querySelector('[data-testid="call-summary-no-number"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/app/numbers"]')).not.toBeNull();
    expect(text(fixture)).not.toContain(USER_TEXTS.agents.callSummary.forwarding.howTo);
  });

  it('offers to try again when the settings cannot be loaded', async () => {
    const fixture = await render(null);
    expect(fixture.componentInstance.state()).toBe('failed');

    (fixture.nativeElement.querySelector('[data-testid="call-summary-retry"]') as HTMLButtonElement).click();
    http.expectOne(URL).flush({ data: VIEW });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.componentInstance.state()).toBe('ready');
  });
});

describe('phoneShape', () => {
  const check = (value: string) => phoneShape(new FormControl(value));

  it('accepts national, international and spaced numbers', () => {
    expect(check('0171 1234567')).toBeNull();
    expect(check('+49 (0) 171 123-4567')).toBeNull();
    expect(check('0049 171 1234567')).toBeNull();
    expect(check('')).toBeNull();
  });

  it('refuses letters and numbers far too short or long', () => {
    expect(check('Mama')).toEqual({ phone: true });
    expect(check('12')).toEqual({ phone: true });
    expect(check('+123456789012345678')).toEqual({ phone: true });
  });
});
