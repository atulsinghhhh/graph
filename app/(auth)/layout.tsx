export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // The login page renders its own full-screen split layout, so the auth
  // layout is just a neutral full-height wrapper.
  return <div className="min-h-screen bg-background">{children}</div>;
}
