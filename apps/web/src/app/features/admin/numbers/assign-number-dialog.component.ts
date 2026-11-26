import { Component, inject, type OnInit, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { AdminHubService } from '../../../core/hub/admin-hub.service';
import type { ResellerCustomer, ResellerStockOffers } from '../../../core/hub/hub.models';
import { NotifyService } from '../../../core/notify/notify.service';
import { FieldErrorPipe } from '../../../shared/forms/field-error.pipe';
import { type CustomerOption, customerOption } from '../customer-option';

/** How many customers the picker loads at once; the hub caps a page at 500. */
const CUSTOMER_PAGE = 500;

/** The number the operator started from, so the dialog can name it. */
export interface AssignNumberDialogData {
  phoneNumber: string;
}

/** Who the number goes to, and whether that customer pays for it. */
export interface AssignNumberResult {
  customerId: number;
  chargeCustomer: boolean;
}

/**
 * Picks the customer one number goes to, and whether the number is free for
 * them or billed to their balance in the operator's name (API 1.26.0). Billing
 * needs the operator's own payment details at the service, which the hub
 * reports with the stock offers; until then that choice stays disabled and
 * says why. The dialog only chooses; the page calls the hub, because the page
 * also has to read both lists again afterwards.
 */
@Component({
  selector: 'app-assign-number-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule,
    MatRadioModule,
    MatProgressBarModule,
    MatButtonModule,
    TranslocoDirective,
    FieldErrorPipe,
  ],
  providers: [provideTranslocoScope('admin')],
  template: `
    <ng-container *transloco="let t">
      <h2 mat-dialog-title>{{ t('admin.numbers.assignDialog.title') }}</h2>
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <mat-dialog-content>
          <p class="hint">
            {{ t('admin.numbers.assignDialog.intro', { number: data.phoneNumber }) }}
          </p>
          @if (loading()) {
            <mat-progress-bar mode="indeterminate" />
          }
          <mat-form-field appearance="outline" class="full">
            <mat-label>{{ t('admin.numbers.assignDialog.customer') }}</mat-label>
            <mat-select formControlName="customerId" data-testid="customer">
              @for (customer of customers(); track customer.id) {
                <mat-option [value]="customer.id">{{ customer.label }}</mat-option>
              }
            </mat-select>
            @if (form.controls.customerId | fieldError; as e) {
              <mat-error>{{ t(e.key, e.params) }}</mat-error>
            }
          </mat-form-field>
          <fieldset>
            <legend>{{ t('admin.numbers.assignDialog.billing') }}</legend>
            <mat-radio-group formControlName="billing" data-testid="billing">
              <mat-radio-button value="free">
                <span class="option">
                  <span>{{ t('admin.numbers.assignDialog.free') }}</span>
                  <span class="small">{{ t('admin.numbers.assignDialog.freeHint') }}</span>
                </span>
              </mat-radio-button>
              <mat-radio-button value="charge" [disabled]="!paymentReady()" data-testid="charge">
                <span class="option">
                  <span>{{ t('admin.numbers.assignDialog.charge') }}</span>
                  <span class="small">{{ t('admin.numbers.assignDialog.chargeHint') }}</span>
                </span>
              </mat-radio-button>
            </mat-radio-group>
            @if (!loading() && !paymentReady()) {
              <p class="small note" data-testid="charge-needs-payment">
                {{ t('admin.numbers.assignDialog.chargeNeedsPayment') }}
              </p>
            }
          </fieldset>
        </mat-dialog-content>
        <mat-dialog-actions align="end">
          <button mat-button type="button" mat-dialog-close>{{ t('actions.cancel') }}</button>
          <button mat-flat-button type="submit" data-testid="submit">
            {{ t('admin.numbers.assignDialog.submit') }}
          </button>
        </mat-dialog-actions>
      </form>
    </ng-container>
  `,
  styles: `
    .hint {
      margin: 0 0 16px;
    }
    .small {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    fieldset {
      border: 0;
      margin: 0;
      padding: 0;
    }
    legend {
      font: var(--mat-sys-label-large);
      color: var(--mat-sys-on-surface-variant);
      padding: 0 0 8px;
    }
    mat-radio-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .option {
      display: flex;
      flex-direction: column;
      padding: 4px 0;
    }
    .note {
      margin: 8px 0 0;
    }
  `,
})
export class AssignNumberDialogComponent implements OnInit {
  readonly data = inject<AssignNumberDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<AssignNumberDialogComponent, AssignNumberResult>>(MatDialogRef);
  private readonly hub = inject(AdminHubService);
  private readonly notify = inject(NotifyService);

  readonly loading = signal(false);
  readonly customers = signal<CustomerOption[]>([]);
  /** Whether the operator's customers can already be billed for numbers. */
  readonly paymentReady = signal(false);

  readonly form = inject(NonNullableFormBuilder).group({
    customerId: [null as number | null, Validators.required],
    billing: ['free' as 'free' | 'charge'],
  });

  ngOnInit(): void {
    void this.load();
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    this.ref.close({
      customerId: Number(value.customerId),
      chargeCustomer: value.billing === 'charge' && this.paymentReady(),
    });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    const [customers, offers] = await Promise.allSettled([
      firstValueFrom(this.hub.page<ResellerCustomer>('/resellers/customers', { perPage: CUSTOMER_PAGE })),
      firstValueFrom(this.hub.get<ResellerStockOffers>('/resellers/phone-numbers/stock-offers')),
    ]);
    this.loading.set(false);
    if (customers.status === 'fulfilled') this.customers.set(customers.value.data.map(customerOption));
    else this.notify.apiError(customers.reason);
    // Without an answer the safe reading is "not ready": the number then goes out for free.
    this.paymentReady.set(offers.status === 'fulfilled' && offers.value.paymentReady === true);
  }
}
