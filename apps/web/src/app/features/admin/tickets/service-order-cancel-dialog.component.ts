import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';

export interface ServiceOrderCancelData {
  /** The paid amount, formatted, when it can go back to the customer; null when nothing can. */
  refundAmount: string | null;
}

export interface ServiceOrderCancelResult {
  refund: boolean;
}

/**
 * Asks before a service order ends for good. When the customer paid for it,
 * the money goes back by default, because that is what a cancelled order
 * usually calls for; the operator can untick it when the work was done in part.
 */
@Component({
  selector: 'app-service-order-cancel-dialog',
  imports: [MatButtonModule, MatCheckboxModule, MatDialogModule, TranslocoDirective],
  providers: [provideTranslocoScope('admin')],
  template: `
    <ng-container *transloco="let t">
      <h2 mat-dialog-title>{{ t('admin.serviceOrders.cancelTitle') }}</h2>
      <mat-dialog-content>
        <p class="lead">{{ t('admin.serviceOrders.cancelDesc') }}</p>
        @if (data.refundAmount; as amount) {
          <mat-checkbox
            [checked]="refund()"
            (change)="refund.set($event.checked)"
            data-testid="service-refund"
          >
            {{ t('admin.serviceOrders.refund', { amount }) }}
          </mat-checkbox>
          <p class="note">{{ t('admin.serviceOrders.refundNote') }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button mat-dialog-close cdkFocusInitial>{{ t('admin.serviceOrders.keep') }}</button>
        <button
          mat-flat-button
          class="destructive"
          type="button"
          (click)="confirm()"
          data-testid="service-cancel-confirm"
        >
          {{ t('admin.serviceOrders.confirmCancel') }}
        </button>
      </mat-dialog-actions>
    </ng-container>
  `,
  styles: `
    .lead {
      margin: 0 0 12px;
    }
    .note {
      margin: 0 0 0 40px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .destructive {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
  `,
})
export class ServiceOrderCancelDialogComponent {
  readonly data = inject<ServiceOrderCancelData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<ServiceOrderCancelDialogComponent, ServiceOrderCancelResult>);

  readonly refund = signal(true);

  confirm(): void {
    this.ref.close({ refund: this.data.refundAmount !== null && this.refund() });
  }
}
