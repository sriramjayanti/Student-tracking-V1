'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { StudentWithTracking, ScanType } from '@/lib/types'
import { getStatusLabel, getStatusColor } from '@/lib/types'
import { formatDistanceToNow, format } from 'date-fns'

interface StudentCardProps {
  student: StudentWithTracking
  onViewMap?: () => void
}

const SCAN_TIMELINE: { type: ScanType; label: string; icon: string }[] = [
  { type: 'MORNING_BOARD',  label: 'Boarded bus',      icon: '🚌' },
  { type: 'SCHOOL_ARRIVAL', label: 'Reached school',   icon: '🏫' },
  { type: 'EVENING_BOARD',  label: 'Heading home',     icon: '🚌' },
  { type: 'HOME_DROP',      label: 'Reached home',     icon: '🏠' },
]

export default function StudentCard({ student, onViewMap }: StudentCardProps) {
  const [expanded, setExpanded] = useState(false)

  const statusOrder: Record<string, number> = {
    not_boarded: 0,
    boarded_morning: 1,
    on_way_to_school: 1,
    reached_school: 2,
    boarded_evening: 3,
    on_way_home: 3,
    reached_home: 4,
  }

  const currentStep = statusOrder[student.current_status] ?? 0

  return (
    <div className="card p-5 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {student.photo_url ? (
            <Image
              src={student.photo_url}
              alt={student.full_name}
              width={48}
              height={48}
              className="h-12 w-12 rounded-full object-cover border-2 border-slate-100"
            />
          ) : (
            <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">
              {student.full_name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h3 className="font-semibold text-slate-800 text-base">{student.full_name}</h3>
            <p className="text-xs text-slate-500">
              Class {student.class_name}{student.section ? ` – ${student.section}` : ''}
              {student.bus && (
                <span className="ml-2 font-medium text-blue-600">· Bus {student.bus.bus_number}</span>
              )}
            </p>
            {student.assigned_stop && (
              <p className="text-xs text-slate-400 mt-0.5">
                📍 Stop: {student.assigned_stop.name}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <span className={`badge ${getStatusColor(student.current_status)}`}>
            {getStatusLabel(student.current_status)}
          </span>
          {student.latest_scan && (
            <p className="text-xs text-slate-400">
              {formatDistanceToNow(new Date(student.latest_scan.scanned_at), { addSuffix: true })}
            </p>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4">
        <div className="flex items-center gap-1">
          {[0, 1, 2, 3, 4].map((step) => (
            <div
              key={step}
              className={`h-1.5 flex-1 rounded-full transition-all ${
                step <= currentStep ? 'bg-blue-500' : 'bg-slate-200'
              }`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-xs text-slate-400">Home</span>
          <span className="text-xs text-slate-400">School</span>
          <span className="text-xs text-slate-400">Home</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mt-4">
        {student.active_trip && onViewMap && (
          <button
            onClick={onViewMap}
            className="btn-primary flex-1 text-xs py-2"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            </svg>
            Live Map
          </button>
        )}
        <button
          onClick={() => setExpanded(!expanded)}
          className="btn-secondary flex-1 text-xs py-2"
        >
          {expanded ? 'Hide' : 'Scan'} History
          <svg
            className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Scan history timeline */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <p className="text-xs font-semibold text-slate-600 mb-3 uppercase tracking-wide">Today&apos;s Journey</p>
          <div className="space-y-3">
            {SCAN_TIMELINE.map((step, idx) => {
              const isCompleted = idx < currentStep
              const isCurrent = idx === currentStep && student.current_status !== 'not_boarded'
              return (
                <div key={step.type} className="flex items-center gap-3">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${
                    isCompleted || isCurrent
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-slate-100 text-slate-400'
                  }`}>
                    {step.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${isCompleted || isCurrent ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>
                      {step.label}
                    </p>
                  </div>
                  {(isCompleted || isCurrent) && student.latest_scan?.scan_type === step.type && (
                    <p className="text-xs text-slate-400 flex-shrink-0">
                      {format(new Date(student.latest_scan.scanned_at), 'hh:mm a')}
                    </p>
                  )}
                  {!isCompleted && !isCurrent && (
                    <p className="text-xs text-slate-300 flex-shrink-0">Pending</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
