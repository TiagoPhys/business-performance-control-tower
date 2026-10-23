import { createBrowserRouter, Link, RouterProvider } from "react-router";
import { AppLayout, PageHeader } from "@/components/layout/AppLayout";
import { LoadingState } from "@/components/states/States";
import { Button } from "@/components/ui/button";

function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" description="The address does not match any page of the control tower." />
      <Button asChild variant="outline">
        <Link to="/">Go to the overview</Link>
      </Button>
    </>
  );
}

// Pages are code-split so the first load only fetches what it shows.
export const routes = [
  {
    path: "/",
    element: <AppLayout />,
    hydrateFallbackElement: (
      <div className="p-6">
        <LoadingState label="Loading the control tower" />
      </div>
    ),
    children: [
      { index: true, lazy: () => import("@/pages/OverviewPage").then((m) => ({ Component: m.OverviewPage })) },
      { path: "drivers", lazy: () => import("@/pages/DriversPage").then((m) => ({ Component: m.DriversPage })) },
      { path: "products", lazy: () => import("@/pages/ProductsPage").then((m) => ({ Component: m.ProductsPage })) },
      { path: "operations", lazy: () => import("@/pages/OperationsPage").then((m) => ({ Component: m.OperationsPage })) },
      { path: "actions", lazy: () => import("@/pages/ActionPlanPage").then((m) => ({ Component: m.ActionPlanPage })) },
      {
        path: "methodology",
        lazy: () => import("@/pages/MethodologyPage").then((m) => ({ Component: m.MethodologyPage })),
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

const router = createBrowserRouter(routes);

export function App() {
  return <RouterProvider router={router} />;
}
