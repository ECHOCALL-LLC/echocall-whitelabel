import { Component, inject, type OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { readApiError } from '../../../core/errors/api-error';
import { formatMoney } from '../../../core/format/money';
import { AdminHubService } from '../../../core/hub/admin-hub.service';
import type { PhoneNumber, ResellerAssignedNumber, ResellerAssignResult } from '../../../core/hub/hub.models';
import { LanguageService } from '../../../core/i18n/language.service';
import { NotifyService } from '../../../core/notify/notify.service';
import { ConfirmDialogComponent, type ConfirmDialogData } from '../../../shared/confirm-dialog.component';
import { LocalDatePipe } from '../../../shared/local-date.pipe';
import {
  AssignNumberDialogComponent,
  type AssignNumberDialogData,
  type AssignNumberResult,
} from './assign-number-dialog.component';
import { BuyNumberDialogComponent, type BuyNumberResult } from './buy-number-dialog.component';
import { ImportNumberDialogComponent, type ImportNumberResult } from './import-number-dialog.component';
import {
  SaleNumberDialogComponent,
  type SaleNumberDialogData,
  type SaleNumberResult,
} from './sale-number-dialog.component';

/**
 * A number in the pool. The hub also says whose number it is, whether the
 * operator offers it to its customers and, since API 1.26.0, whether it is a
 * platform number the operator bought into the portal's stock (since when, at
 * which monthly price) and whether a customer pays the operator for it. Hubs
 * before that sent fewer fields, so they stay optional here and are read
 * defensively.
 */
export type PoolNumber = PhoneNumber & {
  ownership?: 'platform' | 'partner' | 'customer' | null;
  isAvailableForPurchase?: boolean | null;
  resellerPoolSince?: string | null;
  resellerPoolPrice?: string | null;
  resellerBaseMonthlyPrice?: string | null;
};

/** The fields `isOwn` and `isBought` look at, on a pool row and on an assigned one. */
type Tenancy = Pick<PoolNumber, 'ownership' | 'resellerPoolSince'>;

/** What the hub says about a charged assignment the operator should read in the portal's words. */
const CHARGE_MESSAGES: Record<string, string> = {
  insufficient_balance: 'admin.numbers.chargeErrors.insufficient_balance',
  billing_profile_incomplete: 'admin.numbers.chargeErrors.billing_profile_incomplete',
};

/**
 * The number pool of the portal, in the two states a number can be in: lying in
 * the pool, or held by a customer. Both lists are shown at once rather than
 * behind tabs, because handing a number out moves a row from one to the other
 * and the operator should see that happen.
 */
@Component({
  selector: 'app-admin-numbers-page',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTableModule,
    TranslocoDirective,
    LocalDatePipe,
  ],
  providers: [provideTranslocoScope('admin')],
  template: `
    <ng-container *transloco="let t">
      <div class="page-head">
        <div>
          <h1 class="page-title">{{ t('admin.numbers.title') }}</h1>
          <p class="page-hint">{{ t('admin.numbers.intro') }}</p>
        </div>
        <div class="head-actions">
          <button mat-stroked-button type="button" (click)="importNumber()" data-testid="import">
            {{ t('admin.numbers.import') }}
          </button>
          <button mat-flat-button type="button" (click)="buyNumber()" data-testid="buy">
            <mat-icon>add</mat-icon>
            {{ t('admin.numbers.buy') }}
          </button>
        </div>
      </div>
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      <h2 class="section">{{ t('admin.numbers.tabs.available') }}</h2>
      @if (available().length) {
        <div class="table-wrap">
          <table mat-table [dataSource]="available()" data-testid="available-table">
            <ng-container matColumnDef="number">
              <th mat-header-cell *matHeaderCellDef>{{ t('admin.numbers.number') }}</th>
              <td mat-cell *matCellDef="let row" [attr.data-label]="t('admin.numbers.number')">
                <span class="nowrap">{{ row.phoneNumber }}</span>
                @if (isBought(row)) {
                  <span class="cell-sub block" data-testid="bought">
                    {{ t('admin.numbers.boughtBadge', { price: money(row.resellerPoolPrice) }) }}
                  </span>
                }
              </td>
            </ng-container>
            <ng-container matColumnDef="label">
              <th mat-header-cell *matHeaderCellDef>{{ t('admin.numbers.label') }}</th>
              <td mat-cell *matCellDef="let row" [attr.data-label]="t('admin.numbers.label')">
                {{ row.friendlyName }}
              </td>
            </ng-container>
            <ng-container matColumnDef="country">
              <th mat-header-cell *matHeaderCellDef>{{ t('admin.numbers.country') }}</th>
              <td mat-cell *matCellDef="let row" [attr.data-label]="t('admin.numbers.country')">
                {{ row.country }}
              </td>
            </ng-container>
            <ng-container matColumnDef="direction">
              <th mat-header-cell *matHeaderCellDef>{{ t('admin.numbers.direction') }}</th>
              <td mat-cell *matCellDef="let row" [attr.data-label]="t('admin.numbers.direction')">
                {{ directions(row, t) }}
              </td>
            </ng-container>
            <ng-container matColumnDef="price">
              <th mat-header-cell *matHeaderCellDef>{{ t('admin.numbers.price') }}</th>
              <td mat-cell *matCellDef="let row" [attr.data-label]="t('admin.numbers.price')" class="numeric">
                {{ money(row.monthlyPrice) }}
              </td>
            </ng-container>
            <ng-container matColumnDef="sale">
              <th mat-header-cell *matHeaderCellDef>{{ t('admin.numbers.sale') }}</th>
              <td
                mat-cell
                *matCellDef="let row"
                [attr.data-label]="t('admin.numbers.sale')"
                data-testid="sale-state"
              >
                @if (isOwn(row) || isBought(row)) {
                  @if (row.isAvailableForPurchase) {
                    <span class="on-sale">
                      {{ isBought(row) ? t('admin.numbers.onSaleMarkup') : t('admin.numbers.onSale') }}
                    </span>
                  } @else {
                    <span class="cell-sub">{{ t('admin.numbers.notOnSale') }}</span>
                  }
                }
              </td>
            </ng-container>
            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef></th>
              <td mat-cell *matCellDef="let row" class="row-actions">
                @if (isOwn(row)) {
                  @if (row.isAvailableForPurchase) {
                    <button
                      mat-stroked-button
                      type="button"
                      (click)="offer(row)"
                      data-testid="sale-price-change"
                    >
                      {{ t('admin.numbers.changePrice') }}
                    </button>
                    <button mat-stroked-button type="button" (click)="withdraw(row)" data-testid="sale-stop">
                      {{ t('admin.numbers.stopSale') }}
                    </button>
                  } @else {
                    <button mat-stroked-button type="button" (click)="offer(row)" data-testid="sale-start">
                      {{ t('admin.numbers.offer') }}
                    </button>
                  }
                } @else if (isBought(row)) {
                  @if (row.isAvailableForPurchase) {
                    <button mat-stroked-button type="button" (click)="withdraw(row)" data-testid="sale-stop">
                      {{ t('admin.numbers.stopSale') }}
                    </button>
                  } @else {
                    <button
                      mat-stroked-button
                      type="button"
                      (click)="offerBought(row)"
                      data-testid="sale-start"
                    >
                      {{ t('admin.numbers.offer') }}
                    </button>
                  }
                }
                <button mat-stroked-button type="button" (click)="assign(row)" data-testid="assign">
                  {{ t('admin.numbers.assign') }}
                </button>
                @if (isBought(row)) {
                  <button mat-stroked-button type="button" (click)="giveBack(row)" data-testid="return">
                    {{ t('admin.numbers.return') }}
                  </button>
                } @else if (isOwn(row)) {
                  <button mat-stroked-button type="button" (click)="remove(row)" data-testid="delete">
                    {{ t('admin.numbers.delete') }}
                  </button>
                }
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="availableColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: availableColumns"></tr>
          </table>
        </div>
      } @else {
        <p class="empty empty-panel" data-testid="available-empty">{{ t('admin.numbers.empty') }}</p>
      }

      <h2 class="section">{{ t('admin.numbers.tabs.assigned') }}</h2>
      @if (assigned().length) {
        <div class="table-wrap">
          <table mat-table [dataSource]="assigned()" data-testid="assigned-table">
            <ng-container matColumnDef="number">
              <th mat-header-cell *matHeaderCellDef>{{ t('admin.numbers.number') }}</th>
              <td mat-cell *matCellDef="let row" [attr.data-label]="t('admin.numbers.number')">
                <span class="nowrap">{{ row.phoneNumber.phoneNumber }}</span>
                @if (isBought(row.phoneNumber)) {
                  <span class="cell-sub block">
                    {{ t('admin.numbers.boughtBadge', { price: money(row.phoneNumber.resellerPoolPrice) }) }}
                  </span>
                }
              </td>
            </ng-container>
            <ng-container matColumnDef="label">
              <th mat-header-cell *matHeaderCellDef>{{ t('admin.numbers.label') }}</th>
              <td mat-cell *matCellDef="let row" [attr.data-label]="t('admin.numbers.label')">
                {{ row.phoneNumber.friendlyName }}
              </td>
            </ng-container>
            <ng-container matColumnDef="customer">
              <th mat-header-cell *matHeaderCellDef>{{ t('admin.numbers.customer') }}</th>
              <td mat-cell *matCellDef="let row" [attr.data-label]="t('admin.numbers.customer')">
                @if (row.owner) {
                  {{ row.owner.name || row.owner.email }}
                } @else {
                  <span class="cell-sub">{{ t('admin.numbers.customerGone') }}</span>
                }
              </td>
            </ng-container>
            <ng-container matColumnDef="since">
              <th mat-header-cell *matHeaderCellDef>{{ t('admin.numbers.since') }}</th>
              <td mat-cell *matCellDef="let row" [attr.data-label]="t('admin.numbers.since')" class="nowrap">
                {{ row.phoneNumber.purchasedAt | localDate: 'date' }}
              </td>
            </ng-container>
            <ng-container matColumnDef="billing">
              <th mat-header-cell *matHeaderCellDef>{{ t('admin.numbers.billing') }}</th>
              <td
                mat-cell
                *matCellDef="let row"
                [attr.data-label]="t('admin.numbers.billing')"
                data-testid="billing"
              >
                @if (billedToCustomer(row.phoneNumber)) {
                  {{ t('admin.numbers.customerPays', { price: money(row.phoneNumber.monthlyPrice) }) }}
                } @else {
                  <span class="cell-sub">{{ t('admin.numbers.customerFree') }}</span>
                }
              </td>
            </ng-container>
            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef></th>
              <td mat-cell *matCellDef="let row" class="row-actions">
                @if (isOwn(row.phoneNumber) || isBought(row.phoneNumber)) {
                  <button mat-stroked-button type="button" (click)="release(row)" data-testid="release">
                    {{ t('admin.numbers.release') }}
                  </button>
                }
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="assignedColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: assignedColumns"></tr>
          </table>
        </div>
      } @else {
        <p class="empty empty-panel" data-testid="assigned-empty">
          {{ t('admin.numbers.emptyAssigned') }}
        </p>
      }
    </ng-container>
  `,
  styles: `
    .head-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .section {
      font: var(--mat-sys-title-medium);
      margin: 24px 0 8px;
    }
    .cell-sub {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .block {
      display: block;
    }
    .row-actions {
      text-align: right;
      white-space: nowrap;
    }
    .on-sale {
      color: var(--mat-sys-primary);
      font: var(--mat-sys-label-large);
    }
    .numeric {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class AdminNumbersPage implements OnInit {
  private readonly hub = inject(AdminHubService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly language = inject(LanguageService);

  readonly availableColumns = ['number', 'label', 'country', 'direction', 'price', 'sale', 'actions'];
  readonly assignedColumns = ['number', 'label', 'customer', 'since', 'billing', 'actions'];
  readonly available = signal<PoolNumber[]>([]);
  readonly assigned = signal<ResellerAssignedNumber[]>([]);
  readonly loading = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  money(value: string | number | null | undefined): string {
    return formatMoney(value, this.language.current());
  }

  /** What the number is cleared for; a number that can do neither says nothing. */
  directions(number: PhoneNumber, t: (key: string) => string): string {
    const parts: string[] = [];
    if (number.supportsInbound) parts.push(t('admin.numbers.inbound'));
    if (number.supportsOutbound) parts.push(t('admin.numbers.outbound'));
    return parts.join(', ');
  }

  async load(): Promise<void> {
    this.loading.set(true);
    const [available, assigned] = await Promise.allSettled([
      firstValueFrom(this.hub.list<PoolNumber>('/resellers/phone-numbers/available')),
      firstValueFrom(this.hub.list<ResellerAssignedNumber>('/resellers/phone-numbers/assigned')),
    ]);
    this.loading.set(false);
    if (available.status === 'fulfilled') this.available.set(available.value);
    if (assigned.status === 'fulfilled') this.assigned.set(assigned.value);
    const failed = [available, assigned].find((part) => part.status === 'rejected');
    if (failed) this.notify.apiError(failed.reason);
  }

  /** The operator's own imported numbers: offered at its own price, removed for good. */
  isOwn(number: Tenancy): boolean {
    return number.ownership === 'partner';
  }

  /**
   * A platform number the operator bought into the portal's stock. It sells at
   * the platform price plus the operator's markup and goes back to the
   * platform rather than being removed.
   */
  isBought(number: Tenancy): boolean {
    return number.ownership === 'platform' && number.resellerPoolSince != null;
  }

  /** Whether the customer pays the operator for a handed out number: the hub keeps the base price beside it then. */
  billedToCustomer(number: Pick<PoolNumber, 'resellerBaseMonthlyPrice'>): boolean {
    return number.resellerBaseMonthlyPrice != null;
  }

  /**
   * Offers one of the operator's own numbers to its customers at a monthly
   * price, or changes that price. Customers then find it among the numbers
   * they can buy at once and pay it from their balance.
   */
  offer(number: PoolNumber): void {
    const price = Number(number.monthlyPrice);
    const data: SaleNumberDialogData = {
      phoneNumber: number.phoneNumber,
      monthlyPrice: number.isAvailableForPurchase && Number.isFinite(price) ? price : null,
    };
    this.dialog
      .open<SaleNumberDialogComponent, SaleNumberDialogData, SaleNumberResult>(SaleNumberDialogComponent, {
        data,
      })
      .afterClosed()
      .subscribe(async (result) => {
        if (!result) return;
        await this.setSale(
          number,
          { onSale: true, monthlyPrice: result.monthlyPrice },
          'admin.numbers.offered',
        );
      });
  }

  /** Offers a bought number. Its price is not the operator's to type: platform price plus markup. */
  offerBought(number: PoolNumber): void {
    const data: ConfirmDialogData = {
      titleKey: 'admin.numbers.saleDialog.title',
      messageKey: 'admin.numbers.offerBoughtMessage',
      params: { number: number.phoneNumber },
      confirmKey: 'admin.numbers.offer',
    };
    this.dialog
      .open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, { data })
      .afterClosed()
      .subscribe(async (confirmed) => {
        if (!confirmed) return;
        await this.setSale(number, { onSale: true }, 'admin.numbers.offered');
      });
  }

  /** Takes a number off sale. It stays in the pool and can be offered again. */
  withdraw(number: PoolNumber): void {
    const data: ConfirmDialogData = {
      titleKey: 'admin.numbers.stopSaleTitle',
      messageKey: 'admin.numbers.stopSaleMessage',
      params: { number: number.phoneNumber },
      confirmKey: 'admin.numbers.stopSale',
    };
    this.dialog
      .open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, { data })
      .afterClosed()
      .subscribe(async (confirmed) => {
        if (!confirmed) return;
        await this.setSale(number, { onSale: false }, 'admin.numbers.saleStopped');
      });
  }

  private async setSale(
    number: PoolNumber,
    body: { onSale: boolean; monthlyPrice?: number },
    successKey: string,
  ): Promise<void> {
    try {
      await firstValueFrom(this.hub.patch(`/resellers/phone-numbers/${number.id}/sale`, body));
      this.notify.success(successKey, { number: number.phoneNumber });
      await this.load();
    } catch (err) {
      this.notify.apiError(err);
    }
  }

  /**
   * Hands one number out, for free or for the customer to pay. The customer can
   * point an agent at it afterwards.
   */
  assign(number: PhoneNumber): void {
    const data: AssignNumberDialogData = { phoneNumber: number.phoneNumber };
    this.dialog
      .open<AssignNumberDialogComponent, AssignNumberDialogData, AssignNumberResult>(
        AssignNumberDialogComponent,
        { data },
      )
      .afterClosed()
      .subscribe(async (result) => {
        if (!result) return;
        try {
          const answer = await firstValueFrom(
            this.hub.post<ResellerAssignResult>(`/resellers/phone-numbers/${number.id}/assign`, {
              customerId: result.customerId,
              chargeCustomer: result.chargeCustomer,
            }),
          );
          if (answer?.charged) {
            this.notify.success('admin.numbers.assignedCharged', {
              number: number.phoneNumber,
              price: this.money(answer.monthlyPrice),
            });
          } else {
            this.notify.success('admin.numbers.assigned', { number: number.phoneNumber });
          }
          await this.load();
        } catch (err) {
          const own = result.chargeCustomer ? CHARGE_MESSAGES[readApiError(err).code] : undefined;
          if (own) this.notify.error(own);
          else this.notify.apiError(err);
        }
      });
  }

  /**
   * Takes a number back into the pool. Calls to it stop reaching the customer
   * the moment this goes through, so the confirmation says so beforehand.
   */
  release(row: ResellerAssignedNumber): void {
    const data: ConfirmDialogData = {
      titleKey: 'admin.numbers.releaseTitle',
      messageKey: 'admin.numbers.releaseMessage',
      params: { number: row.phoneNumber.phoneNumber },
      confirmKey: 'admin.numbers.release',
      destructive: true,
    };
    this.dialog
      .open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, { data })
      .afterClosed()
      .subscribe(async (confirmed) => {
        if (!confirmed) return;
        try {
          await firstValueFrom(this.hub.post(`/resellers/phone-numbers/${row.phoneNumber.id}/release`));
          this.notify.success('admin.numbers.released');
          await this.load();
        } catch (err) {
          this.notify.apiError(err);
        }
      });
  }

  /**
   * Drops one of the operator's own numbers out of the pool for good. Only
   * offered for numbers no customer holds, and the confirmation spells out
   * that the stored trunk credentials go with it while the carrier contract
   * does not.
   */
  remove(number: PhoneNumber): void {
    const data: ConfirmDialogData = {
      titleKey: 'admin.numbers.deleteTitle',
      messageKey: 'admin.numbers.deleteMessage',
      params: { number: number.phoneNumber },
      confirmKey: 'admin.numbers.delete',
      destructive: true,
    };
    this.dialog
      .open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, { data })
      .afterClosed()
      .subscribe(async (confirmed) => {
        if (!confirmed) return;
        try {
          await firstValueFrom(this.hub.delete(`/resellers/phone-numbers/${number.id}`));
          this.notify.success('admin.numbers.deleted');
          await this.load();
        } catch (err) {
          this.notify.apiError(err);
        }
      });
  }

  /**
   * Hands a bought number back to the platform. It stops costing the portal
   * balance at once; the month already paid stays paid, which the
   * confirmation says before anything happens.
   */
  giveBack(number: PoolNumber): void {
    const data: ConfirmDialogData = {
      titleKey: 'admin.numbers.returnTitle',
      messageKey: 'admin.numbers.returnMessage',
      params: { number: number.phoneNumber },
      confirmKey: 'admin.numbers.return',
      destructive: true,
    };
    this.dialog
      .open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, { data })
      .afterClosed()
      .subscribe(async (confirmed) => {
        if (!confirmed) return;
        try {
          await firstValueFrom(this.hub.post(`/resellers/phone-numbers/${number.id}/return`));
          this.notify.success('admin.numbers.returned', { number: number.phoneNumber });
          await this.load();
        } catch (err) {
          this.notify.apiError(err);
        }
      });
  }

  /** Buys a platform number into the portal's stock; the dialog names the price first. */
  buyNumber(): void {
    this.dialog
      .open<BuyNumberDialogComponent, unknown, BuyNumberResult>(BuyNumberDialogComponent, { data: {} })
      .afterClosed()
      .subscribe((result) => {
        if (!result) return;
        this.notify.success('admin.numbers.bought', { number: result.phoneNumber });
        void this.load();
      });
  }

  importNumber(): void {
    this.dialog
      .open<ImportNumberDialogComponent, unknown, ImportNumberResult>(ImportNumberDialogComponent, {
        data: {},
      })
      .afterClosed()
      .subscribe((result) => {
        if (!result) return;
        this.notify.success('admin.numbers.imported', { number: result.phoneNumber });
        void this.load();
      });
  }
}
