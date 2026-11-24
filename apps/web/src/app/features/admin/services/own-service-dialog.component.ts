import { Component, inject, signal } from '@angular/core';
import {
  type AbstractControl,
  FormArray,
  type FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  type ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { readApiError } from '../../../core/errors/api-error';
import { AdminHubService } from '../../../core/hub/admin-hub.service';
import type { OwnServiceInput, ResellerOwnService } from '../../../core/hub/hub.models';
import { LanguageService } from '../../../core/i18n/language.service';
import { NotifyService } from '../../../core/notify/notify.service';
import { FieldErrorPipe } from '../../../shared/forms/field-error.pipe';
import { parsePrice, priceInput, priceValidator } from './service-price';

export type OwnServiceDialogData = { mode: 'create' } | { mode: 'edit'; service: ResellerOwnService };

/** The limits the service enforces, so the form says no before it does. */
export const OWN_LIMITS = {
  name: 160,
  description: 4000,
  label: 120,
  fields: 12,
  variants: 12,
  maxSlaHours: 8760,
};

const FIELD_TYPES = ['text', 'textarea', 'country', 'datetime'] as const;
type FieldType = (typeof FIELD_TYPES)[number];

/** The refusals of a service that have their own words. */
const OWN_REFUSALS = [
  'NAME_REQUIRED',
  'TOO_MANY_FIELDS',
  'TOO_MANY_VARIANTS',
  'FIELD_LABEL_REQUIRED',
  'VARIANT_NAME_REQUIRED',
  'PRICE_INVALID',
  'SLA_INVALID',
  'POSITION_LIMIT',
  'NOT_FOUND',
];

/** Whole hours from 1 to a year, or nothing. */
function hoursValidator(control: AbstractControl): ValidationErrors | null {
  const raw = control.value;
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const text = String(raw).trim();
  const value = Number(text);
  return /^\d+$/.test(text) && value >= 1 && value <= OWN_LIMITS.maxSlaHours ? null : { hours: true };
}

const hours = (raw: string): number | null => (raw.trim() === '' ? null : Number(raw.trim()));

/**
 * Creates or edits a service the operator offers and does themselves: what it
 * is called, what it costs (one price or a price per variant), what the
 * customer fills in when ordering and how long it usually takes. Saving
 * replaces the service as a whole, which is why the form always sends it all.
 */
@Component({
  selector: 'app-own-service-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    TranslocoDirective,
    FieldErrorPipe,
  ],
  providers: [provideTranslocoScope('admin')],
  template: `
    <ng-container *transloco="let t">
      <h2 mat-dialog-title>
        {{ t(data.mode === 'create' ? 'admin.services.own.createTitle' : 'admin.services.own.editTitle') }}
      </h2>
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <mat-dialog-content>
          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>{{ t('admin.services.own.nameDe') }}</mat-label>
              <input matInput formControlName="name" [maxlength]="limits.name" data-testid="own-name" />
              @if (form.controls.name | fieldError; as e) {
                <mat-error>{{ t(e.key, e.params) }}</mat-error>
              }
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>{{ t('admin.services.own.nameEn') }}</mat-label>
              <input matInput formControlName="nameEn" [maxlength]="limits.name" data-testid="own-name-en" />
            </mat-form-field>
          </div>
          <div class="row">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>{{ t('admin.services.own.descriptionDe') }}</mat-label>
              <textarea
                matInput
                rows="3"
                formControlName="description"
                [maxlength]="limits.description"
              ></textarea>
              <mat-hint>{{ t('admin.services.own.descriptionHint') }}</mat-hint>
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>{{ t('admin.services.own.descriptionEn') }}</mat-label>
              <textarea
                matInput
                rows="3"
                formControlName="descriptionEn"
                [maxlength]="limits.description"
              ></textarea>
            </mat-form-field>
          </div>

          <h3 class="section">{{ t('admin.services.own.priceSection') }}</h3>
          @if (variants.length === 0) {
            <mat-form-field appearance="outline" class="narrow">
              <mat-label>{{ t('admin.services.own.priceNet') }}</mat-label>
              <input matInput inputmode="decimal" formControlName="priceNet" data-testid="own-price" />
              <span matTextSuffix>&nbsp;EUR</span>
              @if (form.controls.priceNet.hasError('price')) {
                <mat-error>{{ t('admin.services.own.errors.PRICE_INVALID') }}</mat-error>
              } @else if (form.controls.priceNet | fieldError; as e) {
                <mat-error>{{ t(e.key, e.params) }}</mat-error>
              }
            </mat-form-field>
          }
          <div formArrayName="variants" class="group">
            @for (variant of variants.controls; track variant; let i = $index) {
              <div class="item" [formGroupName]="i" data-testid="own-variant">
                <mat-form-field appearance="outline">
                  <mat-label>{{ t('admin.services.own.variantNameDe') }}</mat-label>
                  <input matInput formControlName="nameDe" [maxlength]="limits.label" />
                  @if (variant.controls.nameDe | fieldError; as e) {
                    <mat-error>{{ t(e.key, e.params) }}</mat-error>
                  }
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>{{ t('admin.services.own.variantNameEn') }}</mat-label>
                  <input matInput formControlName="nameEn" [maxlength]="limits.label" />
                </mat-form-field>
                <mat-form-field appearance="outline" class="money">
                  <mat-label>{{ t('admin.services.own.priceNet') }}</mat-label>
                  <input matInput inputmode="decimal" formControlName="priceNet" />
                  <span matTextSuffix>&nbsp;EUR</span>
                  @if (variant.controls.priceNet.hasError('price')) {
                    <mat-error>{{ t('admin.services.own.errors.PRICE_INVALID') }}</mat-error>
                  } @else if (variant.controls.priceNet | fieldError; as e) {
                    <mat-error>{{ t(e.key, e.params) }}</mat-error>
                  }
                </mat-form-field>
                <button
                  mat-icon-button
                  type="button"
                  (click)="variants.removeAt(i)"
                  [attr.aria-label]="t('admin.services.own.removeVariant')"
                >
                  <mat-icon>remove</mat-icon>
                </button>
              </div>
            }
          </div>
          @if (variants.length < limits.variants) {
            <button mat-stroked-button type="button" (click)="addVariant()" data-testid="own-add-variant">
              <mat-icon>add</mat-icon>
              {{ t('admin.services.own.addVariant') }}
            </button>
          }
          <p class="hint">{{ t('admin.services.own.variantHint') }}</p>

          <h3 class="section">{{ t('admin.services.own.fieldsSection') }}</h3>
          <div formArrayName="fields" class="group">
            @for (field of fields.controls; track field; let i = $index) {
              <div class="item" [formGroupName]="i" data-testid="own-field">
                <mat-form-field appearance="outline">
                  <mat-label>{{ t('admin.services.own.fieldLabelDe') }}</mat-label>
                  <input matInput formControlName="labelDe" [maxlength]="limits.label" />
                  @if (field.controls.labelDe | fieldError; as e) {
                    <mat-error>{{ t(e.key, e.params) }}</mat-error>
                  }
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>{{ t('admin.services.own.fieldLabelEn') }}</mat-label>
                  <input matInput formControlName="labelEn" [maxlength]="limits.label" />
                </mat-form-field>
                <mat-form-field appearance="outline" class="type">
                  <mat-label>{{ t('admin.services.own.fieldType') }}</mat-label>
                  <mat-select formControlName="type">
                    @for (type of fieldTypes; track type) {
                      <mat-option [value]="type">{{ t('admin.services.own.fieldTypes.' + type) }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <mat-checkbox formControlName="required">{{
                  t('admin.services.own.fieldRequired')
                }}</mat-checkbox>
                <button
                  mat-icon-button
                  type="button"
                  (click)="fields.removeAt(i)"
                  [attr.aria-label]="t('admin.services.own.removeField')"
                >
                  <mat-icon>remove</mat-icon>
                </button>
              </div>
            }
          </div>
          @if (fields.length < limits.fields) {
            <button mat-stroked-button type="button" (click)="addField()" data-testid="own-add-field">
              <mat-icon>add</mat-icon>
              {{ t('admin.services.own.addField') }}
            </button>
          }
          <p class="hint">{{ t('admin.services.own.fieldsHint') }}</p>

          <h3 class="section">{{ t('admin.services.own.slaSection') }}</h3>
          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>{{ t('admin.services.own.slaMin') }}</mat-label>
              <input matInput inputmode="numeric" formControlName="slaMinHours" data-testid="own-sla-min" />
              @if (form.controls.slaMinHours.hasError('hours')) {
                <mat-error>{{ t('admin.services.own.hoursInvalid', { max: limits.maxSlaHours }) }}</mat-error>
              }
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>{{ t('admin.services.own.slaMax') }}</mat-label>
              <input matInput inputmode="numeric" formControlName="slaMaxHours" data-testid="own-sla-max" />
              @if (form.controls.slaMaxHours.hasError('hours')) {
                <mat-error>{{ t('admin.services.own.hoursInvalid', { max: limits.maxSlaHours }) }}</mat-error>
              }
            </mat-form-field>
          </div>
          @if (form.hasError('slaOrder')) {
            <p class="hint error" data-testid="own-sla-order">
              {{ t('admin.services.own.errors.SLA_INVALID') }}
            </p>
          }

          <mat-checkbox formControlName="isVisible" data-testid="own-visible">
            {{ t('admin.services.own.visible') }}
          </mat-checkbox>
          <p class="hint">{{ t('admin.services.own.visibleHint') }}</p>
        </mat-dialog-content>
        <mat-dialog-actions align="end">
          <button mat-button type="button" mat-dialog-close>{{ t('actions.cancel') }}</button>
          <button mat-flat-button type="submit" [disabled]="saving()" data-testid="own-save">
            {{ t(data.mode === 'create' ? 'admin.services.own.create' : 'actions.save') }}
          </button>
        </mat-dialog-actions>
      </form>
    </ng-container>
  `,
  styles: `
    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0 12px;
    }
    .section {
      margin: 16px 0 8px;
      font: var(--mat-sys-title-small);
    }
    .narrow {
      max-width: 240px;
    }
    .group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .item {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0 12px;
      padding-top: 8px;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }
    .item mat-form-field {
      flex: 1 1 180px;
    }
    .item .money,
    .item .type {
      flex: 0 1 170px;
    }
    .hint {
      margin: 4px 0 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .hint.error {
      color: var(--mat-sys-error);
    }
    button[mat-stroked-button] {
      align-self: flex-start;
      margin-top: 4px;
    }
  `,
})
export class OwnServiceDialogComponent {
  readonly data = inject<OwnServiceDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<OwnServiceDialogComponent, boolean>);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly hub = inject(AdminHubService);
  private readonly notify = inject(NotifyService);
  private readonly language = inject(LanguageService);

  readonly limits = OWN_LIMITS;
  readonly fieldTypes = FIELD_TYPES;
  readonly saving = signal(false);

  readonly form = this.fb.group(
    {
      name: ['', [Validators.required, Validators.maxLength(OWN_LIMITS.name)]],
      nameEn: ['', Validators.maxLength(OWN_LIMITS.name)],
      description: ['', Validators.maxLength(OWN_LIMITS.description)],
      descriptionEn: ['', Validators.maxLength(OWN_LIMITS.description)],
      priceNet: ['', priceValidator],
      variants: this.fb.array<FormGroup>([]),
      fields: this.fb.array<FormGroup>([]),
      slaMinHours: ['', hoursValidator],
      slaMaxHours: ['', hoursValidator],
      isVisible: [true],
    },
    {
      validators: (group: AbstractControl): ValidationErrors | null => {
        const min = hours(String(group.get('slaMinHours')?.value ?? ''));
        const max = hours(String(group.get('slaMaxHours')?.value ?? ''));
        return min !== null && max !== null && min > max ? { slaOrder: true } : null;
      },
    },
  );

  get variants() {
    return this.form.controls.variants as FormArray<ReturnType<OwnServiceDialogComponent['variantGroup']>>;
  }

  get fields() {
    return this.form.controls.fields as FormArray<ReturnType<OwnServiceDialogComponent['fieldGroup']>>;
  }

  constructor() {
    if (this.data.mode === 'edit') {
      const service = this.data.service;
      const language = this.language.current();
      this.form.patchValue({
        name: service.name,
        nameEn: service.nameEn,
        description: service.description,
        descriptionEn: service.descriptionEn,
        priceNet: service.variants.length > 0 ? '' : priceInput(service.priceNet, language),
        slaMinHours: service.slaMinHours ? String(service.slaMinHours) : '',
        slaMaxHours: service.slaMaxHours ? String(service.slaMaxHours) : '',
        isVisible: service.isVisible,
      });
      for (const variant of service.variants) {
        this.variants.push(
          this.variantGroup(
            variant.key,
            variant.nameDe,
            variant.nameEn,
            priceInput(variant.priceNet, language),
          ),
        );
      }
      for (const field of service.fields) {
        this.fields.push(
          this.fieldGroup(field.key, field.labelDe, field.labelEn, field.type, field.required),
        );
      }
    }
  }

  addVariant(): void {
    if (this.variants.length >= OWN_LIMITS.variants) return;
    this.variants.push(this.variantGroup());
  }

  addField(): void {
    if (this.fields.length >= OWN_LIMITS.fields) return;
    this.fields.push(this.fieldGroup());
  }

  async submit(): Promise<void> {
    // One price is needed only while there are no variants; each variant brings its own.
    const single = this.form.controls.priceNet;
    single.setValidators(this.variants.length === 0 ? [Validators.required, priceValidator] : []);
    single.updateValueAndValidity();
    for (const control of [
      this.form.controls.name,
      ...this.variants.controls.map((v) => v.controls.nameDe),
      ...this.fields.controls.map((f) => f.controls.labelDe),
    ]) {
      if (control.value.trim() === '') control.setErrors({ required: true });
    }
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const body = this.body();
    this.saving.set(true);
    try {
      if (this.data.mode === 'create') {
        await firstValueFrom(this.hub.post('/resellers/services/own', body));
      } else {
        await firstValueFrom(this.hub.put(`/resellers/services/own/${this.data.service.id}`, body));
      }
      this.ref.close(true);
    } catch (err) {
      const reason = (readApiError(err).details as { reason?: unknown } | undefined)?.reason;
      if (typeof reason === 'string' && OWN_REFUSALS.includes(reason)) {
        this.notify.error('admin.services.own.errors.' + reason);
      } else {
        this.notify.apiError(err);
      }
    } finally {
      this.saving.set(false);
    }
  }

  /** The whole service as the form holds it, trimmed, with empty optional texts left out. */
  private body(): OwnServiceInput {
    const value = this.form.getRawValue();
    const optional = (text: string) => (text.trim() === '' ? undefined : text.trim());
    const body: OwnServiceInput = {
      name: value.name.trim(),
      nameEn: optional(value.nameEn),
      description: optional(value.description),
      descriptionEn: optional(value.descriptionEn),
      isVisible: value.isVisible,
      slaMinHours: hours(value.slaMinHours),
      slaMaxHours: hours(value.slaMaxHours),
      variants: this.variants.controls.map((group) => {
        const v = group.getRawValue();
        return {
          ...(v.key ? { key: v.key } : {}),
          nameDe: v.nameDe.trim(),
          nameEn: optional(v.nameEn),
          priceNet: parsePrice(v.priceNet) ?? 0,
        };
      }),
      fields: this.fields.controls.map((group) => {
        const f = group.getRawValue();
        return {
          ...(f.key ? { key: f.key } : {}),
          type: f.type,
          required: f.required,
          labelDe: f.labelDe.trim(),
          labelEn: optional(f.labelEn),
        };
      }),
    };
    if (this.variants.length === 0) body.priceNet = parsePrice(value.priceNet) ?? 0;
    return body;
  }

  variantGroup(key = '', nameDe = '', nameEn = '', priceNet = '') {
    return this.fb.group({
      key: [key],
      nameDe: [nameDe, [Validators.required, Validators.maxLength(OWN_LIMITS.label)]],
      nameEn: [nameEn, Validators.maxLength(OWN_LIMITS.label)],
      priceNet: [priceNet, [Validators.required, priceValidator]],
    });
  }

  fieldGroup(key = '', labelDe = '', labelEn = '', type: FieldType = 'text', required = false) {
    return this.fb.group({
      key: [key],
      labelDe: [labelDe, [Validators.required, Validators.maxLength(OWN_LIMITS.label)]],
      labelEn: [labelEn, Validators.maxLength(OWN_LIMITS.label)],
      type: [type],
      required: [required],
    });
  }
}
