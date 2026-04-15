'use client'

import { useEffect, useRef, useState } from 'react'

interface QRScannerProps {
  onScan: (qrCode: string) => Promise<void>
  isActive?: boolean
}

export default function QRScanner({ onScan, isActive = true }: QRScannerProps) {
  const scannerRef = useRef<any>(null)
  const [status, setStatus] = useState<'idle' | 'scanning' | 'processing' | 'success' | 'error'>('idle')
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [lastScanTime, setLastScanTime] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const DEBOUNCE_MS = 3000 // prevent duplicate scans

  useEffect(() => {
    if (!isActive) return

    let scanner: any = null

    import('html5-qrcode').then(({ Html5Qrcode }) => {
      if (!containerRef.current) return

      scanner = new Html5Qrcode('qr-reader')
      scannerRef.current = scanner

      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1 },
          async (decodedText: string) => {
            const now = Date.now()
            if (now - lastScanTime < DEBOUNCE_MS) return
            setLastScanTime(now)

            setStatus('processing')
            setLastResult(decodedText)

            try {
              await onScan(decodedText)
              setStatus('success')
              // Vibrate on success
              if ('vibrate' in navigator) navigator.vibrate([100, 50, 100])
              setTimeout(() => setStatus('scanning'), 2000)
            } catch (err: any) {
              setErrorMsg(err.message ?? 'Scan failed')
              setStatus('error')
              if ('vibrate' in navigator) navigator.vibrate(300)
              setTimeout(() => setStatus('scanning'), 3000)
            }
          },
          () => { /* ignore QR not found errors */ }
        )
        .then(() => setStatus('scanning'))
        .catch((err: any) => {
          console.error('[QR] Camera error:', err)
          setStatus('error')
          setErrorMsg('Camera access denied. Please allow camera permission.')
        })
    })

    return () => {
      if (scanner) {
        scanner.stop().catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])

  return (
    <div className="relative">
      {/* Camera feed */}
      <div className="relative rounded-2xl overflow-hidden bg-black" style={{ minHeight: 300 }}>
        <div id="qr-reader" ref={containerRef} className="w-full" />

        {/* Scanning overlay */}
        {status === 'scanning' && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative w-60 h-60">
                {/* Corner brackets */}
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-400 rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-blue-400 rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-blue-400 rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-400 rounded-br-lg" />
                {/* Scan line animation */}
                <div className="absolute left-0 right-0 h-0.5 bg-blue-400 opacity-80"
                  style={{ animation: 'scanline 2s linear infinite', top: '50%' }} />
              </div>
            </div>
          </div>
        )}

        {/* Processing overlay */}
        {status === 'processing' && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-2xl">
            <div className="text-center text-white">
              <svg className="animate-spin h-10 w-10 mx-auto mb-3" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" className="opacity-75" />
              </svg>
              <p className="text-sm font-medium">Processing scan…</p>
            </div>
          </div>
        )}

        {/* Success overlay */}
        {status === 'success' && (
          <div className="absolute inset-0 bg-green-500/80 flex items-center justify-center rounded-2xl">
            <div className="text-center text-white">
              <svg className="h-16 w-16 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-lg font-bold">Scan Successful!</p>
            </div>
          </div>
        )}

        {/* Error overlay */}
        {status === 'error' && (
          <div className="absolute inset-0 bg-red-500/80 flex items-center justify-center rounded-2xl">
            <div className="text-center text-white px-6">
              <svg className="h-12 w-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <p className="text-base font-bold mb-1">Scan Failed</p>
              <p className="text-xs opacity-90">{errorMsg}</p>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="mt-3 flex items-center gap-2 text-sm">
        <div className={`h-2 w-2 rounded-full ${
          status === 'scanning'    ? 'bg-green-400 animate-pulse' :
          status === 'processing'  ? 'bg-yellow-400 animate-pulse' :
          status === 'success'     ? 'bg-green-400' :
          status === 'error'       ? 'bg-red-400' :
          'bg-slate-300'
        }`} />
        <span className="text-slate-600">
          {status === 'idle'       && 'Camera loading…'}
          {status === 'scanning'   && 'Ready — point camera at QR code'}
          {status === 'processing' && 'Verifying scan…'}
          {status === 'success'    && 'Student checked in successfully'}
          {status === 'error'      && (errorMsg ?? 'Scan error — please try again')}
        </span>
      </div>

      {lastResult && status !== 'error' && (
        <p className="mt-1 text-xs text-slate-400 font-mono truncate">
          Last QR: {lastResult.slice(0, 24)}…
        </p>
      )}

      <style jsx>{`
        @keyframes scanline {
          0%   { transform: translateY(-120px); }
          100% { transform: translateY(120px); }
        }
      `}</style>
    </div>
  )
}
