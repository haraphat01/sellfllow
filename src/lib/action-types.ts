/** Client-safe action result shapes (lib/actions.ts is server-only). */
export type FormState =
  | { ok?: boolean; error?: string; message?: string; fieldErrors?: Record<string, string[] | undefined>; data?: Record<string, unknown> }
  | undefined;

export type ActionResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };
