"use client";

import { useActionState } from "react";
import { ACCEPT, ATTACH_LIMITS } from "@/lib/attachments/rules";
import { LIMITS } from "@/lib/guard/input";
export interface ReportState {
  error?: string;
  title: string;
  body: string;
}

const initial: ReportState = { title: "", body: "" };

export function ReportForm({ action, needsCode }: { action: (prev: ReportState, formData: FormData) => Promise<ReportState>; needsCode?: boolean }) {
  const [state, formAction, pending] = useActionState(action, initial);
  const maxMb = ATTACH_LIMITS.maxBytes / 1024 / 1024;
  return (
    <>
      {state.error && (
        <p id="form-error" role="alert" className="alert-bad mb-4">
          {state.error}
        </p>
      )}
      <form action={formAction} className="card flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="title" className="label">
            Title
          </label>
          <input id="title" name="title" required maxLength={LIMITS.title.max} defaultValue={state.title} className="field" aria-describedby="title-hint" />
          <p id="title-hint" className="hint">
            A short summary, for example “Score does not update after a match”.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="body" className="label">
            What happened?
          </label>
          <textarea id="body" name="body" required rows={6} maxLength={LIMITS.body.max} defaultValue={state.body} className="field" aria-describedby="body-hint" />
          <p id="body-hint" className="hint">
            What you did, what you expected and what you saw instead.
          </p>
        </div>
        {needsCode && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="code" className="label">
              Access code
            </label>
            <input id="code" name="code" required autoComplete="off" className="field" aria-describedby="code-hint" />
            <p id="code-hint" className="hint">
              The code the maintainer shared with the group. It keeps spam out.
            </p>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="files" className="label">
            Documents <span className="font-normal text-[var(--muted)]">(optional)</span>
          </label>
          <input
            id="files"
            name="files"
            type="file"
            multiple
            accept={ACCEPT}
            aria-describedby="files-hint"
            className="field cursor-pointer border-dashed bg-[var(--bg)] p-3 file:mr-4 file:min-h-10 file:cursor-pointer file:rounded-md file:border-0 file:bg-[var(--accent)] file:px-4 file:font-semibold file:text-white"
          />
          <p id="files-hint" className="hint">
            Screenshots, PDFs, Word documents or text logs. Up to {ATTACH_LIMITS.maxFiles} files, {maxMb} MB each. Screenshots (PNG or JPEG, up to 3 MB) are read automatically and added to the ticket; PDFs, Word documents and text logs are stored with the ticket but not read yet. Documents must be chosen again after an error.
          </p>
        </div>
        <button type="submit" disabled={pending} className="btn btn-primary self-start">
          {pending ? "Sending…" : "Send report"}
        </button>
      </form>
    </>
  );
}
