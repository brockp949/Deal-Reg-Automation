import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Edit, Mail, FileDown, Loader2, DollarSign, Calendar, TrendingUp, Plus } from 'lucide-react';
import { vendorAPI } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import DealCreateDialog from '@/components/DealCreateDialog';
import type { Vendor, DealRegistration, Contact } from '@/types';

export default function VendorDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'deals' | 'contacts' | 'timeline'>('deals');

  // Fetch vendor data
  const { data: vendor, isLoading: vendorLoading } = useQuery({
    queryKey: ['vendor', id],
    queryFn: async () => {
      const response = await vendorAPI.getById(id!);
      if (!response.data.success) return null;
      return response.data.data as Vendor;
    },
    enabled: !!id,
  });

  // Fetch vendor's deals
  const { data: deals, isLoading: dealsLoading } = useQuery({
    queryKey: ['vendor-deals', id],
    queryFn: async () => {
      const response = await vendorAPI.getDeals(id!);
      if (!response.data.success) return [];
      return response.data.data.data as DealRegistration[];
    },
    enabled: !!id,
  });

  // Fetch vendor's contacts
  const { data: contacts, isLoading: contactsLoading } = useQuery({
    queryKey: ['vendor-contacts', id],
    queryFn: async () => {
      const response = await vendorAPI.getContacts(id!);
      if (!response.data.success) return [];
      return response.data.data.data as Contact[];
    },
    enabled: !!id,
  });

  if (vendorLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold mb-2">Vendor not found</h2>
        <Button asChild>
          <Link to="/vendors">Back to Vendors</Link>
        </Button>
      </div>
    );
  }

  // Calculate statistics
  const totalDeals = deals?.length || 0;
  const totalValue = deals?.reduce((sum, deal) => sum + (deal.deal_value || 0), 0) || 0;
  const avgDealSize = totalDeals > 0 ? totalValue / totalDeals : 0;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" onClick={() => navigate('/vendors')} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Vendors
        </Button>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold">{vendor.name}</h1>
              <Badge variant={vendor.status === 'active' ? 'success' : 'secondary'}>
                {vendor.status}
              </Badge>
            </div>
            {vendor.industry && (
              <p className="text-muted-foreground">{vendor.industry}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline">
              <Mail className="mr-2 h-4 w-4" />
              Email
            </Button>
            <Button variant="outline">
              <FileDown className="mr-2 h-4 w-4" />
              Export
            </Button>
            <Button>
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </Button>
          </div>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Vendor Info */}
        <Card>
          <CardHeader>
            <CardTitle>Vendor Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {vendor.website && (
              <div>
                <div className="text-sm text-muted-foreground mb-1">Website</div>
                <a
                  href={vendor.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {vendor.website}
                </a>
              </div>
            )}
            {vendor.email_domains && vendor.email_domains.length > 0 && (
              <div>
                <div className="text-sm text-muted-foreground mb-1">Email Domains</div>
                <div className="flex flex-wrap gap-2">
                  {vendor.email_domains.map((domain, index) => (
                    <Badge key={index} variant="outline">
                      {domain}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="text-sm text-muted-foreground mb-1">Added</div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span>{formatDate(vendor.created_at)}</span>
              </div>
            </div>
            {vendor.notes && (
              <div>
                <div className="text-sm text-muted-foreground mb-1">Notes</div>
                <p className="text-sm">{vendor.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Stats */}
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Deals</p>
                  <p className="text-2xl font-bold">{totalDeals}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Value</p>
                  <p className="text-2xl font-bold">{formatCurrency(totalValue)}</p>
                </div>
                <DollarSign className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Avg Deal Size</p>
                  <p className="text-2xl font-bold">{formatCurrency(avgDealSize)}</p>
                </div>
                <DollarSign className="h-8 w-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Tabs */}
      <Card>
        <CardHeader>
          <div className="flex gap-4 border-b">
            <button
              className={`pb-2 px-1 font-medium transition-colors ${
                activeTab === 'deals'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('deals')}
            >
              Deals ({totalDeals})
            </button>
            <button
              className={`pb-2 px-1 font-medium transition-colors ${
                activeTab === 'contacts'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('contacts')}
            >
              Contacts ({contacts?.length || 0})
            </button>
            <button
              className={`pb-2 px-1 font-medium transition-colors ${
                activeTab === 'timeline'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('timeline')}
            >
              Timeline
            </button>
          </div>
        </CardHeader>

        <CardContent>
          {/* Deals Tab */}
          {activeTab === 'deals' && (
            <div>
              <div className="flex justify-end mb-4">
                <DealCreateDialog
                  preselectedVendorId={id}
                  trigger={
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Deal
                    </Button>
                  }
                />
              </div>
              {dealsLoading ? (
                <div className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </div>
              ) : !deals || deals.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="mb-4">No deals registered yet</p>
                  <DealCreateDialog
                    preselectedVendorId={id}
                    trigger={
                      <Button size="sm">
                        <Plus className="mr-2 h-4 w-4" />
                        Create First Deal
                      </Button>
                    }
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  {deals.map((deal) => (
                    <div
                      key={deal.id}
                      className="p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <h4 className="font-semibold">{deal.deal_name}</h4>
                          {deal.customer_name && (
                            <p className="text-sm text-muted-foreground">
                              Customer: {deal.customer_name}
                            </p>
                          )}
                        </div>
                        <Badge
                          variant={
                            deal.status === 'closed-won'
                              ? 'success'
                              : deal.status === 'approved'
                              ? 'default'
                              : 'secondary'
                          }
                        >
                          {deal.status}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3 text-sm">
                        <div>
                          <span className="text-muted-foreground">Value</span>
                          <p className="font-medium">
                            {formatCurrency(deal.deal_value, deal.currency)}
                          </p>
                        </div>
                        {deal.deal_stage && (
                          <div>
                            <span className="text-muted-foreground">Stage</span>
                            <p className="font-medium">{deal.deal_stage}</p>
                          </div>
                        )}
                        {deal.probability !== null && deal.probability !== undefined && (
                          <div>
                            <span className="text-muted-foreground">Probability</span>
                            <p className="font-medium">{deal.probability}%</p>
                          </div>
                        )}
                        {deal.expected_close_date && (
                          <div>
                            <span className="text-muted-foreground">Expected Close</span>
                            <p className="font-medium">
                              {formatDate(deal.expected_close_date)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Contacts Tab */}
          {activeTab === 'contacts' && (
            <div>
              {contactsLoading ? (
                <div className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </div>
              ) : !contacts || contacts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No contacts added yet
                </div>
              ) : (
                <div className="space-y-3">
                  {contacts.map((contact) => (
                    <div
                      key={contact.id}
                      className="p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold">{contact.name}</h4>
                            {contact.is_primary && (
                              <Badge variant="default" className="text-xs">
                                Primary
                              </Badge>
                            )}
                          </div>
                          {contact.role && (
                            <p className="text-sm text-muted-foreground mb-2">
                              {contact.role}
                            </p>
                          )}
                          <div className="space-y-1 text-sm">
                            {contact.email && (
                              <div className="flex items-center gap-2">
                                <Mail className="h-4 w-4 text-muted-foreground" />
                                <a
                                  href={`mailto:${contact.email}`}
                                  className="text-primary hover:underline"
                                >
                                  {contact.email}
                                </a>
                              </div>
                            )}
                            {contact.phone && (
                              <p className="text-muted-foreground">{contact.phone}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Timeline Tab */}
          {activeTab === 'timeline' && (
            <div className="text-center py-8 text-muted-foreground">
              Timeline feature coming soon
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
