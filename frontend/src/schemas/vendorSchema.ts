import { z } from 'zod';

export const vendorSchema = z.object({
  name: z
    .string()
    .min(2, 'Vendor name must be at least 2 characters')
    .max(255, 'Vendor name must not exceed 255 characters'),
  email_domains: z
    .array(
      z
        .string()
        .regex(
          /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
          'Invalid domain format (e.g., example.com)'
        )
    )
    .optional(),
  industry: z
    .string()
    .max(100, 'Industry must not exceed 100 characters')
    .optional(),
  website: z
    .string()
    .url('Must be a valid URL (e.g., https://example.com)')
    .optional()
    .or(z.literal('')),
  notes: z
    .string()
    .max(5000, 'Notes must not exceed 5000 characters')
    .optional(),
  status: z
    .enum(['active', 'inactive'], {
      errorMap: () => ({ message: 'Status must be active or inactive' }),
    })
    .default('active')
    .optional(),
  approval_status: z
    .enum(['approved', 'pending', 'denied'], {
      errorMap: () => ({ message: 'Invalid approval status' }),
    })
    .default('approved')
    .optional(),
  approval_notes: z
    .string()
    .max(1000, 'Approval notes must not exceed 1000 characters')
    .optional(),
});

export type VendorFormData = z.infer<typeof vendorSchema>;
