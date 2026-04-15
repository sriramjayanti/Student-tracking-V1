'use client'

import { useEffect, useRef } from 'react'
import type { Student } from '@/lib/types'

interface StudentQRProps {
  student: Student
  size?: number
  showDownload?: boolean
}

export default function StudentQR({ student, size = 200, showDownload = true }: StudentQRProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    import('qrcode').then((QRCode) => {
      if (!canvasRef.current) return
      QRCode.toCanvas(canvasRef.current, student.qr_code, {
        width: size,
        margin: 2,
        color: { dark: '#1e293b', light: '#ffffff' },
        errorCorrectionLevel: 'H',
      })
    })
  }, [student.qr_code, size])

  function handleDownload() {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `qr-${student.admission_no}-${student.full_name.replace(/\s+/g, '_')}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="p-3 bg-white rounded-2xl shadow-sm border border-slate-100">
        <canvas ref={canvasRef} />
      </div>

      <div className="text-center">
        <p className="text-sm font-semibold text-slate-800">{student.full_name}</p>
        <p className="text-xs text-slate-500">
          {student.class_name}{student.section ? ` – ${student.section}` : ''} · {student.admission_no}
        </p>
        <p className="text-xs text-slate-400 font-mono mt-1">{student.qr_code.slice(0, 12)}…</p>
      </div>

      {showDownload && (
        <button onClick={handleDownload} className="btn-secondary text-xs px-4 py-2">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download QR
        </button>
      )}
    </div>
  )
}
