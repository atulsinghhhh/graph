import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED = ['/integrations', '/sync', '/chat', '/incidents'];

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { pathname } = request.nextUrl;

  // Dev mode: skip auth entirely so demo data is accessible without login
  if (process.env.NODE_ENV === 'development') {
    return supabaseResponse;
  }

  const { data: { user } } = await supabase.auth.getUser();

  const isProtected = PROTECTED.some(p => pathname === p || pathname.startsWith(p + '/'));

  if (!user && isProtected) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/integrations', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
