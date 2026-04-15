'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import QRScanner from '@/components/qr/QRScanner'
import type { TripSession, Student, BusLocation } from '@/lib/types'
import { getStatusLabel, getStatusColor } from '@/lib/types'

const BusMap = dynamic(() => import('@/components/map/BusMap'), { ssr: false })

type Tab = 'scan' | 'students' | 'map'

export default function DriverDashboard() {
  const supabase = createClient()

  const [driver, setDriver]               = useState<any>(null)
  const [activeTrip, setActiveTrip]       = useState<TripSession | null>(null)
  const [students, setStudents]           = useState<Student[]>([])
  const [currentLocation, setCurrentLocation] = useState<BusLocation | null>(null)
  const [tab, setTab]                     = useState<Tab>('scan')
  const [loading, setLoading]             = useState(true)
  const [tripLoading, setTripLoading]     = useState(false)
  const [scanFeedback, setScanFeedback]   = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [gpsStatus, setGpsStatus]         = useState<'off' | 'active' | 'error'>('off')

  const gpsWatchRef = useRef<number | null>(null)
  const GPS_INTERVAL_MS = 7000

  // ── Load driver profile and active trip ──────────────────────────────────
  const loadDriver = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: driverData } = await supabase
      .from('drivers')
      .select('*, user:users(*), bus:buses(*, routes:bus_route_assignments(*, route:routes(*)))')
      .eq('id', user.id)
      .single()

    if (driverData) {
      setDriver(driverData)

      // Check for active trip today
      const today = new Date().toISOString().split('T')[0]
      const { data: trip } = await supabase
        .from('trip_sessions')
        .select('*, bus:buses(*), route:routes(*)')
        .eq('driver_id', user.id)
        .eq('status', 'active')
        .eq('trip_date', today)
        .single()

      if (trip) {
        setActiveTrip(trip as any)
        startGPS(trip.id, driverData.bus_id)
      }

      // Students on this bus
      if (driverData.bus_id) {
        const { data: studs } = await supabase
          .from('students')
          .select('*, student_stop_assignments(*, stop:stops(*))')
          .eq('bus_id', driverData.bus_id)
          .eq('is_active', true)
          .order('full_name')

        if (studs) setStudents(studs as any)
      }
    }

    setLoading(false)
  }, [supabase])

  useEffect(() => {
    loadDriver()
    return () => stopGPS()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── GPS tracking ──────────────────────────────────────────────────────────
  function startGPS(tripSessionId: string, busId: string) {
    if (!('geolocation' in navigator)) {
      setGpsStatus('error')
      return
    }

    let lastSent = 0

    gpsWatchRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const now = Date.now()
        if (now - lastSent < GPS_INTERVAL_MS) return
        lastSent = now

        const locData: BusLocation = {
          id: '',
          bus_id: busId,
          trip_session_id: tripSessionId,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed ? pos.coords.speed * 3.6 : null, // m/s → km/h
          heading: pos.coords.heading,
          altitude: pos.coords.altitude,
          recorded_at: new Date().toISOString(),
        }
        setCurrentLocation(locData)
        setGpsStatus('active')

        await fetch('/api/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bus_id: busId,
            trip_session_id: tripSessionId,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            speed: locData.speed,
            heading: pos.coords.heading,
            altitude: pos.coords.altitude,
          }),
        })
      },
      (err) => {
        console.error('[GPS]', err)
        setGpsStatus('error')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    )
  }

  function stopGPS() {
    if (gpsWatchRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchRef.current)
      gpsWatchRef.current = null
    }
    setGpsStatus('off')
  }

  // ── Start / end trip ──────────────────────────────────────────────────────
  async function handleStartTrip(tripType: 'morning' | 'evening') {
    if (!driver?.bus_id) return
    setTripLoading(true)

    const routeId = driver.bus?.routes?.[0]?.route_id
    if (!routeId) {
      alert('No route assigned to your bus. Please contact admin.')
      setTripLoading(false)
      return
    }

    const res = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bus_id: driver.bus_id, route_id: routeId, trip_type: tripType }),
    })

    const data = await res.json()
    if (!res.ok) {
      alert(data.error ?? 'Failed to start trip')
      setTripLoading(false)
      return
    }

    setActiveTrip(data.trip_session)
    startGPS(data.trip_session.id, driver.bus_id)
    setTripLoading(false)
  }

  async function handleEndTrip() {
    if (!activeTrip) return
    if (!confirm('End this trip? This cannot be undone.')) return
    setTripLoading(true)

    const res = await fetch('/api/trips', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trip_session_id: activeTrip.id, action: 'end' }),
    })

    if (res.ok) {
      stopGPS()
      setActiveTrip(null)
      setCurrentLocation(null)
      // Reset student statuses for next trip
      await loadDriver()
    }
    setTripLoading(false)
  }

  // ── QR scan handler ───────────────────────────────────────────────────────
  async function handleScan(qrCode: string) {
    if (!activeTrip) throw new Error('No active trip. Please start a trip first.')

    const pos = await new Promise<GeolocationPosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 3000 })
    })

    const res = await fetch('/api/scans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        qr_code: qrCode,
        trip_session_id: activeTrip.id,
        scanner_latitude: pos?.coords.latitude,
        scanner_longitude: pos?.coords.longitude,
        scanner_accuracy: pos?.coords.accuracy,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      setScanFeedback({ type: 'error', message: data.error })
      setTimeout(() => setScanFeedback(null), 4000)
      throw new Error(data.error)
    }

    setScanFeedback({
      type: 'success',
      message: `${data.student.full_name} — ${data.expected_scan_type.replace(/_/g, ' ')}`,
    })
    setTimeout(() => setScanFeedback(null), 3000)

    // Refresh student list to show updated status
    setStudents((prev) =>
      prev.map((s) =>
        s.id === data.student.id ? { ...s, current_status: data.student.current_status } : s
      )
    )
  }

  async function handleLogout() {
    stopGPS()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <svg className="animate-spin h-8 w-8 text-blue-600" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
          <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" className="opacity-75" />
        </svg>
      </div>
    )
  }

  const isTimeForMorning = new Date().getHours() < 13
  const canStartMorning  = !activeTrip && isTimeForMorning
  const canStartEvening  = !activeTrip && !isTimeForMorning

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Topbar */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
          <div>
            <p className="font-bold text-white text-base">SafeRide Driver</p>
            <p className="text-xs text-slate-400">{driver?.bus?.bus_number ?? '—'}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* GPS indicator */}
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${
                gpsStatus === 'active' ? 'bg-green-400 animate-pulse' :
                gpsStatus === 'error'  ? 'bg-red-400' : 'bg-slate-500'
              }`} />
              <span className="text-xs text-slate-400">GPS</span>
            </div>
            <button onClick={handleLogout} className="text-xs text-slate-400 hover:text-white">
              Exit
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
        {/* Trip control */}
        <div className="bg-slate-800 rounded-2xl p-4">
          {activeTrip ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide">Active Trip</p>
                  <p className="font-bold text-lg capitalize">
                    {activeTrip.trip_type} Trip
                  </p>
                  <p className="text-xs text-slate-400">
                    Started {new Date(activeTrip.started_at!).toLocaleTimeString('en-IN')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-sm text-green-400 font-semibold">LIVE</span>
                </div>
              </div>
              <button
                onClick={handleEndTrip}
                disabled={tripLoading}
                className="btn-danger w-full"
              >
                {tripLoading ? 'Ending…' : 'End Trip'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-400">No active trip. Start a trip to begin tracking.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleStartTrip('morning')}
                  disabled={tripLoading || !driver?.bus_id || !canStartMorning}
                  className="btn-primary flex-1"
                >
                  {tripLoading ? '…' : '🌅 Morning Trip'}
                </button>
                <button
                  onClick={() => handleStartTrip('evening')}
                  disabled={tripLoading || !driver?.bus_id || !canStartEvening}
                  className="btn-secondary flex-1 !text-slate-800"
                >
                  {tripLoading ? '…' : '🌆 Evening Trip'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Scan feedback toast */}
        {scanFeedback && (
          <div className={`rounded-2xl px-4 py-3 flex items-center gap-3 ${
            scanFeedback.type === 'success'
              ? 'bg-green-500/20 border border-green-500/30'
              : 'bg-red-500/20 border border-red-500/30'
          }`}>
            <span className="text-xl">{scanFeedback.type === 'success' ? '✅' : '❌'}</span>
            <p className={`text-sm font-medium ${
              scanFeedback.type === 'success' ? 'text-green-300' : 'text-red-300'
            }`}>
              {scanFeedback.message}
            </p>
          </div>
        )}

        {/* Tab navigation */}
        <div className="flex bg-slate-800 rounded-xl p-1">
          {(['scan', 'students', 'map'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-all ${
                tab === t
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t === 'scan' ? '📷 Scan' : t === 'students' ? '👥 Students' : '🗺️ Map'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'scan' && (
          <div>
            {!activeTrip ? (
              <div className="bg-slate-800 rounded-2xl p-8 text-center">
                <p className="text-slate-400 text-sm">Start a trip to enable QR scanning</p>
              </div>
            ) : (
              <QRScanner onScan={handleScan} isActive={tab === 'scan'} />
            )}
          </div>
        )}

        {tab === 'students' && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500 uppercase tracking-wide px-1">
              {students.length} students on this bus
            </p>
            {students.map((student) => (
              <div key={student.id} className="bg-slate-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-blue-900 flex items-center justify-center text-blue-300 font-bold flex-shrink-0">
                    {student.full_name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{student.full_name}</p>
                    <p className="text-xs text-slate-400">Class {student.class_name}</p>
                  </div>
                </div>
                <span className={`badge flex-shrink-0 ${getStatusColor(student.current_status)}`}>
                  {getStatusLabel(student.current_status)}
                </span>
              </div>
            ))}
            {students.length === 0 && (
              <div className="bg-slate-800 rounded-2xl p-6 text-center text-slate-400 text-sm">
                No students assigned to this bus
              </div>
            )}
          </div>
        )}

        {tab === 'map' && (
          <div className="bg-slate-800 rounded-2xl p-4">
            <BusMap busLocation={currentLocation} height="360px" />
            {currentLocation && (
              <p className="text-xs text-slate-500 text-center mt-2">
                {currentLocation.latitude.toFixed(5)}, {currentLocation.longitude.toFixed(5)}
                {currentLocation.speed != null && ` · ${Math.round(currentLocation.speed)} km/h`}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
