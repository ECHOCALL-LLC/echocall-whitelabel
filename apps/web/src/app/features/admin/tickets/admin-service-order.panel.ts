import { Component, computed, inject, input, type OnInit, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { readApiError } from '../../../core/errors/api-error';
import { formatMoney } from '../../../core/format/money';
import { AdminHubService } from '../../../core/hub/admin-hub.service';
import type { ResellerServiceOrder, ServiceForwardResult, ServiceOrderStep } from '../../../core/hub/hub.models';
import { LanguageService } from '../../../core/i18n/language.service';
import { NotifyService } from '../../../core/notify/notify.service';
import { ConfirmDialogComponent, type ConfirmDialogData } from '../../../shared/confirm-dialog.component';
import { pickText, turnaround } from '../../account/services.model';
import {
  type ServiceOrderCancelData,
  ServiceOrderCancelDialogComponent,
  type ServiceOrderCancelResult,
} from './service-order-cancel-dialog.component';

/** The refusals of handing an order on that have their own words; anything else reads as a failure. */
const FORWARD_REFUSALS = ['INSUFFICIENT_BALANCE', 'ALREADY_FORWARDED', 'NOT_AVAILABLE'];

interface StepButton {
  status: ServiceOrderStep;
  key: string;
  primary: boolean;
}

/**
 * The service a customer ordered through this ticket, and the work on it.
 * The operator moves the order along here (start, ask back, finish) or ends
 * it; a platform service can also be handed on to the platform's team, paid
 * from the operator's balance. The ticket holds the conversation, so this
 * panel only tells the parent when the ticket should be read again.
 */
@Component({
  selector: 'app-admin-service-order-panel',
  imports: [MatButtonModule, MatIconModule, RouterLink, TranslocoDirective],
  providers: [provideTranslocoScope('admin')],
  template: `
    <ng-container *transloco="let t">
      @if (order(); as o) {
        <section class="order" data-testid="service-order" [attr.aria-label]="t('admin.serviceOrders.title')">
          <header class="head">
            <mat-icon aria-hidden="true">handyman</mat-icon>
            <h2>{{ t('admin.serviceOrders.title') }}</h2>
            <span class="state" [attr.data-state]="o.status" data-testid="service-status">
              {{ t('admin.serviceOrders.status.' + o.status) }}
            </span>
          </header>

          <p class="name">
            {{ name(o) }}
            @if (variant(o); as v) {
              <span class="variant">{{ v }}</span>
            }
          </p>
          <dl class="facts">
            <div>
              <dt>{{ t('admin.serviceOrders.buyerLabel') }}</dt>
              <dd>
                <a [routerLink]="['/admin/customers', o.customerId]" data-testid="service-buyer">
                  {{ t('admin.serviceOrders.buyer', { id: o.customerId }) }}
                </a>
              </dd>
            </div>
            <div>
              <dt>{{ t('admin.serviceOrders.priceLabel') }}</dt>
              <dd data-testid="service-price">
                @if (o.priceGross > 0) {
                  {{ t('admin.serviceOrders.paid', { gross: money(o.priceGross), net: money(o.priceNet) }) }}
                } @else {
                  {{ t('admin.serviceOrders.free') }}
                }
              </dd>
            </div>
            @if (eta(o); as e) {
              <div>
                <dt>{{ t('admin.serviceOrders.etaLabel') }}</dt>
                <dd>{{ t('admin.serviceOrders.eta.' + e.key, { min: e.min, max: e.max }) }}</dd>
              </div>
            }
            @if (o.refundedEur > 0) {
              <div>
                <dt>{{ t('admin.serviceOrders.refundedLabel') }}</dt>
                <dd data-testid="service-refunded">{{ t('admin.serviceOrders.refunded', { amount: money(o.refundedEur) }) }}</dd>
              </div>
            }
          </dl>

          @if (o.status === 'waiting_customer') {
            <p class="hint" data-testid="service-ask-hint">{{ t('admin.serviceOrders.askHint') }}</p>
          }

          @if (!final()) {
            <div class="actions" data-testid="service-actions">
              @for (step of steps(); track step.status + step.key) {
                @if (step.primary) {
                  <button
                    mat-flat-button
                    type="button"
                    [disabled]="busy()"
                    (click)="move(step.status)"
                    [attr.data-testid]="'service-' + step.key"
                  >
                    {{ t('admin.serviceOrders.' + step.key) }}
                  </button>
                } @else {
                  <button
                    mat-stroked-button
                    type="button"
                    [disabled]="busy()"
                    (click)="move(step.status)"
                    [attr.data-testid]="'service-' + step.key"
                  >
                    {{ t('admin.serviceOrders.' + step.key) }}
                  </button>
                }
              }
              <button
                mat-button
                type="button"
                class="cancel"
                [disabled]="busy()"
                (click)="cancel(o)"
                data-testid="service-cancel"
              >
                {{ t('admin.serviceOrders.cancel') }}
              </button>
            </div>
          }

          @if (o.forwarded; as f) {
            <div class="box" data-testid="service-forwarded">
              <p class="box-title">{{ t('admin.serviceOrders.forwardedTitle') }}</p>
              <p class="box-text">
                {{
                  t('admin.serviceOrders.forwardedState', {
                    ticket: f.ticketId ?? '',
                    status: t('admin.serviceOrders.status.' + f.status),
                  })
                }}
              </p>
            </div>
          } @else if (o.forwardQuote && !final() && !o.ownService) {
            <div class="box forward" data-testid="service-forward">
              <div class="box-body">
                <p class="box-title">{{ t('admin.serviceOrders.forwardTitle') }}</p>
                <p class="box-text">
                  {{ t('admin.serviceOrders.forwardHint', { gross: money(o.forwardQuote.grossEur), net: money(o.forwardQuote.netEur) }) }}
                </p>
                @if (short()) {
                  <p class="box-text warn" data-testid="service-forward-short">
                    <mat-icon aria-hidden="true">warning</mat-icon>
                    {{
                      t('admin.serviceOrders.forwardShort', {
                        balance: money(o.forwardQuote.balanceEur),
                        gross: money(o.forwardQuote.grossEur),
                      })
                    }}
                  </p>
                }
              </div>
              <button
                mat-stroked-button
                type="button"
                [disabled]="busy() || short()"
                (click)="forward(o)"
                data-testid="service-forward-open"
              >
                <mat-icon>send</mat-icon>
                {{ t('admin.serviceOrders.forward') }}
              </button>
            </div>
          } @else if (!final() && o.forwardBlocked === 'NOT_AVAILABLE' && !o.ownService) {
            <p class="hint" data-testid="service-forward-blocked">{{ t('admin.serviceOrders.forwardErrors.NOT_AVAILABLE') }}</p>
          }

          @if (o.ownService && !final()) {
            <p class="hint" data-testid="service-own">{{ t('admin.serviceOrders.ownHint') }}</p>
          }
        </section>
      }
    </ng-container>
  `,
  styles: `
    .order {
      margin-top: 16px;
      padding: 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .head h2 {
      font: var(--mat-sys-title-medium);
      margin: 0;
      flex: 1;
    }
    .head mat-icon {
      color: var(--mat-sys-on-surface-variant);
    }
    .state {
      padding: 2px 10px;
      border-radius: 999px;
      font: var(--mat-sys-label-medium);
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      white-space: nowrap;
    }
    .state[data-state='done'] {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    .state[data-state='cancelled'] {
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-on-surface-variant);
    }
    .name {
      margin: 0;
      font: var(--mat-sys-body-large);
    }
    .variant {
      color: var(--mat-sys-on-surface-variant);
      margin-left: 6px;
    }
    .facts {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 32px;
      margin: 0;
    }
    .facts dt {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }
    .facts dd {
      margin: 2px 0 0;
      font: var(--mat-sys-body-medium);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .cancel {
      margin-left: auto;
      --mat-button-text-label-text-color: var(--mat-sys-error);
    }
    .box {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 10px;
      padding: 12px;
      background: var(--mat-sys-surface);
    }
    .forward {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px 16px;
    }
    .box-body {
      flex: 1 1 260px;
      min-width: 0;
    }
    .box-title {
      margin: 0;
      font: var(--mat-sys-title-small);
    }
    .box-text {
      margin: 4px 0 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
    .warn {
      display: flex;
      gap: 6px;
      align-items: flex-start;
      color: var(--mat-sys-error);
    }
    .warn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex: none;
    }
    .hint {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      max-width: 70ch;
    }
  `,
})
export class AdminServiceOrderPanel implements OnInit {
  private readonly hub = inject(AdminHubService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly transloco = inject(TranslocoService);
  private readonly language = inject(LanguageService);

  /** The ticket whose order is shown. */
  readonly ticketId = input.required<string>();
  /** Fires after a step that also moves the ticket, so the page reads it again. */
  readonly changed = output<void>();

  readonly order = signal<ResellerServiceOrder | null>(null);
  readonly busy = signal(false);

  readonly final = computed(() => {
    const status = this.order()?.status;
    return status === 'done' || status === 'cancelled';
  });

  readonly short = computed(() => {
    const quote = this.order()?.forwardQuote;
    return !!quote && quote.balanceEur < quote.grossEur;
  });

  /** The ways forward from where the order stands, the usual next one first. */
  readonly steps = computed<StepButton[]>(() => {
    switch (this.order()?.status) {
      case 'open':
        return [{ status: 'in_progress', key: 'start', primary: true }];
      case 'in_progress':
        return [
          { status: 'done', key: 'finish', primary: true },
          { status: 'waiting_customer', key: 'ask', primary: false },
        ];
      case 'waiting_customer':
        return [
          { status: 'in_progress', key: 'resume', primary: false },
          { status: 'done', key: 'finish', primary: true },
        ];
      default:
        return [];
    }
  });

  ngOnInit(): void {
    void this.load();
  }

  name(order: ResellerServiceOrder): string {
    return pickText(this.language.current(), order.name, order.nameEn);
  }

  variant(order: ResellerServiceOrder): string {
    return pickText(this.language.current(), order.variantName, order.variantNameEn);
  }

  eta(order: ResellerServiceOrder) {
    return turnaround(order);
  }

  money(value: number): string {
    return formatMoney(value, this.language.current());
  }

  /**
   * Reads the order behind the ticket. Most tickets hold none and the panel
   * stays away; a ticket the service does not know is the page's business.
   */
  async load(): Promise<void> {
    try {
      const body = await firstValueFrom(
        this.hub.get<{ data: ResellerServiceOrder | null }>(`/resellers/services/orders/by-ticket/${this.ticketId()}`),
      );
      this.order.set(body?.data ?? null);
    } catch (err) {
      this.order.set(null);
      if (readApiError(err).status !== 404) this.notify.apiError(err);
    }
  }

  async move(status: ServiceOrderStep): Promise<void> {
    const order = this.order();
    if (!order || this.busy()) return;
    this.busy.set(true);
    try {
      const body = await firstValueFrom(
        this.hub.post<{ data: ResellerServiceOrder }>(`/resellers/services/orders/${order.id}/status`, { status }),
      );
      this.order.set(body.data);
      this.notify.success('admin.serviceOrders.saved', {
        status: this.transloco.translate('admin.serviceOrders.status.' + body.data.status),
      });
      this.changed.emit();
    } catch (err) {
      this.notify.apiError(err);
      await this.load();
    } finally {
      this.busy.set(false);
    }
  }

  cancel(order: ResellerServiceOrder): void {
    const data: ServiceOrderCancelData = {
      refundAmount: order.refundable && order.priceGross > 0 ? this.money(order.priceGross) : null,
    };
    this.dialog
      .open<ServiceOrderCancelDialogComponent, ServiceOrderCancelData, ServiceOrderCancelResult>(
        ServiceOrderCancelDialogComponent,
        { data, autoFocus: 'first-tabbable' },
      )
      .afterClosed()
      .subscribe((result) => {
        if (result) void this.confirmCancel(order.id, result.refund);
      });
  }

  /**
   * Hands a platform service on to the platform's team. It costs the operator
   * money at once, so the amount is in the question before anything is sent.
   */
  forward(order: ResellerServiceOrder): void {
    const quote = order.forwardQuote;
    if (!quote || this.short()) return;
    const gross = this.money(quote.grossEur);
    const data: ConfirmDialogData = {
      titleKey: 'admin.serviceOrders.forwardConfirmTitle',
      messageKey: 'admin.serviceOrders.forwardConfirmDesc',
      params: { gross, net: this.money(quote.netEur), amount: gross },
      confirmKey: 'admin.serviceOrders.forwardConfirm',
      cancelKey: 'admin.serviceOrders.notNow',
    };
    this.dialog
      .open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, { data })
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed) void this.confirmForward(order.id);
      });
  }

  private async confirmCancel(orderId: number, refund: boolean): Promise<void> {
    this.busy.set(true);
    try {
      const body = await firstValueFrom(
        this.hub.post<{ data: ResellerServiceOrder }>(`/resellers/services/orders/${orderId}/cancel`, { refund }),
      );
      this.order.set(body.data);
      if (body.data.refundedEur > 0) {
        this.notify.success('admin.serviceOrders.cancelledRefund', { amount: this.money(body.data.refundedEur) });
      } else {
        this.notify.success('admin.serviceOrders.cancelled');
      }
      this.changed.emit();
    } catch (err) {
      this.notify.apiError(err);
      await this.load();
    } finally {
      this.busy.set(false);
    }
  }

  private async confirmForward(orderId: number): Promise<void> {
    this.busy.set(true);
    try {
      const body = await firstValueFrom(
        this.hub.post<{ data: ServiceForwardResult }>(`/resellers/services/orders/${orderId}/forward`),
      );
      this.notify.success('admin.serviceOrders.forwardDone', {
        ticket: body.data.ticketId,
        amount: this.money(body.data.grossEur),
      });
      this.changed.emit();
    } catch (err) {
      const reason = (readApiError(err).details as { reason?: unknown } | undefined)?.reason;
      if (typeof reason === 'string' && FORWARD_REFUSALS.includes(reason)) {
        this.notify.error('admin.serviceOrders.forwardErrors.' + reason);
      } else {
        this.notify.apiError(err);
      }
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }
}
