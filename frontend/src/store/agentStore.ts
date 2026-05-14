/**
 * Zustand store for Claude Agent Platform.
 * Manages sessions, messages, modules, and UI state.
 * Module selections are stored per-session so each session remembers its modules.
 */
import { create } from 'zustand'

// ── Types ──
export interface Session {
  id: string
  project_name: string
  workspace_path: string
  status: 'idle' | 'running' | 'error'
  active_modules: string[]
  pinned?: boolean
  created_at: string
  last_active: string
}

export interface AgentMessage {
  id: string
  type: 'assistant' | 'tool_use' | 'tool_result' | 'result' | 'error' | 'status' | 'thinking' | 'user' | 'tool_start'
  content: string
  tool?: string
  input?: any
  status?: string
  timestamp: string
  expanded?: boolean
}

export interface Module {
  name: string
  display_name: string
  description: string
  tools: { name: string; description: string }[]
}

export interface PluginInfo {
  name: string
  description: string
  version: string
  author: string
  category: string
  is_builtin: boolean
  commands: string[]
  agents: string[]
  skills: string[]
  hooks: string[]
  has_mcp: boolean
  readme?: string
}

export interface FileNode {
  path: string
  name: string
  is_dir: boolean
  size: number
}

// ── Store ──
interface AgentState {
  // Sessions
  sessions: Session[]
  activeSessionId: string | null

  // Messages (per active session)
  messages: AgentMessage[]

  // Modules
  modules: Module[]
  // Per-session module selections: { [sessionId]: ['testing', 'security', ...] }
  sessionModules: Record<string, string[]>

  // Files
  files: FileNode[]
  fileTreeExpanded: Set<string>

  // Plugins
  plugins: PluginInfo[]
  activePlugins: Record<string, string[]>  // { [sessionId]: ['plugin-name', ...] }

  // Activity tracking
  currentActivity: { label: string; detail: string; tool?: string; startedAt: string } | null
  stepCount: number

  // File preview
  previewFile: { path: string; content: string; name: string } | null

  // WebSocket
  wsConnected: boolean

  // UI
  showNewSessionDialog: boolean
  draftTask: string | null

  // Actions
  setSessions: (sessions: Session[]) => void
  addSession: (session: Session) => void
  removeSession: (id: string) => void
  setActiveSession: (id: string | null) => void
  updateSessionStatus: (id: string, status: Session['status']) => void
  togglePinSession: (id: string) => void

  addMessage: (msg: AgentMessage) => void
  setMessages: (msgs: AgentMessage[]) => void
  clearMessages: () => void
  toggleMessageExpand: (id: string) => void
  appendToken: (token: string) => void
  appendToolStream: (content: string) => void

  setModules: (modules: Module[]) => void
  toggleSelectedModule: (sessionId: string, name: string) => void
  getSelectedModules: (sessionId: string | null) => string[]

  setFiles: (files: FileNode[]) => void
  setFileTreeExpanded: (expanded: Set<string>) => void

  setPlugins: (plugins: PluginInfo[]) => void
  setActivePlugins: (sessionId: string, plugins: string[]) => void
  toggleActivePlugin: (sessionId: string, name: string) => void
  getActivePlugins: (sessionId: string | null) => string[]

  setCurrentActivity: (activity: AgentState['currentActivity']) => void
  clearActivity: () => void
  incrementStep: () => void
  resetSteps: () => void

  openPreview: (path: string, content: string, name: string) => void
  closePreview: () => void

  setWsConnected: (connected: boolean) => void

  setShowNewSessionDialog: (show: boolean) => void
  setDraftTask: (task: string | null) => void

  // Internal cache to survive session switching
  _sessionMessages?: Record<string, AgentMessage[]>
}

let msgCounter = 0

export const useAgentStore = create<AgentState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  modules: [],
  sessionModules: {},
  files: [],
  fileTreeExpanded: new Set(),
  plugins: [],
  activePlugins: {},
  currentActivity: null,
  stepCount: 0,
  previewFile: null,
  wsConnected: false,
  showNewSessionDialog: false,
  draftTask: null,

  setSessions: (sessions) => set((s) => {
    // Restore per-session module selections from DB data.
    // Merge: preserve any locally toggled state; seed from DB where not yet set.
    const restoredModules = { ...s.sessionModules }
    for (const sess of sessions) {
      if (!restoredModules[sess.id] && sess.active_modules?.length) {
        restoredModules[sess.id] = sess.active_modules
      }
    }
    return { sessions, sessionModules: restoredModules }
  }),
  addSession: (session) => set((s) => ({ sessions: [...s.sessions, session] })),
  removeSession: (id) => set((s) => {
    const { [id]: _, ...rest } = s.sessionModules
    const isActive = s.activeSessionId === id
    const { [id]: _m, ...restMessages } = s._sessionMessages || {}
    return {
      sessions: s.sessions.filter((x) => x.id !== id),
      activeSessionId: isActive ? null : s.activeSessionId,
      sessionModules: rest,
      messages: isActive ? [] : s.messages,
      files: isActive ? [] : s.files,
      _sessionMessages: restMessages,
    }
  }),
  setActiveSession: (id) => set((s) => {
    if (s.activeSessionId === id) return s
    const cache = { ...(s._sessionMessages || {}) }
    if (s.activeSessionId) {
      cache[s.activeSessionId] = s.messages
    }
    return {
      activeSessionId: id,
      messages: id ? (cache[id] || []) : [],
      _sessionMessages: cache,
    }
  }),
  updateSessionStatus: (id, status) => set((s) => ({
    sessions: s.sessions.map((x) => x.id === id ? { ...x, status } : x),
  })),
  togglePinSession: (id) => set((s) => ({
    sessions: s.sessions.map((x) =>
      x.id === id ? { ...x, pinned: !x.pinned } : x,
    ),
  })),

  addMessage: (msg) => set((s) => {
    const rawType = typeof msg.type === 'string' ? msg.type.trim() : msg.type
    const normalizedType = typeof rawType === 'string'
      ? rawType.toLowerCase().split(/\s+/)[0]
      : rawType

    if (normalizedType === 'tool_start') return s

    const normalizedMsg = normalizedType && normalizedType !== msg.type
      ? { ...msg, type: normalizedType as AgentMessage['type'] }
      : msg

    // If message with same id exists (e.g. from tool_start), replace it
    const existingIdx = s.messages.findIndex(m => m.id === normalizedMsg.id)
    if (existingIdx >= 0) {
      const newMessages = [...s.messages]
      newMessages[existingIdx] = { ...normalizedMsg, id: newMessages[existingIdx].id }
      return { messages: newMessages }
    }
    return {
      messages: [...s.messages, { ...normalizedMsg, id: normalizedMsg.id || `msg-${++msgCounter}` }],
    }
  }),
  setMessages: (msgs) => set((s) => {
    const cache = { ...(s._sessionMessages || {}) }
    if (s.activeSessionId) {
      cache[s.activeSessionId] = msgs
    }
    return { messages: msgs, _sessionMessages: cache }
  }),
  clearMessages: () => set({ messages: [] }),
  toggleMessageExpand: (id) => set((s) => ({
    messages: s.messages.map((m) => m.id === id ? { ...m, expanded: !m.expanded } : m),
  })),
  appendToken: (token) => set((s) => {
    if (s.messages.length === 0) {
      return {
        messages: [{
          id: `msg-${++msgCounter}`,
          type: 'assistant',
          content: token,
          timestamp: new Date().toISOString(),
        }]
      }
    }
    
    // Scan backwards to find the last assistant message (skip system/metadata)
    const newMessages = [...s.messages]
    for (let i = newMessages.length - 1; i >= 0; i--) {
      const msg = newMessages[i]
      if (msg.type === 'assistant' && !msg.content.startsWith('{"type"')) {
        newMessages[i] = { ...msg, content: msg.content + token }
        return { messages: newMessages }
      }
      // Stop if we hit a boundary
      if (msg.type === 'user' || msg.type === 'tool_use' || msg.type === 'tool_result') break
    }

    // No suitable message found to append to, create a new one
    return {
      messages: [...s.messages, {
        id: `msg-${++msgCounter}`,
        type: 'assistant',
        content: token,
        timestamp: new Date().toISOString(),
      }]
    }
  }),
  appendToolStream: (content) => set((s) => {
    if (s.messages.length === 0) return s
    // Scan backwards to find the last tool_use
    const newMessages = [...s.messages]
    for (let i = newMessages.length - 1; i >= 0; i--) {
      if (newMessages[i].type === 'tool_use') {
        newMessages[i] = { ...newMessages[i], content: newMessages[i].content + content }
        return { messages: newMessages }
      }
      if (newMessages[i].type === 'user' || newMessages[i].type === 'assistant') break
    }
    return s
  }),

  setModules: (modules) => set({ modules }),
  toggleSelectedModule: (sessionId, name) => set((s) => {
    const current = s.sessionModules[sessionId] || []
    const updated = current.includes(name)
      ? current.filter((n) => n !== name)
      : [...current, name]
    return { sessionModules: { ...s.sessionModules, [sessionId]: updated } }
  }),
  getSelectedModules: (sessionId) => {
    if (!sessionId) return []
    return get().sessionModules[sessionId] || []
  },

  setFiles: (files) => set({ files }),
  setFileTreeExpanded: (expanded) => set({ fileTreeExpanded: expanded }),

  setPlugins: (plugins) => set({ plugins }),
  setActivePlugins: (sessionId, plugins) => set((s) => ({
    activePlugins: { ...s.activePlugins, [sessionId]: plugins },
  })),
  toggleActivePlugin: (sessionId, name) => set((s) => {
    const current = s.activePlugins[sessionId] || []
    const updated = current.includes(name)
      ? current.filter((n) => n !== name)
      : [...current, name]
    return { activePlugins: { ...s.activePlugins, [sessionId]: updated } }
  }),
  getActivePlugins: (sessionId) => {
    if (!sessionId) return []
    return get().activePlugins[sessionId] || []
  },

  setCurrentActivity: (activity) => set({ currentActivity: activity }),
  clearActivity: () => set({ currentActivity: null }),
  incrementStep: () => set((s) => ({ stepCount: s.stepCount + 1 })),
  resetSteps: () => set({ stepCount: 0, currentActivity: null }),

  openPreview: (path, content, name) => set({ previewFile: { path, content, name } }),
  closePreview: () => set({ previewFile: null }),

  setWsConnected: (connected) => set({ wsConnected: connected }),

  setShowNewSessionDialog: (show) => set({ showNewSessionDialog: show }),
  setDraftTask: (task) => set({ draftTask: task }),
}))
