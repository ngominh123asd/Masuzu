/**
 * ChatPanel — conversation view with streaming messages.
 * 
 * Display hierarchy:
 * - PRIMARY: User messages (blue bubble) + clean agent text (green, prominent)
 * - METADATA: System/status/result/JSON events → collapsed single-line, click to expand
 * - FILE CHIPS: Clickable inline chips when agent mentions file paths
 */
import { useRef, useEffect, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAgentStore } from '../store/agentStore'
import { ToolCallView } from './ToolCallView'
import s from '../agent.module.css'

function decodeUnicodeEscapes(str: string): string {
  if (typeof str !== 'string') return str
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (match, grp) => {
    try {
      return String.fromCharCode(parseInt(grp, 16))
    } catch {
      return match
    }
  })
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/** Check if content looks like raw JSON (metadata/debug info) */
function isJsonContent(content: string): boolean {
  const trimmed = content.trim()
  return trimmed.startsWith('{') && trimmed.endsWith('}')
}

/** Extract file paths mentioned in agent text */
function extractFilePaths(text: string): string[] {
  const paths: string[] = []
  // Pattern: "File created successfully at: /path/to/file"
  const createMatch = text.matchAll(/(?:File (?:created|written|saved) (?:successfully )?(?:at|to):?\s*)([^\s()]+\.\w+)/gi)
  for (const m of createMatch) paths.push(m[1])
  // Pattern: paths like /home/agent/.claude/plans/something.md
  const pathMatch = text.matchAll(/(?:^|\s)(\/[\w./-]+\.\w{1,8})/gm)
  for (const m of pathMatch) {
    if (!paths.includes(m[1])) paths.push(m[1])
  }
  return paths
}

/** Metadata types that should be compact */
const META_TYPES = new Set(['status', 'system', 'result'])

const ROLE_LABELS: Record<string, string> = {
  user: 'YOU',
  assistant: 'AGENT',
  tool_use: 'TOOL',
  tool_result: 'RESULT',
  result: 'COMPLETE',
  error: 'ERROR',
  status: 'STATUS',
  thinking: 'THINKING',
  system: 'SYSTEM',
}

/** Inline file chip component */
function FileChip({ path, sessionId }: { path: string; sessionId: string }) {
  const { openPreview } = useAgentStore()
  const name = path.split('/').pop() || path

  const handleClick = useCallback(async () => {
    try {
      // Normalize Docker-internal paths for the API
      // The backend also handles this, but stripping here gives a cleaner URL
      let apiPath = path
      for (const prefix of ['/home/agent/', '/app/', '/workspace/']) {
        if (apiPath.startsWith(prefix)) {
          apiPath = apiPath.slice(prefix.length)
          break
        }
      }
      // Strip leading slash if still absolute
      if (apiPath.startsWith('/')) {
        apiPath = apiPath.slice(1)
      }

      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/files/${apiPath}`)
      if (res.ok) {
        const data = await res.json()
        openPreview(path, data.content || '', name)
      }
    } catch (e) {
      console.error('Failed to fetch file:', e)
    }
  }, [path, sessionId, openPreview, name])

  return (
    <button className={s.fileChip} onClick={handleClick} title={`Preview ${path}`}>
      <span className={s.fileChipIcon}>📄</span>
      <span className={s.fileChipName}>{name}</span>
    </button>
  )
}

export function ChatPanel() {
  const { messages, activeSessionId } = useAgentStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [expandedMeta, setExpandedMeta] = useState<Set<string>>(new Set())

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length])

  const toggleExpand = (id: string) => {
    setExpandedMeta((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!activeSessionId) {
    return (
      <div className={s.chatPanel}>
        <div className={s.chatEmpty}>
          <div className={s.chatEmptyGlyph}>▌</div>
          <div className={s.chatEmptyText}>SELECT OR CREATE A SESSION TO BEGIN</div>
        </div>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className={s.chatPanel}>
        <div className={s.chatEmpty}>
          <div className={s.chatEmptyGlyph}>_</div>
          <div className={s.chatEmptyText}>AWAITING INSTRUCTIONS</div>
          <div className={s.mute} style={{ fontSize: 11, maxWidth: '50ch', textAlign: 'center', lineHeight: 1.6 }}>
            Enter a task below. The agent will execute it autonomously — writing code, running tests, and fixing errors until done.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={s.chatPanel} ref={scrollRef}>
      {messages.map((msg) => {
        // Hide redundant task completed messages
        if (msg.type === 'result' && msg.content.trim() === 'Task completed successfully') {
          return null
        }

        // Ignore transient tool_start events if they leak into the message stream
        if (msg.type === 'tool_start') {
          return null
        }

        // Tool calls get their own card component
        if (msg.type === 'tool_use' || msg.type === 'tool_result') {
          return <ToolCallView key={msg.id} message={msg} />
        }

        const isUser = msg.type === 'user'
        const isMeta = META_TYPES.has(msg.type)
        const isJson = isJsonContent(msg.content)
        const roleLabel = ROLE_LABELS[msg.type] || msg.type.toUpperCase()
        const isExpanded = expandedMeta.has(msg.id)

        // ── METADATA ROW: system/status/result OR any JSON content ──
        if (isMeta || isJson) {
          return (
            <div
              key={msg.id}
              className={s.chatMetaRow}
              onClick={() => toggleExpand(msg.id)}
              title="Click to expand/collapse"
            >
              <span className={s.chatMetaLabel}>
                {roleLabel}
              </span>
              <span className={s.chatMetaTime}>
                {formatTimestamp(msg.timestamp)}
              </span>
              <span className={isExpanded ? s.chatMetaContentExpanded : s.chatMetaContent}>
                {decodeUnicodeEscapes(msg.content)}
              </span>
            </div>
          )
        }

        // ── PRIMARY MESSAGE: user prompts + clean agent text ──
        if (isUser) {
          // Parse attached files from message content
          const attachMatch = msg.content.match(/\n\n\[Attached files uploaded to workspace:\n([\s\S]*?)\nPlease read and use these files\.\]$/)
          const cleanContent = attachMatch
            ? msg.content.replace(attachMatch[0], '').trim()
            : msg.content
          const attachedPaths = attachMatch
            ? attachMatch[1].split('\n').map((l: string) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean)
            : []

          return (
            <div key={msg.id} className={s.chatMessageUserWrapper}>
              <span className={s.chatTimestampUserOutside}>{formatTimestamp(msg.timestamp)}</span>
              <div className={`${s.chatMessage} ${s.chatMessageUser}`}>
                {cleanContent && (
                  <div className={s.chatContentUser}>
                    {cleanContent}
                  </div>
                )}
                {attachedPaths.length > 0 && (
                  <div className={s.chatAttachments}>
                    {attachedPaths.map((p: string, i: number) => {
                      const name = p.split('/').pop() || p
                      const ext = name.split('.').pop()?.toLowerCase() || ''
                      const isImage = ['png','jpg','jpeg','gif','svg','webp'].includes(ext)
                      return (
                        <div key={i} className={s.chatAttachmentChip}>
                          <span className={s.chatAttachmentIcon}>
                            {isImage ? '🖼' : '📄'}
                          </span>
                          <span className={s.chatAttachmentName}>{name}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        }

        // ── AGENT MESSAGE with file detection ──
        // Scan backwards to pick up files from recent tool results/JSON logs before this agent message
        const detectedFiles = extractFilePaths(msg.content)
        
        let backtrackIndex = messages.indexOf(msg) - 1
        while (backtrackIndex >= 0) {
          const prevMsg = messages[backtrackIndex]
          if (prevMsg.type === 'assistant' && !isJsonContent(prevMsg.content)) break // Stop at previous textual agent message
          if (prevMsg.type === 'user' && !isJsonContent(prevMsg.content)) break // Stop at actual user task
          
          if (isJsonContent(prevMsg.content) || META_TYPES.has(prevMsg.type) || prevMsg.type === 'tool_result' || prevMsg.type === 'tool_use') {
            const moreFiles = extractFilePaths(prevMsg.content)
            for (const f of moreFiles) {
              if (!detectedFiles.includes(f)) detectedFiles.push(f)
            }
          }
          backtrackIndex--
        }

        return (
          <div key={msg.id} className={s.chatMessage}>
            <div className={s.chatMeta}>
              <span className={`${s.chatRole} ${msg.type === 'error' ? s.chatRoleError : s.chatRoleAssistant}`}>
                {roleLabel}
              </span>
              <span className={s.chatTimestamp}>
                {formatTimestamp(msg.timestamp)}
              </span>
            </div>
            <div className={s.chatContent}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {decodeUnicodeEscapes(msg.content)}
              </ReactMarkdown>
            </div>
            {/* File chips for detected file paths */}
            {detectedFiles.length > 0 && (
              <div className={s.chatFileChips}>
                {detectedFiles.map((fp, i) => (
                  <FileChip key={i} path={fp} sessionId={activeSessionId} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}
