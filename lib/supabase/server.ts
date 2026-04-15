import { createServerClient, type CookieMethodsServer } from '@supabase/ssr'
import { cookies } from 'next/headers'

type SupabaseCookie = Parameters<NonNullable<CookieMethodsServer['setAll']>>[0][number]

function applyCookies(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  cookiesToSet: SupabaseCookie[]
) {
  cookiesToSet.forEach(({ name, value, options }) => {
    cookieStore.set(name, value, options)
  })
}

function createCookieMethods(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return {
    getAll() {
      return cookieStore.getAll()
    },
    setAll(cookiesToSet: SupabaseCookie[]) {
      try {
        applyCookies(cookieStore, cookiesToSet)
      } catch {
        // Server Components cannot always mutate cookies during render.
      }
    },
  }
}

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: createCookieMethods(cookieStore),
    }
  )
}

/** Service-role client: bypasses RLS. Use only in trusted server contexts. */
export async function createAdminClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: createCookieMethods(cookieStore),
    }
  )
}
