import { Component, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';

/** The hub refuses a monthly price above this, in EUR net. */
export const MAX_SALE_MONTHLY_PRICE = 1000;

/** The number the operator offers, and the price it is offered at today, if any. */
export interface SaleNumberDialogData {
  phoneNumber: string;
  monthlyPrice: number | null;
}

/** The monthly price the customers pay, net in EUR. */
export interface SaleNumberResult {
  monthlyPrice: number;
}

/**
 * Asks for the monthly price one of the operator's own numbers is offered at.
 * The dialog only asks; the page calls the hub and reads the list again.
 */
@Component({
  selector: 'app-sale-number-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    TranslocoDirective,
  ],
  providers: [provideTranslocoScope('admin')],
  template: `
    <ng-container *transloco="let t">
      <h2 mat-dialog-title>{{ t('admin.numbers.saleDialog.title') }}</h2>
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <mat-dialog-content>
          <p class="hint">{{ t('admin.numbers.saleDialog.intro', { number: data.phoneNumber }) }}</p>
          <mat-form-field appearance="outline" class="full">
            <mat-label>{{ t('admin.numbers.saleDialog.price') }}</mat-label>
            <input
              matInput
              type="number"
              step="0.01"
              min="0.01"
              [max]="max"
              formControlName="monthlyPrice"
              data-testid="sale-price"
            />
            <span matTextSuffix>&nbsp;€</span>
            <mat-hint>{{ t('admin.numbers.saleDialog.priceHint') }}</mat-hint>
            @if (form.controls.monthlyPrice.invalid) {
              <mat-error>{{ t('admin.numbers.saleDialog.invalid') }}</mat-error>
            }
          </mat-form-field>
        </mat-dialog-content>
        <mat-dialog-actions align="end">
          <button mat-button type="button" mat-dialog-close>{{ t('actions.cancel') }}</button>
          <button mat-flat-button type="submit" data-testid="sale-submit">
            {{ t('admin.numbers.saleDialog.submit') }}
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
export class SaleNumberDialogComponent {
  readonly data = inject<SaleNumberDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<SaleNumberDialogComponent, SaleNumberResult>>(MatDialogRef);
  readonly max = MAX_SALE_MONTHLY_PRICE;

  readonly form = inject(NonNullableFormBuilder).group({
    monthlyPrice: [
      this.data.monthlyPrice && this.data.monthlyPrice > 0 ? this.data.monthlyPrice : (null as number | null),
      [Validators.required, Validators.min(0.01), Validators.max(MAX_SALE_MONTHLY_PRICE)],
    ],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const price = Math.round(Number(this.form.getRawValue().monthlyPrice) * 100) / 100;
    this.ref.close({ monthlyPrice: price });
  }
}
