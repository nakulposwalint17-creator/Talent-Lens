import { Compass } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <Card className="mt-10">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you were looking for doesn't exist."
        action={
          <Button variant="primary" asChild>
            <Link href="/">Go to overview</Link>
          </Button>
        }
      />
    </Card>
  );
}
