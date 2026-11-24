import { describe, it, expect } from 'vitest';
import { FormControl } from '@angular/forms';
import { allowanceValidator, integerValidator, portValidator } from './validators';

const check = (validator: typeof integerValidator, value: string) => validator(new FormControl(value));

describe('integerValidator', () => {
  it('accepts a whole number above zero and an empty field', () => {
    expect(check(integerValidator, '141453')).toBeNull();
    expect(check(integerValidator, '')).toBeNull();
  });

  it('refuses zero, a fraction and anything that is not a number', () => {
    // This one guards identifiers, where a zero points at no record at all.
    expect(check(integerValidator, '0')).toEqual({ positiveInteger: true });
    expect(check(integerValidator, '1.5')).toEqual({ positiveInteger: true });
    expect(check(integerValidator, 'zwölf')).toEqual({ positiveInteger: true });
  });
});

describe('allowanceValidator', () => {
  it('accepts zero, because a plan may include none of a service', () => {
    expect(check(allowanceValidator, '0')).toBeNull();
    expect(check(allowanceValidator, '300')).toBeNull();
  });

  it('accepts an empty field, which stands for no limit at all', () => {
    expect(check(allowanceValidator, '')).toBeNull();
  });

  it('refuses a negative number, a fraction and anything that is not a number', () => {
    expect(check(allowanceValidator, '-1')).toEqual({ integer: true });
    expect(check(allowanceValidator, '2.5')).toEqual({ integer: true });
    expect(check(allowanceValidator, 'viele')).toEqual({ integer: true });
  });
});

describe('portValidator', () => {
  it('accepts the ports a mail server listens on and an empty field', () => {
    expect(portValidator(new FormControl(587))).toBeNull();
    expect(portValidator(new FormControl('465'))).toBeNull();
    expect(portValidator(new FormControl(1))).toBeNull();
    expect(portValidator(new FormControl(65535))).toBeNull();
    expect(portValidator(new FormControl(''))).toBeNull();
    expect(portValidator(new FormControl(null))).toBeNull();
  });

  it('refuses zero, a fraction, a port past the range and anything that is not a number', () => {
    expect(portValidator(new FormControl(0))).toEqual({ port: true });
    expect(portValidator(new FormControl(25.5))).toEqual({ port: true });
    expect(portValidator(new FormControl(65536))).toEqual({ port: true });
    expect(portValidator(new FormControl('smtp'))).toEqual({ port: true });
  });
});
