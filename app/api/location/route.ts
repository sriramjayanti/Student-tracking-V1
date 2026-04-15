import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { LocationPingRequest } from '@/lib/types'

// POST /api/location — receive GPS ping from driver phone
export async function POST(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body: LocationPingRequest = await request.json()
  const { bus_id, trip_session_id, latitude, longitude, accuracy, speed, heading, altitude } = body

  if (!bus_id || latitude == null || longitude == null) {
    return NextResponse.json({ error: 'bus_id, latitude, and longitude are required' }, { status: 400 })
  }

  // Verify driver is assigned to this bus
  const { data: driver } = await supabase
    .from('drivers')
    .select('bus_id')
    .eq('id', user.id)
    .single()

  if (driver?.bus_id !== bus_id) {
    return NextResponse.json({ error: 'Bus not assigned to this driver' }, { status: 403 })
  }

  // Insert location ping
  const { error: insertError } = await supabase
    .from('bus_locations')
    .insert({
      bus_id,
      trip_session_id: trip_session_id ?? null,
      latitude,
      longitude,
      accuracy: accuracy ?? null,
      speed: speed ?? null,
      heading: heading ?? null,
      altitude: altitude ?? null,
      recorded_at: new Date().toISOString(),
    })

  if (insertError) {
    console.error('[Location] Insert error:', insertError)
    return NextResponse.json({ error: 'Failed to record location' }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}

// GET /api/location?bus_id=&limit=  — latest N pings for a bus
export async function GET(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const bus_id = searchParams.get('bus_id')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '1', 10), 100)
  const trip_session_id = searchParams.get('trip_session_id')

  if (!bus_id) {
    return NextResponse.json({ error: 'bus_id is required' }, { status: 400 })
  }

  let query = supabase
    .from('bus_locations')
    .select('*')
    .eq('bus_id', bus_id)
    .order('recorded_at', { ascending: false })
    .limit(limit)

  if (trip_session_id) {
    query = query.eq('trip_session_id', trip_session_id)
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ locations: data })
}
