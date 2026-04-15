/**
 * Firebase Cloud Messaging server-side notification service.
 * Uses the FCM HTTP v1 API without pulling in the Firebase Admin SDK.
 */

import type { ScanType } from '@/lib/types'
import { getNotificationMessage } from '@/lib/types'

interface FCMPayload {
  token: string
  title: string
  body: string
  data?: Record<string, string>
}

interface FCMBatchPayload {
  tokens: string[]
  title: string
  body: string
  data?: Record<string, string>
}

interface ServiceAccount {
  client_email: string
  private_key: string
}

let accessTokenCache: string | null = null
let tokenExpiry = 0

function toBase64Url(value: string | Uint8Array) {
  const buffer = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value)
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function getServiceAccount(): ServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON

  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured')
  }

  return JSON.parse(raw) as ServiceAccount
}

/** Get an OAuth2 access token for the FCM v1 API using a service account. */
async function getAccessToken(): Promise<string> {
  if (accessTokenCache && Date.now() < tokenExpiry - 60_000) {
    return accessTokenCache
  }

  const serviceAccount = getServiceAccount()
  const now = Math.floor(Date.now() / 1000)
  const unsignedToken = [
    toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
    toBase64Url(
      JSON.stringify({
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      })
    ),
  ].join('.')

  const keyBytes = Buffer.from(
    serviceAccount.private_key
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\n/g, ''),
    'base64'
  )

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  )

  const signedJWT = `${unsignedToken}.${toBase64Url(new Uint8Array(signature))}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedJWT,
    }),
  })

  if (!res.ok) {
    const errorBody = await res.text()
    throw new Error(`Failed to obtain FCM access token: ${errorBody}`)
  }

  const json = (await res.json()) as { access_token: string; expires_in: number }
  accessTokenCache = json.access_token
  tokenExpiry = Date.now() + json.expires_in * 1000

  return accessTokenCache
}

/** Send a single FCM push notification. */
export async function sendFCMNotification(payload: FCMPayload): Promise<string | null> {
  const projectId = process.env.FIREBASE_PROJECT_ID

  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID is not configured')
  }

  const accessToken = await getAccessToken()
  const body = {
    message: {
      token: payload.token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data ?? {},
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channel_id: 'transport_alerts',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    },
  }

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[FCM] Send failed:', err)
    return null
  }

  const data = (await res.json()) as { name: string }
  return data.name
}

/** Send to multiple tokens. */
export async function sendFCMBatch(payload: FCMBatchPayload): Promise<string[]> {
  const results = await Promise.allSettled(
    payload.tokens.map((token) => sendFCMNotification({ ...payload, token }))
  )

  return results
    .filter((result): result is PromiseFulfilledResult<string | null> => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter((id): id is string => id !== null)
}

/** High-level helper for scan notifications. */
export async function notifyParent(params: {
  fcmToken: string
  scanType: ScanType
  studentName: string
  busNumber: string
  time: string
  studentId: string
  scanEventId: string
}): Promise<string | null> {
  const { title, body } = getNotificationMessage(
    params.scanType,
    params.studentName,
    params.busNumber,
    params.time
  )

  return sendFCMNotification({
    token: params.fcmToken,
    title,
    body,
    data: {
      type: params.scanType,
      student_id: params.studentId,
      scan_event_id: params.scanEventId,
    },
  })
}
