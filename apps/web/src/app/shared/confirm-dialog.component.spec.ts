import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ADMIN_TEXTS, provideTestI18n } from '../testing/i18n';
import { ConfirmDialogComponent, type ConfirmDialogData } from './confirm-dialog.component';

describe('ConfirmDialogComponent', () => {
  async function render(data: ConfirmDialogData) {
    await TestBed.configureTestingModule({
      imports: [ConfirmDialogComponent, provideTestI18n()],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: () => undefined } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ConfirmDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('fills the amount into the buttons as well, not only into the question', async () => {
    const el = await render({
      titleKey: 'admin.serviceOrders.forwardConfirmTitle',
      messageKey: 'admin.serviceOrders.forwardConfirmDesc',
      params: { gross: '€59.50', net: '€50.00', amount: '€59.50' },
      confirmKey: 'admin.serviceOrders.forwardConfirm',
      cancelKey: 'admin.serviceOrders.notNow',
    });
    const buttons = Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim());

    expect(buttons).toEqual([
      ADMIN_TEXTS.serviceOrders.notNow,
      ADMIN_TEXTS.serviceOrders.forwardConfirm.replace('{{amount}}', '€59.50'),
    ]);
    expect(el.textContent).toContain('€50.00');
    expect(el.textContent).not.toContain('{{');
  });
});
