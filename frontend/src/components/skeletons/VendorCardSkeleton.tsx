import { Card, CardContent, CardHeader } from '@/components/ui/card';

interface VendorCardSkeletonProps {
  count?: number;
}

export function VendorCardSkeleton({ count = 6 }: VendorCardSkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <Card key={index} className="animate-pulse">
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 space-y-2">
                <div className="h-5 w-3/4 bg-muted rounded"></div>
                <div className="h-4 w-1/2 bg-muted rounded"></div>
              </div>
              <div className="h-6 w-16 bg-muted rounded-full"></div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 bg-muted rounded"></div>
                <div className="h-4 w-32 bg-muted rounded"></div>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 bg-muted rounded"></div>
                <div className="h-4 w-40 bg-muted rounded"></div>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 bg-muted rounded"></div>
                <div className="h-4 w-24 bg-muted rounded"></div>
              </div>
            </div>
            <div className="pt-3 border-t">
              <div className="h-8 w-full bg-muted rounded"></div>
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  );
}
