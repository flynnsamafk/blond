import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

import { NavBar } from "./NavBar";

export async function Header() {
  let signedIn = false;
  if (env.isConfigured) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data.user);
  }

  return <NavBar signedIn={signedIn} />;
}
