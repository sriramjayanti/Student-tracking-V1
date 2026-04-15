import { createServerClient, type CookieMethodsServer } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

type SupabaseCookie = Parameters<NonNullable<CookieMethodsServer['setAll']>>[0][number]

const PUBLIC_ROUTES = ['/login', '/api/auth', '/api/health']
const ROLE_ROUTES: Record<string, string[]> = {
  '/parent': ['parent', 'admin'],
  '/driver': ['driver', 'admin'],
  '/admin': ['admin'],
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: SupabaseCookie[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // Refresh session — important: do not add logic between this and getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Allow public routes
  if (PUBLIC_ROUTES.some((r) => pathname.startsWith(r))) {
    // If already logged in, redirect away from /login
    if (user && pathname === '/login') {
      return redirectByRole(user, request)
    }
    return supabaseResponse
  }

  // Require auth for everything else
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Role-based access control
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = profile?.role ?? 'parent'

  for (const [routePrefix, allowedRoles] of Object.entries(ROLE_ROUTES)) {
    if (pathname.startsWith(routePrefix) && !allowedRoles.includes(role)) {
      return redirectByRole({ ...user, role } as any, request)
    }
  }

  return supabaseResponse
}

function redirectByRole(user: { role?: string }, request: NextRequest) {
  const role = (user as any).role
  const dest =
    role === 'admin' ? '/admin' :
    role === 'driver' ? '/driver' :
    '/parent'
  return NextResponse.redirect(new URL(dest, request.url))
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
