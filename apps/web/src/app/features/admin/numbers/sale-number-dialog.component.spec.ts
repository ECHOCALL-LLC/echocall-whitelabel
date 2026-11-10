import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ADMIN_TEXTS, provideTestI18n } from '../../../testing/i18n';
import { SaleNumberDialogComponent, type SaleNumberDialogData } from './sale-number-dialog.component';

describe('SaleNumberDialogComponent', () => {
  let closed: unknown;

  async function render(data: SaleNumberDialogData) {
    closed = undefined;
    await TestBed.configureTestingModule({
      imports: [SaleNumberDialogComponent, provideTestI18n()],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: (value: unknown) => (closed = value) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SaleNumberDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('names the number and starts empty when it is not on offer yet', async () => {
    const fixture = await render({ phoneNumber: '+4989555666', monthlyPrice: null });

    expect(fixture.nativeElement.textContent).toContain('+4989555666');
    expect(fixture.componentInstance.form.controls.monthlyPrice.value).toBeNull();
  });

  it('starts from the price the number is offered at today', async () => {
    const fixture = await render({ phoneNumber: '+4989555666', monthlyPrice: 4.5 });

    expect(fixture.componentInstance.form.controls.monthlyPrice.value).toBe(4.5);
  });

  it('hands back the price rounded to the cent', async () => {
    const fixture = await render({ phoneNumber: '+4989555666', monthlyPrice: null });
    fixture.componentInstance.form.controls.monthlyPrice.setValue(4.999);

    fixture.componentInstance.submit();

    expect(closed).toEqual({ monthlyPrice: 5 });
  });

  it('refuses a price of zero or above the limit and says why', async () => {
    const fixture = await render({ phoneNumber: '+4989555666', monthlyPrice: null });

    fixture.componentInstance.form.controls.monthlyPrice.setValue(0);
    fixture.componentInstance.submit();
    fixture.componentInstance.form.controls.monthlyPrice.setValue(1000.01);
    fixture.componentInstance.submit();
    fixture.detectChanges();

    expect(closed).toBeUndefined();
    expect(fixture.nativeElement.textContent).toContain(ADMIN_TEXTS.numbers.saleDialog.invalid);
  });
});
