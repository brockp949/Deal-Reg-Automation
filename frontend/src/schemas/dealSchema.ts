import { z } from 'zod';

// Schema for form inputs - accepts strings from HTML inputs
export const dealSchema = z.object({
  vendor_id: z.string().uuid('Please select a valid vendor'),
  deal_name: z
    .string()
    .min(3, 'Deal name must be at least 3 characters')
    .max(255, 'Deal name must not exceed 255 characters'),
  deal_value: z
    .string()
    .optional()
    .transform((val) => (val ? Number(val) : undefined))
    .pipe(
      z
        .number()
        .nonnegative('Deal value must be positive')
        .optional()
    ),
  currency: z
    .string()
    .length(3, 'Currency must be a 3-letter code (e.g., USD)')
    .regex(/^[A-Z]{3}$/, 'Currency must be uppercase letters')
    .default('USD')
    .optional(),
  customer_name: z
    .string()
    .max(255, 'Customer name must not exceed 255 characters')
    .optional(),
  customer_industry: z
    .string()
    .max(100, 'Industry must not exceed 100 characters')
    .optional(),
  registration_date: z
    .string()
    .optional(),
  expected_close_date: z
    .string()
    .optional(),
  status: z
    .enum(['registered', 'approved', 'rejected', 'closed-won', 'closed-lost'], {
      errorMap: () => ({ message: 'Invalid status' }),
    })
    .default('registered')
    .optional(),
  deal_stage: z
    .string()
    .max(100, 'Deal stage must not exceed 100 characters')
    .optional(),
  probability: z
    .string()
    .optional()
    .transform((val) => (val ? Number(val) : undefined))
    .pipe(
      z
        .number()
        .min(0, 'Probability must be between 0 and 100')
        .max(100, 'Probability must be between 0 and 100')
        .optional()
    ),
  notes: z
    .string()
    .max(5000, 'Notes must not exceed 5000 characters')
    .optional(),
});

// Input type for the form (what react-hook-form receives)
export type DealFormInput = {
  vendor_id: string;
  deal_name: string;
  deal_value?: string;
  currency?: string;
  customer_name?: string;
  customer_industry?: string;
  registration_date?: string;
  expected_close_date?: string;
  status?: 'registered' | 'approved' | 'rejected' | 'closed-won' | 'closed-lost';
  deal_stage?: string;
  probability?: string;
  notes?: string;
};

export type DealFormData = z.infer<typeof dealSchema>;

// Schema for updating deal status
export const dealStatusSchema = z.object({
  status: z.enum(['registered', 'approved', 'rejected', 'closed-won', 'closed-lost'], {
    errorMap: () => ({ message: 'Invalid status' }),
  }),
});

export type DealStatusFormData = z.infer<typeof dealStatusSchema>;
