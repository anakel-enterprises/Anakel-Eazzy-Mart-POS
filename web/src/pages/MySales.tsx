import { useAuth } from "../context/AuthContext";
import { SalesHistoryPanel } from "../components/SalesHistoryPanel";
import { Topbar } from "../components/Topbar";

// Self-service sales history — every employee's own "what have I sold and
// to whom", independent of VIEW_REPORTS (that's store-wide reporting; this
// is scoped to just the signed-in user). GET /api/sales enforces the same
// self-only scoping server-side, so this page isn't the only thing
// preventing one employee from seeing another's history.
export function MySales() {
  const { user } = useAuth();

  return (
    <>
      <Topbar title="My Sales" subtitle="Everything you've personally sold, and to whom" />
      <div className="flex flex-1 flex-col gap-6 overflow-auto p-4 sm:p-6 lg:p-8">
        {user && (
          <SalesHistoryPanel cashierId={user.id} employeeName={user.name} description="Your complete sales history" />
        )}
      </div>
    </>
  );
}
