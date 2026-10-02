"use client";

import { useActionState, useTransition } from "react";

import type { FormState } from "@/lib/action-types";

/**
 * useActionState without React 19's automatic form reset: when an action
 * returns validation errors the user's input stays in place. Spread
 * `formProps` onto the <form>.
 *
 * `action` is set too, so a submit before hydration (slow network, dev
 * compile) is still a POST to the server action — never the browser's
 * default GET, which would put every field (including secrets) in the URL.
 * Once hydrated, `onSubmit` takes over and React doesn't run the action itself.
 */
export function useFormAction(action: (state: FormState, form: FormData) => Promise<FormState>) {
  const [state, dispatch, pending] = useActionState(action, undefined);
  const [, startTransition] = useTransition();

  const formProps = {
    action: dispatch,
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const data = new FormData(e.currentTarget);
      startTransition(() => dispatch(data));
    },
  };

  return { state, pending, formProps };
}
