import { z } from 'zod';
import { emailSchema, nameSchema } from '../../auth/dto.js';
import { LANGUAGES } from '../../settings/branding.js';

const companySchema = z.string().trim().max(200);

/**
 * A new customer of the portal: one account in the hub and one portal login for
 * it. An empty name or company is simply not sent on.
 */
export const createCustomerSchema = z.object({
  email: emailSchema,
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  company: companySchema.optional(),
  language: z.enum(LANGUAGES).default('en'),
  /** Whether the invitation is mailed right away. The link is returned either way. */
  sendInvite: z.boolean().default(true),
});
export type CreateCustomerDto = z.infer<typeof createCustomerSchema>;

/**
 * What an operator may change about a customer. An empty string clears the
 * field, which is why none of these are nullable: the hub only accepts strings.
 */
export const updateCustomerSchema = z
  .object({
    email: emailSchema.optional(),
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    company: companySchema.optional(),
    language: z.enum(LANGUAGES).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nothing to update',
  });
export type UpdateCustomerDto = z.infer<typeof updateCustomerSchema>;

/** One line of the billing address. Line breaks would split the line on the invoice, so they are flattened. */
const billingLine = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.replace(/[\r\n\t]+/g, ' ').trim());

/** An address invoices are mailed to; empty clears it. */
const billingAddress = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .pipe(z.union([z.literal(''), z.email()]));

/**
 * The details the customer's invoices carry and are mailed to. Each field is
 * optional, an empty string clears it, and the hub checks country, postal code
 * and VAT ID against each other before it keeps anything.
 */
export const updateBillingSchema = z
  .object({
    companyName: billingLine(255).optional(),
    billingStreet: billingLine(255).optional(),
    billingPostalCode: billingLine(20).optional(),
    billingCity: billingLine(100).optional(),
    billingCountry: billingLine(60).optional(),
    vatId: billingLine(50).optional(),
    billingEmail: billingAddress.optional(),
    billingCcEmail: billingAddress.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nothing to update',
  });
export type UpdateBillingDto = z.infer<typeof updateBillingSchema>;

export const customerIdSchema = z.coerce.number().int().positive();
