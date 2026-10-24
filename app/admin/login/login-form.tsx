"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "../actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  return (
    <form action={action} className="card flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />
      {state.error && (
        <p role="alert" className="alert-bad">
          {state.error}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="label">
          Password
        </label>
        <input id="password" name="password" type="password" required autoComplete="current-password" autoFocus className="field" />
      </div>
      <button type="submit" disabled={pending} className="btn btn-primary self-start">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
