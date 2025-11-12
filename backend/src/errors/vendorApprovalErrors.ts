export class VendorApprovalPendingError extends Error {
  public readonly aliasId: string;
  public readonly vendorName: string;

  constructor(vendorName: string, aliasId: string) {
    super(`Vendor "${vendorName}" requires approval (alias ${aliasId})`);
    this.name = 'VendorApprovalPendingError';
    this.aliasId = aliasId;
    this.vendorName = vendorName;
  }
}

export class VendorApprovalDeniedError extends Error {
  public readonly vendorName: string;

  constructor(vendorName: string) {
    super(`Vendor "${vendorName}" has been denied by the user`);
    this.name = 'VendorApprovalDeniedError';
    this.vendorName = vendorName;
  }
}
