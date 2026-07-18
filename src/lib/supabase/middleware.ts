import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Sidor som är åtkomliga utan inloggning. */
const PUBLIC_PATHS = ["/login", "/register", "/auth"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Uppdaterar Supabase-sessionen (roterar tokens) och skyddar routes.
 * Körs från src/middleware.ts på varje request.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Viktigt: getUser() validerar tokenet mot Supabase och roterar vid behov.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Inte inloggad + skyddad sida -> till /login (spara mål i ?next=)
  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // Inloggad men på login/register -> till /groups
  if (
    user &&
    (pathname === "/login" || pathname === "/register")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/groups";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
