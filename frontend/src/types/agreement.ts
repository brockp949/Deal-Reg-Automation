/**
 * Agreement Types
 * TypeScript types for vendor agreements and commission structures.
 */

// Commission rate within a structure
export interface CommissionRate {
  percentage: number;
  description?: string;
  min?: number;
  max?: number | null;
  product?: string;
}

// Commission structure types
export type CommissionType = 'flat' | 'tiered' | 'product';

export interface CommissionStructure {
  type: CommissionType;
  rates: CommissionRate[];
}

// Key terms extracted from agreements
export interface KeyTerms {
  exclusivity?: 'exclusive' | 'non-exclusive' | 'semi-exclusive';
  territory?: string;
  payment_terms?: string;
  min_order_quantity?: string;
  min_order_value?: number;
  termination_notice_days?: number;
  termination_clauses?: string;
  liability_limitation?: string;
  warranty_terms?: string;
  intellectual_property?: string;
  confidentiality?: string;
  insurance_requirements?: string;
  compliance_requirements?: string;
  additional_terms?: string[];
}

// Agreement types
export type AgreementType = 'manufacturing' | 'distribution' | 'reseller' | 'partnership' | 'other';

// Main agreement interface
export interface VendorAgreement {
  id: string;
  vendor_id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  upload_date: string;
  agreement_type: AgreementType | null;
  effective_date: string | null;
  expiration_date: string | null;
  auto_renewal: boolean;
  renewal_terms: string | null;
  commission_structure: CommissionStructure | null;
  key_terms: KeyTerms | null;
  extraction_confidence: number | null;
  extraction_model: string | null;
  extraction_metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// Create agreement input
export interface CreateAgreementInput {
  file: File;
}

// Update agreement input
export interface UpdateAgreementInput {
  agreement_type?: AgreementType;
  effective_date?: string | null;
  expiration_date?: string | null;
  auto_renewal?: boolean;
  renewal_terms?: string | null;
  commission_structure?: CommissionStructure | null;
  key_terms?: KeyTerms | null;
}

// Agreement response types
export interface AgreementResponse {
  success: true;
  data: VendorAgreement;
  message?: string;
}

export interface AgreementsListResponse {
  success: true;
  data: VendorAgreement[];
}

// Helper functions for commission display
export function formatCommissionType(type: CommissionType): string {
  switch (type) {
    case 'flat':
      return 'Flat Rate';
    case 'tiered':
      return 'Tiered';
    case 'product':
      return 'Product-specific';
    default:
      return 'Unknown';
  }
}

export function formatCommissionSummary(structure: CommissionStructure | null): string {
  if (!structure || !structure.rates || structure.rates.length === 0) {
    return 'Not specified';
  }

  const { type, rates } = structure;

  if (type === 'flat' && rates[0]) {
    return `${rates[0].percentage}% flat rate`;
  }

  if (type === 'tiered') {
    const minRate = Math.min(...rates.map((r) => r.percentage));
    const maxRate = Math.max(...rates.map((r) => r.percentage));
    return `${minRate}% - ${maxRate}% (${rates.length} tiers)`;
  }

  if (type === 'product') {
    return `${rates.length} product-specific rates`;
  }

  return 'Custom structure';
}

export function getAgreementTypeLabel(type: AgreementType | null): string {
  if (!type) return 'Unknown';

  const labels: Record<AgreementType, string> = {
    manufacturing: 'Manufacturing',
    distribution: 'Distribution',
    reseller: 'Reseller',
    partnership: 'Partnership',
    other: 'Other',
  };

  return labels[type] || 'Unknown';
}

export function getAgreementTypeColor(type: AgreementType | null): string {
  if (!type) return 'secondary';

  const colors: Record<AgreementType, string> = {
    manufacturing: 'blue',
    distribution: 'green',
    reseller: 'purple',
    partnership: 'orange',
    other: 'secondary',
  };

  return colors[type] || 'secondary';
}

export function isAgreementExpired(agreement: VendorAgreement): boolean {
  if (!agreement.expiration_date) return false;
  return new Date(agreement.expiration_date) < new Date();
}

export function isAgreementExpiringSoon(agreement: VendorAgreement, daysThreshold = 30): boolean {
  if (!agreement.expiration_date) return false;

  const expirationDate = new Date(agreement.expiration_date);
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);

  return expirationDate <= thresholdDate && expirationDate > new Date();
}
