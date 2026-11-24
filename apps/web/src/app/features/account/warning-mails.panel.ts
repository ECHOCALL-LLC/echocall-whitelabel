import { Component, inject, input, type OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { AdminHubService } from '../../core/hub/admin-hub.service';
import { HubService, type HubApi } from '../../core/hub/hub.service';
import { NotifyService } from '../../core/notify/notify.service';

export const WARNING_INTERVALS = ['off', 'event', 'daily', 'weekly'] as const;
export type WarningInterval = (typeof WARNING_INTERVALS)[number];
export type WarningCategory = 'balance' | 'trial' | 'numbers' | 'integrations' | 'customer_orders';

export interface WarningMailSetting {
  category: WarningCategory;
  interval: WarningInterval;
}

interface WarningMailsResponse {
  data: { settings: WarningMailSetting[]; partner: boolean };
}

/**
 * Which warnings reach the account by email, and how often. Every warning is
 * off until someone switches it on here. The service decides which categories
 * apply (the operator sees the orders of its customers, a customer never sees
 * the balance of the portal), so the panel lists only what can arrive. A choice
 * is saved the moment it is made, like any setting, with no extra save button.
 */
@Component({
  selector: 'app-warning-mails-panel',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressBarModule,
    MatSelectModule,
    TranslocoDirective,
  ],
  template: `
    <ng-container *transloco="let t">
      <mat-card appearance="outlined" data-testid="warning-mails">
        <mat-card-header>
          <mat-icon mat-card-avatar aria-hidden="true">notifications</mat-icon>
          <mat-card-title>{{ t('account.warningMails.title') }}</mat-card-title>
          <mat-card-subtitle>{{ t('account.warningMails.subtitle') }}</mat-card-subtitle>
        </mat-card-header>
        @if (state() === 'loading') {
          <mat-progress-bar mode="indeterminate" [attr.aria-label]="t('account.warningMails.loading')" />
        }
        <mat-card-content>
          @if (state() === 'failed') {
            <div class="failed" role="status">
              <p>{{ t('account.warningMails.loadFailed') }}</p>
              <button mat-stroked-button type="button" (click)="load()" data-testid="warning-mails-retry">
                {{ t('account.warningMails.retry') }}
              </button>
            </div>
          }
          @if (state() === 'ready') {
            <ul class="rows">
              @for (setting of settings(); track setting.category) {
                <li class="row" [attr.data-testid]="'warning-' + setting.category">
                  <div class="text">
                    <p class="name" [id]="'warning-title-' + setting.category">
                      {{ t('account.warningMails.categories.' + textKey(setting.category) + '.title') }}
                    </p>
                    <p class="hint" [id]="'warning-desc-' + setting.category">
                      {{ t('account.warningMails.categories.' + textKey(setting.category) + '.description') }}
                    </p>
                  </div>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="interval">
                    <mat-select
                      [value]="setting.interval"
                      (selectionChange)="change(setting.category, $event.value)"
                      [disabled]="saving() === setting.category"
                      [attr.aria-labelledby]="'warning-title-' + setting.category"
                      [attr.aria-describedby]="'warning-desc-' + setting.category"
                    >
                      @for (interval of intervals; track interval) {
                        <mat-option [value]="interval">
                          {{ t('account.warningMails.intervals.' + optionSet(setting.category) + '.' + interval) }}
                        </mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                </li>
              }
            </ul>
          }
          <p class="hint always">{{ t('account.warningMails.alwaysSent') }}</p>
        </mat-card-content>
      </mat-card>
    </ng-container>
  `,
  styles: `
    mat-card-content {
      padding-top: 8px;
    }
    .rows {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      padding: 16px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .text {
      min-width: 0;
    }
    .name {
      margin: 0 0 4px;
      font: var(--mat-sys-title-small);
    }
    .row .hint {
      margin: 0;
    }
    .interval {
      flex: 0 0 auto;
      width: 260px;
      max-width: 100%;
    }
    .failed {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
      padding: 8px 0;
    }
    .failed p {
      margin: 0;
    }
    .always {
      margin: 16px 0 0;
    }
    /* On a phone the choice goes under its text and takes the full width. */
    @media (max-width: 599.98px) {
      .row {
        flex-direction: column;
        align-items: stretch;
        gap: 12px;
      }
      .interval {
        width: 100%;
      }
    }
  `,
})
export class WarningMailsPanel implements OnInit {
  /** True in the admin panel: the settings of the account the portal is connected with. */
  readonly operator = input(false);

  private readonly customerHub = inject(HubService);
  private readonly operatorHub = inject(AdminHubService);
  private readonly notify = inject(NotifyService);

  readonly intervals = WARNING_INTERVALS;
  readonly settings = signal<WarningMailSetting[]>([]);
  readonly partner = signal(false);
  readonly state = signal<'loading' | 'ready' | 'failed'>('loading');
  readonly saving = signal<WarningCategory | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  private get hub(): HubApi {
    return this.operator() ? this.operatorHub : this.customerHub;
  }

  /** The balance warning is about a shortage that lasts, so its options say "while it lasts". */
  optionSet(category: WarningCategory): 'balance' | 'event' {
    return category === 'balance' ? 'balance' : 'event';
  }

  textKey(category: WarningCategory): string {
    if (category === 'balance' && this.partner()) return 'balancePortal';
    if (category === 'customer_orders') return 'customerOrders';
    return category;
  }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      const result = await firstValueFrom(this.hub.get<WarningMailsResponse>('/users/me/warning-mails'));
      this.settings.set(result.data.settings);
      this.partner.set(result.data.partner);
      this.state.set('ready');
    } catch {
      this.state.set('failed');
    }
  }

  async change(category: WarningCategory, interval: WarningInterval): Promise<void> {
    const previous = this.settings();
    // The choice shows at once; a failed save puts the old one back.
    this.settings.set(previous.map((s) => (s.category === category ? { ...s, interval } : s)));
    this.saving.set(category);
    try {
      await firstValueFrom(this.hub.put(`/users/me/warning-mails/${category}`, { interval }));
      this.notify.success(interval === 'off' ? 'account.warningMails.savedOff' : 'account.warningMails.savedOn');
    } catch (err) {
      this.settings.set(previous);
      this.notify.apiError(err);
    } finally {
      this.saving.set(null);
    }
  }
}
