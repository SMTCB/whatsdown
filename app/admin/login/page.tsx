import { Shell } from "@/components/shell";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <Shell>
      <div className="mx-auto max-w-sm">
        <h1 className="mb-1 text-3xl font-semibold">Owner sign-in</h1>
        <p className="hint mb-6">For the maintainer only. Reporting a problem does not need an account.</p>
        <LoginForm next={next ?? ""} />
      </div>
    </Shell>
  );
}
