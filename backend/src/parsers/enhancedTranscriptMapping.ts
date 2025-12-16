import type { EnhancedDealData } from './enhancedTranscriptParser';
import { domainToCompanyName, extractEmailDomain, normalizeCompanyName } from '../utils/fileHelpers';

export const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'protonmail.com',
  'pm.me',
]);

export function normalizeOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

export function emailLocalPartToName(email: string): string | undefined {
  const local = normalizeOptionalString(email.split('@')[0]);
  if (!local) return undefined;
  const cleaned = local.replace(/[._-]+/g, ' ').replace(/\d+/g, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function inferVendorName(deal: EnhancedDealData): { name?: string; emailDomain?: string } {
  const explicit = normalizeOptionalString(deal.partner_company_name);
  if (explicit) {
    return { name: normalizeCompanyName(explicit) };
  }

  const domain = deal.partner_email ? extractEmailDomain(deal.partner_email) : null;
  if (!domain) return {};

  const lowerDomain = domain.toLowerCase();
  if (PERSONAL_EMAIL_DOMAINS.has(lowerDomain)) {
    return {};
  }

  const inferred = domainToCompanyName(domain);
  const normalized = normalizeOptionalString(inferred);
  if (!normalized || normalized.toLowerCase() === 'unknown') {
    return {};
  }

  return { name: normalizeCompanyName(normalized), emailDomain: lowerDomain };
}

export type EnhancedTranscriptMappingResult = {
  vendors: any[];
  deals: any[];
  contacts: any[];
  warnings: Array<{ message: string; suggestion?: string }>;
};

export function mapEnhancedTranscriptDealToExtractedData(
  deal: EnhancedDealData
): EnhancedTranscriptMappingResult {
  const warnings: EnhancedTranscriptMappingResult['warnings'] = [];

  const { name: vendorName, emailDomain } = inferVendorName(deal);
  if (!vendorName) {
    warnings.push({
      message: 'Enhanced transcript extraction missing partner company/email; skipping deal output to avoid creating "Unknown Vendor" records.',
      suggestion: 'Ensure the transcript mentions the partner company name or includes a partner email with a corporate domain.',
    });
    return { vendors: [], deals: [], contacts: [], warnings };
  }

  const customerName =
    normalizeOptionalString(deal.end_user_company_name) ?? normalizeOptionalString(deal.prospect_company_name);

  const dealName =
    normalizeOptionalString(deal.deal_name) ??
    ([customerName, normalizeOptionalString(deal.product_line), 'Opportunity']
      .filter(Boolean)
      .join(' - ') || 'Transcript Opportunity');

  const notes: string[] = [];
  const dealDescription = normalizeOptionalString(deal.deal_description);
  if (dealDescription) notes.push(dealDescription);

  const requirements = normalizeOptionalString(deal.product_service_requirements);
  if (requirements) notes.push(`Requirements: ${requirements}`);

  const preSales = normalizeOptionalString(deal.substantiated_presales_efforts);
  if (preSales) notes.push(`Pre-sales efforts: ${preSales}`);

  const support = normalizeOptionalString(deal.requested_support);
  if (support) notes.push(`Requested support: ${support}`);

  const reason = normalizeOptionalString(deal.reason_for_change);
  if (reason) notes.push(`Reason for change: ${reason}`);

  const jobTitle = normalizeOptionalString(deal.prospect_job_title);
  if (jobTitle) notes.push(`Prospect job title: ${jobTitle}`);

  const vendors = [
    {
      name: vendorName,
      email_domain: emailDomain,
    },
  ];

  const deals = [
    {
      deal_name: dealName,
      vendor_name: vendorName,
      customer_name: customerName,
      customer_industry: normalizeOptionalString(deal.industry),
      end_user_address: normalizeOptionalString(deal.end_user_address),
      deal_value: typeof deal.estimated_deal_value === 'number' ? deal.estimated_deal_value : undefined,
      currency: normalizeOptionalString(deal.currency),
      expected_close_date: deal.expected_close_date,
      deal_stage: normalizeOptionalString(deal.deal_stage),
      product_service_requirements: requirements,
      pre_sales_efforts: preSales,
      objections: deal.objections,
      competitor_insights: deal.competitor_insights,
      identified_competitors: deal.identified_competitors,
      decision_maker_contact: normalizeOptionalString(deal.prospect_contact_name),
      decision_maker_email: normalizeOptionalString(deal.prospect_contact_email),
      decision_maker_phone: normalizeOptionalString(deal.prospect_contact_phone),
      notes: notes.length ? notes.join('\n') : undefined,
      confidence_score: deal.confidence_score,
      extraction_method: 'nlp',
    },
  ];

  const contactName =
    normalizeOptionalString(deal.partner_contact_name) ??
    (deal.partner_email ? emailLocalPartToName(deal.partner_email) : undefined) ??
    (deal.partner_email ? normalizeOptionalString(deal.partner_email) : undefined);

  const contacts =
    contactName
      ? [
          {
            name: contactName,
            vendor_name: vendorName,
            email: normalizeOptionalString(deal.partner_email),
            phone: normalizeOptionalString(deal.partner_phone),
            role: normalizeOptionalString(deal.partner_role),
          },
        ]
      : [];

  return { vendors, deals, contacts, warnings };
}

