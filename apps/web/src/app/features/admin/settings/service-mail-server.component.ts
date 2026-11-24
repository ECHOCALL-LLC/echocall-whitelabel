import { Component, computed, ElementRef, inject, type OnInit, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ActivatedRoute } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../../../core/auth/auth.store';
import { AdminHubService } from '../../../core/hub/admin-hub.service';
import type {
  ResellerSmtp,
  ResellerSmtpEffective,
  ResellerSmtpInput,
  ResellerSmtpTestResult,
} from '../../../core/hub/hub.models';
import { NotifyService } from '../../../core/notify/notify.service';
import { FieldErrorPipe } from '../../../shared/forms/field-error.pipe';
import { portValidator } from '../../../shared/forms/validators';
import { LocalDatePipe } from '../../../shared/local-date.pipe';

/** The reasons a test mail can fail that this screen has its own words for. */
export const MAIL_SERVER_RESULTS = [
  'auth',
  'host_not_found',
  'host_blocked',
  'refused',
  'timeout',
  'tls',
  'certificate',
  'sender_rejected',
  'recipient_rejected',
  'not_configured',
  'unknown',
] as const;

type ResultCode = (typeof MAIL_SERVER_RESULTS)[number];

/** A reason this screen has no words for reads as "could not be sent". */
export function resultCode(code: string | null | undefined): ResultCode {
  return MAIL_SERVER_RESULTS.find((known) => known === code) ?? 'unknown';
}

interface TestOutcome {
  ok: boolean;
  code: ResultCode | null;
}

/**
 * The mail server the service sends this operator's invoices and ticket mails
 * through. Without one the service sends with its own address, or not at all
 * when it has none, which is the "no mail server" notice the invoice dialog
 * links here for.
 *
 * The password is write-only: the service never hands it back, so the field
 * starts empty, an empty field keeps what is stored, and it is required only
 * while nothing is stored. The three TLS details the service also keeps are
 * carried over as stored, never shown: nobody should have to know them to send
 * mail, and the service tells which of them is wrong when a test fails.
 */
@Component({
  selector: 'app-service-mail-server',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSlideToggleModule,
    TranslocoDirective,
    FieldErrorPipe,
    LocalDatePipe,
  ],
  providers: [provideTranslocoScope('admin')],
  template: `
    <ng-container *transloco="let t">
      <h2 class="section-title" id="mail-server" tabindex="-1">{{ t('admin.settings.mailServer.title') }}</h2>
      <p class="hint">{{ t('admin.settings.mailServer.hint') }}</p>
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (effective(); as eff) {
        <p class="source" [class.none]="eff.source === 'none'" role="status" data-testid="mail-server-source">
          <mat-icon aria-hidden="true">{{
            eff.source === 'reseller' ? 'check_circle' : eff.source === 'platform' ? 'info' : 'warning'
          }}</mat-icon>
          <span>{{
            t('admin.settings.mailServer.source.' + eff.source, {
              host: eff.host ?? '',
              from: eff.fromEmail ?? '',
            })
          }}</span>
        </p>
      }
      @if (lastTest(); as last) {
        <p class="last-test" data-testid="mail-server-last-test">
          {{ t('admin.settings.mailServer.lastTest.' + last.status, { date: last.at | localDate }) }}
        </p>
      }

      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <div class="row">
          <mat-form-field appearance="outline" class="grow">
            <mat-label>{{ t('admin.settings.mailServer.host') }}</mat-label>
            <input
              matInput
              formControlName="host"
              autocomplete="off"
              spellcheck="false"
              placeholder="smtp.example.com"
              data-testid="mail-server-host"
            />
            @if (form.controls.host | fieldError; as e) {
              <mat-error>{{ t(e.key, e.params) }}</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline" class="port">
            <mat-label>{{ t('admin.settings.mailServer.port') }}</mat-label>
            <input
              matInput
              formControlName="port"
              type="number"
              inputmode="numeric"
              min="1"
              max="65535"
              data-testid="mail-server-port"
            />
            @if (form.controls.port | fieldError; as e) {
              <mat-error>{{ t(e.key, e.params) }}</mat-error>
            }
          </mat-form-field>
        </div>
        <mat-slide-toggle formControlName="secure" class="toggle" data-testid="mail-server-secure">
          {{ t('admin.settings.mailServer.secure') }}
        </mat-slide-toggle>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>{{ t('admin.settings.mailServer.username') }}</mat-label>
            <input
              matInput
              formControlName="username"
              autocomplete="off"
              spellcheck="false"
              data-testid="mail-server-username"
            />
            @if (form.controls.username | fieldError; as e) {
              <mat-error>{{ t(e.key, e.params) }}</mat-error>
            }
          </mat-form-field>
          <!-- The keep hint is a full sentence and wraps on a phone, so it takes real space. -->
          <mat-form-field
            appearance="outline"
            [subscriptSizing]="stored() ? 'dynamic' : 'fixed'"
            [class.keep]="stored()"
          >
            <mat-label>{{ t('admin.settings.mailServer.password') }}</mat-label>
            <input
              matInput
              type="password"
              formControlName="password"
              autocomplete="new-password"
              data-testid="mail-server-password"
            />
            @if (stored()) {
              <mat-hint>{{ t('admin.settings.mailServer.passwordKeep') }}</mat-hint>
            }
            @if (form.controls.password | fieldError; as e) {
              <mat-error>{{ t(e.key, e.params) }}</mat-error>
            }
          </mat-form-field>
        </div>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>{{ t('admin.settings.mailServer.fromEmail') }}</mat-label>
            <input
              matInput
              type="email"
              formControlName="fromEmail"
              autocomplete="off"
              data-testid="mail-server-from-email"
            />
            @if (form.controls.fromEmail | fieldError; as e) {
              <mat-error>{{ t(e.key, e.params) }}</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>{{ t('admin.settings.mailServer.fromName') }}</mat-label>
            <input matInput formControlName="fromName" data-testid="mail-server-from-name" />
            @if (form.controls.fromName | fieldError; as e) {
              <mat-error>{{ t(e.key, e.params) }}</mat-error>
            }
          </mat-form-field>
        </div>
        <mat-slide-toggle formControlName="isActive" class="toggle" data-testid="mail-server-active">
          {{ t('admin.settings.mailServer.active') }}
        </mat-slide-toggle>

        <div class="actions">
          <button
            mat-flat-button
            type="submit"
            [disabled]="saving() || testing()"
            data-testid="save-mail-server"
          >
            {{ t('actions.save') }}
          </button>
          <button
            mat-stroked-button
            type="button"
            [disabled]="!canTest() || saving() || testing()"
            (click)="sendTest()"
            data-testid="mail-server-test"
          >
            <mat-icon>send</mat-icon>
            {{ t('admin.settings.mailServer.sendTest') }}
          </button>
        </div>
        @if (stored() && form.dirty) {
          <p class="hint" data-testid="mail-server-save-first">
            {{ t('admin.settings.mailServer.saveFirst') }}
          </p>
        } @else if (stored() && testTo()) {
          <p class="hint">{{ t('admin.settings.mailServer.testHint', { email: testTo() }) }}</p>
        }
        @if (outcome(); as o) {
          <p class="outcome" [class.failed]="!o.ok" role="status" data-testid="mail-server-outcome">
            <mat-icon aria-hidden="true">{{ o.ok ? 'check_circle' : 'error' }}</mat-icon>
            <span>{{
              o.ok
                ? t('admin.settings.mailServer.testSent', { email: testTo() })
                : t('admin.settings.mailServer.result.' + o.code)
            }}</span>
          </p>
        }
      </form>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
      scroll-margin-top: 24px;
    }
    .hint {
      margin: 4px 0 16px;
    }
    .section-title {
      font: var(--mat-sys-title-medium);
      margin: 32px 0 0;
    }
    .section-title:focus {
      outline: none;
    }
    .row {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      flex-wrap: wrap;
    }
    .row mat-form-field {
      flex: 1;
      min-width: 240px;
    }
    .row .grow {
      flex: 3;
    }
    .row .port {
      flex: 1;
      min-width: 120px;
    }
    .row .keep {
      margin-bottom: 12px;
    }
    .toggle {
      display: block;
      margin: 0 0 20px;
    }
    .source,
    .outcome {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 0 0 16px;
      color: var(--mat-sys-on-surface-variant);
    }
    .source.none,
    .outcome.failed {
      color: var(--mat-sys-error);
    }
    .source mat-icon,
    .outcome mat-icon {
      flex: none;
    }
    .source span,
    .outcome span {
      overflow-wrap: anywhere;
    }
    .last-test {
      margin: -8px 0 16px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 4px;
    }
    .outcome {
      margin-top: 16px;
    }
    @media (max-width: 599px) {
      .actions button {
        width: 100%;
      }
    }
  `,
})
export class ServiceMailServerComponent implements OnInit {
  private readonly hub = inject(AdminHubService);
  private readonly notify = inject(NotifyService);
  private readonly auth = inject(AuthStore);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly stored = signal<ResellerSmtp | null>(null);
  readonly effective = signal<ResellerSmtpEffective | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly testing = signal(false);
  readonly outcome = signal<TestOutcome | null>(null);

  readonly form = this.fb.group({
    host: ['', [Validators.required, Validators.maxLength(255), Validators.pattern(/^[^\s/]+$/)]],
    port: [587, [Validators.required, portValidator]],
    secure: [false],
    username: ['', [Validators.required, Validators.maxLength(255)]],
    password: ['', Validators.maxLength(500)],
    fromEmail: ['', [Validators.required, Validators.email, Validators.maxLength(320)]],
    fromName: ['', [Validators.required, Validators.maxLength(255)]],
    isActive: [true],
  });

  /** The last test of the stored server, when there was one that ended either way. */
  readonly lastTest = computed(() => {
    const s = this.stored();
    if (!s?.lastTestedAt || (s.testStatus !== 'success' && s.testStatus !== 'failed')) return null;
    return { at: s.lastTestedAt, status: s.testStatus };
  });

  /** The test mail goes to the signed-in administrator, never to an address typed here. */
  testTo(): string {
    return this.auth.user()?.email ?? '';
  }

  /** A test goes through the saved server, so there has to be one and nothing unsaved. */
  canTest(): boolean {
    return this.stored() !== null && !this.form.dirty && this.testTo() !== '';
  }

  ngOnInit(): void {
    void this.load().then(() => {
      // Arriving from the "no mail server" notice: show this section, not the top of the tab.
      if (this.route.snapshot.fragment === 'mail-server') {
        this.host.nativeElement.scrollIntoView({ block: 'start' });
        this.host.nativeElement.querySelector<HTMLElement>('#mail-server')?.focus({ preventScroll: true });
      }
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [server, effective] = await Promise.all([
        firstValueFrom(this.hub.get<{ data: ResellerSmtp | null }>('/resellers/smtp')),
        firstValueFrom(this.hub.get<{ data: ResellerSmtpEffective }>('/resellers/smtp/effective')),
      ]);
      const current = server?.data ?? null;
      this.stored.set(current);
      this.effective.set(effective?.data ?? null);
      this.form.reset({
        host: current?.host ?? '',
        port: current?.port ?? 587,
        secure: current?.secure ?? false,
        username: current?.username ?? '',
        password: '',
        fromEmail: current?.fromEmail ?? '',
        fromName: current?.fromName ?? '',
        isActive: current?.isActive ?? true,
      });
      // Without a stored server there is no password to keep.
      this.form.controls.password.setValidators(
        current ? [Validators.maxLength(500)] : [Validators.required, Validators.maxLength(500)],
      );
      this.form.controls.password.updateValueAndValidity();
    } catch (err) {
      this.notify.apiError(err);
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const current = this.stored();
    const body: ResellerSmtpInput = {
      host: value.host.trim(),
      port: Number(value.port),
      secure: value.secure,
      username: value.username.trim(),
      fromEmail: value.fromEmail.trim(),
      fromName: value.fromName.trim(),
      isActive: value.isActive,
      requireTLS: current?.requireTLS ?? false,
      ignoreTLS: current?.ignoreTLS ?? false,
      rejectUnauthorized: current?.rejectUnauthorized ?? true,
    };
    // A password is sent exactly as typed, spaces included, and only when typed.
    if (value.password !== '') body.password = value.password;
    this.saving.set(true);
    this.outcome.set(null);
    try {
      await firstValueFrom(this.hub.put<unknown>('/resellers/smtp', body));
      this.notify.success('admin.settings.mailServer.saved');
      await this.load();
    } catch (err) {
      this.notify.apiError(err);
    } finally {
      this.saving.set(false);
    }
  }

  async sendTest(): Promise<void> {
    const to = this.testTo();
    if (!this.canTest()) return;
    this.testing.set(true);
    this.outcome.set(null);
    try {
      const res = await firstValueFrom(
        this.hub.post<{ data: ResellerSmtpTestResult }>('/resellers/smtp/test-email', { toEmail: to }),
      );
      const result = res?.data;
      this.outcome.set(
        result?.success ? { ok: true, code: null } : { ok: false, code: resultCode(result?.code) },
      );
      // The stored test date and status changed with this test.
      const [server, effective] = await Promise.all([
        firstValueFrom(this.hub.get<{ data: ResellerSmtp | null }>('/resellers/smtp')),
        firstValueFrom(this.hub.get<{ data: ResellerSmtpEffective }>('/resellers/smtp/effective')),
      ]);
      this.stored.set(server?.data ?? null);
      this.effective.set(effective?.data ?? null);
    } catch (err) {
      this.notify.apiError(err);
    } finally {
      this.testing.set(false);
    }
  }
}
