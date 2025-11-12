
import { query } from '../db';
import { ExtractedDeal } from './aiExtractor';
import logger from '../utils/logger';
import { normalizeCompanyName } from '../utils/fileHelpers';

export interface ValidatedDeal extends ExtractedDeal {
  isCustomerNameValid?: boolean;
  isDealValuePlausible?: boolean;
}

/**
 * Validates and enriches the deal data extracted by the AI.
 * This acts as "System 2" to the AI's "System 1".
 *
 * @param deal The deal data extracted by the AI.
 * @returns A promise that resolves to the validated and enriched deal data.
 */
export async function validateAndEnrichDealData(deal: ExtractedDeal): Promise<ValidatedDeal> {
  const validatedDeal: ValidatedDeal = { ...deal };

  // 1. Validate Customer Name: Check if it's a person's name.
  if (deal.customerName) {
    const contactResult = await query(
      'SELECT id FROM contacts WHERE name ILIKE $1',
      [`%${deal.customerName}%`]
    );
    if (contactResult.rows.length > 0) {
      logger.warn('AI-extracted customer name might be a person', { customerName: deal.customerName });
      validatedDeal.isCustomerNameValid = false;
    } else {
      validatedDeal.isCustomerNameValid = true;
      // Normalize company name
      validatedDeal.customerName = normalizeCompanyName(deal.customerName);
    }
  }

  // 2. Validate Deal Value: Check for plausibility (e.g., not too high or too low).
  if (deal.dealValue) {
    if (deal.dealValue < 100 || deal.dealValue > 100000000) {
      logger.warn('AI-extracted deal value seems implausible', { dealValue: deal.dealValue });
      validatedDeal.isDealValuePlausible = false;
    } else {
      validatedDeal.isDealValuePlausible = true;
    }
  }

  // More validation rules can be added here in the future.

  logger.info('Deal data validation complete', { dealName: deal.dealName });

  return validatedDeal;
}
