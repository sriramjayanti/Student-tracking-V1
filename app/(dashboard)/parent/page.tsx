'use client'

import { useEffect, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import StudentCard from '@/components/dashboard/StudentCard'
import NotificationPanel from '@/components/dashboard/NotificationPanel'
import type { StudentWithTracking, Notification, BusLocation } from '@/lib/types'

// Dynamic import — Leaflet requires browser APIs
const BusMap = dynamic(() => import('@/components/map/BusMap'), {
  ssr: false,
  loading: () => (
    <div className="h-80 rounded-2xl bg-slate-100 animate-pulse" />
  ),
})

export default function ParentDashboard() {
  const supabase = createClient()

  const [students, setStudents] = useState<StudentWithTracking[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [selectedStudent, setSelectedStudent] = useState<StudentWithTracking | null>(null)
  const [busLocation, setBusLocation] = useState<BusLocation | null>(null)
  const [locationHistory, setLocationHistory] = useState<BusLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [userName, setUserName] = useState('')

  // ── Initial load ──────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from('users')
      .select('full_name')
      .eq('id', user.id)
      .single()
    if (profile) setUserName(profile.full_name)

    // Students linked to this parent
    const { data: links } = await supabase
    
      .from('parent_student')
      .select(`
        student:students(
          *,
          bus:buses(*),
          student_stop_assignments(*, stop:stops(*))
        )
      `)
      .eq('parent_id', user.id)

    if (links && links.length > 0) {
      const enriched: StudentWithTracking[] = await Promise.all(
        links.map(async (link: any) => {
          const student = link.student

          // Latest scan for this student
          const { data: latestScan } = await supabase
            .from('scan_events')
            .select('*')
            .eq('student_id', student.id)
            .order('scanned_at', { ascending: false })
            .limit(1)
            .single()

          // Active trip for this student's bus
          const today = new Date().toISOString().split('T')[0]
          const { data: activeTrip } = await supabase
            .from('trip_sessions')
            .select('*')
            .eq('bus_id', student.bus_id)
            .eq('status', 'active')
            .eq('trip_date', today)
            .limit(1)
            .single()

          // Latest bus location
          let latestLocation: BusLocation | undefined
          if (student.bus_id) {
            const { data: loc } = await supabase
              .from('bus_locations')
              .select('*')
              .eq('bus_id', student.bus_id)
              .order('recorded_at', { ascending: false })
              .limit(1)
              .single()
            latestLocation = loc ?? undefined
          }

          const activeStop = student.student_stop_assignments?.find((a: any) => a.is_active)

          return {
            ...student,
            latest_scan: latestScan ?? undefined,
            active_trip: activeTrip ?? undefined,
            latest_location: latestLocation,
            assigned_stop: activeStop?.stop ?? undefined,
          }
        })
      )
      setStudents(enriched)
      if (enriched.length > 0) {
        setSelectedStudent(enriched[0])
        if (enriched[0].latest_location) {
          setBusLocation(enriched[0].latest_location)
        }
      }
    }

    // Notifications
    const { data: notifs } = await supabase
      .from('notifications')
      .select('*, student:students(id, full_name)', { count: 'exact' })
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30)

    if (notifs) setNotifications(notifs as any)
    setUnreadCount(
      (notifs ?? []).filter((n: any) => !n.is_read).length
    )

    setLoading(false)
  }, [supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ── Realtime subscriptions ─────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedStudent?.bus_id) return

    // Live bus location
    const locationSub = supabase
      .channel(`bus-location-${selectedStudent.bus_id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bus_locations',
          filter: `bus_id=eq.${selectedStudent.bus_id}`,
        },
        (payload) => {
          const loc = payload.new as BusLocation
          setBusLocation(loc)
          setLocationHistory((prev) => [loc, ...prev].slice(0, 60))
        }
      )
      .subscribe()

    // Student status updates
    const studentSub = supabase
      .channel(`student-status-${selectedStudent.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'students',
          filter: `id=eq.${selectedStudent.id}`,
        },
        (payload) => {
          const updated = payload.new as any
          setStudents((prev) =>
            prev.map((s) => s.id === updated.id ? { ...s, current_status: updated.current_status } : s)
          )
          setSelectedStudent((prev) =>
            prev && prev.id === updated.id
              ? { ...prev, current_status: updated.current_status }
              : prev
          )
        }
      )
      .subscribe()

    // New notifications
    const notifSub = supabase
      .channel('parent-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
        },
        (payload) => {
          const notif = payload.new as Notification
          setNotifications((prev) => [notif, ...prev])
          setUnreadCount((c) => c + 1)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(locationSub)
      supabase.removeChannel(studentSub)
      supabase.removeChannel(notifSub)
    }
  }, [selectedStudent?.bus_id, selectedStudent?.id, supabase])

  async function handleMarkAllRead() {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mark_all: true }),
    })
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    setUnreadCount(0)
  }

  async function handleMarkRead(id: string) {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notification_ids: [id] }),
    })
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n))
    setUnreadCount((c) => Math.max(0, c - 1))
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-10 w-10 text-blue-600 mx-auto mb-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" className="opacity-75" />
          </svg>
          <p className="text-slate-500 text-sm">Loading your dashboard…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Topbar */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <span className="font-bold text-slate-800 text-base">SafeRide</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <svg className="h-5 w-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </div>
            <button
              onClick={handleLogout}
              className="text-xs text-slate-500 hover:text-slate-700 font-medium"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Greeting */}
        <div>
          <h1 className="text-xl font-bold text-slate-800">
            Hello, {userName.split(' ')[0]} 👋
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>

        {/* Student selector tabs (if multiple children) */}
        {students.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {students.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSelectedStudent(s)
                  setBusLocation(s.latest_location ?? null)
                }}
                className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  selectedStudent?.id === s.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {s.full_name.split(' ')[0]}
              </button>
            ))}
          </div>
        )}

        {/* Student cards */}
        <div className="space-y-4">
          {students.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-slate-500">No students linked to your account.</p>
              <p className="text-xs text-slate-400 mt-1">Please contact your school administrator.</p>
            </div>
          ) : (
            students.map((student) => (
              <StudentCard
                key={student.id}
                student={student}
                onViewMap={
                  student.active_trip
                    ? () => {
                        setSelectedStudent(student)
                        setBusLocation(student.latest_location ?? null)
                        document.getElementById('live-map')?.scrollIntoView({ behavior: 'smooth' })
                      }
                    : undefined
                }
              />
            ))
          )}
        </div>

        {/* Live Map */}
        {selectedStudent?.bus_id && (
          <div id="live-map" className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-slate-800">Live Bus Location</h2>
              {busLocation && (
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-xs text-green-600 font-medium">Live</span>
                </div>
              )}
            </div>
            <BusMap
              busLocation={busLocation}
              locationHistory={locationHistory}
              stops={selectedStudent.assigned_stop ? [selectedStudent.assigned_stop] : []}
              height="350px"
            />
            {busLocation && (
              <p className="text-xs text-slate-400 mt-2 text-center">
                Last updated: {new Date(busLocation.recorded_at).toLocaleTimeString('en-IN')}
                {busLocation.speed != null && ` · ${Math.round(busLocation.speed)} km/h`}
              </p>
            )}
          </div>
        )}

        {/* Notifications */}
        <NotificationPanel
          notifications={notifications}
          unreadCount={unreadCount}
          onMarkAllRead={handleMarkAllRead}
          onMarkRead={handleMarkRead}
        />
      </main>
    </div>
  )
}
