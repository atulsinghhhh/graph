import Sidebar from '@/components/Sidebar';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let email = '';
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    email = user?.email ?? '';
  } catch {
    // non-fatal — sidebar will show no email
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar email={email} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
