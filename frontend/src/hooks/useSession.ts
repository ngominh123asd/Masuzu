/**
 * Session management hook — fetches sessions, modules, files, and messages from the API.
 * Optimized: parallel fetches, lazy message loading, cached modules.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useAgentStore } from '../store/agentStore'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Module cache — modules are static, only fetch once per page lifetime
let modulesCache: any[] | null = null

export function useSession() {
  const {
    sessions, activeSessionId, modules,
    setSessions, addSession, removeSession, setActiveSession,
    setModules, setFiles, setShowNewSessionDialog,
    setMessages, setPlugins, setActivePlugins, toggleActivePlugin,
  } = useAgentStore()

  const hasFetchedRef = useRef(false)

  // Fetch sessions + modules in PARALLEL on mount (only once)
  useEffect(() => {
    if (hasFetchedRef.current) return
    hasFetchedRef.current = true

    // Fire all requests simultaneously
    const init = async () => {
      const [sessionsRes, modulesData, pluginsData] = await Promise.all([
        fetchSessionsRaw(),
        modulesCache ? Promise.resolve(modulesCache) : fetchModulesRaw(),
        fetchPluginsRaw(),
      ])
      if (sessionsRes) setSessions(sessionsRes)
      if (modulesData) {
        modulesCache = modulesData
        setModules(modulesData)
      }
      if (pluginsData) setPlugins(pluginsData)
    }
    init()
  }, [])

  // Fetch files + messages in PARALLEL when active session changes
  useEffect(() => {
    if (!activeSessionId) return
    const load = async () => {
      const [filesData, msgsData, activePluginsData] = await Promise.all([
        fetchFilesRaw(activeSessionId),
        fetchMessagesRaw(activeSessionId),
        fetchActivePluginsRaw(activeSessionId),
      ])
      if (filesData) setFiles(filesData)
      if (msgsData) setMessages(msgsData)
      if (activePluginsData) setActivePlugins(activeSessionId, activePluginsData)
    }
    load()
  }, [activeSessionId])

  // Raw fetch functions (return data, no store side effects)
  const fetchSessionsRaw = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`)
      return await res.json()
    } catch (e) {
      console.error('Failed to fetch sessions:', e)
      return null
    }
  }

  const fetchModulesRaw = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/modules`)
      return await res.json()
    } catch (e) {
      console.error('Failed to fetch modules:', e)
      return null
    }
  }

  const fetchFilesRaw = async (sessionId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/files`)
      return await res.json()
    } catch (e) {
      console.error('Failed to fetch files:', e)
      return null
    }
  }

  const fetchMessagesRaw = async (sessionId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/messages`)
      if (!res.ok) return null
      const data = await res.json()
      return data
        .map((msg: any) => ({
          id: msg.id,
          type: msg.role === 'user' ? 'user' : (msg.type || 'assistant'),
          content: msg.content,
          tool: msg.tool,
          input: msg.input,
          status: msg.status,
          timestamp: msg.timestamp,
        }))
        .filter((msg: any) => msg.type !== 'tool_start')
    } catch (e) {
      console.error('Failed to fetch messages:', e)
      return null
    }
  }

  const fetchPluginsRaw = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/plugins`)
      return await res.json()
    } catch (e) {
      console.error('Failed to fetch plugins:', e)
      return null
    }
  }

  const fetchActivePluginsRaw = async (sessionId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/plugins`)
      const data = await res.json()
      return data.active_plugins || []
    } catch (e) {
      console.error('Failed to fetch active plugins:', e)
      return null
    }
  }

  // Public actions
  const fetchSessions = useCallback(async () => {
    const data = await fetchSessionsRaw()
    if (data) setSessions(data)
  }, [setSessions])

  const fetchFiles = useCallback(async (sessionId: string) => {
    const data = await fetchFilesRaw(sessionId)
    if (data) setFiles(data)
  }, [setFiles])

  const fetchMessages = useCallback(async (sessionId: string) => {
    const data = await fetchMessagesRaw(sessionId)
    if (data) setMessages(data)
  }, [setMessages])

  const createSession = useCallback(async (projectName: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_name: projectName }),
      })
      const data = await res.json()
      addSession(data)
      setActiveSession(data.id)
      setShowNewSessionDialog(false)
    } catch (e) {
      console.error('Failed to create session:', e)
    }
  }, [addSession, setActiveSession, setShowNewSessionDialog])

  const deleteSession = useCallback(async (sessionId: string) => {
    // Optimistic: remove from UI immediately
    removeSession(sessionId)
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}`, { method: 'DELETE' })
      if (!res.ok) {
        console.error('Delete session API error:', res.status, await res.text())
      }
    } catch (e) {
      console.error('Failed to delete session:', e)
    }
  }, [removeSession])

  const enableModule = useCallback(async (sessionId: string, moduleName: string) => {
    try {
      await fetch(`${API_BASE}/api/sessions/${sessionId}/modules/${moduleName}/enable`, {
        method: 'POST',
      })
    } catch (e) {
      console.error('Failed to enable module:', e)
    }
  }, [])

  const disableModule = useCallback(async (sessionId: string, moduleName: string) => {
    try {
      await fetch(`${API_BASE}/api/sessions/${sessionId}/modules/${moduleName}/disable`, {
        method: 'POST',
      })
    } catch (e) {
      console.error('Failed to disable module:', e)
    }
  }, [])

  const activatePlugin = useCallback(async (sessionId: string, pluginName: string) => {
    try {
      await fetch(`${API_BASE}/api/sessions/${sessionId}/plugins/${pluginName}/activate`, {
        method: 'POST',
      })
      toggleActivePlugin(sessionId, pluginName)
    } catch (e) {
      console.error('Failed to activate plugin:', e)
    }
  }, [toggleActivePlugin])

  const deactivatePlugin = useCallback(async (sessionId: string, pluginName: string) => {
    try {
      await fetch(`${API_BASE}/api/sessions/${sessionId}/plugins/${pluginName}/deactivate`, {
        method: 'POST',
      })
      toggleActivePlugin(sessionId, pluginName)
    } catch (e) {
      console.error('Failed to deactivate plugin:', e)
    }
  }, [toggleActivePlugin])

  const importPlugin = useCallback(async (files: FileList, overwrite = false) => {
    try {
      const formData = new FormData()
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        // webkitRelativePath gives us "folder/subpath/file.ext"
        formData.append('files', file, file.webkitRelativePath || file.name)
      }
      formData.append('overwrite', overwrite ? 'true' : 'false')

      const res = await fetch(`${API_BASE}/api/plugins/upload`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json()
        if (res.status === 409 && err.detail?.requires_confirmation) {
          const confirm = window.confirm(err.detail.message + '\n\nBạn có muốn ghi đè lên plugin hiện tại không?')
          if (confirm) {
            return importPlugin(files, true)
          }
          return false
        }
        throw new Error(err.detail || 'Import failed')
      }
      // Refresh plugins list
      const pluginsData = await fetchPluginsRaw()
      if (pluginsData) setPlugins(pluginsData)
      return true
    } catch (e) {
      console.error('Failed to import plugin:', e)
      return false
    }
  }, [setPlugins])

  const refreshPlugins = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/plugins/refresh`, { method: 'POST' })
      const pluginsData = await fetchPluginsRaw()
      if (pluginsData) setPlugins(pluginsData)
    } catch (e) {
      console.error('Failed to refresh plugins:', e)
    }
  }, [setPlugins])

  return {
    sessions, activeSessionId, modules,
    createSession, deleteSession,
    setActiveSession,
    enableModule, disableModule,
    fetchFiles, fetchMessages,
    activatePlugin, deactivatePlugin, importPlugin, refreshPlugins,
  }
}
