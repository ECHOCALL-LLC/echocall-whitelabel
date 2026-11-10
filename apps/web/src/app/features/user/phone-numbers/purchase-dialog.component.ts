import { Component, inject, type OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { formatMoney } from '../../../core/format/money';
import { HubService } from '../../../core/hub/hub.service';
import type { Country, InstantNumber, MarketplaceNumber } from '../../../core/hub/hub.models';
import { LanguageService } from '../../../core/i18n/language.service';
import { NotifyService } from '../../../core/notify/notify.service';
import { NUMBER_TYPE_OPTIONS } from './number-type.options';

/** What the purchase returns, so the list can show what the new number costs and needs. */
export interface PurchaseResult {
  phoneNumberId: number;
  number: string;
  kycRequired: boolean;
}

/**
 * Buys a number. Numbers that are set up already, among them the ones the
 * operator offers, are listed first and bought at once from the balance.
 * Below that the marketplace is searched; the offer is passed back to the
 * service unchanged: it prices the number itself, so the prices shown here
 * are what the account is charged, net of VAT.
 */
@Component({
  selector: 'app-purchase-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTableModule,
    TranslocoDirective,
  ],
  providers: [provideTranslocoScope('user')],
  template: `
    <ng-container *transloco="let t">
      <h2 mat-dialog-title>{{ t('user.numbers.purchaseTitle') }}</h2>
      <mat-dialog-content>
        @if (instant().length) {
          <section data-testid="instant-numbers">
            <h3 class="part-title">{{ t('user.numbers.instantTitle') }}</h3>
            <p class="hint">{{ t('user.numbers.instantHint') }}</p>
            <div class="table-wrap">
              <table mat-table [dataSource]="instant()" data-testid="instant-table">
                <ng-container matColumnDef="number">
                  <th mat-header-cell *matHeaderCellDef>{{ t('user.numbers.number') }}</th>
                  <td mat-cell *matCellDef="let n" [attr.data-label]="t('user.numbers.number')">
                    {{ n.phoneNumber }}
                    @if (n.friendlyName && n.friendlyName !== n.phoneNumber) {
                      <span class="area">{{ n.friendlyName }}</span>
                    }
                  </td>
                </ng-container>
                <ng-container matColumnDef="monthly">
                  <th mat-header-cell *matHeaderCellDef>{{ t('user.numbers.monthly') }}</th>
                  <td mat-cell *matCellDef="let n" [attr.data-label]="t('user.numbers.monthly')">
                    {{ money(n.monthlyPrice) }}
                  </td>
                </ng-container>
                <ng-container matColumnDef="actions">
                  <th mat-header-cell *matHeaderCellDef></th>
                  <td mat-cell *matCellDef="let n" class="cell-actions">
                    <button
                      mat-stroked-button
                      type="button"
                      (click)="buyInstant(n)"
                      [disabled]="busy()"
                      data-testid="instant-buy"
                    >
                      {{ t('user.numbers.buy') }}
                    </button>
                  </td>
                </ng-container>
                <tr mat-header-row *matHeaderRowDef="instantColumns"></tr>
                <tr mat-row *matRowDef="let row; columns: instantColumns"></tr>
              </table>
            </div>
          </section>
          <h3 class="part-title">{{ t('user.numbers.searchTitle') }}</h3>
        }
        <form class="search" (ngSubmit)="search()">
          <mat-form-field appearance="outline">
            <mat-label>{{ t('user.numbers.country') }}</mat-label>
            <mat-select name="country" [(ngModel)]="countryIso" data-testid="purchase-country" required>
              @for (country of countries(); track country.iso) {
                <mat-option [value]="country.iso">{{ country.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>{{ t('user.numbers.numberType') }}</mat-label>
            <mat-select name="numberType" [(ngModel)]="numberType">
              @for (type of numberTypes; track type) {
                <mat-option [value]="type">{{ t('user.numbers.types.' + type) }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>{{ t('user.numbers.areaCode') }}</mat-label>
            <input matInput name="areaCode" [(ngModel)]="areaCode" />
          </mat-form-field>
          <button
            mat-flat-button
            type="submit"
            [disabled]="!countryIso || busy()"
            data-testid="purchase-search"
          >
            <mat-icon>search</mat-icon>
            {{ t('user.numbers.search') }}
          </button>
        </form>

        @if (busy()) {
          <mat-progress-bar mode="indeterminate" />
        }

        @if (searched()) {
          <div class="table-wrap">
            <table mat-table [dataSource]="offers()" data-testid="purchase-results">
              <ng-container matColumnDef="number">
                <th mat-header-cell *matHeaderCellDef>{{ t('user.numbers.number') }}</th>
                <td mat-cell *matCellDef="let offer" [attr.data-label]="t('user.numbers.number')">
                  {{ offer.number }}
                  @if (offer.areaName) {
                    <span class="area">{{ offer.areaName }}</span>
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="setup">
                <th mat-header-cell *matHeaderCellDef>{{ t('user.numbers.setupPrice') }}</th>
                <td mat-cell *matCellDef="let offer" [attr.data-label]="t('user.numbers.setupPrice')">
                  {{ money(offer.setupPrice) }}
                </td>
              </ng-container>
              <ng-container matColumnDef="monthly">
                <th mat-header-cell *matHeaderCellDef>{{ t('user.numbers.monthly') }}</th>
                <td mat-cell *matCellDef="let offer" [attr.data-label]="t('user.numbers.monthly')">
                  {{ money(offer.monthlyPrice) }}
                </td>
              </ng-container>
              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef></th>
                <td mat-cell *matCellDef="let offer" class="cell-actions">
                  <button
                    mat-stroked-button
                    type="button"
                    (click)="buy(offer)"
                    [disabled]="busy()"
                    data-testid="purchase-buy"
                  >
                    {{ t('user.numbers.buy') }}
                  </button>
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columns"></tr>
              <tr mat-row *matRowDef="let row; columns: columns"></tr>
              <tr class="mat-row" *matNoDataRow>
                <td class="mat-cell empty" [attr.colspan]="columns.length">
                  {{ t('user.numbers.searchEmpty') }}
                </td>
              </tr>
            </table>
          </div>
          <p class="hint">{{ t('user.numbers.priceHint') }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button mat-dialog-close type="button">{{ t('actions.cancel') }}</button>
      </mat-dialog-actions>
    </ng-container>
  `,
  styles: `
    .search {
      display: flex;
      gap: 12px;
      align-items: baseline;
      flex-wrap: wrap;
    }
    .search mat-form-field {
      flex: 1;
      min-width: 160px;
    }
    .area {
      color: var(--mat-sys-on-surface-variant);
      margin-left: 8px;
      font: var(--mat-sys-body-small);
    }
    .hint {
      margin: 12px 0 0;
    }
    .part-title {
      font: var(--mat-sys-title-small);
      margin: 8px 0 0;
    }
    section {
      margin-bottom: 24px;
    }
    section .hint {
      margin: 4px 0 8px;
    }
  `,
})
export class PurchaseDialogComponent implements OnInit {
  private readonly hub = inject(HubService);
  private readonly notify = inject(NotifyService);
  private readonly language = inject(LanguageService);
  private readonly dialogRef = inject(MatDialogRef<PurchaseDialogComponent, PurchaseResult>);

  readonly countries = signal<Country[]>([]);
  readonly offers = signal<MarketplaceNumber[]>([]);
  readonly instant = signal<InstantNumber[]>([]);
  readonly busy = signal(false);
  readonly searched = signal(false);
  readonly columns = ['number', 'setup', 'monthly', 'actions'];
  readonly instantColumns = ['number', 'monthly', 'actions'];
  readonly numberTypes = NUMBER_TYPE_OPTIONS;

  countryIso = '';
  numberType: string = NUMBER_TYPE_OPTIONS[0];
  areaCode = '';

  ngOnInit(): void {
    void this.loadCountries();
    void this.loadInstant();
  }

  money(value: string | number | null | undefined): string {
    return formatMoney(value, this.language.current());
  }

  async loadCountries(): Promise<void> {
    this.busy.set(true);
    try {
      this.countries.set(await firstValueFrom(this.hub.list<Country>('/phone-numbers/countries')));
    } catch (err) {
      this.notify.apiError(err);
    } finally {
      this.busy.set(false);
    }
  }

  /** The ready numbers are an extra: when they cannot be read the search still works. */
  async loadInstant(): Promise<void> {
    try {
      this.instant.set(await firstValueFrom(this.hub.list<InstantNumber>('/phone-numbers/instant')));
    } catch {
      this.instant.set([]);
    }
  }

  /** Pays the first month from the balance; the number is on the account at once. */
  async buyInstant(number: InstantNumber): Promise<void> {
    this.busy.set(true);
    try {
      const { data } = await firstValueFrom(
        this.hub.post<{ data: { id: number; phoneNumber: string } }>(
          `/phone-numbers/instant/${number.id}/purchase`,
        ),
      );
      this.dialogRef.close({ phoneNumberId: data.id, number: data.phoneNumber, kycRequired: false });
    } catch (err) {
      this.notify.apiError(err);
    } finally {
      this.busy.set(false);
    }
  }

  async search(): Promise<void> {
    if (!this.countryIso) return;
    this.busy.set(true);
    try {
      const params: Record<string, string | number> = {
        countryIso: this.countryIso,
        numberType: this.numberType,
        limit: 25,
      };
      const areaCode = this.areaCode.trim();
      if (areaCode) params['areaCode'] = areaCode;
      this.offers.set(
        await firstValueFrom(this.hub.list<MarketplaceNumber>('/phone-numbers/search', params)),
      );
      this.searched.set(true);
    } catch (err) {
      this.notify.apiError(err);
    } finally {
      this.busy.set(false);
    }
  }

  async buy(offer: MarketplaceNumber): Promise<void> {
    this.busy.set(true);
    try {
      const result = await firstValueFrom(
        this.hub.post<PurchaseResult>('/phone-numbers/purchase', {
          availableDidId: offer.availableDidId,
          skuId: offer.skuId,
          number: offer.number,
          countryIso: offer.countryIso,
          areaName: offer.areaName ?? undefined,
          numberType: offer.numberType,
          features: offer.features ?? [],
          requirementId: offer.requirementId ?? undefined,
        }),
      );
      this.dialogRef.close(result);
    } catch (err) {
      this.notify.apiError(err);
    } finally {
      this.busy.set(false);
    }
  }
}
