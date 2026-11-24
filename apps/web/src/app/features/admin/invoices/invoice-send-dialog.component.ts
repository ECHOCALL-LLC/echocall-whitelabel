import { Component, computed, inject, type OnInit, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { readApiError } from '../../../core/errors/api-error';
import { AdminHubService } from '../../../core/hub/admin-hub.service';
import { OperatorLinksService } from '../../../core/hub/operator-links.service';
import type {
  ResellerInvoiceMailPreview,
  SendInvoiceInput,
  SendInvoiceResult,
} from '../../../core/hub/hub.models';
import { LanguageService } from '../../../core/i18n/language.service';
import { NotifyService } from '../../../core/notify/notify.service';
import { FieldErrorPipe } from '../../../shared/forms/field-error.pipe';
import { LocalDatePipe } from '../../../shared/local-date.pipe';

export interface InvoiceSendDialogData {
  invoiceId: number;
  invoiceNumber: string;
}

/** The limits the service puts on what the operator may write into the mail. */
const SUBJECT_MAX = 300;
const BODY_MAX = 10000;

/** The languages the portal speaks; the customer's own is added when it is another one. */
const PORTAL_LANGUAGES = ['de', 'en', 'fr'];

/** The company fields the service can name as missing, by the label the settings page gives them. */
const COMPANY_FIELD_LABELS: Record<string, string> = {
  companyName: 'admin.settings.hub.companyName',
  companyAddress: 'admin.settings.hub.address',
  companyPostalCode: 'admin.settings.hub.postalCode',
  companyCity: 'admin.settings.hub.city',
  companyVatId: 'admin.settings.hub.vatId',
};

/**
 * The words in front of the portal address at the end of the mail, in the
 * mail's language rather than the operator's. Other languages get the English.
 */
const PORTAL_LINK_LABELS: Readonly<Record<string, string>> = {
  de: 'Zum Kundenportal',
  en: 'Open customer portal',
  fr: 'Accéder à l’espace client',
};

/** The line that points the customer at this portal's sign-in page. */
export function portalLinkLine(lang: string | null | undefined, url: string): string {
  const label =
    lang && Object.hasOwn(PORTAL_LINK_LABELS, lang) ? PORTAL_LINK_LABELS[lang] : PORTAL_LINK_LABELS['en'];
  return `${label}: ${url}`;
}

/** Refusals after which the preview is read again, so the reason shows in the dialog. */
const RELOAD_ON = new Set([409, 429]);

/**
 * Mails one invoice with its PDF to the billing address on file for the
 * customer. The recipients come from the customer and cannot be typed here, so
 * a mail can only reach the address the operator stored. Subject and text
 * start from the operator's template in the chosen language and can be changed
 * for this one mail. The service's own portal link is never used, because
 * customers of this portal sign in here; instead the operator can add a line
 * with this portal's sign-in address to the end of the text.
 */
@Component({
  selector: 'app-invoice-send-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    RouterLink,
    TranslocoDirective,
    FieldErrorPipe,
    LocalDatePipe,
  ],
  providers: [provideTranslocoScope('admin')],
  template: `
    <ng-container *transloco="let t">
      <h2 mat-dialog-title>{{ t('admin.invoices.mail.title', { number: data.invoiceNumber }) }}</h2>
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <mat-dialog-content class="content">
          @if (loading()) {
            <mat-progress-bar mode="indeterminate" />
          }
          @if (loadFailed()) {
            <div class="notice" role="alert" data-testid="mail-load-error">
              <mat-icon aria-hidden="true">error</mat-icon>
              <div class="notice-body">
                <p>{{ t('admin.invoices.mail.loadError') }}</p>
                <button mat-stroked-button type="button" (click)="load()">{{ t('actions.retry') }}</button>
              </div>
            </div>
          }
          @if (preview(); as p) {
            @if (p.problem) {
              <div class="notice" role="alert" data-testid="mail-problem">
                <mat-icon aria-hidden="true">warning</mat-icon>
                <div class="notice-body">
                  <p>{{ problemText(p, t) }}</p>
                  @if (p.problem === 'no_billing_email' && p.customerId) {
                    <a
                      mat-stroked-button
                      [routerLink]="['/admin/customers', p.customerId]"
                      mat-dialog-close
                      data-testid="mail-fix-customer"
                    >
                      {{ t('admin.invoices.mail.editCustomer') }}
                    </a>
                  }
                  @if (p.problem === 'company_incomplete') {
                    <a
                      mat-stroked-button
                      routerLink="/admin/settings"
                      [queryParams]="{ tab: 'service' }"
                      mat-dialog-close
                      data-testid="mail-fix-company"
                    >
                      {{ t('admin.invoices.mail.editCompany') }}
                    </a>
                  }
                  @if (p.problem === 'no_smtp') {
                    <a
                      mat-stroked-button
                      routerLink="/admin/settings"
                      [queryParams]="{ tab: 'service' }"
                      fragment="mail-server"
                      mat-dialog-close
                      data-testid="mail-fix-smtp"
                    >
                      {{ t('admin.invoices.mail.setUpMailServer') }}
                    </a>
                  }
                </div>
              </div>
            }

            <dl class="facts">
              <div>
                <dt>{{ t('admin.invoices.mail.to') }}</dt>
                <dd data-testid="mail-to">{{ p.to || t('admin.invoices.mail.noAddress') }}</dd>
              </div>
              @if (p.cc) {
                <div>
                  <dt>{{ t('admin.invoices.mail.cc') }}</dt>
                  <dd data-testid="mail-cc">{{ p.cc }}</dd>
                </div>
              }
              <div>
                <dt>{{ t('admin.invoices.mail.from') }}</dt>
                <dd data-testid="mail-from">{{ sender(p) }}</dd>
              </div>
              <div>
                <dt>{{ t('admin.invoices.mail.attachment') }}</dt>
                <dd>{{ p.pdfFileName }}</dd>
              </div>
              @if (p.emailSentAt) {
                <div>
                  <dt>{{ t('admin.invoices.mail.lastSent') }}</dt>
                  <dd data-testid="mail-last-sent">
                    {{
                      t('admin.invoices.mail.sentAt', {
                        date: (p.emailSentAt | localDate),
                        to: p.emailSentTo ?? '',
                      })
                    }}
                  </dd>
                </div>
              }
            </dl>

            <div class="row">
              <!-- A hint here is a whole sentence; it takes real space so it never covers the next field. -->
              <mat-form-field
                appearance="outline"
                [subscriptSizing]="p.templateLang !== p.lang ? 'dynamic' : 'fixed'"
              >
                <mat-label>{{ t('admin.invoices.mail.language') }}</mat-label>
                <mat-select
                  [value]="p.lang"
                  (selectionChange)="changeLanguage($event.value)"
                  [disabled]="loading()"
                  data-testid="mail-language"
                >
                  @for (option of languages(); track option.code) {
                    <mat-option [value]="option.code">{{ option.name }}</mat-option>
                  }
                </mat-select>
                @if (p.templateLang !== p.lang) {
                  <mat-hint>{{ t('admin.invoices.mail.fallbackLang') }}</mat-hint>
                }
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>{{ t('admin.invoices.mail.subject') }}</mat-label>
                <input
                  matInput
                  formControlName="subject"
                  [maxlength]="subjectMax"
                  data-testid="mail-subject"
                />
                @if (form.controls.subject | fieldError; as e) {
                  <mat-error>{{ t(e.key, e.params) }}</mat-error>
                }
              </mat-form-field>
            </div>
            <mat-form-field appearance="outline" class="full" subscriptSizing="dynamic">
              <mat-label>{{ t('admin.invoices.mail.body') }}</mat-label>
              <textarea
                matInput
                formControlName="bodyText"
                rows="10"
                [maxlength]="bodyMax"
                data-testid="mail-body"
              ></textarea>
              <mat-hint>{{ t('admin.invoices.mail.templateHint') }}</mat-hint>
              @if (form.controls.bodyText | fieldError; as e) {
                <mat-error>{{ t(e.key, e.params) }}</mat-error>
              }
            </mat-form-field>

            @if (portalLogin(); as url) {
              <div class="portal-link">
                <mat-checkbox
                  formControlName="portalLink"
                  aria-describedby="mail-portal-line"
                  data-testid="mail-portal-link"
                >
                  {{ t('admin.invoices.mail.portalLink') }}
                </mat-checkbox>
                <p class="hint" id="mail-portal-line" data-testid="mail-portal-line">
                  {{ t('admin.invoices.mail.portalLinkHint') }}
                  <span class="line">{{ portalLine(p.lang, url) }}</span>
                </p>
              </div>
            }
            @if (p.bccAddress) {
              <mat-checkbox formControlName="bcc" data-testid="mail-bcc">
                {{ t('admin.invoices.mail.bcc', { address: p.bccAddress }) }}
              </mat-checkbox>
            }
            <p class="hint" data-testid="mail-usage">
              {{ t('admin.invoices.mail.dailyUsage', { sent: p.sentToday, limit: p.dailyLimit }) }}
            </p>
          }
        </mat-dialog-content>
        <mat-dialog-actions align="end">
          <button mat-button type="button" mat-dialog-close>{{ t('actions.cancel') }}</button>
          <button mat-flat-button type="submit" [disabled]="blocked() || sending()" data-testid="mail-send">
            <mat-icon>send</mat-icon>
            {{ t(preview()?.emailSentAt ? 'admin.invoices.mail.resend' : 'admin.invoices.mail.send') }}
          </button>
        </mat-dialog-actions>
      </form>
    </ng-container>
  `,
  styles: `
    .content {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .facts {
      margin: 0;
    }
    .facts dd {
      overflow-wrap: anywhere;
    }
    .notice {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 12px 16px;
      border-radius: 12px;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    .notice-body {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }
    .notice p,
    .hint {
      margin: 0;
    }
    .hint {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .portal-link .hint {
      padding-left: 40px;
    }
    .line {
      overflow-wrap: anywhere;
      color: var(--mat-sys-on-surface);
    }
  `,
})
export class InvoiceSendDialogComponent implements OnInit {
  readonly data = inject<InvoiceSendDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<InvoiceSendDialogComponent, SendInvoiceResult>>(MatDialogRef);
  private readonly hub = inject(AdminHubService);
  private readonly notify = inject(NotifyService);
  private readonly language = inject(LanguageService);
  private readonly links = inject(OperatorLinksService);

  /** This portal's sign-in page, empty until known; without it the option is not shown. */
  readonly portalLogin = computed(() => this.links.links()?.portalLogin ?? null);
  readonly portalLine = portalLinkLine;

  readonly subjectMax = SUBJECT_MAX;
  readonly bodyMax = BODY_MAX;
  readonly preview = signal<ResellerInvoiceMailPreview | null>(null);
  readonly loading = signal(false);
  readonly loadFailed = signal(false);
  readonly sending = signal(false);

  readonly form = inject(NonNullableFormBuilder).group({
    subject: ['', [Validators.required, Validators.maxLength(SUBJECT_MAX)]],
    bodyText: ['', [Validators.required, Validators.maxLength(BODY_MAX)]],
    bcc: [false],
    portalLink: [false],
  });

  /** Nothing goes out while the preview is missing or names a reason the mail cannot be sent. */
  readonly blocked = computed(() => {
    const preview = this.preview();
    return !preview || !!preview.problem || this.loading();
  });

  /** The portal's languages by name, plus the customer's own when the service knows it as another. */
  readonly languages = computed(() => {
    const ui = this.language.current();
    const codes = new Set(PORTAL_LANGUAGES);
    const current = this.preview()?.lang;
    if (current) codes.add(current);
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([ui], { type: 'language' });
    } catch {
      names = null;
    }
    return [...codes]
      .map((code) => ({ code, name: names?.of(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name, ui));
  });

  ngOnInit(): void {
    void this.load();
    void this.links.load();
  }

  /** Reads what the mail would look like; a language switch loads that language's text. */
  async load(lang?: string): Promise<void> {
    this.loading.set(true);
    this.loadFailed.set(false);
    try {
      const preview = await firstValueFrom(
        this.hub.get<ResellerInvoiceMailPreview>(
          `/resellers/invoices/${this.data.invoiceId}/email-preview`,
          lang ? { lang } : undefined,
        ),
      );
      this.preview.set(preview);
      this.form.patchValue({ subject: preview.subject ?? '', bodyText: preview.bodyText ?? '' });
    } catch {
      this.loadFailed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  changeLanguage(lang: string): void {
    void this.load(lang);
  }

  /** The sender as the customer will see it. */
  sender(preview: ResellerInvoiceMailPreview): string {
    const name = preview.fromName ?? '';
    return preview.fromAddress ? `${name} <${preview.fromAddress}>`.trim() : name;
  }

  problemText(preview: ResellerInvoiceMailPreview, t: (key: string, params?: object) => string): string {
    if (preview.problem === 'company_incomplete') {
      const fields = (preview.missingCompanyFields ?? [])
        .map((field) => (COMPANY_FIELD_LABELS[field] ? t(COMPANY_FIELD_LABELS[field]) : field))
        .join(', ');
      return t('admin.invoices.mail.problem.company_incomplete', { fields });
    }
    return t(`admin.invoices.mail.problem.${preview.problem}`, { limit: preview.dailyLimit });
  }

  async submit(): Promise<void> {
    const preview = this.preview();
    if (!preview || this.blocked()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    // Spaces alone are no subject and no text.
    const blank = (['subject', 'bodyText'] as const).filter((field) => !value[field].trim());
    if (blank.length) {
      for (const field of blank) {
        this.form.controls[field].setErrors({ required: true });
        this.form.controls[field].markAsTouched();
      }
      return;
    }
    let text = value.bodyText.trim();
    const url = this.portalLogin();
    if (value.portalLink && url && !text.includes(url)) {
      // A blank line makes it a paragraph of its own in the mail.
      const withLink = `${text}\n\n${portalLinkLine(preview.lang, url)}`;
      if (withLink.length > BODY_MAX) {
        // The line has to fit as well, so the room left for the text is what counts.
        this.form.controls.bodyText.setErrors({
          maxlength: { requiredLength: BODY_MAX - (withLink.length - text.length) },
        });
        this.form.controls.bodyText.markAsTouched();
        return;
      }
      text = withLink;
    }
    const body: SendInvoiceInput = {
      lang: preview.lang,
      subject: value.subject.trim(),
      bodyText: text,
      bcc: value.bcc && !!preview.bccAddress,
      // The service's own portal is not where these customers sign in; the line above is.
      portalLink: false,
    };
    this.sending.set(true);
    try {
      const result = await firstValueFrom(
        this.hub.post<SendInvoiceResult>(`/resellers/invoices/${this.data.invoiceId}/send`, body),
      );
      this.ref.close(result);
    } catch (err) {
      this.notify.apiError(err);
      if (RELOAD_ON.has(readApiError(err).status)) void this.load(preview.lang);
    } finally {
      this.sending.set(false);
    }
  }
}
