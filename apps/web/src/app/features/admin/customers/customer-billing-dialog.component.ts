import { Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { provideTranslocoScope, TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/api/api.service';
import { readApiError } from '../../../core/errors/api-error';
import { countryOptions } from '../../../core/format/countries';
import { LanguageService } from '../../../core/i18n/language.service';
import { NotifyService } from '../../../core/notify/notify.service';
import { FieldErrorPipe } from '../../../shared/forms/field-error.pipe';

/** The billing details of one customer as the hub keeps them; a missing one is null. */
export interface CustomerBilling {
  companyName: string | null;
  billingStreet: string | null;
  billingPostalCode: string | null;
  billingCity: string | null;
  billingCountry: string | null;
  vatId: string | null;
  billingEmail: string | null;
  billingCcEmail: string | null;
}

export interface CustomerBillingDialogData {
  customerId: number;
  billing: CustomerBilling;
}

type BillingField = keyof CustomerBilling;

const BILLING_FIELDS: BillingField[] = [
  'companyName',
  'billingStreet',
  'billingPostalCode',
  'billingCity',
  'billingCountry',
  'vatId',
  'billingEmail',
  'billingCcEmail',
];

/** What the hub names when a value does not fit, and the field it belongs to. */
const PROBLEM_FIELD: Record<string, BillingField> = {
  invalid_country: 'billingCountry',
  invalid_postal_code: 'billingPostalCode',
  invalid_vat_id: 'vatId',
  invalid_billing_email: 'billingEmail',
  invalid_billing_cc_email: 'billingCcEmail',
};

/**
 * The details a customer's invoices carry and where they are mailed. Only the
 * fields that changed are sent, an emptied one is cleared, and when the hub
 * says a value does not fit, that field is marked with the reason.
 */
@Component({
  selector: 'app-customer-billing-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    TranslocoDirective,
    FieldErrorPipe,
  ],
  providers: [provideTranslocoScope('admin')],
  template: `
    <ng-container *transloco="let t">
      <h2 mat-dialog-title>{{ t('admin.customer.billing.dialogTitle') }}</h2>
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <mat-dialog-content>
          <p class="hint">{{ t('admin.customer.billing.dialogIntro') }}</p>
          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>{{ t('admin.customer.billing.email') }}</mat-label>
              <input
                matInput
                type="email"
                formControlName="billingEmail"
                autocomplete="off"
                maxlength="320"
                data-testid="billing-email"
              />
              <mat-hint>{{ t('admin.customer.billing.emailHint') }}</mat-hint>
              @if (form.controls.billingEmail | fieldError; as e) {
                <mat-error>{{ t(e.key, e.params) }}</mat-error>
              }
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>{{ t('admin.customer.billing.ccEmail') }}</mat-label>
              <input
                matInput
                type="email"
                formControlName="billingCcEmail"
                autocomplete="off"
                maxlength="320"
                data-testid="billing-cc-email"
              />
              @if (form.controls.billingCcEmail | fieldError; as e) {
                <mat-error>{{ t(e.key, e.params) }}</mat-error>
              }
            </mat-form-field>
          </div>
          <mat-form-field appearance="outline" class="full">
            <mat-label>{{ t('admin.customer.billing.companyName') }}</mat-label>
            <input matInput formControlName="companyName" maxlength="255" autocomplete="off" />
            @if (form.controls.companyName | fieldError; as e) {
              <mat-error>{{ t(e.key, e.params) }}</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline" class="full">
            <mat-label>{{ t('admin.customer.billing.street') }}</mat-label>
            <input matInput formControlName="billingStreet" maxlength="255" autocomplete="off" />
            @if (form.controls.billingStreet | fieldError; as e) {
              <mat-error>{{ t(e.key, e.params) }}</mat-error>
            }
          </mat-form-field>
          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>{{ t('admin.customer.billing.postalCode') }}</mat-label>
              <input
                matInput
                formControlName="billingPostalCode"
                maxlength="20"
                autocomplete="off"
                data-testid="billing-postal-code"
              />
              @if (form.controls.billingPostalCode | fieldError; as e) {
                <mat-error>{{ t(e.key, e.params) }}</mat-error>
              }
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>{{ t('admin.customer.billing.city') }}</mat-label>
              <input matInput formControlName="billingCity" maxlength="100" autocomplete="off" />
              @if (form.controls.billingCity | fieldError; as e) {
                <mat-error>{{ t(e.key, e.params) }}</mat-error>
              }
            </mat-form-field>
          </div>
          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>{{ t('admin.customer.billing.country') }}</mat-label>
              <mat-select formControlName="billingCountry" data-testid="billing-country">
                <mat-option value="">{{ t('admin.customer.billing.noCountry') }}</mat-option>
                @for (country of countries(); track country.code) {
                  <mat-option [value]="country.code">{{ country.name }}</mat-option>
                }
              </mat-select>
              @if (form.controls.billingCountry | fieldError; as e) {
                <mat-error>{{ t(e.key, e.params) }}</mat-error>
              }
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>{{ t('admin.customer.billing.vatId') }}</mat-label>
              <input matInput formControlName="vatId" maxlength="50" autocomplete="off" data-testid="billing-vat-id" />
              @if (form.controls.vatId | fieldError; as e) {
                <mat-error>{{ t(e.key, e.params) }}</mat-error>
              }
            </mat-form-field>
          </div>
        </mat-dialog-content>
        <mat-dialog-actions align="end">
          <button mat-button type="button" mat-dialog-close>{{ t('actions.cancel') }}</button>
          <button mat-flat-button type="submit" [disabled]="busy()" data-testid="billing-submit">
            {{ t('actions.save') }}
          </button>
        </mat-dialog-actions>
      </form>
    </ng-container>
  `,
  styles: `
    .hint {
      margin: 0 0 16px;
    }
  `,
})
export class CustomerBillingDialogComponent {
  readonly data = inject<CustomerBillingDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<CustomerBillingDialogComponent, true>>(MatDialogRef);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  private readonly transloco = inject(TranslocoService);
  private readonly language = inject(LanguageService);
  readonly busy = signal(false);

  /** What was on file when the dialog opened, so only real changes are sent. */
  private readonly stored: Record<BillingField, string> = Object.fromEntries(
    BILLING_FIELDS.map((field) => [field, this.data.billing[field] ?? '']),
  ) as Record<BillingField, string>;

  /**
   * Every country by name; a stored value the list does not know (written before
   * the hub kept codes) stays selectable, so opening the dialog never loses it.
   */
  readonly countries = computed(() => {
    const options = countryOptions(this.language.current());
    const current = this.stored.billingCountry;
    return current && !options.some((option) => option.code === current)
      ? [{ code: current, name: current }, ...options]
      : options;
  });

  readonly form = inject(NonNullableFormBuilder).group({
    companyName: [this.stored.companyName, Validators.maxLength(255)],
    billingStreet: [this.stored.billingStreet, Validators.maxLength(255)],
    billingPostalCode: [this.stored.billingPostalCode, Validators.maxLength(20)],
    billingCity: [this.stored.billingCity, Validators.maxLength(100)],
    billingCountry: [this.stored.billingCountry],
    vatId: [this.stored.vatId, Validators.maxLength(50)],
    billingEmail: [this.stored.billingEmail, [Validators.email, Validators.maxLength(320)]],
    billingCcEmail: [this.stored.billingCcEmail, [Validators.email, Validators.maxLength(320)]],
  });

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const body: Partial<Record<BillingField, string>> = {};
    for (const field of BILLING_FIELDS) {
      const next = value[field].trim();
      if (next !== this.stored[field]) body[field] = next;
    }
    if (Object.keys(body).length === 0) {
      this.ref.close();
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.patch(`/admin/customers/${this.data.customerId}/billing`, body));
      this.ref.close(true);
    } catch (err) {
      const error = readApiError(err);
      const field = error.code === 'invalid_billing_details' ? PROBLEM_FIELD[error.message] : undefined;
      if (field) {
        const text = this.transloco.translate(`admin.customer.billing.errors.${error.message}`);
        this.form.controls[field].setErrors({ server: text });
        this.form.controls[field].markAsTouched();
        this.notify.error(`admin.customer.billing.errors.${error.message}`);
      } else {
        this.notify.apiError(err);
      }
    } finally {
      this.busy.set(false);
    }
  }
}
