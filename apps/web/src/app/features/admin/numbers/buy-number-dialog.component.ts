import { Component, computed, inject, type OnInit, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatRadioModule } from '@angular/material/radio';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { formatMoney } from '../../../core/format/money';
import { AdminHubService } from '../../../core/hub/admin-hub.service';
import type {
  ResellerStockOffer,
  ResellerStockOffers,
  ResellerStockPurchase,
} from '../../../core/hub/hub.models';
import { LanguageService } from '../../../core/i18n/language.service';
import { NotifyService } from '../../../core/notify/notify.service';

/** The number that was bought, so the page can name it. */
export interface BuyNumberResult {
  phoneNumber: string;
}

/**
 * Buys one of the service's free numbers into the portal's stock (API 1.26.0).
 * The portal balance pays the first month at once and every month after until
 * the number goes back, so the dialog names the amount before the button does
 * anything. It calls the hub itself and stays open on a refusal, so the
 * operator can pick another number or top up and try again.
 */
@Component({
  selector: 'app-buy-number-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatRadioModule,
    MatProgressBarModule,
    MatButtonModule,
    TranslocoDirective,
  ],
  providers: [provideTranslocoScope('admin')],
  template: `
    <ng-container *transloco="let t">
      <h2 mat-dialog-title>{{ t('admin.numbers.buyDialog.title') }}</h2>
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <mat-dialog-content>
          <p class="hint">{{ t('admin.numbers.buyDialog.intro') }}</p>
          @if (loading()) {
            <mat-progress-bar mode="indeterminate" />
          } @else if (offers().length === 0) {
            <p class="empty empty-panel" data-testid="buy-empty">{{ t('admin.numbers.buyDialog.empty') }}</p>
          } @else {
            <fieldset>
              <legend>{{ t('admin.numbers.buyDialog.choose') }}</legend>
              <mat-radio-group formControlName="phoneNumberId" class="offers" data-testid="offers">
                @for (offer of offers(); track offer.id) {
                  <mat-radio-button [value]="offer.id">
                    <span class="offer">
                      <span class="nowrap">{{ offer.phoneNumber }}</span>
                      @if (offer.country || offer.countryCode) {
                        <span class="cell-sub">{{ offer.country || offer.countryCode }}</span>
                      }
                      <span class="price">
                        {{ t('admin.numbers.buyDialog.perMonth', { price: money(offer.monthlyPrice) }) }}
                      </span>
                    </span>
                  </mat-radio-button>
                }
              </mat-radio-group>
            </fieldset>
            @if (selected(); as offer) {
              <p class="summary" data-testid="buy-summary">
                {{
                  t('admin.numbers.buyDialog.summary', {
                    number: offer.phoneNumber,
                    gross: money(gross(offer)),
                    vat: vatPercent(),
                  })
                }}
              </p>
            }
          }
        </mat-dialog-content>
        <mat-dialog-actions align="end">
          <button mat-button type="button" mat-dialog-close>{{ t('actions.cancel') }}</button>
          <button mat-flat-button type="submit" [disabled]="busy() || !selected()" data-testid="submit">
            @if (selected(); as offer) {
              {{ t('admin.numbers.buyDialog.submitFor', { price: money(gross(offer)) }) }}
            } @else {
              {{ t('admin.numbers.buyDialog.submit') }}
            }
          </button>
        </mat-dialog-actions>
      </form>
    </ng-container>
  `,
  styles: `
    .hint {
      margin: 0 0 16px;
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
    .offers {
      display: flex;
      flex-direction: column;
      max-height: 320px;
      overflow-y: auto;
    }
    .offer {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      align-items: baseline;
    }
    .cell-sub {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .price {
      font-variant-numeric: tabular-nums;
    }
    .summary {
      margin: 16px 0 0;
    }
  `,
})
export class BuyNumberDialogComponent implements OnInit {
  private readonly ref = inject<MatDialogRef<BuyNumberDialogComponent, BuyNumberResult>>(MatDialogRef);
  private readonly hub = inject(AdminHubService);
  private readonly notify = inject(NotifyService);
  private readonly language = inject(LanguageService);

  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly offers = signal<ResellerStockOffer[]>([]);
  readonly vatPercent = signal(0);

  readonly form = inject(NonNullableFormBuilder).group({
    phoneNumberId: [null as number | null, Validators.required],
  });

  private readonly chosenId = toSignal(this.form.controls.phoneNumberId.valueChanges, { initialValue: null });
  readonly selected = computed(() => this.offers().find((offer) => offer.id === this.chosenId()) ?? null);

  ngOnInit(): void {
    void this.load();
  }

  money(value: string | number | null | undefined): string {
    return formatMoney(value, this.language.current());
  }

  /** What the balance pays per month: the net price plus the VAT rate the hub names, to the cent. */
  gross(offer: ResellerStockOffer): number {
    const net = Number(offer.monthlyPrice);
    return Math.round(net * (100 + this.vatPercent())) / 100;
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const result = await firstValueFrom(
        this.hub.get<ResellerStockOffers>('/resellers/phone-numbers/stock-offers'),
      );
      this.offers.set(result.data ?? []);
      this.vatPercent.set(Number(result.vatPercent) || 0);
    } catch (err) {
      this.notify.apiError(err);
    } finally {
      this.loading.set(false);
    }
  }

  async submit(): Promise<void> {
    const offer = this.selected();
    if (!offer || this.busy()) return;
    this.busy.set(true);
    try {
      const result = await firstValueFrom(
        this.hub.post<ResellerStockPurchase>('/resellers/phone-numbers/stock', { phoneNumberId: offer.id }),
      );
      this.ref.close({ phoneNumber: result.phoneNumber?.phoneNumber ?? offer.phoneNumber });
    } catch (err) {
      this.notify.apiError(err);
      // An offer that is gone (bought by someone else meanwhile) drops out of the list.
      void this.load();
    } finally {
      this.busy.set(false);
    }
  }
}
