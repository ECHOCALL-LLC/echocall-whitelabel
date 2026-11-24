import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { ResellerOwnService } from '../../../core/hub/hub.models';
import { ADMIN_TEXTS, provideTestI18n } from '../../../testing/i18n';
import { OwnServiceDialogComponent, type OwnServiceDialogData } from './own-service-dialog.component';

const OWN_URL = '/api/admin/hub/resellers/services/own';

const SERVICE: ResellerOwnService = {
  id: 12,
  name: 'Logo gestalten',
  nameEn: 'Logo design',
  description: 'Ein Logo für {price}.',
  descriptionEn: '',
  priceNet: 49,
  isVisible: false,
  variants: [
    { key: 'v1', nameDe: 'Klein', nameEn: 'Small', priceNet: 49 },
    { key: 'v2', nameDe: 'Groß', nameEn: '', priceNet: 99 },
  ],
  fields: [{ key: 'f1', type: 'textarea', required: true, labelDe: 'Wünsche', labelEn: 'Wishes' }],
  slaMinHours: 24,
  slaMaxHours: 72,
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('OwnServiceDialogComponent', () => {
  let http: HttpTestingController;
  let snacks: string[];
  let closed: unknown[];

  async function render(data: OwnServiceDialogData = { mode: 'create' }) {
    snacks = [];
    closed = [];
    await TestBed.configureTestingModule({
      imports: [OwnServiceDialogComponent, provideTestI18n()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: (value: unknown) => closed.push(value) } },
        { provide: MatSnackBar, useValue: { open: (message: string) => snacks.push(message) } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(OwnServiceDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const el = (fixture: { nativeElement: HTMLElement }, id: string) =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  function type(fixture: { nativeElement: HTMLElement; detectChanges(): void }, id: string, value: string) {
    const input = el(fixture, id) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  async function save(fixture: { nativeElement: HTMLElement; detectChanges(): void }) {
    (el(fixture, 'own-save') as HTMLButtonElement).click();
    await settle();
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('adds a service with one price, trimmed and without the empty texts', async () => {
    const fixture = await render();

    type(fixture, 'own-name', '  Logo gestalten ');
    type(fixture, 'own-price', '79,90');
    await save(fixture);
    const request = http.expectOne(OWN_URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      name: 'Logo gestalten',
      isVisible: true,
      slaMinHours: null,
      slaMaxHours: null,
      variants: [],
      fields: [],
      priceNet: 79.9,
    });
    expect(Object.keys(JSON.parse(request.request.serializeBody() as string))).not.toContain('nameEn');
    request.flush({ data: { id: 13 } });
    await settle();

    expect(closed).toEqual([true]);
  });

  it('asks for a price while there are no variants', async () => {
    const fixture = await render();

    type(fixture, 'own-name', 'Logo gestalten');
    await save(fixture);

    http.expectNone(OWN_URL);
    expect(fixture.componentInstance.form.controls.priceNet.hasError('required')).toBe(true);
    expect(closed).toEqual([]);
  });

  it('prices by variant instead, and sends no single price then', async () => {
    const fixture = await render();
    const component = fixture.componentInstance;

    type(fixture, 'own-name', 'Logo gestalten');
    (el(fixture, 'own-add-variant') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el(fixture, 'own-price')).toBeNull();
    component.variants.at(0).patchValue({ nameDe: ' Klein ', priceNet: '49' });
    (el(fixture, 'own-add-field') as HTMLButtonElement).click();
    component.fields.at(0).patchValue({ labelDe: 'Wünsche', type: 'textarea', required: true });
    fixture.detectChanges();
    await save(fixture);
    const request = http.expectOne(OWN_URL);
    expect(request.request.body.priceNet).toBeUndefined();
    expect(request.request.body.variants).toEqual([{ nameDe: 'Klein', priceNet: 49 }]);
    expect(request.request.body.fields).toEqual([{ type: 'textarea', required: true, labelDe: 'Wünsche' }]);
    request.flush({ data: { id: 13 } });
    await settle();
    expect(closed).toEqual([true]);
  });

  it('opens a service as it is stored and saves it whole, with its keys', async () => {
    const fixture = await render({ mode: 'edit', service: SERVICE });

    expect((el(fixture, 'own-name') as HTMLInputElement).value).toBe('Logo gestalten');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="own-variant"]').length).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('[data-testid="own-field"]').length).toBe(1);
    expect((el(fixture, 'own-sla-max') as HTMLInputElement).value).toBe('72');
    type(fixture, 'own-name', 'Logo neu');
    await save(fixture);
    const request = http.expectOne(`${OWN_URL}/12`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      name: 'Logo neu',
      nameEn: 'Logo design',
      description: 'Ein Logo für {price}.',
      isVisible: false,
      slaMinHours: 24,
      slaMaxHours: 72,
      variants: [
        { key: 'v1', nameDe: 'Klein', nameEn: 'Small', priceNet: 49 },
        { key: 'v2', nameDe: 'Groß', priceNet: 99 },
      ],
      fields: [{ key: 'f1', type: 'textarea', required: true, labelDe: 'Wünsche', labelEn: 'Wishes' }],
    });
    request.flush({ data: { ok: true } });
    await settle();
    expect(closed).toEqual([true]);
  });

  it('does not take a name of blanks', async () => {
    const fixture = await render();

    type(fixture, 'own-name', '   ');
    type(fixture, 'own-price', '10');
    await save(fixture);

    http.expectNone(OWN_URL);
    expect(fixture.componentInstance.form.controls.name.hasError('required')).toBe(true);
  });

  it('says when the shortest turnaround is longer than the longest', async () => {
    const fixture = await render();

    type(fixture, 'own-name', 'Logo gestalten');
    type(fixture, 'own-price', '10');
    type(fixture, 'own-sla-min', '48');
    type(fixture, 'own-sla-max', '24');
    expect(el(fixture, 'own-sla-order')?.textContent).toContain(ADMIN_TEXTS.services.own.errors.SLA_INVALID);
    await save(fixture);

    http.expectNone(OWN_URL);
  });

  it('says in its own words when the limit of services is reached, and stays open', async () => {
    const fixture = await render();

    type(fixture, 'own-name', 'Logo gestalten');
    type(fixture, 'own-price', '10');
    await save(fixture);
    http
      .expectOne(OWN_URL)
      .flush(
        { error: { code: 'validation_error', message: 'x', details: { reason: 'POSITION_LIMIT' } } },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle();

    expect(snacks).toEqual([ADMIN_TEXTS.services.own.errors.POSITION_LIMIT]);
    expect(closed).toEqual([]);
  });
});
