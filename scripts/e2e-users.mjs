#!/usr/bin/env node
// Creates / removes confirmed throwaway users for manual E2E testing against a
// Supabase project (no confirmation emails are sent).
//   node --env-file=.env scripts/e2e-users.mjs create
//   node --env-file=.env scripts/e2e-users.mjs cleanup   # deletes sellflow-e2e-* users and businesses they own
import { randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const PREFIX = "sellflow-e2e-";

async function create() {
  const tag = Date.now().toString(36);
  const password = `Test-${randomBytes(6).toString("hex")}9`;
  const users = [];
  for (const [role, name] of [["owner", "Aisha Bello"], ["staff", "Tunde Staff"]]) {
    const email = `${PREFIX}${role}-${tag}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
    if (error) throw error;
    users.push({ role, email, id: data.user.id });
  }
  console.log(JSON.stringify({ password, users }));
}

async function cleanup() {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const victims = data.users.filter((u) => u.email?.startsWith(PREFIX));
  for (const u of victims) {
    const { data: owned } = await admin.from("business_members").select("business_id").eq("user_id", u.id).eq("role", "owner");
    for (const { business_id } of owned ?? []) {
      const { data: files } = await admin.storage.from("product-images").list(business_id, { limit: 1000 });
      for (const dir of files ?? []) {
        const { data: imgs } = await admin.storage.from("product-images").list(`${business_id}/${dir.name}`);
        if (imgs?.length) await admin.storage.from("product-images").remove(imgs.map((f) => `${business_id}/${dir.name}/${f.name}`));
      }
      await admin.from("orders").delete().eq("business_id", business_id);
      await admin.from("businesses").delete().eq("id", business_id);
    }
    await admin.auth.admin.deleteUser(u.id);
  }
  console.log(`removed ${victims.length} e2e users`);
}

await ({ create, cleanup }[process.argv[2]] ?? (() => console.error("usage: create | cleanup")))();
