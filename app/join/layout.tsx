export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: '#f9fafb' }}
    >
      {children}
    </div>
  );
}
