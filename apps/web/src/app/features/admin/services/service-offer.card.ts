import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { readApiError } from '../../../core/errors/api-error';
import { formatMoney } from '../../../core/format/money';
import { AdminHubService } from '../../../core/hub/admin-hub.service';
import type { ResellerServiceOffer, UpdateServiceOfferInput } from '../../../core/hub/hub.models';
import { LanguageService } from '../../../core/i18n/language.service';
import { NotifyService } from '../../../core/notify/notify.service';
import { pickText, turnaround } from '../../account/services.model';
import { parsePrice, priceInput } from './service-price';

/** The refusals of a price that have their own words. */
const OFFER_REFUSALS = ['PRICE_BELOW_COST', 'PRICE_INVALID', 'NOT_FOUND'];

interface PriceRow {
  /** The variant key, or '' for a service with one price. */
  key: string;
  label: string;
  purchaseNet: number;
  customerNet: number;
  custom: boolean;
}

interface PriceLine extends PriceRow {
  raw: string;
  value: number | null;
  invalid: boolean;
  below: boolean;
  margin: number;
}

/**
 * One service of the platform as the operator sells it: switched on or off for
 * their customers, and per variant the purchase price, the operator's own net
 * price and what is left for them. A price left empty means the customers pay
 * the purchase price, so the operator earns nothing on it until they set one.
 */
@Component({
  selector: 'app-admin-service-offer-card',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    TranslocoDirective,
  ],
  template: `
    <ng-container *transloco="let t">
      <form class="offer" (ngSubmit)="save()" [attr.data-testid]="'offer-' + offer().positionId">
        <div class="head">
          <div class="title">
            <h3>{{ name() }}</h3>
            @if (eta(); as e) {
              <p class="sub">{{ t('admin.serviceOrders.eta.' + e.key, { min: e.min, max: e.max }) }}</p>
            }
          </div>
          <mat-checkbox
            [checked]="enabled()"
            (change)="enabled.set($event.checked)"
            data-testid="offer-enabled"
          >
            {{ t('admin.services.offers.enabled') }}
          </mat-checkbox>
        </div>

        @if (enabled()) {
          <div class="lines" role="list">
            @for (line of lines(); track line.key) {
              <div class="line" role="listitem">
                @if (line.key) {
                  <span class="label">{{ line.label }}</span>
                } @else {
                  <!-- One price only: the card title already names it, the empty cell keeps the columns in line. -->
                  <span class="label spacer" aria-hidden="true"></span>
                }
                <span class="cell">
                  <span class="cap">{{ t('admin.services.offers.purchase') }}</span>
                  {{ money(line.purchaseNet) }}
                </span>
                <mat-form-field appearance="outline" class="price" subscriptSizing="dynamic">
                  <mat-label>{{ t('admin.services.offers.price') }}</mat-label>
                  <input
                    matInput
                    inputmode="decimal"
                    [name]="'price-' + line.key"
                    [value]="line.raw"
                    [placeholder]="placeholder(line)"
                    (input)="setPrice(line.key, $any($event.target).value)"
                    [attr.aria-invalid]="line.invalid || line.below"
                    [attr.data-testid]="'offer-price-' + (line.key || 'base')"
                  />
                  <span matTextSuffix>&nbsp;EUR</span>
                  @if (line.invalid) {
                    <mat-hint class="error">{{ t('admin.services.offers.errors.PRICE_INVALID') }}</mat-hint>
                  } @else if (line.below) {
                    <mat-hint class="error">{{
                      t('admin.services.offers.minimum', { price: money(line.purchaseNet) })
                    }}</mat-hint>
                  }
                </mat-form-field>
                <span
                  class="cell margin"
                  [class.positive]="line.margin > 0"
                  [attr.data-testid]="'offer-margin-' + (line.key || 'base')"
                >
                  <span class="cap">{{ t('admin.services.offers.margin') }}</span>
                  {{ line.margin > 0 ? '+' + money(line.margin) : money(0) }}
                </span>
              </div>
            }
          </div>
        } @else {
          <p class="sub" data-testid="offer-off">{{ t('admin.services.offers.offHint') }}</p>
        }

        <div class="foot">
          <button
            mat-flat-button
            type="submit"
            [disabled]="!dirty() || hasError() || saving()"
            data-testid="offer-save"
          >
            {{ t('actions.save') }}
          </button>
        </div>
      </form>
    </ng-container>
  `,
  styles: `
    .offer {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      padding: 16px;
      background: var(--mat-sys-surface-container-low);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px 16px;
    }
    .title {
      min-width: 0;
    }
    h3 {
      margin: 0;
      font: var(--mat-sys-title-medium);
    }
    .sub {
      margin: 2px 0 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
    .lines {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .line {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(0, 0.8fr) minmax(160px, 1fr) minmax(0, 0.7fr);
      align-items: center;
      gap: 8px 16px;
    }
    .label {
      font: var(--mat-sys-body-large);
      overflow-wrap: anywhere;
    }
    .cell {
      font: var(--mat-sys-body-medium);
      font-variant-numeric: tabular-nums;
    }
    .cap {
      display: block;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);
    }
    .margin {
      text-align: right;
      color: var(--mat-sys-on-surface-variant);
    }
    .margin.positive {
      color: var(--mat-sys-primary);
      font-weight: 600;
    }
    .price {
      width: 100%;
    }
    .error {
      color: var(--mat-sys-error);
    }
    .foot {
      display: flex;
      justify-content: flex-end;
    }
    @media (max-width: 640px) {
      .line {
        grid-template-columns: 1fr 1fr;
      }
      .label,
      .price {
        grid-column: 1 / -1;
      }
      .spacer {
        display: none;
      }
      .margin {
        text-align: left;
      }
    }
  `,
})
export class AdminServiceOfferCard {
  private readonly hub = inject(AdminHubService);
  private readonly notify = inject(NotifyService);
  private readonly language = inject(LanguageService);

  readonly offer = input.required<ResellerServiceOffer>();
  /** Fires after a save, or when the service vanished meanwhile, so the page reads the list again. */
  readonly saved = output<void>();

  readonly enabled = signal(true);
  readonly prices = signal<Record<string, string>>({});
  readonly saving = signal(false);

  readonly name = computed(() => pickText(this.language.current(), this.offer().name, this.offer().nameEn));
  readonly eta = computed(() => turnaround(this.offer()));

  /** A service with variants is priced per variant; one without has a single line. */
  readonly rows = computed<PriceRow[]>(() => {
    const offer = this.offer();
    if (offer.variants.length > 0) {
      return offer.variants.map((variant) => ({
        key: variant.key,
        label: pickText(this.language.current(), variant.nameDe, variant.nameEn) || this.name(),
        purchaseNet: variant.purchaseNet,
        customerNet: variant.customerNet,
        custom: variant.custom,
      }));
    }
    return offer.price ? [{ key: '', label: this.name(), ...offer.price }] : [];
  });

  readonly lines = computed<PriceLine[]>(() =>
    this.rows().map((row) => {
      const raw = this.prices()[row.key] ?? '';
      const empty = raw.trim() === '';
      const value = empty ? null : parsePrice(raw);
      const invalid = !empty && value === null;
      const below = value !== null && value < row.purchaseNet;
      const customer = value ?? row.purchaseNet;
      return {
        ...row,
        raw,
        value,
        invalid,
        below,
        margin: Math.round((customer - row.purchaseNet) * 100) / 100,
      };
    }),
  );

  readonly dirty = computed(
    () =>
      this.enabled() !== this.offer().enabled ||
      this.lines().some((line) => (line.custom ? line.customerNet : null) !== line.value),
  );

  readonly hasError = computed(
    () => this.enabled() && this.lines().some((line) => line.invalid || line.below),
  );

  constructor() {
    // A fresh list from the service resets what is shown to what is stored.
    effect(() => {
      const offer = this.offer();
      const language = this.language.current();
      this.enabled.set(offer.enabled);
      this.prices.set(
        Object.fromEntries(
          this.rowsOf(offer).map((row) => [row.key, row.custom ? priceInput(row.customerNet, language) : '']),
        ),
      );
    });
  }

  money(value: number): string {
    return formatMoney(value, this.language.current());
  }

  placeholder(line: PriceLine): string {
    return priceInput(line.purchaseNet, this.language.current());
  }

  setPrice(key: string, raw: string): void {
    this.prices.update((prices) => ({ ...prices, [key]: raw }));
  }

  async save(): Promise<void> {
    if (!this.dirty() || this.hasError() || this.saving()) return;
    const offer = this.offer();
    const lines = this.lines();
    const body: UpdateServiceOfferInput = { enabled: this.enabled() };
    if (offer.variants.length > 0) {
      body.variantPrices = Object.fromEntries(lines.map((line) => [line.key, line.value]));
    } else if (lines.length > 0) {
      body.price = lines[0].value;
    }
    this.saving.set(true);
    try {
      await firstValueFrom(this.hub.put(`/resellers/services/offers/${offer.positionId}`, body));
      this.notify.success('admin.services.offers.saved', { name: this.name() });
      this.saved.emit();
    } catch (err) {
      const reason = (readApiError(err).details as { reason?: unknown } | undefined)?.reason;
      if (typeof reason === 'string' && OFFER_REFUSALS.includes(reason)) {
        this.notify.error('admin.services.offers.errors.' + reason);
        if (reason === 'NOT_FOUND') this.saved.emit();
      } else {
        this.notify.apiError(err);
      }
    } finally {
      this.saving.set(false);
    }
  }

  private rowsOf(offer: ResellerServiceOffer): { key: string; customerNet: number; custom: boolean }[] {
    if (offer.variants.length > 0) return offer.variants;
    return offer.price ? [{ key: '', ...offer.price }] : [];
  }
}
