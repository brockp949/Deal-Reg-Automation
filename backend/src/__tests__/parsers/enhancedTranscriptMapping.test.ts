import {
  inferVendorName,
  emailLocalPartToName,
  normalizeOptionalString,
  mapEnhancedTranscriptDealToExtractedData,
  PERSONAL_EMAIL_DOMAINS,
} from '../../parsers/enhancedTranscriptMapping';
import type { EnhancedDealData } from '../../parsers/enhancedTranscriptParser';

// Helper to create a minimal EnhancedDealData with required fields
function createDealData(overrides: Partial<EnhancedDealData>): EnhancedDealData {
  return {
    confidence_score: 0.7,
    buying_signal_score: 0.6,
    extraction_method: 'transcript_nlp',
    ...overrides,
  };
}

describe('enhancedTranscriptMapping', () => {
  describe('normalizeOptionalString', () => {
    it('returns undefined for null/undefined', () => {
      expect(normalizeOptionalString(undefined)).toBeUndefined();
      expect(normalizeOptionalString('')).toBeUndefined();
      expect(normalizeOptionalString('   ')).toBeUndefined();
    });

    it('trims whitespace from strings', () => {
      expect(normalizeOptionalString('  hello  ')).toBe('hello');
      expect(normalizeOptionalString('\ttest\n')).toBe('test');
    });

    it('returns trimmed value for valid strings', () => {
      expect(normalizeOptionalString('Acme Corp')).toBe('Acme Corp');
    });
  });

  describe('emailLocalPartToName', () => {
    it('extracts name from email local part', () => {
      expect(emailLocalPartToName('john.doe@example.com')).toBe('John Doe');
      expect(emailLocalPartToName('jane_smith@example.com')).toBe('Jane Smith');
      expect(emailLocalPartToName('bob-jones@example.com')).toBe('Bob Jones');
    });

    it('handles simple emails', () => {
      expect(emailLocalPartToName('admin@example.com')).toBe('Admin');
    });

    it('strips numbers from email local part', () => {
      expect(emailLocalPartToName('john.doe123@example.com')).toBe('John Doe');
    });

    it('returns undefined for invalid emails', () => {
      expect(emailLocalPartToName('')).toBeUndefined();
      expect(emailLocalPartToName('@example.com')).toBeUndefined();
    });
  });

  describe('inferVendorName', () => {
    it('returns explicit company name when provided', () => {
      const deal = createDealData({
        partner_company_name: 'Acme Corporation',
        partner_email: 'contact@acme.com',
      });
      const result = inferVendorName(deal);
      expect(result.name).toBe('Acme Corporation');
      expect(result.emailDomain).toBeUndefined();
    });

    it('infers vendor name from corporate email domain', () => {
      const deal = createDealData({
        partner_email: 'john@cisco.com',
      });
      const result = inferVendorName(deal);
      expect(result.name).toBe('Cisco');
      expect(result.emailDomain).toBe('cisco.com');
    });

    it('returns empty for personal email domains', () => {
      const personalDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];

      for (const domain of personalDomains) {
        const deal = createDealData({
          partner_email: `user@${domain}`,
        });
        const result = inferVendorName(deal);
        expect(result.name).toBeUndefined();
        expect(result.emailDomain).toBeUndefined();
      }
    });

    it('returns empty when no partner info provided', () => {
      const deal = createDealData({
        prospect_company_name: 'Customer Inc',
      });
      const result = inferVendorName(deal);
      expect(result.name).toBeUndefined();
    });

    it('handles subdomain emails correctly', () => {
      const deal = createDealData({
        partner_email: 'sales@subdomain.microsoft.com',
      });
      const result = inferVendorName(deal);
      // Should extract the company name from the domain
      expect(result.name).toBeDefined();
      expect(result.emailDomain).toBeDefined();
    });
  });

  describe('PERSONAL_EMAIL_DOMAINS', () => {
    it('contains common personal email providers', () => {
      expect(PERSONAL_EMAIL_DOMAINS.has('gmail.com')).toBe(true);
      expect(PERSONAL_EMAIL_DOMAINS.has('yahoo.com')).toBe(true);
      expect(PERSONAL_EMAIL_DOMAINS.has('outlook.com')).toBe(true);
      expect(PERSONAL_EMAIL_DOMAINS.has('hotmail.com')).toBe(true);
      expect(PERSONAL_EMAIL_DOMAINS.has('icloud.com')).toBe(true);
      expect(PERSONAL_EMAIL_DOMAINS.has('protonmail.com')).toBe(true);
    });

    it('does not contain corporate domains', () => {
      expect(PERSONAL_EMAIL_DOMAINS.has('microsoft.com')).toBe(false);
      expect(PERSONAL_EMAIL_DOMAINS.has('cisco.com')).toBe(false);
    });
  });

  describe('mapEnhancedTranscriptDealToExtractedData', () => {
    it('creates vendor, deal, and contact from complete data', () => {
      const deal = createDealData({
        partner_company_name: 'Vendor Corp',
        partner_email: 'sales@vendorcorp.com',
        partner_contact_name: 'John Vendor',
        partner_phone: '555-1234',
        partner_role: 'Sales Manager',
        prospect_company_name: 'Customer Inc',
        prospect_contact_name: 'Jane Customer',
        prospect_contact_email: 'jane@customer.com',
        deal_description: 'Enterprise software deal',
        estimated_deal_value: 100000,
        currency: 'USD',
        confidence_score: 0.85,
      });

      const result = mapEnhancedTranscriptDealToExtractedData(deal);

      expect(result.warnings).toHaveLength(0);
      expect(result.vendors).toHaveLength(1);
      expect(result.vendors[0].name).toBe('Vendor Corp');

      expect(result.deals).toHaveLength(1);
      expect(result.deals[0].vendor_name).toBe('Vendor Corp');
      expect(result.deals[0].deal_value).toBe(100000);
      expect(result.deals[0].confidence_score).toBe(0.85);

      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0].name).toBe('John Vendor');
      expect(result.contacts[0].email).toBe('sales@vendorcorp.com');
    });

    it('infers vendor from email when company name missing', () => {
      const deal = createDealData({
        partner_email: 'john@cisco.com',
        prospect_company_name: 'Customer Inc',
        deal_description: 'Network equipment deal',
        confidence_score: 0.7,
      });

      const result = mapEnhancedTranscriptDealToExtractedData(deal);

      expect(result.warnings).toHaveLength(0);
      expect(result.vendors).toHaveLength(1);
      expect(result.vendors[0].name).toBe('Cisco');
      expect(result.vendors[0].email_domain).toBe('cisco.com');
    });

    it('returns warning when no vendor can be inferred', () => {
      const deal = createDealData({
        partner_email: 'john@gmail.com', // Personal email
        prospect_company_name: 'Customer Inc',
        deal_description: 'Some deal',
        confidence_score: 0.6,
      });

      const result = mapEnhancedTranscriptDealToExtractedData(deal);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].message).toContain('missing partner company');
      expect(result.vendors).toHaveLength(0);
      expect(result.deals).toHaveLength(0);
    });

    it('returns warning when no partner info at all', () => {
      const deal = createDealData({
        prospect_company_name: 'Customer Inc',
        deal_description: 'Orphan deal',
        confidence_score: 0.5,
      });

      const result = mapEnhancedTranscriptDealToExtractedData(deal);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.vendors).toHaveLength(0);
    });

    it('generates deal name from customer and product', () => {
      const deal = createDealData({
        partner_company_name: 'Vendor Corp',
        partner_email: 'sales@vendor.com',
        prospect_company_name: 'Customer Inc',
        product_line: 'Enterprise Suite',
        confidence_score: 0.8,
      });

      const result = mapEnhancedTranscriptDealToExtractedData(deal);

      expect(result.deals[0].deal_name).toContain('Customer Inc');
      expect(result.deals[0].deal_name).toContain('Enterprise Suite');
    });

    it('aggregates notes from multiple fields', () => {
      const deal = createDealData({
        partner_company_name: 'Vendor Corp',
        partner_email: 'sales@vendor.com',
        deal_description: 'Main description',
        product_service_requirements: 'Needs 100 licenses',
        substantiated_presales_efforts: 'Demo completed',
        requested_support: 'Technical POC',
        reason_for_change: 'Current solution is slow',
        confidence_score: 0.75,
      });

      const result = mapEnhancedTranscriptDealToExtractedData(deal);

      const notes = result.deals[0].notes;
      expect(notes).toContain('Main description');
      expect(notes).toContain('Needs 100 licenses');
      expect(notes).toContain('Demo completed');
      expect(notes).toContain('Technical POC');
      expect(notes).toContain('Current solution is slow');
    });

    it('extracts contact name from email when name missing', () => {
      const deal = createDealData({
        partner_company_name: 'Vendor Corp',
        partner_email: 'john.smith@vendor.com',
        // No partner_contact_name
        confidence_score: 0.7,
      });

      const result = mapEnhancedTranscriptDealToExtractedData(deal);

      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0].name).toBe('John Smith');
    });

    it('preserves extraction method as nlp', () => {
      const deal = createDealData({
        partner_company_name: 'Vendor Corp',
        partner_email: 'sales@vendor.com',
        confidence_score: 0.8,
      });

      const result = mapEnhancedTranscriptDealToExtractedData(deal);

      expect(result.deals[0].extraction_method).toBe('nlp');
    });

    it('handles objections and competitor insights', () => {
      const deal = createDealData({
        partner_company_name: 'Vendor Corp',
        partner_email: 'sales@vendor.com',
        objections: ['Price too high', 'Implementation time'],
        competitor_insights: ['Competitor A offers discount'],
        identified_competitors: ['Competitor A', 'Competitor B'],
        confidence_score: 0.7,
      });

      const result = mapEnhancedTranscriptDealToExtractedData(deal);

      expect(result.deals[0].objections).toEqual(['Price too high', 'Implementation time']);
      expect(result.deals[0].competitor_insights).toEqual(['Competitor A offers discount']);
      expect(result.deals[0].identified_competitors).toEqual(['Competitor A', 'Competitor B']);
    });
  });
});
