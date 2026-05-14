/**
 * ToolCallView — displays tool call cards with terminal-style output.
 * Bash: command + output in dark terminal box
 * File ops: name + content preview, with clickable file chip
 * Status badge: RUNNING (blink) / SUCCESS (green) / ERROR (red)
 */
import { useState, useCallback, useMemo } from 'react'
import { useAgentStore, type AgentMessage } from '../store/agentStore'
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

interface Props {
  message: AgentMessage
}

const TOOL_ICONS: Record<string, string> = {
  bash: '$',
  Bash: '$',
  Read: '◇',
  read_file: '◇',
  Write: '◆',
  write_file: '◆',
  Edit: '✎',
  edit_file: '✎',
  MultiEdit: '✎',
  Search: '⌕',
  search: '⌕',
  Grep: '⌕',
  Task: '▶',
  default: '⚙',
}

/** File-producing tools */
const FILE_TOOLS = new Set([
  'Write', 'write_file', 'Edit', 'edit_file', 'MultiEdit',
  'Read', 'read_file',
])

export function ToolCallView({ message }: Props) {
  const [expanded, setExpanded] = useState(false)
  const { activeSessionId, openPreview } = useAgentStore()

  const toolName = message.tool || 'tool'
  const icon = TOOL_ICONS[toolName] || TOOL_ICONS.default
  const statusText = message.status || (message.type === 'tool_use' ? 'running' : 'success')

  const badgeClass =
    statusText === 'running' ? s.badgeRunning :
    statusText === 'error' ? s.badgeError :
    s.badgeSuccess

  // Extract file path from the tool input (if parsed) or try to parse from raw content
  const extractFilePath = () => {
    if (message.input?.file_path || message.input?.path || message.input?.filePath) {
      return message.input?.file_path || message.input?.path || message.input?.filePath
    }
    // If streaming raw JSON, try to regex extract file_path
    if (typeof message.content === 'string') {
      const m = message.content.match(/"(?:file_path|path|filePath)"\s*:\s*"([^"]+)"/)
      if (m) return m[1]
    }
    return null
  }
  const filePath = extractFilePath()

  const fileName = filePath ? filePath.split('/').pop() || filePath : null

  // If we don't have message.input, we are likely streaming raw JSON
  const isStreamingRaw = !message.input && typeof message.content === 'string'

  const lineCount = useMemo(() => {
    if (!isStreamingRaw) return 0
    return (message.content.match(/\\n|\n/g) || []).length
  }, [message.content, isStreamingRaw])

  const renderStreamingContent = () => {
    if (!isStreamingRaw) return message.content
    // Try to extract the actual content being written
    const contentMatch = message.content.match(/"(?:content|file_contents|command)"\s*:\s*"([\s\S]*)/)
     if (contentMatch) {
       // Keep escaped newlines so streaming stays on one line
       return decodeUnicodeEscapes(contentMatch[1].replace(/\r?\n/g, '').replace(/\\"/g, '"'))
     }
     return decodeUnicodeEscapes(message.content.replace(/\r?\n/g, ''))
  }

  const handleFileClick = useCallback(async () => {
    if (!filePath || !activeSessionId) return
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${activeSessionId}/files/${filePath}`)
      if (res.ok) {
        const data = await res.json()
        openPreview(filePath, data.content || '', fileName || filePath)
      }
    } catch (e) {
      console.error('Failed to fetch file for preview:', e)
    }
  }, [filePath, activeSessionId, openPreview, fileName])

  const isFileTool = FILE_TOOLS.has(toolName) && filePath

  return (
    <div className={s.toolCard}>
      <div className={s.toolCardHeader} onClick={() => setExpanded(!expanded)}>
        <span className={s.toolCardIcon}>{icon}</span>
        <span className={s.toolCardName}>
          {toolName} {isStreamingRaw && FILE_TOOLS.has(toolName) && lineCount > 0 && <span style={{fontSize: 10, opacity: 0.7, marginLeft: 4}}>({lineCount} lines)</span>}
        </span>
        {/* File chip — clickable to open preview */}
        {isFileTool && (
          <button
            className={s.fileChip}
            onClick={(e) => { e.stopPropagation(); handleFileClick() }}
            title={`Preview ${filePath}`}
          >
            <span className={s.fileChipIcon}>📄</span>
            <span className={s.fileChipName}>{fileName}</span>
          </button>
        )}
        <span className={`${s.toolCardBadge} ${badgeClass}`}>
          {statusText.toUpperCase()}
        </span>
        <span className={s.mute} style={{ fontSize: 10 }}>
          {expanded ? '▾' : '▸'}
        </span>
      </div>
      {expanded && (
        <div className={s.toolCardBody}>
          {toolName === 'bash' || toolName === 'Bash' ? (
            <div className={s.terminalBox}>
              {message.input?.command && (
                <div style={{ color: 'var(--green)', marginBottom: 8 }}>
                  $ {message.input.command}
                </div>
              )}
              <div>{isStreamingRaw ? renderStreamingContent() : decodeUnicodeEscapes(message.content)}</div>
            </div>
          ) : (
            <pre className={s.terminalBox}>
              {isStreamingRaw ? renderStreamingContent() : decodeUnicodeEscapes(message.content)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
