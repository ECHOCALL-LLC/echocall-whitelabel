import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ADMIN_TEXTS, provideTestI18n } from '../../../testing/i18n';
import { ServiceOrderCancelDialogComponent } from './service-order-cancel-dialog.component';

describe('ServiceOrderCancelDialogComponent', () => {
  let closed: unknown[];

  async function render(refundAmount: string | null) {
    closed = [];
    await TestBed.configureTestingModule({
      imports: [ServiceOrderCancelDialogComponent, provideTestI18n()],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { refundAmount } },
        { provide: MatDialogRef, useValue: { close: (value: unknown) => closed.push(value) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ServiceOrderCancelDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const confirm = (fixture: { nativeElement: HTMLElement }) =>
    (fixture.nativeElement.querySelector('[data-testid="service-cancel-confirm"]') as HTMLButtonElement).click();

  it('gives the money back unless told otherwise', async () => {
    const fixture = await render('€59.50');

    expect(fixture.nativeElement.textContent).toContain('€59.50');
    expect(fixture.nativeElement.textContent).toContain(ADMIN_TEXTS.serviceOrders.refundNote);
    confirm(fixture);

    expect(closed).toEqual([{ refund: true }]);
  });

  it('keeps the money when the box is unticked', async () => {
    const fixture = await render('€59.50');

    fixture.componentInstance.refund.set(false);
    confirm(fixture);

    expect(closed).toEqual([{ refund: false }]);
  });

  it('asks nothing about money for an order that cannot be refunded', async () => {
    const fixture = await render(null);

    expect(fixture.nativeElement.querySelector('[data-testid="service-refund"]')).toBeNull();
    confirm(fixture);

    expect(closed).toEqual([{ refund: false }]);
  });
});
