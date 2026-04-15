'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import StudentQR from '@/components/qr/StudentQR'
import type { Student, Bus, TripSession, ScanEvent, BusLocation } from '@/lib/types'
import { getStatusLabel, getStatusColor } from '@/lib/types'

const BusMap = dynamic(() => import('@/components/map/BusMap'), { ssr: false })

type AdminTab = 'overview' | 'students' | 'buses' | 'scans'

export default function AdminDashboard() {
  const supabase = createClient()

  const [tab, setTab]             = useState<AdminTab>('overview')
  const [loading, setLoading]     = useState(true)
  const [buses, setBuses]         = useState<(Bus & { _location?: BusLocation; _trip?: TripSession })[]>([])
  const [students, setStudents]   = useState<Student[]>([])
  const [scans, setScans]         = useState<(ScanEvent & { student?: any })[]>([])
  const [selectedBus, setSelectedBus] = useState<string | null>(null)
  const [busLocation, setBusLocation] = useState<BusLocation | null>(null)
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Counts
  const [stats, setStats] = useState({
    totalStudents: 0,
    boardedCount: 0,
    reachedSchool: 0,
    reachedHome: 0,
    activeTrips: 0,
  })

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadAll() {
    const today = new Date().toISOString().split('T')[0]

    // Buses
    const { data: busData } = await supabase
      .from('buses')
      .select('*')
      .eq('is_active', true)
      .order('bus_number')

    // Students
    const { data: studentData } = await supabase
      .from('students')
      .select('*, bus:buses(bus_number)')
      .eq('is_active', true)
      .order('full_name')

    // Active trips
    const { data: trips } = await supabase
      .from('trip_sessions')
      .select('*')
      .eq('status', 'active')
      .eq('trip_date', today)

    // Recent scans
    const { data: scanData } = await supabase
      .from('scan_events')
      .select(`
        *,
        student:students(full_name, class_name, admission_no),
        trip_session:trip_sessions(trip_type)
      `)
      .gte('scanned_at', `${today}T00:00:00Z`)
      .order('scanned_at', { ascending: false })
      .limit(100)

    if (busData) {
      const enriched = busData.map((bus) => ({
        ...bus,
        _trip: trips?.find((t) => t.bus_id === bus.id),
      }))
      setBuses(enriched)
    }

    if (studentData) {
      setStudents(studentData as any)

      setStats({
        totalStudents: studentData.length,
        boardedCount: studentData.filter((s) => ['boarded_morning', 'on_way_to_school', 'boarded_evening', 'on_way_home'].includes(s.current_status)).length,
        reachedSchool: studentData.filter((s) => s.current_status === 'reached_school').length,
        reachedHome: studentData.filter((s) => s.current_status === 'reached_home').length,
        activeTrips: trips?.length ?? 0,
      })
    }

    if (scanData) setScans(scanData as any)

    setLoading(false)
  }

  async function loadBusLocation(busId: string) {
    setSelectedBus(busId)
    const { data } = await supabase
      .from('bus_locations')
      .select('*')
      .eq('bus_id', busId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .single()
    setBusLocation(data ?? null)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  // Subscribe to realtime for live updates
  useEffect(() => {
    const sub = supabase
      .channel('admin-live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'students' }, () => loadAll())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'scan_events' }, () => loadAll())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bus_locations' }, (p) => {
        if (p.new.bus_id === selectedBus) setBusLocation(p.new as BusLocation)
      })
      .subscribe()
    return () => { supabase.removeChannel(sub) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBus])

  const filteredStudents = students.filter((s) =>
    s.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.admission_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.class_name.toLowerCase().includes(searchQuery.toLowerCase())
  )

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

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Topbar */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <span className="font-bold text-slate-800 text-base">SafeRide Admin</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-600 font-medium">{stats.activeTrips} live trips</span>
            </div>
            <button onClick={handleLogout} className="text-xs text-slate-500 hover:text-slate-700 font-medium">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Students', value: stats.totalStudents, color: 'text-slate-800', bg: 'bg-white' },
            { label: 'On the Bus',     value: stats.boardedCount,  color: 'text-blue-700',  bg: 'bg-blue-50' },
            { label: 'At School',      value: stats.reachedSchool, color: 'text-green-700', bg: 'bg-green-50' },
            { label: 'Reached Home',   value: stats.reachedHome,   color: 'text-emerald-700', bg: 'bg-emerald-50' },
          ].map((stat) => (
            <div key={stat.label} className={`card p-4 ${stat.bg}`}>
              <p className="text-xs text-slate-500 font-medium">{stat.label}</p>
              <p className={`text-3xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit mb-6">
          {([
            { key: 'overview',  label: '📊 Overview' },
            { key: 'students',  label: '👥 Students' },
            { key: 'buses',     label: '🚌 Buses' },
            { key: 'scans',     label: '📋 Scan Log' },
          ] as { key: AdminTab; label: string }[]).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t.key ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* OVERVIEW TAB */}
        {tab === 'overview' && (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Bus fleet cards */}
            <div className="space-y-3">
              <h2 className="font-semibold text-slate-800">Fleet Status</h2>
              {buses.map((bus) => (
                <div
                  key={bus.id}
                  onClick={() => { setTab('buses'); loadBusLocation(bus.id) }}
                  className="card p-4 cursor-pointer hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-blue-100 flex items-center justify-center">
                        <span className="text-lg">🚌</span>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800">Bus {bus.bus_number}</p>
                        <p className="text-xs text-slate-500">{bus.plate_number}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      {bus._trip ? (
                        <span className="badge bg-green-100 text-green-700">
                          {bus._trip.trip_type} — Live
                        </span>
                      ) : (
                        <span className="badge bg-slate-100 text-slate-500">Idle</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Recent scan activity */}
            <div>
              <h2 className="font-semibold text-slate-800 mb-3">Recent Activity</h2>
              <div className="card divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {scans.slice(0, 20).map((scan) => (
                  <div key={scan.id} className="px-4 py-2.5 flex items-center gap-3">
                    <span className="text-base flex-shrink-0">
                      {scan.scan_type === 'MORNING_BOARD' ? '🚌' :
                       scan.scan_type === 'SCHOOL_ARRIVAL' ? '🏫' :
                       scan.scan_type === 'EVENING_BOARD' ? '🚌' : '🏠'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {(scan as any).student?.full_name ?? 'Unknown'}
                      </p>
                      <p className="text-xs text-slate-400">
                        {scan.scan_type.replace(/_/g, ' ')}
                      </p>
                    </div>
                    <p className="text-xs text-slate-400 flex-shrink-0">
                      {new Date(scan.scanned_at).toLocaleTimeString('en-IN', { timeStyle: 'short' })}
                    </p>
                  </div>
                ))}
                {scans.length === 0 && (
                  <p className="px-4 py-6 text-sm text-slate-400 text-center">No scans today</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STUDENTS TAB */}
        {tab === 'students' && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1 max-w-sm">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search students…"
                  className="input pl-9"
                />
              </div>
              <span className="text-sm text-slate-500">{filteredStudents.length} students</span>
            </div>

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Student</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Class</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Bus</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">QR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStudents.map((student) => (
                      <tr key={student.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs flex-shrink-0">
                              {student.full_name.charAt(0)}
                            </div>
                            <div>
                              <p className="font-medium text-slate-800">{student.full_name}</p>
                              <p className="text-xs text-slate-400">{student.admission_no}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{student.class_name} {student.section ?? ''}</td>
                        <td className="px-4 py-3 text-slate-600">{(student as any).bus?.bus_number ?? '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`badge ${getStatusColor(student.current_status)}`}>
                            {getStatusLabel(student.current_status)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setSelectedStudent(selectedStudent?.id === student.id ? null : student)}
                            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                          >
                            {selectedStudent?.id === student.id ? 'Hide' : 'Show QR'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* QR panel */}
            {selectedStudent && (
              <div className="mt-4 card p-6 flex flex-col items-center">
                <StudentQR student={selectedStudent} size={180} showDownload />
              </div>
            )}
          </div>
        )}

        {/* BUSES TAB */}
        {tab === 'buses' && (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-3">
              {buses.map((bus) => (
                <div
                  key={bus.id}
                  onClick={() => loadBusLocation(bus.id)}
                  className={`card p-4 cursor-pointer transition-all ${
                    selectedBus === bus.id ? 'ring-2 ring-blue-500' : 'hover:shadow-md'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-slate-800">Bus {bus.bus_number}</p>
                      <p className="text-xs text-slate-500">{bus.plate_number} · {bus.make_model ?? ''}</p>
                    </div>
                    {bus._trip ? (
                      <span className="badge bg-green-100 text-green-700">Active</span>
                    ) : (
                      <span className="badge bg-slate-100 text-slate-500">Idle</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="card p-4">
              <h3 className="font-semibold text-slate-800 mb-3">
                {selectedBus
                  ? `Bus ${buses.find(b => b.id === selectedBus)?.bus_number ?? ''} — Live Map`
                  : 'Select a bus to view map'}
              </h3>
              <BusMap busLocation={busLocation} height="360px" />
            </div>
          </div>
        )}

        {/* SCAN LOG TAB */}
        {tab === 'scans' && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Time</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Student</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Event</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Trip</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {scans.map((scan) => (
                    <tr key={scan.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                        {new Date(scan.scanned_at).toLocaleTimeString('en-IN')}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{(scan as any).student?.full_name}</p>
                        <p className="text-xs text-slate-400">{(scan as any).student?.class_name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${
                          scan.scan_type === 'MORNING_BOARD'  ? 'bg-blue-100 text-blue-700' :
                          scan.scan_type === 'SCHOOL_ARRIVAL' ? 'bg-green-100 text-green-700' :
                          scan.scan_type === 'EVENING_BOARD'  ? 'bg-orange-100 text-orange-700' :
                          'bg-emerald-100 text-emerald-700'
                        }`}>
                          {scan.scan_type.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 capitalize">
                        {(scan as any).trip_session?.trip_type}
                      </td>
                    </tr>
                  ))}
                  {scans.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                        No scan events today
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
