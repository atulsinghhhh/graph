import Sidebar from '@/components/Sidebar';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-zinc-50 overflow-hidden">
      <Sidebar email="dev@demo.local" />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
