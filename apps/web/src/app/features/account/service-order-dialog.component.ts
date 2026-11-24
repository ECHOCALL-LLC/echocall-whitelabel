import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { readApiError } from '../../core/errors/api-error';
import { countryOptions } from '../../core/format/countries';
import { formatMoney } from '../../core/format/money';
import { HubService } from '../../core/hub/hub.service';
import { LanguageService } from '../../core/i18n/language.service';
import { NotifyService } from '../../core/notify/notify.service';
import { pickText, type ServiceField, type ServiceOffer, vatSplit } from './services.model';

export interface ServiceOrderDialogData {
  service: ServiceOffer;
  vatPercent: number;
  balanceEur: number;
}

/** What ordering reports back: the order, the ticket it opened and what it cost. */
export interface ServiceOrderResult {
  orderId: number;
  ticketId: number | null;
  grossEur: number;
}

/** The longest answer the service keeps, per field type. */
const ANSWER_LIMITS = { text: 200, textarea: 4000 } as const;

type FieldError = 'required' | 'invalid';

/** "2026-11-24T09:30" in local time, the format of a datetime-local input. */
function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Ordering one service: pick the variant, answer what the work needs, see the price with VAT
 * and order. It is paid from the balance at once and opens a ticket where the work is
 * discussed, so the dialog says both before the button is pressed.
 */
@Component({
  selector: 'app-service-order-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    TranslocoDirective,
  ],
  providers: [provideTranslocoScope('user')],
  template: `
    <ng-container *transloco="let t">
      <h2 mat-dialog-title>{{ text(service.name, service.nameEn) }}</h2>
      <form (ngSubmit)="order()">
        <mat-dialog-content class="content">
          @if (text(service.description, service.descriptionEn); as description) {
            <p class="description">{{ description }}</p>
          }

          @if (service.variants.length > 0) {
            <mat-form-field appearance="outline">
              <mat-label>{{ t('user.services.order.variant') }}</mat-label>
              <mat-select
                name="variant"
                required
                [ngModel]="variantKey()"
                (ngModelChange)="variantKey.set($event)"
                data-testid="service-variant"
              >
                @for (variant of service.variants; track variant.key) {
                  <mat-option [value]="variant.key">
                    {{ text(variant.nameDe, variant.nameEn) }} · {{ money(variant.priceNet) }}
                  </mat-option>
                }
              </mat-select>
            </mat-form-field>
          }

          @for (field of service.fields; track field.key) {
            <mat-form-field appearance="outline">
              <mat-label>{{ text(field.labelDe, field.labelEn) }}</mat-label>
              @switch (field.type) {
                @case ('textarea') {
                  <textarea
                    matInput
                    rows="4"
                    [name]="field.key"
                    [required]="field.required"
                    [attr.maxlength]="limits.textarea"
                    [ngModel]="answers()[field.key] ?? ''"
                    (ngModelChange)="answer(field.key, $event)"
                    [attr.data-testid]="'service-field-' + field.key"
                  ></textarea>
                }
                @case ('country') {
                  <mat-select
                    [name]="field.key"
                    [required]="field.required"
                    [ngModel]="answers()[field.key] ?? ''"
                    (ngModelChange)="answer(field.key, $event)"
                    [attr.data-testid]="'service-field-' + field.key"
                  >
                    @if (!field.required) {
                      <mat-option value="">{{ t('user.services.order.noCountry') }}</mat-option>
                    }
                    @for (country of countries(); track country.code) {
                      <mat-option [value]="country.code">{{ country.name }}</mat-option>
                    }
                  </mat-select>
                }
                @case ('datetime') {
                  <input
                    matInput
                    type="datetime-local"
                    [name]="field.key"
                    [required]="field.required"
                    [min]="earliest"
                    [ngModel]="answers()[field.key] ?? ''"
                    (ngModelChange)="answer(field.key, $event)"
                    [attr.data-testid]="'service-field-' + field.key"
                  />
                }
                @default {
                  <input
                    matInput
                    [name]="field.key"
                    [required]="field.required"
                    [attr.maxlength]="limits.text"
                    [ngModel]="answers()[field.key] ?? ''"
                    (ngModelChange)="answer(field.key, $event)"
                    [attr.data-testid]="'service-field-' + field.key"
                  />
                }
              }
              @if (fieldErrors()[field.key]; as error) {
                <mat-hint class="field-error" role="alert">{{ t('user.services.order.field.' + error) }}</mat-hint>
              }
            </mat-form-field>
          }

          <dl class="facts" data-testid="service-price">
            <dt>{{ t('user.services.order.net') }}</dt>
            <dd>{{ price() ? money(price()!.net) : '' }}</dd>
            <dt>{{ t('user.services.order.vat', { percent: vatPercent }) }}</dt>
            <dd>{{ price() ? money(price()!.vat) : '' }}</dd>
            <dt class="total">{{ t('user.services.order.total') }}</dt>
            <dd class="total">{{ price() ? money(price()!.gross) : t('user.services.order.pickVariant') }}</dd>
          </dl>

          @if (missing() > 0) {
            <div class="notice" role="note" data-testid="service-balance-short">
              <mat-icon aria-hidden="true">account_balance_wallet</mat-icon>
              <p>{{ t('user.services.order.balanceShort', { balance: money(balanceEur), missing: money(missing()) }) }}</p>
            </div>
          } @else {
            <p class="hint">{{ t('user.services.order.paidFrom', { balance: money(balanceEur) }) }}</p>
          }
          <p class="hint">{{ t('user.services.order.ticketHint') }}</p>
        </mat-dialog-content>
        <mat-dialog-actions align="end">
          <button mat-button type="button" mat-dialog-close>{{ t('actions.cancel') }}</button>
          <button
            mat-flat-button
            type="submit"
            [disabled]="!ready() || ordering()"
            data-testid="service-order-submit"
          >
            {{ price() ? t('user.services.order.submit', { amount: money(price()!.gross) }) : t('user.services.order.submitPlain') }}
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
      max-width: 560px;
    }
    .description {
      margin: 0;
      white-space: pre-line;
    }
    .facts {
      margin: 4px 0 0;
    }
    .total {
      font-weight: 600;
    }
    .field-error {
      color: var(--mat-sys-error);
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
    .notice p {
      margin: 0;
    }
    .hint {
      margin: 0;
    }
  `,
})
export class ServiceOrderDialogComponent {
  private readonly data = inject<ServiceOrderDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ServiceOrderDialogComponent, ServiceOrderResult>>(MatDialogRef);
  private readonly hub = inject(HubService);
  private readonly notify = inject(NotifyService);
  private readonly language = inject(LanguageService);

  readonly service = this.data.service;
  readonly vatPercent = this.data.vatPercent;
  readonly balanceEur = this.data.balanceEur;
  readonly limits = ANSWER_LIMITS;
  /** A date in the past is refused by the service, so the picker starts now. */
  readonly earliest = localInputValue(new Date());

  /** A single variant is the only choice there is, so it is picked already. */
  readonly variantKey = signal<string | null>(this.service.variants.length === 1 ? this.service.variants[0].key : null);
  readonly answers = signal<Record<string, string>>({});
  readonly fieldErrors = signal<Record<string, FieldError>>({});
  readonly ordering = signal(false);
  readonly countries = computed(() => countryOptions(this.language.current()));

  readonly price = computed(() => {
    if (this.service.variants.length === 0) return vatSplit(this.service.priceNet, this.vatPercent);
    const variant = this.service.variants.find((v) => v.key === this.variantKey());
    return variant ? vatSplit(variant.priceNet, this.vatPercent) : null;
  });

  /** How much is missing on the balance for this order, 0 when it is enough. */
  readonly missing = computed(() => {
    const price = this.price();
    if (!price) return 0;
    return Math.max(0, Math.round((price.gross - this.balanceEur) * 100) / 100);
  });

  readonly ready = computed(() => {
    if (!this.price() || this.missing() > 0) return false;
    const answers = this.answers();
    return this.service.fields.every((f) => !f.required || (answers[f.key] ?? '').trim() !== '');
  });

  text(de: string | null | undefined, en: string | null | undefined): string {
    return pickText(this.language.current(), de, en);
  }

  money(value: number): string {
    return formatMoney(value, this.language.current());
  }

  answer(key: string, value: string): void {
    this.answers.update((all) => ({ ...all, [key]: value ?? '' }));
    if (this.fieldErrors()[key]) {
      this.fieldErrors.update((all) => {
        const rest = { ...all };
        delete rest[key];
        return rest;
      });
    }
  }

  async order(): Promise<void> {
    if (!this.ready() || this.ordering()) return;
    const answers: Record<string, string> = {};
    for (const field of this.service.fields) {
      const value = this.answerFor(field);
      if (value !== '') answers[field.key] = value;
    }
    const body: { positionId: number; variantKey?: string; answers: Record<string, string> } = {
      positionId: this.service.id,
      answers,
    };
    const variant = this.variantKey();
    if (variant) body.variantKey = variant;

    this.ordering.set(true);
    try {
      const result = await firstValueFrom(
        this.hub.post<{ data: { orderId: number; ticketId?: number | null; grossEur: number } }>(
          '/billing/services/orders',
          body,
        ),
      );
      this.ref.close({
        orderId: result.data.orderId,
        ticketId: result.data.ticketId ?? null,
        grossEur: result.data.grossEur,
      });
    } catch (err) {
      this.showError(err);
    } finally {
      this.ordering.set(false);
    }
  }

  /** The answer as the service wants it: trimmed text, a country code, a date in ISO 8601. */
  private answerFor(field: ServiceField): string {
    const raw = (this.answers()[field.key] ?? '').trim();
    if (!raw) return '';
    if (field.type === 'datetime') {
      const at = new Date(raw);
      return Number.isNaN(at.getTime()) ? raw : at.toISOString();
    }
    if (field.type === 'country') return raw.toUpperCase();
    return raw;
  }

  private showError(err: unknown): void {
    const error = readApiError(err);
    const details = (error.details ?? {}) as Record<string, unknown>;
    const reason = typeof details['reason'] === 'string' ? details['reason'] : null;
    switch (reason) {
      case 'INSUFFICIENT_BALANCE': {
        const balance = Number(details['balanceEur']);
        const gross = Number(details['grossEur']);
        const missing = Number.isFinite(balance) && Number.isFinite(gross) ? Math.max(0, gross - balance) : null;
        if (missing !== null) {
          this.notify.error('user.services.order.errors.balance', { missing: this.money(missing) });
        } else {
          this.notify.error('errors.insufficient_balance');
        }
        return;
      }
      case 'ANSWER_REQUIRED':
      case 'ANSWER_INVALID': {
        const field = typeof details['field'] === 'string' ? details['field'] : null;
        const kind: FieldError = reason === 'ANSWER_REQUIRED' ? 'required' : 'invalid';
        if (field) this.fieldErrors.update((all) => ({ ...all, [field]: kind }));
        this.notify.error(`user.services.order.errors.${kind}`);
        return;
      }
      case 'VARIANT_REQUIRED':
        this.notify.error('user.services.order.errors.variant');
        return;
      case 'NOT_AVAILABLE':
      case 'NOT_ELIGIBLE':
        this.notify.error('user.services.order.errors.notAvailable');
        return;
      case 'TOO_MANY':
        this.notify.error('user.services.order.errors.tooMany');
        return;
      case 'BILLING_PROFILE_INCOMPLETE':
        this.notify.error('errors.billing_profile_incomplete');
        return;
    }
    this.notify.apiError(err);
  }
}
