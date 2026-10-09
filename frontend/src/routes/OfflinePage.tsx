import { CloudOff, RefreshCw, ShoppingCart } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "../components/ui/Button";

export function OfflinePage() {
  return (
    <main className="offline-page">
      <div className="offline-card">
        <span>
          <CloudOff size={30} />
        </span>
        <p className="eyebrow">RetailOps BD</p>
        <h1>You’re offline</h1>
        <p>
          The app shell and POS catalog stay on this device. Sign in once while
          online, then you can continue selling and sync later.
        </p>
        <div>
          <Button asChild>
            <Link to="/pos">
              <ShoppingCart size={16} /> Open POS
            </Link>
          </Button>
          <Button onClick={() => location.reload()} variant="secondary">
            <RefreshCw size={16} /> Try again
          </Button>
        </div>
      </div>
    </main>
  );
}
