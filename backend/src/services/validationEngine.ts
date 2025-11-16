import { query } from '../db';
import logger from '../utils/logger';

// Validation result types
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  confidenceAdjustment: number; // -1.0 to +1.0 (adjustment to original confidence)
  finalConfidence: number; // Adjusted confidence score
  rulesApplied: string[];
  validatedAt: Date;
}

export interface ValidationError {
  rule: string;
  field: string;
  message: string;
  severity: 'critical' | 'error';
  expectedValue?: any;
  actualValue?: any;
}

export interface ValidationWarning {
  rule: string;
  field: string;
  message: string;
  suggestion?: string;
}

export interface CrossReferenceResult {
  matchFound: boolean;
  matchType: 'exact' | 'fuzzy' | 'partial' | 'none';
  matchedEntity?: any;
  confidence: number;
  reasoning: string;
}

// Validation rule configuration
interface ValidationRule {
  name: string;
  description: string;
  field: string;
  validator: (value: any, context: any) => ValidationRuleResult;
  severity: 'critical' | 'error' | 'warning';
  confidenceImpact: number; // -0.5 to +0.5
}

interface ValidationRuleResult {
  passed: boolean;
  message?: string;
  suggestion?: string;
}

/**
 * Validate extracted deal data
 */
export async function validateDeal(
  dealData: any,
  context?: {
    sourceText?: string;
    existingDeals?: any[];
    vendors?: any[];
  }
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const rulesApplied: string[] = [];
  let confidenceAdjustment = 0;

  const originalConfidence = dealData.confidence || 0.5;

  // Apply all deal validation rules
  const rules = getDealValidationRules();

  for (const rule of rules) {
    try {
      const result = rule.validator(dealData[rule.field], { dealData, ...context });
      rulesApplied.push(rule.name);

      if (!result.passed) {
        if (rule.severity === 'critical' || rule.severity === 'error') {
          errors.push({
            rule: rule.name,
            field: rule.field,
            message: result.message || `${rule.field} validation failed`,
            severity: rule.severity,
            actualValue: dealData[rule.field],
          });
        } else {
          warnings.push({
            rule: rule.name,
            field: rule.field,
            message: result.message || `${rule.field} has issues`,
            suggestion: result.suggestion,
          });
        }

        // Adjust confidence based on rule impact
        confidenceAdjustment += rule.confidenceImpact;
      } else {
        // Passed validation - small confidence boost for critical fields
        if (rule.severity === 'critical') {
          confidenceAdjustment += 0.05;
        }
      }
    } catch (error: any) {
      logger.warn(`Validation rule ${rule.name} failed to execute`, {
        error: error.message,
        field: rule.field,
      });
    }
  }

  // Cross-reference with existing data
  if (context?.existingDeals && context.existingDeals.length > 0) {
    const duplicateCheck = await checkForDuplicateDeals(dealData, context.existingDeals);
    if (duplicateCheck.matchFound && duplicateCheck.confidence > 0.7) {
      warnings.push({
        rule: 'duplicate_detection',
        field: 'dealName',
        message: `Potential duplicate of existing deal: ${duplicateCheck.matchedEntity?.deal_name}`,
        suggestion: 'Review for possible duplicate or update to existing deal',
      });
      confidenceAdjustment -= 0.2; // Reduce confidence for potential duplicates
    }
  }

  // Vendor cross-reference
  if (dealData.vendorName && context?.vendors) {
    const vendorMatch = await matchVendorReference(dealData.vendorName, context.vendors);
    if (!vendorMatch.matchFound) {
      warnings.push({
        rule: 'vendor_reference',
        field: 'vendorName',
        message: `Vendor "${dealData.vendorName}" not found in database`,
        suggestion: 'Vendor may need to be added to approval queue',
      });
      confidenceAdjustment -= 0.1;
    } else if (vendorMatch.matchType === 'fuzzy') {
      warnings.push({
        rule: 'vendor_reference',
        field: 'vendorName',
        message: `Vendor matched as "${vendorMatch.matchedEntity.name}" (fuzzy match)`,
        suggestion: 'Verify vendor name is correct',
      });
    }
  }

  // Calculate final confidence
  const finalConfidence = Math.max(0, Math.min(1.0, originalConfidence + confidenceAdjustment));

  const result: ValidationResult = {
    isValid: errors.filter(e => e.severity === 'critical').length === 0,
    errors,
    warnings,
    confidenceAdjustment,
    finalConfidence,
    rulesApplied,
    validatedAt: new Date(),
  };

  logger.info('Deal validation completed', {
    dealName: dealData.dealName,
    isValid: result.isValid,
    errorsCount: errors.length,
    warningsCount: warnings.length,
    originalConfidence,
    finalConfidence,
    adjustment: confidenceAdjustment,
  });

  return result;
}

/**
 * Validate deal value and currency
 */
export function validateDealValue(
  value: any,
  currency: string,
  context?: { sourceText?: string }
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const rulesApplied: string[] = [];

  // Convert to number
  const numValue = typeof value === 'string' ? parseFloat(value) : value;

  // Rule: Value must be a positive number
  rulesApplied.push('value_positive');
  if (isNaN(numValue) || numValue <= 0) {
    errors.push({
      rule: 'value_positive',
      field: 'dealValue',
      message: 'Deal value must be a positive number',
      severity: 'critical',
      actualValue: value,
    });
  }

  // Rule: Value should be reasonable (not too small or too large)
  rulesApplied.push('value_range');
  if (numValue < 100) {
    warnings.push({
      rule: 'value_range',
      field: 'dealValue',
      message: `Deal value $${numValue} seems unusually small`,
      suggestion: 'Verify this is the correct value, not a partial amount',
    });
  } else if (numValue > 10000000) {
    warnings.push({
      rule: 'value_range',
      field: 'dealValue',
      message: `Deal value $${numValue} seems unusually large`,
      suggestion: 'Verify this is the total deal value',
    });
  }

  // Rule: Currency must be valid ISO code
  rulesApplied.push('currency_valid');
  const validCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CNY', 'INR'];
  if (currency && !validCurrencies.includes(currency.toUpperCase())) {
    warnings.push({
      rule: 'currency_valid',
      field: 'currency',
      message: `Currency code "${currency}" may not be valid`,
      suggestion: `Expected one of: ${validCurrencies.join(', ')}`,
    });
  }

  // Rule: Context check - value should appear in source text
  if (context?.sourceText && numValue > 0) {
    rulesApplied.push('value_context_check');
    const valueStr = numValue.toString();
    const hasValue = context.sourceText.includes(valueStr) ||
                     context.sourceText.includes(numValue.toLocaleString());
    if (!hasValue) {
      warnings.push({
        rule: 'value_context_check',
        field: 'dealValue',
        message: 'Deal value not found in source text',
        suggestion: 'Verify the value was correctly extracted',
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    confidenceAdjustment: errors.length > 0 ? -0.3 : warnings.length > 0 ? -0.1 : 0,
    finalConfidence: 0.5, // Placeholder, should be calculated
    rulesApplied,
    validatedAt: new Date(),
  };
}

/**
 * Validate date fields
 */
export function validateDealDate(
  date: any,
  dateType: 'close_date' | 'registration_date',
  context?: any
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const rulesApplied: string[] = [];

  if (!date) {
    return {
      isValid: true,
      errors: [],
      warnings: [],
      confidenceAdjustment: 0,
      finalConfidence: 0.5,
      rulesApplied: ['date_null_check'],
      validatedAt: new Date(),
    };
  }

  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();

  // Rule: Date must be valid
  rulesApplied.push('date_valid');
  if (isNaN(dateObj.getTime())) {
    errors.push({
      rule: 'date_valid',
      field: dateType,
      message: 'Date is invalid or unparseable',
      severity: 'error',
      actualValue: date,
    });
    return {
      isValid: false,
      errors,
      warnings,
      confidenceAdjustment: -0.3,
      finalConfidence: 0.2,
      rulesApplied,
      validatedAt: new Date(),
    };
  }

  // Rule: Close date should be in future (for open deals)
  if (dateType === 'close_date') {
    rulesApplied.push('close_date_future');
    const daysDiff = (dateObj.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

    if (daysDiff < -180) {
      // More than 6 months in past
      warnings.push({
        rule: 'close_date_future',
        field: 'close_date',
        message: `Close date is ${Math.abs(Math.round(daysDiff))} days in the past`,
        suggestion: 'This may be a closed deal or incorrect date',
      });
    } else if (daysDiff > 730) {
      // More than 2 years in future
      warnings.push({
        rule: 'close_date_future',
        field: 'close_date',
        message: `Close date is ${Math.round(daysDiff)} days in the future`,
        suggestion: 'Verify this distant close date is correct',
      });
    }
  }

  // Rule: Registration date should be in past
  if (dateType === 'registration_date') {
    rulesApplied.push('registration_date_past');
    if (dateObj > now) {
      errors.push({
        rule: 'registration_date_past',
        field: 'registration_date',
        message: 'Registration date cannot be in the future',
        severity: 'error',
        actualValue: date,
      });
    }
  }

  // Rule: Dates should be logically consistent
  if (context?.closeDate && context?.registrationDate) {
    rulesApplied.push('date_consistency');
    const regDate = new Date(context.registrationDate);
    const closeDate = new Date(context.closeDate);

    if (regDate > closeDate) {
      errors.push({
        rule: 'date_consistency',
        field: dateType,
        message: 'Registration date is after close date',
        severity: 'error',
        actualValue: date,
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    confidenceAdjustment: errors.length > 0 ? -0.2 : warnings.length > 0 ? -0.1 : 0,
    finalConfidence: 0.5,
    rulesApplied,
    validatedAt: new Date(),
  };
}

/**
 * Validate customer name
 */
export function validateCustomerName(name: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const rulesApplied: string[] = [];

  if (!name || name.trim().length === 0) {
    return {
      isValid: false,
      errors: [{ rule: 'name_required', field: 'customerName', message: 'Customer name is required', severity: 'critical' }],
      warnings: [],
      confidenceAdjustment: -0.5,
      finalConfidence: 0,
      rulesApplied: ['name_required'],
      validatedAt: new Date(),
    };
  }

  // Rule: Should not be a person name (heuristic)
  rulesApplied.push('name_not_person');
  const personNamePatterns = /^(Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z]/i;
  const firstLastPattern = /^[A-Z][a-z]+ [A-Z][a-z]+$/; // John Smith pattern

  if (personNamePatterns.test(name) || (firstLastPattern.test(name) && name.split(' ').length === 2)) {
    warnings.push({
      rule: 'name_not_person',
      field: 'customerName',
      message: 'Customer name appears to be a person name, not a company',
      suggestion: 'Verify this is the company name, not an individual',
    });
  }

  // Rule: Should be properly capitalized
  rulesApplied.push('name_capitalization');
  if (name === name.toUpperCase() && name.length > 5) {
    warnings.push({
      rule: 'name_capitalization',
      field: 'customerName',
      message: 'Customer name is all uppercase',
      suggestion: 'Consider normalizing to proper case',
    });
  } else if (name === name.toLowerCase()) {
    warnings.push({
      rule: 'name_capitalization',
      field: 'customerName',
      message: 'Customer name is all lowercase',
      suggestion: 'Consider normalizing to proper case',
    });
  }

  // Rule: Should not contain email or URL
  rulesApplied.push('name_no_email_url');
  if (/@/.test(name) || /https?:\/\//.test(name)) {
    errors.push({
      rule: 'name_no_email_url',
      field: 'customerName',
      message: 'Customer name contains email or URL',
      severity: 'error',
      actualValue: name,
    });
  }

  // Rule: Reasonable length
  rulesApplied.push('name_length');
  if (name.length < 2) {
    errors.push({
      rule: 'name_length',
      field: 'customerName',
      message: 'Customer name is too short',
      severity: 'error',
      actualValue: name,
    });
  } else if (name.length > 100) {
    warnings.push({
      rule: 'name_length',
      field: 'customerName',
      message: 'Customer name is unusually long',
      suggestion: 'Verify this is the correct company name',
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    confidenceAdjustment: errors.length > 0 ? -0.3 : warnings.length > 0 ? -0.05 : 0,
    finalConfidence: 0.5,
    rulesApplied,
    validatedAt: new Date(),
  };
}

/**
 * Validate deal status
 */
export function validateDealStatus(status: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const rulesApplied: string[] = [];

  const validStatuses = [
    'prospecting',
    'qualified',
    'proposal',
    'negotiation',
    'closed_won',
    'closed_lost',
    'registered',
    'pending',
    'new',
  ];

  rulesApplied.push('status_valid');
  const normalizedStatus = status?.toLowerCase().trim();

  if (!normalizedStatus) {
    warnings.push({
      rule: 'status_valid',
      field: 'status',
      message: 'Status is empty or null',
      suggestion: 'Default to "new" or "registered"',
    });
  } else if (!validStatuses.includes(normalizedStatus)) {
    warnings.push({
      rule: 'status_valid',
      field: 'status',
      message: `Status "${status}" is not a standard value`,
      suggestion: `Expected one of: ${validStatuses.join(', ')}`,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    confidenceAdjustment: warnings.length > 0 ? -0.05 : 0.05,
    finalConfidence: 0.5,
    rulesApplied,
    validatedAt: new Date(),
  };
}

/**
 * Check for duplicate deals
 */
async function checkForDuplicateDeals(
  dealData: any,
  existingDeals: any[]
): Promise<CrossReferenceResult> {
  // Simple fuzzy matching logic
  const newDealName = dealData.dealName?.toLowerCase().trim() || '';
  const newCustomer = dealData.customerName?.toLowerCase().trim() || '';
  const newValue = dealData.dealValue || 0;

  for (const existing of existingDeals) {
    const existingName = existing.deal_name?.toLowerCase().trim() || '';
    const existingCustomer = existing.customer_name?.toLowerCase().trim() || '';
    const existingValue = existing.deal_value || 0;

    let matchScore = 0;

    // Name similarity (simple approach)
    if (newDealName && existingName) {
      const commonWords = newDealName.split(' ').filter((word: string) =>
        existingName.includes(word) && word.length > 3
      );
      matchScore += (commonWords.length / newDealName.split(' ').length) * 0.4;
    }

    // Customer match
    if (newCustomer && existingCustomer && newCustomer === existingCustomer) {
      matchScore += 0.3;
    }

    // Value match (within 10%)
    if (newValue > 0 && existingValue > 0) {
      const valueDiff = Math.abs(newValue - existingValue) / Math.max(newValue, existingValue);
      if (valueDiff < 0.1) {
        matchScore += 0.3;
      }
    }

    if (matchScore > 0.7) {
      return {
        matchFound: true,
        matchType: matchScore > 0.9 ? 'exact' : 'fuzzy',
        matchedEntity: existing,
        confidence: matchScore,
        reasoning: `Deal matches existing deal: name similarity + customer match + value proximity`,
      };
    }
  }

  return {
    matchFound: false,
    matchType: 'none',
    confidence: 0,
    reasoning: 'No duplicate deals found',
  };
}

/**
 * Match vendor reference
 */
async function matchVendorReference(
  vendorName: string,
  vendors: any[]
): Promise<CrossReferenceResult> {
  const normalized = vendorName.toLowerCase().trim();

  for (const vendor of vendors) {
    const vendorNameNorm = vendor.name?.toLowerCase().trim() || '';
    const normalizedNameNorm = vendor.normalized_name?.toLowerCase().trim() || '';

    // Exact match
    if (normalized === vendorNameNorm || normalized === normalizedNameNorm) {
      return {
        matchFound: true,
        matchType: 'exact',
        matchedEntity: vendor,
        confidence: 1.0,
        reasoning: 'Exact vendor name match',
      };
    }

    // Check aliases
    if (vendor.email_domains) {
      const domains = Array.isArray(vendor.email_domains) ? vendor.email_domains : [];
      for (const domain of domains) {
        if (normalized.includes(domain.toLowerCase()) || domain.toLowerCase().includes(normalized)) {
          return {
            matchFound: true,
            matchType: 'partial',
            matchedEntity: vendor,
            confidence: 0.8,
            reasoning: 'Matched via email domain',
          };
        }
      }
    }

    // Fuzzy match
    if (vendorNameNorm.includes(normalized) || normalized.includes(vendorNameNorm)) {
      return {
        matchFound: true,
        matchType: 'fuzzy',
        matchedEntity: vendor,
        confidence: 0.7,
        reasoning: 'Partial vendor name match',
      };
    }
  }

  return {
    matchFound: false,
    matchType: 'none',
    confidence: 0,
    reasoning: 'No vendor match found',
  };
}

/**
 * Get deal validation rules
 */
function getDealValidationRules(): ValidationRule[] {
  return [
    {
      name: 'deal_name_required',
      description: 'Deal name must be present',
      field: 'dealName',
      validator: (value) => ({
        passed: !!value && value.trim().length > 0,
        message: 'Deal name is required',
      }),
      severity: 'critical',
      confidenceImpact: -0.5,
    },
    {
      name: 'deal_name_length',
      description: 'Deal name should be reasonable length',
      field: 'dealName',
      validator: (value) => ({
        passed: value && value.length >= 5 && value.length <= 200,
        message: value?.length < 5 ? 'Deal name is too short' : 'Deal name is too long',
      }),
      severity: 'warning',
      confidenceImpact: -0.1,
    },
    {
      name: 'customer_name_required',
      description: 'Customer name must be present',
      field: 'customerName',
      validator: (value) => ({
        passed: !!value && value.trim().length > 0,
        message: 'Customer name is required',
      }),
      severity: 'critical',
      confidenceImpact: -0.5,
    },
    {
      name: 'deal_value_positive',
      description: 'Deal value must be positive if present',
      field: 'dealValue',
      validator: (value) => {
        if (!value) return { passed: true }; // Optional field
        const numValue = typeof value === 'string' ? parseFloat(value) : value;
        return {
          passed: !isNaN(numValue) && numValue > 0,
          message: 'Deal value must be a positive number',
        };
      },
      severity: 'error',
      confidenceImpact: -0.3,
    },
    {
      name: 'deal_value_reasonable',
      description: 'Deal value should be in reasonable range',
      field: 'dealValue',
      validator: (value) => {
        if (!value) return { passed: true };
        const numValue = typeof value === 'string' ? parseFloat(value) : value;
        return {
          passed: numValue >= 100 && numValue <= 10000000,
          message: numValue < 100 ? 'Deal value seems too small' : 'Deal value seems too large',
          suggestion: 'Verify this is the correct total deal value',
        };
      },
      severity: 'warning',
      confidenceImpact: -0.1,
    },
  ];
}

/**
 * Log validation results to database
 */
export async function logValidationResult(
  entityType: 'deal' | 'vendor' | 'contact',
  entityId: string,
  extractionLogId: string,
  validationResult: ValidationResult
): Promise<void> {
  try {
    // Update extracted_entities with validation results
    await query(
      `UPDATE extracted_entities
       SET validation_status = $1,
           validation_rules_applied = $2,
           validation_failures = $3,
           validation_warnings = $4,
           final_confidence_score = $5,
           validated_at = $6
       WHERE entity_type = $7 AND entity_id = $8`,
      [
        validationResult.isValid ? 'passed' : 'failed',
        validationResult.rulesApplied,
        JSON.stringify(validationResult.errors),
        JSON.stringify(validationResult.warnings),
        validationResult.finalConfidence,
        validationResult.validatedAt,
        entityType,
        entityId,
      ]
    );

    // Log validation failures
    for (const error of validationResult.errors) {
      await query(
        `INSERT INTO validation_failures (
          extraction_log_id, rule_name, field_name, expected_value,
          actual_value, failure_reason, severity
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          extractionLogId,
          error.rule,
          error.field,
          error.expectedValue || null,
          error.actualValue || null,
          error.message,
          error.severity,
        ]
      );
    }

    logger.debug('Validation result logged', {
      entityType,
      entityId,
      isValid: validationResult.isValid,
      errorsCount: validationResult.errors.length,
    });
  } catch (error: any) {
    logger.error('Failed to log validation result', {
      error: error.message,
      entityType,
      entityId,
    });
  }
}
