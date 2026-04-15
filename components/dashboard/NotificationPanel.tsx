'use client'

import { useState } from 'react'
import type { Notification } from '@/lib/types'
import { formatDistanceToNow, format } from 'date-fns'

interface NotificationPanelProps {
  notifications: Notification[]
  unreadCount: number
  onMarkAllRead: () => void
  onMarkRead: (id: string) => void
}

const TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
  MORNING_BOARD:  { icon: '🚌', color: 'bg-blue-50 border-blue-100' },
  SCHOOL_ARRIVAL: { icon: '🏫', color: 'bg-green-50 border-green-100' },
  EVENING_BOARD:  { icon: '🚌', color: 'bg-orange-50 border-orange-100' },
  HOME_DROP:      { icon: '🏠', color: 'bg-emerald-50 border-emerald-100' },
}

export default function NotificationPanel({
  notifications,
  unreadCount,
  onMarkAllRead,
  onMarkRead,
}: NotificationPanelProps) {
  const [collapsed, setCollapsed] = useState(false)

  if (notifications.length === 0) {
    return (
      <div className="card p-6 text-center">
        <div className="h-12 w-12 mx-auto mb-3 rounded-full bg-slate-100 flex items-center justify-center">
          <svg className="h-6 w-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </div>
        <p className="text-sm text-slate-500">No notifications yet</p>
        <p className="text-xs text-slate-400 mt-1">You&apos;ll be notified when your child boards or arrives</p>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-800">Notifications</h3>
          {unreadCount > 0 && (
            <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-bold text-white">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onMarkAllRead() }}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              Mark all read
            </button>
          )}
          <svg
            className={`h-4 w-4 text-slate-400 transition-transform ${collapsed ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* List */}
      {!collapsed && (
        <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
          {notifications.map((notif) => {
            const config = TYPE_CONFIG[notif.notification_type] ?? { icon: '📣', color: 'bg-slate-50 border-slate-100' }
            return (
              <div
                key={notif.id}
                onClick={() => !notif.is_read && onMarkRead(notif.id)}
                className={`flex gap-3 px-5 py-3.5 transition-colors ${
                  !notif.is_read
                    ? `${config.color} border-l-2 cursor-pointer hover:brightness-95`
                    : 'hover:bg-slate-50'
                }`}
              >
                <div className="text-xl flex-shrink-0 mt-0.5">{config.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm leading-snug ${!notif.is_read ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
                    {notif.body}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true })}
                    <span className="mx-1.5">·</span>
                    {format(new Date(notif.created_at), 'hh:mm a')}
                  </p>
                </div>
                {!notif.is_read && (
                  <div className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0 mt-2" />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
