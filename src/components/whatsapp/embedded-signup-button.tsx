"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { connectEmbeddedSignupAction } from "@/app/(app)/settings/whatsapp/actions";
import { Button } from "@/components/ui/button";

type FBLoginResponse = { authResponse?: { code?: string } | null; status?: string };
type FBSdk = {
  init: (opts: Record<string, unknown>) => void;
  login: (cb: (r: FBLoginResponse) => void, opts: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    FB?: FBSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";

function loadSdk(appId: string, version: string): Promise<FBSdk> {
  return new Promise((resolve, reject) => {
    if (window.FB) return resolve(window.FB);
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB!);
    };
    const s = document.createElement("script");
    s.src = SDK_SRC;
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("Couldn't load Facebook's SDK. Check ad blockers or your connection."));
    document.body.appendChild(s);
  });
}

/**
 * Meta Embedded Signup (v4). The popup returns a short-lived code via
 * FB.login, and the WABA / phone number IDs via a window message. We forward
 * both to the server as soon as we have them — the code expires in ~30s.
 */
export function EmbeddedSignupButton({ appId, configId, graphVersion }: { appId: string; configId: string; graphVersion: string }) {
  const [pending, setPending] = useState(false);
  const session = useRef<{ wabaId?: string; phoneNumberId?: string }>({});
  const code = useRef<string | null>(null);
  const submitted = useRef(false);

  async function trySubmit() {
    if (submitted.current || !code.current || !session.current.wabaId || !session.current.phoneNumberId) return;
    submitted.current = true;
    const res = await connectEmbeddedSignupAction({
      code: code.current,
      wabaId: session.current.wabaId,
      phoneNumberId: session.current.phoneNumberId,
    });
    setPending(false);
    if (res.ok) toast.success(res.message ?? "WhatsApp connected");
    else toast.error(res.error);
  }

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      let host = "";
      try {
        host = new URL(event.origin).hostname;
      } catch {
        return;
      }
      if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return;
      let data: { type?: string; event?: string; data?: Record<string, string> };
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;

      if (data.event === "FINISH" || data.event === "FINISH_ONLY_WABA") {
        session.current = { wabaId: data.data?.waba_id, phoneNumberId: data.data?.phone_number_id };
        if (!session.current.phoneNumberId) {
          setPending(false);
          toast.error("No phone number was added in Meta's setup. Add a number and try again.");
          return;
        }
        void trySubmit();
      } else if (data.event === "CANCEL") {
        setPending(false);
        toast.message("WhatsApp setup was cancelled.");
      } else if (data.event === "ERROR") {
        setPending(false);
        toast.error(data.data?.error_message ?? "Meta reported an error during setup.");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function start() {
    setPending(true);
    submitted.current = false;
    code.current = null;
    session.current = {};
    try {
      const FB = await loadSdk(appId, graphVersion);
      FB.login(
        (response) => {
          const c = response.authResponse?.code;
          if (!c) {
            setPending(false);
            return;
          }
          code.current = c;
          void trySubmit();
        },
        { config_id: configId, response_type: "code", override_default_response_type: true, extras: { setup: {} } },
      );
    } catch (err) {
      setPending(false);
      toast.error(err instanceof Error ? err.message : "Couldn't start WhatsApp setup.");
    }
  }

  return (
    <Button size="lg" onClick={start} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <MessageCircle />} Connect WhatsApp
    </Button>
  );
}
