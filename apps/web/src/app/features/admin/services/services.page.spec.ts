import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { formatMoney } from '../../../core/format/money';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog.component';
import { ADMIN_TEXTS, provideTestI18n } from '../../../testing/i18n';
import { OwnServiceDialogComponent } from './own-service-dialog.component';
import { AdminServicesPage } from './services.page';

const OFFERS_URL = '/api/admin/hub/resellers/services/offers';
const OWN_URL = '/api/admin/hub/resellers/services/own';

const OFFERS = {
  vatPercent: 19,
  services: [
    {
      positionId: 5,
      name: 'Rufnummer einrichten',
      nameEn: 'Number setup',
      enabled: true,
      price: { purchaseNet: 40, customerNet: 40, marginNet: 0, custom: false },
      variants: [],
      slaMinHours: 24,
      slaMaxHours: 48,
    },
  ],
};

const OWN = [
  {
    id: 12,
    name: 'Logo gestalten',
    nameEn: 'Logo design',
    description: '',
    descriptionEn: '',
    priceNet: 49,
    isVisible: false,
    variants: [
      { key: 'v1', nameDe: 'Klein', nameEn: 'Small', priceNet: 49 },
      { key: 'v2', nameDe: 'Groß', nameEn: 'Large', priceNet: 99 },
    ],
    fields: [{ key: 'f1', type: 'text', required: true, labelDe: 'Wünsche', labelEn: 'Wishes' }],
    slaMinHours: null,
    slaMaxHours: null,
  },
  {
    id: 14,
    name: 'Einweisung',
    nameEn: 'Onboarding call',
    description: '',
    descriptionEn: '',
    priceNet: 120,
    isVisible: true,
    variants: [],
    fields: [],
    slaMinHours: null,
    slaMaxHours: null,
  },
];

const eur = (value: number) => formatMoney(value, 'en');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AdminServicesPage', () => {
  let http: HttpTestingController;
  let snacks: string[];
  let opened: { component: unknown; data: unknown }[];
  let dialogResult: unknown;

  async function render(offers: object | null = OFFERS, own: object[] | null = OWN) {
    snacks = [];
    opened = [];
    await TestBed.configureTestingModule({
      imports: [AdminServicesPage, provideTestI18n()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatSnackBar, useValue: { open: (message: string) => snacks.push(message) } },
        {
          provide: MatDialog,
          useValue: {
            open: (component: unknown, config: { data: unknown }) => {
              opened.push({ component, data: config.data });
              return { afterClosed: () => of(dialogResult) };
            },
          },
        },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AdminServicesPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const failure = { error: { code: 'internal_error', message: 'x' } };
    const offersRequest = http.expectOne(OFFERS_URL);
    if (offers) offersRequest.flush({ data: offers });
    else offersRequest.flush(failure, { status: 500, statusText: 'Error' });
    const ownRequest = http.expectOne(OWN_URL);
    if (own) ownRequest.flush({ data: own });
    else ownRequest.flush(failure, { status: 500, statusText: 'Error' });
    await settle();
    fixture.detectChanges();
    return fixture;
  }

  const el = (fixture: { nativeElement: HTMLElement }, id: string) =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const all = (fixture: { nativeElement: HTMLElement }, id: string) =>
    Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${id}"]`)) as HTMLElement[];

  beforeEach(() => {
    dialogResult = undefined;
  });

  afterEach(() => http.verify());

  it('lists the platform services and the own ones with their prices', async () => {
    const fixture = await render();

    expect(el(fixture, 'offers')?.textContent).toContain('Number setup');
    expect(el(fixture, 'offers')?.textContent).toContain(ADMIN_TEXTS.services.offers.intro.replace('{{vat}}', '19'));
    const rows = all(fixture, 'own-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Logo design');
    expect(rows[0].querySelector('[data-testid="own-hidden"]')).not.toBeNull();
    expect(rows[0].querySelector('[data-testid="own-price"]')?.textContent).toContain(
      ADMIN_TEXTS.services.own.priceFrom.replace('{{price}}', eur(49)),
    );
    expect(rows[1].querySelector('[data-testid="own-hidden"]')).toBeNull();
    expect(rows[1].querySelector('[data-testid="own-price"]')?.textContent).toContain(
      ADMIN_TEXTS.services.own.priceNetValue.replace('{{price}}', eur(120)),
    );
    expect(rows[0].querySelector('[data-testid="own-delete"]')?.getAttribute('aria-label')).toBe(
      ADMIN_TEXTS.services.own.deleteLabel.replace('{{name}}', 'Logo design'),
    );
  });

  it('says so when there is nothing yet', async () => {
    const fixture = await render({ vatPercent: 19, services: [] }, []);

    expect(el(fixture, 'offers-empty')?.textContent).toContain(ADMIN_TEXTS.services.offers.empty);
    expect(el(fixture, 'own-empty')?.textContent).toContain(ADMIN_TEXTS.services.own.empty);
  });

  it('offers to try again when the lists could not be read', async () => {
    const fixture = await render(null, null);

    expect(el(fixture, 'offers-error')?.textContent).toContain(ADMIN_TEXTS.services.loadError);
    expect(el(fixture, 'own-error')?.textContent).toContain(ADMIN_TEXTS.services.loadError);
  });

  it('deletes an own service only after asking, then reads the list again', async () => {
    const fixture = await render();
    dialogResult = true;

    all(fixture, 'own-delete')[1].click();
    expect(opened[0].component).toBe(ConfirmDialogComponent);
    expect(opened[0].data).toMatchObject({ messageKey: 'admin.services.own.deleteMessage', destructive: true });
    const request = http.expectOne(`${OWN_URL}/14`);
    expect(request.request.method).toBe('DELETE');
    request.flush({ data: { ok: true } });
    await settle();
    http.expectOne(OWN_URL).flush({ data: [OWN[0]] });
    await settle();
    fixture.detectChanges();

    expect(snacks).toEqual([ADMIN_TEXTS.services.own.deleted.replace('{{name}}', 'Onboarding call')]);
    expect(all(fixture, 'own-row').length).toBe(1);
  });

  it('leaves the service alone when the question is declined', async () => {
    const fixture = await render();
    dialogResult = false;

    all(fixture, 'own-delete')[0].click();

    http.expectNone(`${OWN_URL}/12`);
  });

  it('opens the form for a new service and reads the list again once it is added', async () => {
    const fixture = await render();
    dialogResult = true;

    el(fixture, 'own-create')?.click();
    expect(opened[0].component).toBe(OwnServiceDialogComponent);
    expect(opened[0].data).toEqual({ mode: 'create' });
    http.expectOne(OWN_URL).flush({ data: OWN });
    await settle();

    expect(snacks).toEqual([ADMIN_TEXTS.services.own.created]);
  });

  it('opens a stored service in the same form', async () => {
    const fixture = await render();
    dialogResult = undefined;

    all(fixture, 'own-edit')[0].click();

    expect(opened[0].data).toEqual({ mode: 'edit', service: OWN[0] });
    http.expectNone(OWN_URL);
  });
});
