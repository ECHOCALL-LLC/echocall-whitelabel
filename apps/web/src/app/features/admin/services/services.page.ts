import { Component, inject, type OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { formatMoney } from '../../../core/format/money';
import { AdminHubService } from '../../../core/hub/admin-hub.service';
import type { ResellerOwnService, ResellerServiceOffers } from '../../../core/hub/hub.models';
import { LanguageService } from '../../../core/i18n/language.service';
import { NotifyService } from '../../../core/notify/notify.service';
import { ConfirmDialogComponent, type ConfirmDialogData } from '../../../shared/confirm-dialog.component';
import { pickText, turnaround } from '../../account/services.model';
import { OwnServiceDialogComponent, type OwnServiceDialogData } from './own-service-dialog.component';
import { AdminServiceOfferCard } from './service-offer.card';

/**
 * What the operator's customers can order besides voice and chat. The
 * platform's services come with a purchase price the operator marks up or
 * switches off; their own services they describe, price and do themselves.
 * Every order arrives as a ticket, where the work on it happens.
 */
@Component({
  selector: 'app-admin-services-page',
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule, TranslocoDirective, AdminServiceOfferCard],
  providers: [provideTranslocoScope('admin')],
  template: `
    <ng-container *transloco="let t">
      <div class="page-head">
        <div>
          <h1 class="page-title">{{ t('admin.services.title') }}</h1>
          <p class="page-hint">{{ t('admin.services.intro') }}</p>
        </div>
      </div>

      <section class="block" data-testid="offers">
        <h2 class="section">{{ t('admin.services.offers.title') }}</h2>
        @if (loadingOffers()) {
          <mat-progress-bar mode="indeterminate" />
        } @else if (offers(); as data) {
          @if (data.services.length > 0) {
            <p class="hint">{{ t('admin.services.offers.intro', { vat: data.vatPercent }) }}</p>
            <div class="cards">
              @for (offer of data.services; track offer.positionId) {
                <app-admin-service-offer-card [offer]="offer" (saved)="loadOffers()" />
              }
            </div>
          } @else {
            <p class="empty" data-testid="offers-empty">{{ t('admin.services.offers.empty') }}</p>
          }
        } @else {
          <p class="empty" data-testid="offers-error">
            {{ t('admin.services.loadError') }}
            <button mat-button type="button" (click)="loadOffers()">{{ t('actions.retry') }}</button>
          </p>
        }
      </section>

      <section class="block" data-testid="own">
        <div class="section-head">
          <h2 class="section">{{ t('admin.services.own.title') }}</h2>
          <button mat-flat-button type="button" (click)="create()" data-testid="own-create">
            <mat-icon>add</mat-icon>
            {{ t('admin.services.own.create') }}
          </button>
        </div>
        <p class="hint">{{ t('admin.services.own.intro') }}</p>
        @if (loadingOwn()) {
          <mat-progress-bar mode="indeterminate" />
        } @else if (ownError()) {
          <p class="empty" data-testid="own-error">
            {{ t('admin.services.loadError') }}
            <button mat-button type="button" (click)="loadOwn()">{{ t('actions.retry') }}</button>
          </p>
        } @else {
          <ul class="own-list">
            @for (service of own(); track service.id) {
              <li class="own" data-testid="own-row">
                <div class="own-main">
                  <p class="own-name">
                    {{ name(service) }}
                    @if (!service.isVisible) {
                      <span class="badge" data-testid="own-hidden">{{ t('admin.services.own.hidden') }}</span>
                    }
                  </p>
                  <p class="own-meta">
                    <span data-testid="own-price">{{ price(t, service) }}</span>
                    @if (eta(service); as e) {
                      <span>{{ t('admin.serviceOrders.eta.' + e.key, { min: e.min, max: e.max }) }}</span>
                    }
                    @if (service.fields.length > 0) {
                      <span>{{ t('admin.services.own.fieldCount', { count: service.fields.length }) }}</span>
                    }
                  </p>
                </div>
                <div class="own-actions">
                  <button
                    mat-icon-button
                    type="button"
                    (click)="edit(service)"
                    [attr.aria-label]="t('admin.services.own.editLabel', { name: name(service) })"
                    data-testid="own-edit"
                  >
                    <mat-icon>edit</mat-icon>
                  </button>
                  <button
                    mat-icon-button
                    type="button"
                    (click)="remove(service)"
                    [attr.aria-label]="t('admin.services.own.deleteLabel', { name: name(service) })"
                    data-testid="own-delete"
                  >
                    <mat-icon>delete</mat-icon>
                  </button>
                </div>
              </li>
            } @empty {
              <li class="empty" data-testid="own-empty">{{ t('admin.services.own.empty') }}</li>
            }
          </ul>
        }
      </section>
    </ng-container>
  `,
  styles: `
    .block {
      margin-top: 24px;
    }
    .section-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px 16px;
    }
    .section {
      font: var(--mat-sys-title-large);
      margin: 0 0 4px;
    }
    .hint {
      margin: 0 0 16px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      max-width: 70ch;
    }
    .cards {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .own-list {
      list-style: none;
      margin: 0;
      padding: 0;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      overflow: hidden;
    }
    .own {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 8px 12px 16px;
      background: var(--mat-sys-surface-container-low);
    }
    .own + .own {
      border-top: 1px solid var(--mat-sys-outline-variant);
    }
    .own-main {
      flex: 1;
      min-width: 0;
    }
    .own-name {
      margin: 0;
      font: var(--mat-sys-body-large);
      overflow-wrap: anywhere;
    }
    .own-meta {
      margin: 2px 0 0;
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      font-variant-numeric: tabular-nums;
    }
    .own-actions {
      display: flex;
      flex: none;
    }
    .badge {
      display: inline-block;
      margin-left: 8px;
      padding: 2px 8px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-on-surface-variant);
      vertical-align: middle;
    }
    .empty {
      margin: 0;
      padding: 16px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
  `,
})
export class AdminServicesPage implements OnInit {
  private readonly hub = inject(AdminHubService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly language = inject(LanguageService);

  readonly offers = signal<ResellerServiceOffers | null>(null);
  readonly own = signal<ResellerOwnService[]>([]);
  readonly loadingOffers = signal(false);
  readonly loadingOwn = signal(false);
  readonly ownError = signal(false);

  ngOnInit(): void {
    void this.loadOffers();
    void this.loadOwn();
  }

  name(service: ResellerOwnService): string {
    return pickText(this.language.current(), service.name, service.nameEn);
  }

  eta(service: ResellerOwnService) {
    return turnaround(service);
  }

  /** One price, or the cheapest variant with "from" when the variants differ. */
  price(t: (key: string, params?: Record<string, unknown>) => string, service: ResellerOwnService): string {
    const locale = this.language.current();
    if (service.variants.length === 0)
      return t('admin.services.own.priceNetValue', { price: formatMoney(service.priceNet, locale) });
    const prices = service.variants.map((variant) => variant.priceNet);
    const lowest = Math.min(...prices);
    const key = prices.some((p) => p !== lowest)
      ? 'admin.services.own.priceFrom'
      : 'admin.services.own.priceNetValue';
    return t(key, { price: formatMoney(lowest, locale) });
  }

  async loadOffers(): Promise<void> {
    this.loadingOffers.set(true);
    try {
      const body = await firstValueFrom(
        this.hub.get<{ data: ResellerServiceOffers }>('/resellers/services/offers'),
      );
      this.offers.set(body?.data ?? { vatPercent: 0, services: [] });
    } catch (err) {
      this.offers.set(null);
      this.notify.apiError(err);
    } finally {
      this.loadingOffers.set(false);
    }
  }

  async loadOwn(): Promise<void> {
    this.loadingOwn.set(true);
    try {
      this.own.set(await firstValueFrom(this.hub.list<ResellerOwnService>('/resellers/services/own')));
      this.ownError.set(false);
    } catch (err) {
      this.ownError.set(true);
      this.notify.apiError(err);
    } finally {
      this.loadingOwn.set(false);
    }
  }

  create(): void {
    this.openDialog({ mode: 'create' }, 'admin.services.own.created');
  }

  edit(service: ResellerOwnService): void {
    this.openDialog({ mode: 'edit', service }, 'admin.services.own.saved');
  }

  /** Deleting cannot be undone, and orders already placed keep their ticket, which the question says. */
  remove(service: ResellerOwnService): void {
    const data: ConfirmDialogData = {
      titleKey: 'admin.services.own.deleteTitle',
      messageKey: 'admin.services.own.deleteMessage',
      params: { name: this.name(service) },
      confirmKey: 'admin.services.own.delete',
      destructive: true,
    };
    this.dialog
      .open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, { data })
      .afterClosed()
      .subscribe(async (confirmed) => {
        if (!confirmed) return;
        try {
          await firstValueFrom(this.hub.delete(`/resellers/services/own/${service.id}`));
          this.notify.success('admin.services.own.deleted', { name: this.name(service) });
        } catch (err) {
          this.notify.apiError(err);
        }
        await this.loadOwn();
      });
  }

  private openDialog(data: OwnServiceDialogData, doneKey: string): void {
    this.dialog
      .open<OwnServiceDialogComponent, OwnServiceDialogData, boolean>(OwnServiceDialogComponent, {
        data,
        panelClass: 'dialog-wide',
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .subscribe(async (saved) => {
        if (!saved) return;
        this.notify.success(doneKey);
        await this.loadOwn();
      });
  }
}
