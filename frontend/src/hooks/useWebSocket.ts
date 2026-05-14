/**
 * WebSocket hook with auto-reconnect for streaming CLI output.
 * Also auto-refreshes the file list while a task is running.
 */
import { useEffect, useRef, useCallback } from 'react'
import ReconnectingWebSocket from 'reconnecting-websocket'
import { useAgentStore, type AgentMessage } from '../store/agentStore'

const WS_BASE = import.meta.env.VITE_WS_URL || 'ws://localhost:8000'
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/** Fetch the latest file tree for a session */
async function refreshFiles(sessionId: string) {
  try {
    const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/files`)
    const data = await res.json()
    useAgentStore.getState().setFiles(data)
  } catch {
    // Silently ignore — polling will retry
  }
}

export function useWebSocket(sessionId: string | null) {
  const wsRef = useRef<ReconnectingWebSocket | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { addMessage, setWsConnected, updateSessionStatus } = useAgentStore()

  // Start polling files every 3 seconds while a task is running
  const startFilePolling = useCallback((sid: string) => {
    // Don't double-start
    if (pollRef.current) return
    // Immediate refresh
    refreshFiles(sid)
    pollRef.current = setInterval(() => refreshFiles(sid), 3000)
  }, [])

  const stopFilePolling = useCallback((sid: string) => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    // Final refresh to catch last changes
    refreshFiles(sid)
    // Schedule second refresh after 1.5s to ensure backend has written files
    setTimeout(() => refreshFiles(sid), 1500)
  }, [])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [])

  // Sync session status from backend — called when WebSocket connects
  // This handles the case where page reloaded while a task was running
  const syncSessionStatus = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sid}`)
      if (res.ok) {
        const sessionData = await res.json()
        const backendStatus = sessionData.status || 'idle'
        
        // Find what store thinks the status is
        const state = useAgentStore.getState()
        const storedSession = state.sessions.find(s => s.id === sid)
        const storedStatus = storedSession?.status || 'idle'
        
        // If store thinks running but backend says idle/error, sync it
        if (storedStatus === 'running' && backendStatus !== 'running') {
          updateSessionStatus(sid, backendStatus)
          stopFilePolling(sid)
        }
      }
    } catch (e) {
      // Silently fail — not critical
      console.debug('Failed to sync session status:', e)
    }
  }, [updateSessionStatus, stopFilePolling])

  useEffect(() => {
    if (!sessionId) return

    const ws = new ReconnectingWebSocket(`${WS_BASE}/ws/${sessionId}`, [], {
      maxReconnectionDelay: 5000,
      minReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1.3,
      maxRetries: 20,
    })

    ws.onopen = () => {
      setWsConnected(true)
      // On reconnect (especially after reload), sync session status from backend
      // to handle case where page reloaded while task was running
      if (sessionId) {
        syncSessionStatus(sessionId)
      }
    }

    ws.onclose = () => {
      setWsConnected(false)
    }

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        const rawType = typeof data.type === 'string' ? data.type.trim() : data.type
        const eventType = typeof rawType === 'string'
          ? rawType.toLowerCase().split(/\s+/)[0]
          : rawType
        
        // Handle streaming tokens directly
        if (eventType === 'token') {
          useAgentStore.getState().appendToken(data.content || '')
          return
        }

        // Deduplicate: assistant events often duplicate already-streamed tokens
        if (eventType === 'assistant') {
          const state = useAgentStore.getState()
          const content = (data.content || '').trim()
          if (content) {
            // Scan recent messages to see if this text already exists
            for (let i = state.messages.length - 1; i >= 0; i--) {
              const m = state.messages[i]
              if (m.type === 'user') break // stop at previous user message
              if (m.type === 'assistant' && m.content.trim() === content) {
                // Exact duplicate — skip entirely
                return
              }
              if (m.type === 'assistant' && content.startsWith(m.content.trim())) {
                // The new event is a superset — replace in-place
                addMessage({ ...m, content: data.content || '' })
                return
              }
            }
          }
        }

        if (eventType === 'tool_start') {
          // Ignore tool_start events entirely — they're just metadata, not UI messages
          return
        }

        if (eventType === 'tool_stream') {
          useAgentStore.getState().appendToolStream(data.content || '')
          return
        }

        const msg: AgentMessage = {
          id: data.tool_use_id || `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: eventType || 'assistant',
          content: data.content || '',
          tool: data.tool,
          input: data.input,
          status: data.status,
          timestamp: data.timestamp || new Date().toISOString(),
        }
        addMessage(msg)

        // Update session status and file polling based on event type
        console.log('[WS] Event:', eventType, data)

        if (eventType === 'status') {
          if (data.content === 'running') {
            updateSessionStatus(sessionId, 'running')
            startFilePolling(sessionId)
          } else if (data.content === 'cancelled' || data.content === 'no_task_running') {
            console.log(`[WS] Task ${data.content} for session ${sessionId}`)
            updateSessionStatus(sessionId, 'idle')
            stopFilePolling(sessionId)
          }
        } else if (eventType === 'result') {
          console.log(`[WS] Task result received for ${sessionId}:`, data.content)
          updateSessionStatus(sessionId, 'idle')
          stopFilePolling(sessionId)
          // Reset file tree expansion to show new files at root level
          useAgentStore.getState().setFileTreeExpanded(new Set())
        } else if (eventType === 'error') {
          console.error(`[WS] Task error for ${sessionId}:`, data.content)
          updateSessionStatus(sessionId, 'error')
          stopFilePolling(sessionId)
        }
      } catch (e) {
        console.error('WS message parse error:', e)
      }
    }

    ws.onerror = () => {
      setWsConnected(false)
    }

    wsRef.current = ws

    return () => {
      ws.close()
      wsRef.current = null
      // Stop polling when session changes
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [sessionId, addMessage, setWsConnected, updateSessionStatus, startFilePolling, stopFilePolling, syncSessionStatus])

  const sendTask = useCallback((task: string, maxTurns = 50, model?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Add user message locally
      addMessage({
        id: `user-${Date.now()}`,
        type: 'user',
        content: task,
        timestamp: new Date().toISOString(),
      })

      wsRef.current.send(JSON.stringify({
        action: 'run',
        task,
        max_turns: maxTurns,
        model,
      }))
    }
  }, [addMessage])

  const cancelTask = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'cancel' }))
    }
  }, [])

  return { sendTask, cancelTask }
}
