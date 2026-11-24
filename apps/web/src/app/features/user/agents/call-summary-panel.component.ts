import { Clipboard } from '@angular/cdk/clipboard';
import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, inject, input, type OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  type AbstractControl,
  FormBuilder,
  type FormGroup,
  type FormControl,
  ReactiveFormsModule,
  type ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { readApiError } from '../../../core/errors/api-error';
import { HubService } from '../../../core/hub/hub.service';
import { NotifyService } from '../../../core/notify/notify.service';

export type ForwardingKind = 'busy' | 'noAnswer' | 'unreachable' | 'allConditional';

export interface ForwardingCode {
  kind: ForwardingKind;
  on: string;
  off: string;
}

export interface VipNumber {
  number: string;
  label: string;
}

export interface CallSummaryView {
  agentId: string;
  /** False while the agent keeps no call data: then the summary can only be switched off. */
  available: boolean;
  enabled: boolean;
  email: string | null;
  anonymous: boolean;
  vipNumbers: VipNumber[];
  phoneNumbers: { number: string; forwardingCodes: ForwardingCode[] }[];
}

/** The service accepts up to 50 important numbers. */
export const MAX_VIP_NUMBERS = 50;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SINGLE_KINDS: ForwardingKind[] = ['busy', 'noAnswer', 'unreachable'];

/**
 * A rough shape check, the same one the service runs before it parses the number: separators
 * and a "(0)" go, "00" becomes "+", then 3 to 17 digits must remain. The service has the last
 * word and names the row it refuses.
 */
export function phoneShape(control: AbstractControl): ValidationErrors | null {
  const raw = String(control.value ?? '').trim();
  if (!raw) return null;
  let s = raw.replace(/\(\s*0\s*\)/g, '').replace(/[\s\-./()]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  return /^\+?\d{3,17}$/.test(s) ? null : { phone: true };
}

/** The address as it will be sent: spaces around it do not count, they are trimmed on save. */
export function emailShape(control: AbstractControl): ValidationErrors | null {
  const raw = String(control.value ?? '');
  if (raw === '') return null;
  return EMAIL.test(raw.trim()) ? null : { email: true };
}

type VipGroup = FormGroup<{ label: FormControl<string>; number: FormControl<string> }>;

/**
 * The short email after every call of a voice agent: who called, what it is about and how
 * urgent it is. It sits under the agent form as its own card with its own save, because it is
 * stored apart from the agent. An agent that keeps no call data cannot send it; the card then
 * says why and how to change that, and switching off still works.
 */
@Component({
  selector: 'app-call-summary-panel',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSlideToggleModule,
    NgTemplateOutlet,
    ReactiveFormsModule,
    RouterLink,
    TranslocoDirective,
  ],
  providers: [provideTranslocoScope('user')],
  template: `
    <ng-container *transloco="let t">
      @if (state() === 'loading') {
        <mat-progress-bar mode="indeterminate" [attr.aria-label]="t('user.agents.callSummary.loading')" />
      }
      @if (state() === 'failed') {
        <div class="failed" role="status">
          <p>{{ t('user.agents.callSummary.loadFailed') }}</p>
          <button mat-stroked-button type="button" (click)="load()" data-testid="call-summary-retry">
            {{ t('user.agents.callSummary.retry') }}
          </button>
        </div>
      }
      @if (state() === 'ready') {
        <form [formGroup]="form" (ngSubmit)="save()" class="summary" data-testid="call-summary">
          @if (!available()) {
            <div class="notice" role="note" data-testid="call-summary-zero-pii">
              <mat-icon aria-hidden="true">lock</mat-icon>
              <div>
                <p class="notice-title">{{ t('user.agents.callSummary.zeroPii.title') }}</p>
                <p class="hint">{{ t('user.agents.callSummary.zeroPii.body') }}</p>
              </div>
            </div>
          }

          <div class="toggle-row">
            <mat-slide-toggle
              formControlName="enabled"
              aria-describedby="call-summary-enabled-hint"
              data-testid="call-summary-enabled"
            >
              {{ t('user.agents.callSummary.enabled') }}
            </mat-slide-toggle>
            <p class="hint" id="call-summary-enabled-hint">{{ t('user.agents.callSummary.enabledHint') }}</p>
          </div>

          @if (form.controls.enabled.value) {
            <mat-form-field appearance="outline" class="email" subscriptSizing="dynamic">
              <mat-label>{{ t('user.agents.callSummary.email') }}</mat-label>
              <input
                matInput
                type="email"
                formControlName="email"
                autocomplete="email"
                maxlength="254"
                data-testid="call-summary-email"
              />
              @if (form.controls.email.invalid && form.controls.email.touched) {
                <mat-error>{{ t('user.agents.callSummary.emailInvalid') }}</mat-error>
              } @else {
                <mat-hint>{{ t('user.agents.callSummary.emailHint') }}</mat-hint>
              }
            </mat-form-field>

            <div class="toggle-row">
              <mat-slide-toggle
                formControlName="anonymous"
                aria-describedby="call-summary-anonymous-hint"
                data-testid="call-summary-anonymous"
              >
                {{ t('user.agents.callSummary.anonymous') }}
              </mat-slide-toggle>
              <p class="hint" id="call-summary-anonymous-hint">{{ t('user.agents.callSummary.anonymousHint') }}</p>
            </div>

            <section class="group" aria-labelledby="call-summary-vip-title">
              <h3 class="group-title" id="call-summary-vip-title">{{ t('user.agents.callSummary.vip.title') }}</h3>
              <p class="hint">{{ t('user.agents.callSummary.vip.hint') }}</p>
              <div formArrayName="vipNumbers" class="vips">
                @for (row of vipNumbers.controls; track row; let i = $index) {
                  <div class="vip-row" [formGroupName]="i" [attr.data-testid]="'call-summary-vip-' + i">
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <input
                        matInput
                        formControlName="label"
                        maxlength="60"
                        [placeholder]="t('user.agents.callSummary.vip.labelPlaceholder')"
                        [attr.aria-label]="t('user.agents.callSummary.vip.labelAria', { n: i + 1 })"
                      />
                    </mat-form-field>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <input
                        matInput
                        type="tel"
                        formControlName="number"
                        maxlength="32"
                        autocomplete="off"
                        [placeholder]="t('user.agents.callSummary.vip.numberPlaceholder')"
                        [attr.aria-label]="t('user.agents.callSummary.vip.numberAria', { n: i + 1 })"
                      />
                      @if (row.controls.number.invalid && (row.controls.number.touched || row.controls.number.errors?.['server'])) {
                        <mat-error>{{ t('user.agents.callSummary.vip.numberInvalid') }}</mat-error>
                      }
                    </mat-form-field>
                    <button
                      mat-icon-button
                      type="button"
                      (click)="removeVip(i)"
                      [attr.aria-label]="t('user.agents.callSummary.vip.remove', { n: i + 1 })"
                    >
                      <mat-icon>delete</mat-icon>
                    </button>
                  </div>
                }
              </div>
              @if (vipNumbers.length < maxVipNumbers) {
                <div>
                  <button mat-stroked-button type="button" (click)="addVip()" data-testid="call-summary-vip-add">
                    <mat-icon>add</mat-icon>
                    {{ t('user.agents.callSummary.vip.add') }}
                  </button>
                </div>
              }
            </section>
          }

          <div class="actions">
            <button
              mat-flat-button
              type="submit"
              [disabled]="form.invalid || form.pristine || saving()"
              data-testid="call-summary-save"
            >
              {{ t('actions.save') }}
            </button>
          </div>
        </form>

        <section class="group forwarding" aria-labelledby="call-summary-forwarding-title" data-testid="call-summary-forwarding">
          <h3 class="group-title" id="call-summary-forwarding-title">{{ t('user.agents.callSummary.forwarding.title') }}</h3>
          @for (phone of phoneNumbers(); track phone.number) {
            <p class="hint">{{ t('user.agents.callSummary.forwarding.forNumber', { number: phone.number }) }}</p>
            <ul class="codes">
              @for (kind of singleKinds; track kind) {
                @if (code(phone.forwardingCodes, kind); as c) {
                  <li class="code-row">
                    <span class="code-label">{{ t('user.agents.callSummary.forwarding.kind.' + kind) }}</span>
                    <span class="code-pair">
                      <ng-container
                        *ngTemplateOutlet="copyButton; context: { code: c.on, label: t('user.agents.callSummary.forwarding.kind.' + kind) }"
                      />
                      <span class="off">{{ t('user.agents.callSummary.forwarding.off') }}</span>
                      <ng-container
                        *ngTemplateOutlet="copyButton; context: { code: c.off, label: t('user.agents.callSummary.forwarding.offLabel', { label: t('user.agents.callSummary.forwarding.kind.' + kind) }) }"
                      />
                    </span>
                  </li>
                }
              }
              @if (code(phone.forwardingCodes, 'allConditional'); as all) {
                <li class="code-row">
                  <span class="code-label">{{ t('user.agents.callSummary.forwarding.allAtOnce') }}</span>
                  <span class="code-pair">
                    <ng-container
                      *ngTemplateOutlet="copyButton; context: { code: all.on, label: t('user.agents.callSummary.forwarding.allLabel') }"
                    />
                    <span class="off">{{ t('user.agents.callSummary.forwarding.off') }}</span>
                    <ng-container
                      *ngTemplateOutlet="copyButton; context: { code: all.off, label: t('user.agents.callSummary.forwarding.offLabel', { label: t('user.agents.callSummary.forwarding.allLabel') }) }"
                    />
                  </span>
                </li>
              }
            </ul>
          } @empty {
            <p class="hint" data-testid="call-summary-no-number">{{ t('user.agents.callSummary.forwarding.noNumber') }}</p>
            <div>
              <a mat-stroked-button routerLink="/app/numbers">{{ t('user.agents.callSummary.forwarding.toNumbers') }}</a>
            </div>
          }
          @if (phoneNumbers().length > 0) {
            <p class="hint">{{ t('user.agents.callSummary.forwarding.howTo') }}</p>
            <p class="hint">{{ t('user.agents.callSummary.forwarding.cost') }}</p>
          }
        </section>

        <ng-template #copyButton let-code="code" let-label="label">
          <button
            mat-stroked-button
            type="button"
            class="code"
            (click)="copy(code)"
            [attr.aria-label]="t('user.agents.callSummary.forwarding.copyLabel', { label: label, code: code })"
            [attr.data-testid]="'forwarding-code-' + code"
          >
            <mat-icon>{{ copied() === code ? 'check' : 'content_copy' }}</mat-icon>
            {{ code }}
          </button>
        </ng-template>
      }
    </ng-container>
  `,
  styles: `
    .summary,
    .group {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .summary {
      padding-top: 8px;
    }
    p {
      margin: 0;
    }
    .notice {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 12px 16px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface);
    }
    .notice mat-icon {
      flex: 0 0 auto;
      color: var(--mat-sys-on-surface-variant);
    }
    .notice-title {
      font: var(--mat-sys-title-small);
      margin-bottom: 4px;
    }
    .toggle-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .email {
      max-width: 420px;
      width: 100%;
    }
    .group {
      padding-top: 16px;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }
    .group-title {
      margin: 0;
      font: var(--mat-sys-title-small);
    }
    .vips {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .vip-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
      gap: 12px;
      align-items: start;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
    }
    .forwarding {
      margin-top: 24px;
    }
    .codes {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .code-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .code-pair {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .off {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .failed {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
      padding: 8px 0;
    }
    /* On a phone a row of codes goes under its label and an important number takes two lines. */
    @media (max-width: 599.98px) {
      .code-row {
        flex-direction: column;
        align-items: flex-start;
      }
      .vip-row {
        grid-template-columns: minmax(0, 1fr) auto;
      }
      .vip-row mat-form-field:first-child {
        grid-column: 1 / -1;
      }
    }
  `,
})
export class CallSummaryPanelComponent implements OnInit {
  /** The agent id as the service names it, for example agent_12. */
  readonly agentId = input.required<string>();

  private readonly hub = inject(HubService);
  private readonly notify = inject(NotifyService);
  private readonly clipboard = inject(Clipboard);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  readonly maxVipNumbers = MAX_VIP_NUMBERS;
  readonly singleKinds = SINGLE_KINDS;
  readonly state = signal<'loading' | 'ready' | 'failed'>('loading');
  readonly saving = signal(false);
  readonly available = signal(true);
  readonly phoneNumbers = signal<CallSummaryView['phoneNumbers']>([]);
  readonly copied = signal<string | null>(null);
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;

  readonly form = this.fb.nonNullable.group({
    enabled: [false],
    email: ['', [Validators.required, Validators.maxLength(254), emailShape]],
    anonymous: [false],
    vipNumbers: this.fb.array<VipGroup>([]),
  });

  get vipNumbers() {
    return this.form.controls.vipNumbers;
  }

  constructor() {
    // While the summary is off only the switch counts, so a half typed address never blocks switching off.
    this.form.controls.enabled.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((enabled) => this.applyEnabled(enabled));
    this.destroyRef.onDestroy(() => clearTimeout(this.copiedTimer));
  }

  ngOnInit(): void {
    void this.load();
  }

  code(codes: ForwardingCode[], kind: ForwardingKind): ForwardingCode | null {
    return codes.find((c) => c.kind === kind) ?? null;
  }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      const result = await firstValueFrom(
        this.hub.get<{ data: CallSummaryView }>(`/agents/${this.agentId()}/call-summary`),
      );
      this.apply(result.data);
      this.state.set('ready');
    } catch {
      this.state.set('failed');
    }
  }

  addVip(row?: VipNumber): void {
    if (this.vipNumbers.length >= MAX_VIP_NUMBERS) return;
    this.vipNumbers.push(this.vipGroup(row));
    if (!row) this.form.markAsDirty();
  }

  removeVip(index: number): void {
    this.vipNumbers.removeAt(index);
    this.form.markAsDirty();
  }

  copy(code: string): void {
    if (!this.clipboard.copy(code)) {
      this.notify.error('user.agents.callSummary.forwarding.copyFailed');
      return;
    }
    this.copied.set(code);
    clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => this.copied.set(null), 1500);
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    // Switching off sends only the switch: that always works, also for an agent without call data.
    const body = v.enabled
      ? {
          enabled: true,
          email: v.email.trim(),
          anonymous: v.anonymous,
          vipNumbers: v.vipNumbers.map((r) => ({ label: r.label.trim(), number: r.number.trim() })),
        }
      : { enabled: false };
    this.saving.set(true);
    try {
      const result = await firstValueFrom(
        this.hub.patch<{ data: CallSummaryView }>(`/agents/${this.agentId()}/call-summary`, body),
      );
      this.apply(result.data);
      this.notify.success(
        result.data.enabled ? 'user.agents.callSummary.savedOn' : 'user.agents.callSummary.savedOff',
      );
    } catch (err) {
      this.showError(err);
    } finally {
      this.saving.set(false);
    }
  }

  private showError(err: unknown): void {
    const error = readApiError(err);
    const details = (error.details ?? {}) as { reason?: unknown; index?: unknown };
    switch (details.reason) {
      case 'ZERO_PII':
        this.available.set(false);
        this.notify.error('user.agents.callSummary.errors.zeroPii');
        return;
      case 'NOT_READY':
        this.notify.error('user.agents.callSummary.errors.notReady');
        return;
      case 'INVALID':
        this.form.markAllAsTouched();
        this.notify.error('user.agents.callSummary.errors.invalid');
        return;
      case 'INVALID_VIP': {
        const index = typeof details.index === 'number' ? details.index : -1;
        const row = this.vipNumbers.at(index);
        if (row) {
          row.controls.number.setErrors({ server: true });
          row.controls.number.markAsTouched();
        }
        this.notify.error('user.agents.callSummary.errors.invalidVip', { n: index + 1 });
        return;
      }
      case 'NOT_FOUND':
        this.notify.error('user.agents.callSummary.errors.notFound');
        return;
    }
    if (error.status >= 500) {
      this.notify.error('user.agents.callSummary.errors.provider');
      return;
    }
    this.notify.apiError(err);
  }

  private apply(view: CallSummaryView): void {
    this.available.set(view.available);
    this.phoneNumbers.set(view.phoneNumbers ?? []);
    this.vipNumbers.clear({ emitEvent: false });
    for (const vip of view.vipNumbers ?? []) this.vipNumbers.push(this.vipGroup(vip), { emitEvent: false });
    this.form.patchValue(
      { enabled: view.enabled, email: view.email ?? '', anonymous: view.anonymous },
      { emitEvent: false },
    );
    this.applyEnabled(view.enabled);
    this.form.markAsPristine();
    this.form.markAsUntouched();
  }

  /** Off: only the switch counts. No call data and off: the switch stays off as well. */
  private applyEnabled(enabled: boolean): void {
    const details = [this.form.controls.email, this.form.controls.anonymous, this.vipNumbers];
    for (const control of details) {
      if (enabled) control.enable({ emitEvent: false });
      else control.disable({ emitEvent: false });
    }
    const toggle = this.form.controls.enabled;
    if (!this.available() && !enabled) toggle.disable({ emitEvent: false });
    else toggle.enable({ emitEvent: false });
  }

  private vipGroup(row?: VipNumber): VipGroup {
    return this.fb.nonNullable.group({
      label: [row?.label ?? '', [Validators.required, Validators.maxLength(60)]],
      number: [row?.number ?? '', [Validators.required, Validators.maxLength(32), phoneShape]],
    });
  }
}
