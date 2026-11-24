import { Component, inject, type OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { formatMoney } from '../../core/format/money';
import { HubService } from '../../core/hub/hub.service';
import { LanguageService } from '../../core/i18n/language.service';
import { NotifyService } from '../../core/notify/notify.service';
import { LocalDatePipe } from '../../shared/local-date.pipe';
import {
  ServiceOrderDialogComponent,
  type ServiceOrderDialogData,
  type ServiceOrderResult,
} from './service-order-dialog.component';
import {
  pickText,
  type ServiceCatalog,
  type ServiceOffer,
  type ServiceOrder,
  type ServiceOrderStatus,
  startingPrice,
  turnaround,
} from './services.model';

const ORDER_COLUMNS = ['service', 'created', 'status', 'total', 'ticket'];

/** Order states on the shared status colours: waiting on someone draws attention, done is good, cancelled stays neutral. */
const STATUS_TONE: Record<ServiceOrderStatus, string> = {
  open: 'open',
  in_progress: 'in_progress',
  waiting_customer: 'waiting',
  done: 'completed',
  cancelled: 'cancelled',
};

/**
 * Work the account can have done for it, paid from the balance: the catalog with prices and
 * the usual turnaround, and the orders so far with their state. Every order has a ticket where
 * the work is discussed; when it waits for an answer, the order says so and offers to report
 * that the answer was given in the ticket.
 */
@Component({
  selector: 'app-services-panel',
  imports: [
    LocalDatePipe,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressBarModule,
    MatTableModule,
    RouterLink,
    TranslocoDirective,
  ],
  providers: [provideTranslocoScope('user')],
  template: `
    <ng-container *transloco="let t">
      <div class="cards">
        <mat-card appearance="outlined" data-testid="services-catalog">
          <mat-card-header>
            <mat-icon mat-card-avatar aria-hidden="true">handyman</mat-icon>
            <mat-card-title>{{ t('user.services.title') }}</mat-card-title>
            <mat-card-subtitle>{{ t('user.services.subtitle') }}</mat-card-subtitle>
          </mat-card-header>
          @if (state() === 'loading') {
            <mat-progress-bar mode="indeterminate" [attr.aria-label]="t('user.services.loading')" />
          }
          <mat-card-content>
            @if (state() === 'failed') {
              <div class="failed" role="status">
                <p>{{ t('user.services.loadFailed') }}</p>
                <button mat-stroked-button type="button" (click)="load()" data-testid="services-retry">
                  {{ t('user.services.retry') }}
                </button>
              </div>
            }
            @if (state() === 'ready') {
              @if (catalog(); as c) {
                <ul class="offers">
                  @for (service of c.services; track service.id) {
                    <li class="offer" [attr.data-testid]="'service-' + service.id">
                      <div class="text">
                        <p class="name">{{ text(service.name, service.nameEn) }}</p>
                        @if (text(service.description, service.descriptionEn); as description) {
                          <p class="hint description">{{ description }}</p>
                        }
                        <p class="meta">
                          <span class="price">{{ priceLabel(t, service) }}</span>
                          @if (turnaroundLabel(t, service); as eta) {
                            <span class="hint">· {{ eta }}</span>
                          }
                        </p>
                      </div>
                      <button
                        mat-stroked-button
                        type="button"
                        (click)="open(service)"
                        [attr.aria-label]="t('user.services.orderNamed', { name: text(service.name, service.nameEn) })"
                        [attr.data-testid]="'service-order-' + service.id"
                      >
                        {{ t('user.services.order.open') }}
                      </button>
                    </li>
                  } @empty {
                    <li class="empty" data-testid="services-empty">
                      <p class="hint">{{ t(c.eligible ? 'user.services.empty' : 'user.services.notEligible') }}</p>
                    </li>
                  }
                </ul>
              }
            }
          </mat-card-content>
        </mat-card>

        @if (state() === 'ready' && orders().length > 0) {
          <mat-card appearance="outlined" data-testid="services-orders">
            <mat-card-header>
              <mat-card-title>{{ t('user.services.orders.title') }}</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <div class="table-wrap">
                <table mat-table [dataSource]="orders()">
                  <ng-container matColumnDef="service">
                    <th mat-header-cell *matHeaderCellDef>{{ t('user.services.orders.service') }}</th>
                    <td mat-cell *matCellDef="let o" [attr.data-label]="t('user.services.orders.service')">
                      <span class="name-cell">{{ text(o.name, o.nameEn) }}</span>
                      @if (text(o.variantName, o.variantNameEn); as variant) {
                        <span class="sub">{{ variant }}</span>
                      }
                    </td>
                  </ng-container>
                  <ng-container matColumnDef="created">
                    <th mat-header-cell *matHeaderCellDef>{{ t('user.services.orders.created') }}</th>
                    <td mat-cell *matCellDef="let o" [attr.data-label]="t('user.services.orders.created')">
                      {{ o.createdAt | localDate }}
                    </td>
                  </ng-container>
                  <ng-container matColumnDef="status">
                    <th mat-header-cell *matHeaderCellDef>{{ t('user.services.orders.status') }}</th>
                    <td mat-cell *matCellDef="let o" [attr.data-label]="t('user.services.orders.status')">
                      <span [class]="'status status-' + statusTone(o.status)" [attr.data-testid]="'service-status-' + o.id">
                        {{ t('user.services.statuses.' + o.status) }}
                      </span>
                      @if (o.status === 'waiting_customer') {
                        <button
                          mat-button
                          type="button"
                          class="answered"
                          (click)="answered(o)"
                          [disabled]="busy() === o.id"
                          [attr.data-testid]="'service-answered-' + o.id"
                        >
                          {{ t('user.services.orders.answered') }}
                        </button>
                      }
                    </td>
                  </ng-container>
                  <ng-container matColumnDef="total">
                    <th mat-header-cell *matHeaderCellDef>{{ t('user.services.orders.total') }}</th>
                    <td mat-cell *matCellDef="let o" [attr.data-label]="t('user.services.orders.total')">
                      {{ money(o.priceGross) }}
                      @if (o.refundedEur > 0) {
                        <span class="sub">{{ t('user.services.orders.refunded', { amount: money(o.refundedEur) }) }}</span>
                      }
                    </td>
                  </ng-container>
                  <ng-container matColumnDef="ticket">
                    <th mat-header-cell *matHeaderCellDef>{{ t('user.services.orders.ticket') }}</th>
                    <td mat-cell *matCellDef="let o" [attr.data-label]="t('user.services.orders.ticket')">
                      @if (o.ticketId) {
                        <a [routerLink]="['/app/tickets', o.ticketId]">{{ t('user.services.orders.ticketLink', { id: o.ticketId }) }}</a>
                      }
                    </td>
                  </ng-container>
                  <tr mat-header-row *matHeaderRowDef="columns"></tr>
                  <tr mat-row *matRowDef="let row; columns: columns"></tr>
                </table>
              </div>
            </mat-card-content>
          </mat-card>
        }
      </div>
    </ng-container>
  `,
  styles: `
    .cards {
      padding-top: 24px;
      display: grid;
      gap: 24px;
      max-width: 960px;
    }
    p {
      margin: 0;
    }
    .offers {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .offer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      padding: 16px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .offer:last-child {
      border-bottom: 0;
    }
    .text {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .name {
      font: var(--mat-sys-title-small);
    }
    .description {
      white-space: pre-line;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: baseline;
    }
    .price {
      font-weight: 500;
    }
    .empty {
      padding: 8px 0;
    }
    .name-cell {
      display: block;
      font-weight: 500;
    }
    .sub {
      display: block;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .answered {
      margin-left: 4px;
    }
    .failed {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
      padding: 8px 0;
    }
    /* On a phone the order button goes under its service. */
    @media (max-width: 599.98px) {
      .offer {
        flex-direction: column;
        align-items: stretch;
        gap: 12px;
      }
    }
  `,
})
export class ServicesPanel implements OnInit {
  private readonly hub = inject(HubService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly language = inject(LanguageService);

  readonly columns = ORDER_COLUMNS;
  readonly state = signal<'loading' | 'ready' | 'failed'>('loading');
  readonly catalog = signal<ServiceCatalog | null>(null);
  readonly orders = signal<ServiceOrder[]>([]);
  readonly busy = signal<number | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  text(de: string | null | undefined, en: string | null | undefined): string {
    return pickText(this.language.current(), de, en);
  }

  money(value: number): string {
    return formatMoney(value, this.language.current());
  }

  statusTone(status: ServiceOrderStatus): string {
    return STATUS_TONE[status] ?? status;
  }

  priceLabel(t: (key: string, params?: Record<string, unknown>) => string, service: ServiceOffer): string {
    const { net, from } = startingPrice(service);
    return t(from ? 'user.services.priceFrom' : 'user.services.price', { amount: this.money(net) });
  }

  turnaroundLabel(t: (key: string, params?: Record<string, unknown>) => string, service: ServiceOffer): string {
    const eta = turnaround(service);
    return eta ? t('user.services.turnaround.' + eta.key, { min: eta.min, max: eta.max }) : '';
  }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      const [catalog, orders] = await Promise.all([
        firstValueFrom(this.hub.get<{ data: ServiceCatalog }>('/billing/services')),
        firstValueFrom(this.hub.get<{ data: ServiceOrder[] }>('/billing/services/orders', { limit: 50 })),
      ]);
      this.catalog.set(catalog.data);
      this.orders.set(orders.data);
      this.state.set('ready');
    } catch {
      this.state.set('failed');
    }
  }

  async open(service: ServiceOffer): Promise<void> {
    const catalog = this.catalog();
    if (!catalog) return;
    const data: ServiceOrderDialogData = {
      service,
      vatPercent: catalog.vatPercent,
      balanceEur: catalog.balanceEur,
    };
    const result = await firstValueFrom(
      this.dialog
        .open<ServiceOrderDialogComponent, ServiceOrderDialogData, ServiceOrderResult>(ServiceOrderDialogComponent, {
          data,
          panelClass: 'dialog-wide',
        })
        .afterClosed(),
    );
    if (!result) return;
    if (result.ticketId) {
      this.notify.success('user.services.ordered', { id: result.ticketId });
    } else {
      this.notify.success('user.services.orderedPlain');
    }
    await this.load();
  }

  async answered(order: ServiceOrder): Promise<void> {
    this.busy.set(order.id);
    try {
      const result = await firstValueFrom(
        this.hub.post<{ data: ServiceOrder }>(`/billing/services/orders/${order.id}/answered`, {}),
      );
      this.orders.update((all) => all.map((o) => (o.id === order.id ? { ...o, ...result.data } : o)));
      this.notify.success('user.services.orders.answeredSaved');
    } catch (err) {
      this.notify.apiError(err);
    } finally {
      this.busy.set(null);
    }
  }
}
