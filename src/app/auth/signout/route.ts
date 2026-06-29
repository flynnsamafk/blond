import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (env.isConfigured) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  // 303 so the browser follows with a GET.
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
