import { Card, CardContent, CardHeader } from '@/components/ui/card';

interface ActivityListSkeletonProps {
  items?: number;
}

export function ActivityListSkeleton({ items = 5 }: ActivityListSkeletonProps) {
  return (
    <Card className="animate-pulse">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="h-5 w-32 bg-muted rounded"></div>
          <div className="h-8 w-20 bg-muted rounded"></div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Array.from({ length: items }).map((_, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 border rounded-lg"
            >
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 bg-muted rounded"></div>
                <div className="flex gap-2">
                  <div className="h-3 w-16 bg-muted rounded"></div>
                  <div className="h-3 w-1 bg-muted rounded"></div>
                  <div className="h-3 w-20 bg-muted rounded"></div>
                </div>
              </div>
              <div className="h-6 w-20 bg-muted rounded-full"></div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
