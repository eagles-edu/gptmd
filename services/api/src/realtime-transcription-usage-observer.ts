import WebSocket, { type RawData } from 'ws'
import { parseRealtimeAudioDurationUsageEvent, type RealtimeAudioDurationUsage } from './realtime-transcription-usage.ts'

export type RealtimeUsageObserver = (
  callId: string,
  onUsage: (usage: RealtimeAudioDurationUsage) => Promise<void>,
  onDisconnect: () => Promise<void>
) => Promise<() => Promise<void>>

export function createRealtimeTranscriptionUsageObserver(
  apiKey: string,
  connect: (url: string, options: WebSocket.ClientOptions) => WebSocket = (url, options) => new WebSocket(url, options),
  connectionTimeoutMs = 8_000
): RealtimeUsageObserver {
  return async (callId, onUsage, onDisconnect) => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(callId)) throw new Error('Invalid Realtime call ID')
    const socket = connect(`wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.terminate()
        reject(new Error('Realtime usage observer connection timed out'))
      }, connectionTimeoutMs)
      const onOpen = () => {
        clearTimeout(timer)
        socket.removeListener('error', onInitialError)
        resolve()
      }
      const onInitialError = (error: Error) => {
        clearTimeout(timer)
        socket.terminate()
        reject(error)
      }
      const onInitialClose = () => {
        clearTimeout(timer)
        reject(new Error('Realtime usage observer closed before connecting'))
      }
      socket.once('open', onOpen)
      socket.once('error', onInitialError)
      socket.once('close', onInitialClose)
    })

    let disconnected = false
    let persistUsage = Promise.resolve()
    let disconnectWork: Promise<void> | null = null
    const notifyDisconnect = () => {
      if (disconnected) return disconnectWork
      disconnected = true
      disconnectWork = onDisconnect().catch(() => undefined)
      return disconnectWork
    }
    socket.on('message', (data: RawData) => {
      const usage = parseRealtimeAudioDurationUsageEvent(toText(data))
      if (!usage) return
      persistUsage = persistUsage.then(() => onUsage(usage)).catch(() => {
        socket.terminate()
        notifyDisconnect()
      })
    })
    socket.on('error', () => {
      socket.terminate()
      notifyDisconnect()
    })
    socket.once('close', notifyDisconnect)

    return async () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => resolve(), 2_000)
          socket.once('close', () => {
            clearTimeout(timer)
            resolve()
          })
          socket.close()
        })
      }
      await persistUsage
      await disconnectWork
    }
  }
}

function toText(data: RawData): string {
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}
