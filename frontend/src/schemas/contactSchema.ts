import { z } from 'zod';

export const contactSchema = z.object({
  vendor_id: z.string().uuid('Please select a valid vendor'),
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(255, 'Name must not exceed 255 characters'),
  email: z
    .string()
    .email('Must be a valid email address')
    .optional()
    .or(z.literal('')),
  phone: z
    .string()
    .regex(/^[\d\s+().-]+$/, 'Invalid phone number format')
    .optional()
    .or(z.literal('')),
  role: z
    .string()
    .max(100, 'Role must not exceed 100 characters')
    .optional(),
  is_primary: z.boolean().default(false).optional(),
});

export type ContactFormData = z.infer<typeof contactSchema>;
