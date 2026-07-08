import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { SidebarProvider } from "../context/SidebarContext";

export function Layout() {
  return (
    <SidebarProvider>
      <div className="flex h-screen bg-brand-surface">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Outlet />
        </div>
      </div>
    </SidebarProvider>
  );
}
