import { body, param, query, validationResult, ValidationChain } from 'express-validator';
import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to handle validation errors
 */
export const handleValidationErrors = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      errors: errors.array().map(err => ({
        field: err.type === 'field' ? err.path : undefined,
        message: err.msg,
        value: err.type === 'field' ? err.value : undefined,
      })),
    });
  }
  next();
};

/**
 * Common validation chains
 */
export const commonValidations = {
  uuid: (field: string) =>
    param(field)
      .isUUID()
      .withMessage(`${field} must be a valid UUID`),

  email: (field: string = 'email') =>
    body(field)
      .optional()
      .isEmail()
      .normalizeEmail()
      .withMessage('Must be a valid email address'),

  url: (field: string) =>
    body(field)
      .optional()
      .isURL({ protocols: ['http', 'https'] })
      .withMessage('Must be a valid URL'),

  date: (field: string) =>
    body(field)
      .optional()
      .isISO8601()
      .toDate()
      .withMessage('Must be a valid ISO 8601 date'),

  currency: () =>
    body('currency')
      .optional()
      .isISO4217()
      .withMessage('Must be a valid ISO 4217 currency code (e.g., USD, EUR)'),

  positiveNumber: (field: string) =>
    body(field)
      .optional()
      .isFloat({ min: 0 })
      .toFloat()
      .withMessage(`${field} must be a positive number`),

  percentage: (field: string) =>
    body(field)
      .optional()
      .isFloat({ min: 0, max: 100 })
      .toFloat()
      .withMessage(`${field} must be between 0 and 100`),

  nonEmptyString: (field: string, minLength: number = 1, maxLength: number = 255) =>
    body(field)
      .trim()
      .isLength({ min: minLength, max: maxLength })
      .escape()
      .withMessage(`${field} must be between ${minLength} and ${maxLength} characters`),

  optionalString: (field: string, maxLength: number = 5000) =>
    body(field)
      .optional()
      .trim()
      .isLength({ max: maxLength })
      .escape()
      .withMessage(`${field} must not exceed ${maxLength} characters`),

  phoneNumber: (field: string = 'phone') =>
    body(field)
      .optional()
      .matches(/^[\d\s\-\+\(\)\.]+$/)
      .withMessage('Must be a valid phone number'),

  enum: (field: string, allowedValues: string[]) =>
    body(field)
      .optional()
      .isIn(allowedValues)
      .withMessage(`${field} must be one of: ${allowedValues.join(', ')}`),

  pagination: () => [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .toInt()
      .withMessage('page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .toInt()
      .withMessage('limit must be between 1 and 100'),
  ],

  // Extended pagination for endpoints that need to fetch more data (e.g., charts)
  extendedPagination: () => [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .toInt()
      .withMessage('page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 5000 })
      .toInt()
      .withMessage('limit must be between 1 and 5000'),
  ],

  sortOrder: () =>
    query('sort_order')
      .optional()
      .isIn(['asc', 'desc'])
      .withMessage('sort_order must be either asc or desc'),
};

/**
 * Deal validation chains
 */
export const dealValidations = {
  create: [
    body('vendor_id')
      .isUUID()
      .withMessage('vendor_id must be a valid UUID'),
    commonValidations.nonEmptyString('deal_name', 3, 255),
    commonValidations.positiveNumber('deal_value'),
    commonValidations.currency(),
    commonValidations.optionalString('customer_name', 255),
    commonValidations.optionalString('customer_industry', 100),
    commonValidations.date('registration_date'),
    commonValidations.date('expected_close_date'),
    commonValidations.enum('status', ['registered', 'approved', 'rejected', 'closed-won', 'closed-lost']),
    commonValidations.optionalString('deal_stage', 100),
    commonValidations.percentage('probability'),
    commonValidations.optionalString('notes', 5000),
    handleValidationErrors,
  ],

  update: [
    commonValidations.uuid('id'),
    body('vendor_id')
      .optional()
      .isUUID()
      .withMessage('vendor_id must be a valid UUID'),
    commonValidations.optionalString('deal_name', 255),
    commonValidations.positiveNumber('deal_value'),
    commonValidations.currency(),
    commonValidations.optionalString('customer_name', 255),
    commonValidations.optionalString('customer_industry', 100),
    commonValidations.date('registration_date'),
    commonValidations.date('expected_close_date'),
    commonValidations.enum('status', ['registered', 'approved', 'rejected', 'closed-won', 'closed-lost']),
    commonValidations.optionalString('deal_stage', 100),
    commonValidations.percentage('probability'),
    commonValidations.optionalString('notes', 5000),
    handleValidationErrors,
  ],

  updateStatus: [
    commonValidations.uuid('id'),
    commonValidations.enum('status', ['registered', 'approved', 'rejected', 'closed-won', 'closed-lost']),
    body('status')
      .notEmpty()
      .withMessage('status is required'),
    handleValidationErrors,
  ],

  getAll: [
    ...commonValidations.extendedPagination(),
    query('vendor_id')
      .optional()
      .isUUID()
      .withMessage('vendor_id must be a valid UUID'),
    commonValidations.enum('status', ['registered', 'approved', 'rejected', 'closed-won', 'closed-lost']),
    query('min_value')
      .optional()
      .isFloat({ min: 0 })
      .toFloat()
      .withMessage('min_value must be a positive number'),
    query('max_value')
      .optional()
      .isFloat({ min: 0 })
      .toFloat()
      .withMessage('max_value must be a positive number'),
    query('sort_by')
      .optional()
      .isIn(['deal_name', 'deal_value', 'registration_date', 'created_at', 'status'])
      .withMessage('sort_by must be a valid field'),
    commonValidations.sortOrder(),
    handleValidationErrors,
  ],

  getById: [
    commonValidations.uuid('id'),
    handleValidationErrors,
  ],

  delete: [
    commonValidations.uuid('id'),
    handleValidationErrors,
  ],
};

/**
 * Vendor validation chains
 */
export const vendorValidations = {
  create: [
    commonValidations.nonEmptyString('name', 2, 255),
    body('email_domains')
      .optional()
      .isArray()
      .withMessage('email_domains must be an array'),
    body('email_domains.*')
      .optional()
      .matches(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
      .withMessage('Each email domain must be valid'),
    commonValidations.optionalString('industry', 100),
    commonValidations.url('website'),
    commonValidations.optionalString('notes', 5000),
    commonValidations.enum('status', ['active', 'inactive']),
    commonValidations.enum('approval_status', ['approved', 'pending', 'denied']),
    handleValidationErrors,
  ],

  update: [
    commonValidations.uuid('id'),
    commonValidations.optionalString('name', 255),
    body('email_domains')
      .optional()
      .isArray()
      .withMessage('email_domains must be an array'),
    commonValidations.optionalString('industry', 100),
    commonValidations.url('website'),
    commonValidations.optionalString('notes', 5000),
    commonValidations.enum('status', ['active', 'inactive']),
    commonValidations.enum('approval_status', ['approved', 'pending', 'denied']),
    commonValidations.optionalString('approval_notes', 1000),
    handleValidationErrors,
  ],

  getAll: [
    ...commonValidations.pagination(),
    commonValidations.enum('status', ['active', 'inactive']),
    commonValidations.enum('approval_status', ['approved', 'pending', 'denied']),
    query('industry')
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage('industry must not exceed 100 characters'),
    query('search')
      .optional()
      .trim()
      .isLength({ max: 255 })
      .withMessage('search must not exceed 255 characters'),
    query('sort_by')
      .optional()
      .isIn(['name', 'created_at', 'updated_at', 'status', 'approval_status'])
      .withMessage('sort_by must be a valid field'),
    commonValidations.sortOrder(),
    handleValidationErrors,
  ],

  getById: [
    commonValidations.uuid('id'),
    handleValidationErrors,
  ],

  delete: [
    commonValidations.uuid('id'),
    handleValidationErrors,
  ],
};

/**
 * Contact validation chains
 */
export const contactValidations = {
  create: [
    body('vendor_id')
      .isUUID()
      .withMessage('vendor_id must be a valid UUID'),
    commonValidations.nonEmptyString('name', 2, 255),
    commonValidations.email('email'),
    commonValidations.phoneNumber('phone'),
    commonValidations.optionalString('role', 100),
    body('is_primary')
      .optional()
      .isBoolean()
      .toBoolean()
      .withMessage('is_primary must be a boolean'),
    handleValidationErrors,
  ],

  update: [
    commonValidations.uuid('id'),
    commonValidations.optionalString('name', 255),
    commonValidations.email('email'),
    commonValidations.phoneNumber('phone'),
    commonValidations.optionalString('role', 100),
    body('is_primary')
      .optional()
      .isBoolean()
      .toBoolean()
      .withMessage('is_primary must be a boolean'),
    handleValidationErrors,
  ],

  getAll: [
    ...commonValidations.pagination(),
    query('vendor_id')
      .optional()
      .isUUID()
      .withMessage('vendor_id must be a valid UUID'),
    handleValidationErrors,
  ],

  delete: [
    commonValidations.uuid('id'),
    handleValidationErrors,
  ],
};
