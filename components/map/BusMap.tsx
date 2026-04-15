'use client'

import { useEffect, useRef } from 'react'
import type { BusLocation, Stop } from '@/lib/types'

interface BusMapProps {
  busLocation: BusLocation | null
  locationHistory?: BusLocation[]
  stops?: Stop[]
  schoolLatitude?: number
  schoolLongitude?: number
  height?: string
}

export default function BusMap({
  busLocation,
  locationHistory = [],
  stops = [],
  schoolLatitude,
  schoolLongitude,
  height = '400px',
}: BusMapProps) {
  const mapRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const busMarkerRef = useRef<any>(null)
  const polylineRef = useRef<any>(null)
  const isInitialized = useRef(false)

  // Initialize map on mount
  useEffect(() => {
    if (isInitialized.current || !containerRef.current) return
    isInitialized.current = true

    // Dynamically import Leaflet (CSR only)
    import('leaflet').then((L) => {
      // Fix default icon paths (webpack issue)
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const defaultCenter: [number, number] = busLocation
        ? [busLocation.latitude, busLocation.longitude]
        : [schoolLatitude ?? 17.385, schoolLongitude ?? 78.4867]

      const map = L.map(containerRef.current!, {
        center: defaultCenter,
        zoom: 14,
        zoomControl: true,
        attributionControl: true,
      })

      mapRef.current = map

      // OpenStreetMap tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map)

      // School marker
      if (schoolLatitude && schoolLongitude) {
        const schoolIcon = L.divIcon({
          html: `<div style="background:#1e40af;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 3L2 12h3v8h14v-8h3L12 3zm0 13a2 2 0 110-4 2 2 0 010 4z"/></svg>
          </div>`,
          className: '',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        })
        L.marker([schoolLatitude, schoolLongitude], { icon: schoolIcon })
          .addTo(map)
          .bindPopup('<b>School</b>')
      }

      // Stop markers
      stops.forEach((stop) => {
        const stopIcon = L.divIcon({
          html: `<div style="background:#f59e0b;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.25);font-size:10px;font-weight:700;color:white">${stop.sequence_no}</div>`,
          className: '',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        })
        L.marker([stop.latitude, stop.longitude], { icon: stopIcon })
          .addTo(map)
          .bindPopup(`<b>Stop ${stop.sequence_no}</b><br>${stop.name}`)
      })

      // Route polyline from stop coordinates
      if (stops.length >= 2) {
        const coords = stops
          .sort((a, b) => a.sequence_no - b.sequence_no)
          .map((s): [number, number] => [s.latitude, s.longitude])
        L.polyline(coords, {
          color: '#3b82f6',
          weight: 3,
          opacity: 0.6,
          dashArray: '6 4',
        }).addTo(map)
      }

      // History trail
      if (locationHistory.length >= 2) {
        const trailCoords = locationHistory
          .slice()
          .reverse()
          .map((l): [number, number] => [l.latitude, l.longitude])
        polylineRef.current = L.polyline(trailCoords, {
          color: '#f97316',
          weight: 3,
          opacity: 0.7,
        }).addTo(map)
      }

      // Bus marker
      if (busLocation) {
        const busIcon = L.divIcon({
          html: `<div style="background:#ef4444;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 3px 10px rgba(0,0,0,0.35)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M4 16c0 .88.39 1.67 1 2.22V20a1 1 0 001 1h1a1 1 0 001-1v-1h8v1a1 1 0 001 1h1a1 1 0 001-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm9 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm1.5-6H6V6h12v5z"/></svg>
          </div>`,
          className: '',
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        })
        busMarkerRef.current = L.marker(
          [busLocation.latitude, busLocation.longitude],
          { icon: busIcon, zIndexOffset: 1000 }
        )
          .addTo(map)
          .bindPopup('<b>Bus is here</b>')

        map.panTo([busLocation.latitude, busLocation.longitude])
      }
    })

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        isInitialized.current = false
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update bus marker position when location changes
  useEffect(() => {
    if (!busLocation || !busMarkerRef.current || !mapRef.current) return

    const latLng = [busLocation.latitude, busLocation.longitude] as [number, number]
    busMarkerRef.current.setLatLng(latLng)
    mapRef.current.panTo(latLng, { animate: true, duration: 0.5 })

    // Extend trail
    if (polylineRef.current) {
      const latlngs = polylineRef.current.getLatLngs() as any[]
      latlngs.push(latLng)
      polylineRef.current.setLatLngs(latlngs)
    }
  }, [busLocation])

  return (
    <div className="relative" style={{ height }}>
      {/* Inject Leaflet CSS */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        crossOrigin=""
      />
      <div ref={containerRef} className="w-full h-full rounded-2xl overflow-hidden" />
      {!busLocation && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 rounded-2xl">
          <div className="text-center text-slate-400">
            <svg className="h-10 w-10 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-sm font-medium">Waiting for bus location…</p>
            <p className="text-xs mt-1">Map updates live when the trip starts</p>
          </div>
        </div>
      )}
    </div>
  )
}
