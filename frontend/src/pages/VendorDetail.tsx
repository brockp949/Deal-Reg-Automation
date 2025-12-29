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
    <div className="container p-6 animate-fade-in">
      {/* Header */}
      <div className="mb-8 animate-slide-up">
        <Button variant="ghost" onClick={() => navigate('/vendors')} className="mb-6 hover:bg-white/10 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Vendors
        </Button>

        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-4xl font-bold bg-gradient-to-r from-primary via-purple-400 to-blue-600 bg-clip-text text-transparent">{vendor.name}</h1>
              <Badge variant={vendor.status === 'active' ? 'success' : 'secondary'} className="glass border-white/10">
                {vendor.status}
              </Badge>
            </div>
            {vendor.industry && (
              <p className="text-muted-foreground text-lg">{vendor.industry}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="glass hover:bg-white/10">
              <Mail className="mr-2 h-4 w-4" />
              Email
            </Button>
            <Button variant="outline" className="glass hover:bg-white/10">
              <FileDown className="mr-2 h-4 w-4" />
              Export
            </Button>
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_20px_rgba(124,58,237,0.3)]">
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </Button>
          </div>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 animate-slide-up" style={{ animationDelay: '0.1s' }}>
        {/* Vendor Info */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Vendor Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {vendor.website && (
              <div>
                <div className="text-sm text-muted-foreground mb-1">Website</div>
                <a
                  href={vendor.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline flex items-center gap-1"
                >
                  {vendor.website}
                </a>
              </div>
            )}
            {vendor.email_domains && vendor.email_domains.length > 0 && (
              <div>
                <div className="text-sm text-muted-foreground mb-2">Email Domains</div>
                <div className="flex flex-wrap gap-2">
                  {vendor.email_domains.map((domain, index) => (
                    <Badge key={index} variant="outline" className="glass border-white/10">
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
                <p className="text-sm text-muted-foreground/80 leading-relaxed bg-white/5 p-3 rounded-lg border border-white/5">{vendor.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Stats */}
        <div className="space-y-4">
          <Card className="glass-card overflow-hidden relative">
            <div className="absolute top-0 right-0 p-3 opacity-10">
              <TrendingUp className="h-24 w-24 text-primary" />
            </div>
            <CardContent className="pt-6 relative z-10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Deals</p>
                  <p className="text-3xl font-bold mt-1">{totalDeals}</p>
                </div>
                <div className="p-3 bg-primary/10 rounded-full">
                  <TrendingUp className="h-6 w-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card overflow-hidden relative">
            <div className="absolute top-0 right-0 p-3 opacity-10">
              <DollarSign className="h-24 w-24 text-green-500" />
            </div>
            <CardContent className="pt-6 relative z-10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Value</p>
                  <p className="text-3xl font-bold mt-1 text-green-500">{formatCurrency(totalValue)}</p>
                </div>
                <div className="p-3 bg-green-500/10 rounded-full">
                  <DollarSign className="h-6 w-6 text-green-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card overflow-hidden relative">
            <div className="absolute top-0 right-0 p-3 opacity-10">
              <DollarSign className="h-24 w-24 text-blue-500" />
            </div>
            <CardContent className="pt-6 relative z-10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Avg Deal Size</p>
                  <p className="text-3xl font-bold mt-1 text-blue-500">{formatCurrency(avgDealSize)}</p>
                </div>
                <div className="p-3 bg-blue-500/10 rounded-full">
                  <DollarSign className="h-6 w-6 text-blue-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Tabs */}
      <Card className="glass-panel animate-slide-up" style={{ animationDelay: '0.2s' }}>
        <CardHeader>
          <div className="flex gap-6 border-b border-white/10 w-full relative">
            <button
              className={`pb-3 px-2 font-medium transition-all relative ${activeTab === 'deals'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
                }`}
              onClick={() => setActiveTab('deals')}
            >
              Deals ({totalDeals})
              {activeTab === 'deals' && (
                <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary rounded-t-full shadow-[0_0_10px_rgba(124,58,237,0.5)]" />
              )}
            </button>
            <button
              className={`pb-3 px-2 font-medium transition-all relative ${activeTab === 'contacts'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
                }`}
              onClick={() => setActiveTab('contacts')}
            >
              Contacts ({contacts?.length || 0})
              {activeTab === 'contacts' && (
                <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary rounded-t-full shadow-[0_0_10px_rgba(124,58,237,0.5)]" />
              )}
            </button>
            <button
              className={`pb-3 px-2 font-medium transition-all relative ${activeTab === 'timeline'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
                }`}
              onClick={() => setActiveTab('timeline')}
            >
              Timeline
              {activeTab === 'timeline' && (
                <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary rounded-t-full shadow-[0_0_10px_rgba(124,58,237,0.5)]" />
              )}
            </button>
          </div>
        </CardHeader>

        <CardContent className="p-6">
          {/* Deals Tab */}
          {activeTab === 'deals' && (
            <div className="animate-fade-in">
              <div className="flex justify-end mb-6">
                <DealCreateDialog
                  preselectedVendorId={id}
                  trigger={
                    <Button size="sm" className="bg-primary hover:bg-primary/90">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Deal
                    </Button>
                  }
                />
              </div>
              {dealsLoading ? (
                <div className="text-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                </div>
              ) : !deals || deals.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p className="mb-4">No deals registered yet</p>
                  <DealCreateDialog
                    preselectedVendorId={id}
                    trigger={
                      <Button size="sm" variant="outline" className="glass hover:bg-white/10">
                        <Plus className="mr-2 h-4 w-4" />
                        Create First Deal
                      </Button>
                    }
                  />
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {deals.map((deal) => (
                    <div
                      key={deal.id}
                      className="p-4 rounded-xl glass-card hover:border-primary/30 transition-all group"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold truncate group-hover:text-primary transition-colors">{deal.deal_name}</h4>
                          {deal.customer_name && (
                            <p className="text-sm text-muted-foreground truncate">
                              Customer: {deal.customer_name}
                            </p>
                          )}
                        </div>
                        <Badge
                          className="glass border-white/10"
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

                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg">
                          <span className="text-muted-foreground">Value</span>
                          <p className="font-bold text-green-400">
                            {formatCurrency(deal.deal_value, deal.currency)}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {deal.deal_stage && (
                            <div className="bg-white/5 p-2 rounded-lg">
                              <span className="text-xs text-muted-foreground block mb-0.5">Stage</span>
                              <p className="font-medium truncate">{deal.deal_stage}</p>
                            </div>
                          )}
                          {deal.probability !== null && deal.probability !== undefined && (
                            <div className="bg-white/5 p-2 rounded-lg">
                              <span className="text-xs text-muted-foreground block mb-0.5">Probability</span>
                              <p className="font-medium">{deal.probability}%</p>
                            </div>
                          )}
                        </div>
                        {deal.expected_close_date && (
                          <div className="flex justify-between items-center pt-1 px-1">
                            <span className="text-muted-foreground text-xs">Expected Close</span>
                            <p className="font-medium text-xs">
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
            <div className="animate-fade-in">
              {contactsLoading ? (
                <div className="text-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                </div>
              ) : !contacts || contacts.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No contacts added yet
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {contacts.map((contact) => (
                    <div
                      key={contact.id}
                      className="p-4 rounded-xl glass-card hover:border-primary/30 transition-all flex flex-col"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                            {contact.name.charAt(0)}
                          </div>
                          <div>
                            <h4 className="font-semibold">{contact.name}</h4>
                            {contact.role && (
                              <p className="text-xs text-muted-foreground">
                                {contact.role}
                              </p>
                            )}
                          </div>
                        </div>
                        {contact.is_primary && (
                          <Badge variant="default" className="text-[10px] h-5">
                            Primary
                          </Badge>
                        )}
                      </div>

                      <div className="space-y-2 text-sm mt-auto">
                        {contact.email && (
                          <div className="flex items-center gap-2 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            <a
                              href={`mailto:${contact.email}`}
                              className="text-primary hover:underline truncate"
                            >
                              {contact.email}
                            </a>
                          </div>
                        )}
                        {contact.phone && (
                          <div className="flex items-center gap-2 p-2 rounded-lg bg-white/5">
                            <span className="text-muted-foreground text-xs">Ph:</span>
                            <p className="text-muted-foreground">{contact.phone}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Timeline Tab */}
          {activeTab === 'timeline' && (
            <div className="text-center py-12 animate-fade-in">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-white/5 mb-4">
                <Calendar className="h-8 w-8 text-muted-foreground opacity-50" />
              </div>
              <p className="text-lg font-medium text-muted-foreground">Timeline feature coming soon</p>
              <p className="text-sm text-muted-foreground/60">Track all interactions and deal history</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
