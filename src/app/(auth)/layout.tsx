export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">SIMS</h1>
          <p className="text-sm text-muted-foreground">Student Information Management System</p>
        </div>
        {children}
      </div>
    </main>
  );
}
