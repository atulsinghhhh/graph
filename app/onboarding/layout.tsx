export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-background px-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 50% 0%, rgba(99,102,241,0.16), transparent 60%)',
        }}
      />
      <div className="relative z-10 w-full flex justify-center">{children}</div>
    </div>
  );
}
