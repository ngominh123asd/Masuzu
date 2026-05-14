/**
 * TaskInput — task entry with controls, Run/Cancel buttons,
 * and file/image attachment support (paste, drag-drop, or pick).
 */
import { useState, useCallback, useRef, useEffect, useMemo, type KeyboardEvent, type DragEvent, type ClipboardEvent } from 'react'
import { Play, Square, Loader2, Paperclip, X, FileIcon, ImageIcon, Terminal } from 'lucide-react'
import { useAgentStore } from '../store/agentStore'
import { useSession } from '../hooks/useSession'
import s from '../agent.module.css'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

interface Props {
  onSendTask: (task: string, maxTurns: number, model?: string) => void
  onCancel: () => void
}

interface AttachedFile {
  file: File
  preview?: string  // data URL for images
}

const MODEL_OPTIONS = [
  { value: 'haiku', label: 'HAIKU', desc: 'Flash Lite' },
  { value: 'sonnet', label: 'SONNET', desc: 'Pro' },
  { value: 'opus', label: 'OPUS', desc: 'Max' },
] as const

const BUILT_IN_SLASH_COMMANDS = [
  { name: '/goal', desc: 'Set a persistent goal for the session' },
  { name: '/loop', desc: 'Run the agent proactively in a loop' },
  { name: '/proactive', desc: 'Alias for /loop' },
  { name: '/clear', desc: 'Clear the current conversation' },
  { name: '/compact', desc: 'Compact conversation to save tokens' },
  { name: '/ultrareview', desc: 'Cloud-hosted multi-agent code review' },
  { name: '/security-review', desc: 'Security review' },
  { name: '/help', desc: 'Show help' },
  { name: '/usage', desc: 'View token usage and cost' },
  { name: '/model', desc: 'Change the active model' },
  { name: '/effort', desc: 'Change the effort level' },
  { name: '/agents', desc: 'Manage background and configured agents' },
  { name: '/mcp', desc: 'Configure and manage MCP servers' },
  { name: '/plugin', desc: 'Manage plugins' },
  { name: '/branch', desc: 'Create a git branch' },
  { name: '/resume', desc: 'Resume a session' },
  { name: '/config', desc: 'Open configuration' },
]

const PLUGIN_COMMAND_DESCRIPTIONS: Record<string, string> = {
  '/new-sdk-app': 'Create a new Claude Agent SDK application',
  '/code-review': 'Run an automated code review on the current changes',
  '/plugin-dev:create-plugin': 'Guided end-to-end plugin creation workflow',
  '/hookify': 'Create a new custom hook interactively',
  '/hookify:list': 'List all active hookify rules',
  '/hookify:configure': 'Enable or disable hookify rules',
  '/hookify:help': 'Show help for hookify commands',
  '/pr-review-toolkit:review-pr': 'Run comprehensive PR review agents',
  '/commit': 'Create a git commit',
  '/commit-push-pr': 'Commit, push, and open a PR',
  '/clean_gone': 'Clean up merged git branches',
  '/feature-dev': 'Scaffold a new feature',
  '/ralph-loop': 'Start Ralph loop',
}

export function TaskInput({ onSendTask, onCancel }: Props) {
  const { activeSessionId, sessions, plugins, activePlugins, draftTask, setDraftTask } = useAgentStore()
  const { deactivatePlugin } = useSession()

  const [task, setTask] = useState('')

  // Derive command tags from active plugins
  const activeCommandTags = useMemo(() => {
    const activeNames = activeSessionId ? (activePlugins[activeSessionId] || []) : []
    return plugins
      .filter(p => activeNames.includes(p.name))
      .flatMap(p => {
        // Show the first command of the plugin as a tag
        if (p.commands && p.commands.length > 0) {
          const cmd = p.commands[0]
          return [cmd.startsWith('/') ? cmd : `/${cmd}`]
        }
        return []
      })
  }, [plugins, activePlugins, activeSessionId])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [maxTurns, setMaxTurnsLocal] = useState(150)
  const [model, setModelLocal] = useState('sonnet')

  const [showSlashCommands, setShowSlashCommands] = useState(false)
  const [filteredCommands, setFilteredCommands] = useState<typeof BUILT_IN_SLASH_COMMANDS>([])
  const [slashIndex, setSlashIndex] = useState(0)

  // Dynamic slash commands based on active plugins
  const allAvailableCommands = useMemo(() => {
    const activePluginNames = activeSessionId ? (activePlugins[activeSessionId] || []) : []
    const activePluginDetails = plugins.filter(p => activePluginNames.includes(p.name))
    
    const dynamicCommands = activePluginDetails.flatMap(p => 
      p.commands.map(cmd => {
        const name = cmd.startsWith('/') ? cmd : `/${cmd}`
        return {
          name,
          desc: `[${p.name}] ${PLUGIN_COMMAND_DESCRIPTIONS[name] || 'Plugin command'}`
        }
      })
    )
    
    return [...BUILT_IN_SLASH_COMMANDS, ...dynamicCommands]
  }, [plugins, activePlugins, activeSessionId])

  // Load session-specific settings when activeSessionId changes
  useEffect(() => {
    if (!activeSessionId) return
    const savedTurns = localStorage.getItem(`claude_maxTurns_${activeSessionId}`)
    setMaxTurnsLocal(savedTurns ? Number(savedTurns) : 150)
    
    const savedModel = localStorage.getItem(`claude_model_${activeSessionId}`)
    setModelLocal(savedModel || 'sonnet')
  }, [activeSessionId])

  // Support for draftTask (auto-populate from other components)
  useEffect(() => {
    if (draftTask) {
      if (draftTask.startsWith('/')) {
        const parts = draftTask.trim().split(' ')
        // If there was remaining text after the command, put it in the textarea
        if (parts.length > 1) {
          setTask(parts.slice(1).join(' '))
        } else {
          // If it was JUST a command, we don't need to put it in the textarea 
          // because it will be shown as a tag automatically if the plugin was activated.
        }
      } else {
        setTask(draftTask)
      }
      setDraftTask(null) // Consume the draft
    }
  }, [draftTask, setDraftTask])

  const handleRemoveTag = useCallback((tag: string) => {
    // Find the plugin that owns this command to deactivate it
    if (activeSessionId) {
      const tagNoSlash = tag.startsWith('/') ? tag.slice(1) : tag
      const plugin = plugins.find(p => p.commands.includes(tagNoSlash))
      if (plugin) {
        deactivatePlugin(activeSessionId, plugin.name)
      }
    }
  }, [activeSessionId, plugins, deactivatePlugin])

  // Wrap setters to also persist to localStorage per session
  const setMaxTurns = (v: number) => {
    setMaxTurnsLocal(v)
    if (activeSessionId) localStorage.setItem(`claude_maxTurns_${activeSessionId}`, String(v))
  }
  const setModel = (v: string) => {
    setModelLocal(v)
    if (activeSessionId) localStorage.setItem(`claude_model_${activeSessionId}`, v)
  }

  const session = sessions.find((x) => x.id === activeSessionId)
  const isRunning = session?.status === 'running'
  const currentModel = MODEL_OPTIONS.find((m) => m.value === model) || MODEL_OPTIONS[0]

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    if (dropdownOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [dropdownOpen])

  // Add files to attachment list
  const addFiles = useCallback((files: FileList | File[]) => {
    const newAttachments: AttachedFile[] = []
    for (const file of Array.from(files)) {
      const attached: AttachedFile = { file }
      if (file.type.startsWith('image/')) {
        attached.preview = URL.createObjectURL(file)
      }
      newAttachments.push(attached)
    }
    setAttachedFiles((prev) => [...prev, ...newAttachments])
  }, [])

  const removeFile = useCallback((index: number) => {
    setAttachedFiles((prev) => {
      const next = [...prev]
      if (next[index].preview) URL.revokeObjectURL(next[index].preview!)
      next.splice(index, 1)
      return next
    })
  }, [])

  // Upload files to workspace, return their paths
  const uploadFiles = useCallback(async (files: AttachedFile[]): Promise<string[]> => {
    if (!activeSessionId || files.length === 0) return []
    const paths: string[] = []
    for (const af of files) {
      const form = new FormData()
      form.append('file', af.file)
      form.append('directory', '')
      try {
        const res = await fetch(`${API_BASE}/api/sessions/${activeSessionId}/upload`, {
          method: 'POST',
          body: form,
        })
        const data = await res.json()
        paths.push(data.path)
      } catch (e) {
        console.error('Upload failed:', e)
      }
    }
    return paths
  }, [activeSessionId])

  const handleSend = useCallback(async () => {
    const trimmed = task.trim()
    const commandsPrefix = activeCommandTags.length > 0 ? activeCommandTags.join(' ') + ' ' : ''
    
    if ((!trimmed && attachedFiles.length === 0 && !commandsPrefix) || !activeSessionId) return

    let finalTask = commandsPrefix + trimmed

    // Upload attached files first
    if (attachedFiles.length > 0) {
      const paths = await uploadFiles(attachedFiles)
      if (paths.length > 0) {
        const fileList = paths.map((p) => `  - ${p}`).join('\n')
        const fileNote = `\n\n[Attached files uploaded to workspace:\n${fileList}\nPlease read and use these files.]`
        finalTask = (trimmed || 'Please review the attached files.') + fileNote
      }
      // Cleanup previews
      attachedFiles.forEach((af) => { if (af.preview) URL.revokeObjectURL(af.preview!) })
      setAttachedFiles([])
    }

    onSendTask(finalTask, maxTurns, model)
    setTask('')
  }, [task, maxTurns, model, activeSessionId, onSendTask, attachedFiles, uploadFiles])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (showSlashCommands && filteredCommands.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSlashIndex(i => (i + 1) % filteredCommands.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSlashIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length)
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          const cmd = filteredCommands[slashIndex]
          if (cmd) {
            const match = task.match(/(?:^|\s)(\/[a-z-]*)$/)
            if (match) {
              const before = task.slice(0, match.index! + (match[0].startsWith(' ') ? 1 : 0))
              setTask(before + cmd.name + ' ')
            } else {
              setTask(cmd.name + ' ')
            }
            setShowSlashCommands(false)
          }
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setShowSlashCommands(false)
          return
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend, showSlashCommands, filteredCommands, slashIndex, task],
  )

  // Paste handler — detect images from clipboard
  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items
      if (!items) return
      const imageFiles: File[] = []
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            imageFiles.push(new File([file], `paste-${Date.now()}.png`, { type: file.type }))
          }
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault()
        addFiles(imageFiles)
      }
    },
    [addFiles],
  )

  // Drag & drop handlers
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files)
    }
  }, [addFiles])

  if (!activeSessionId) return null

  return (
    <div
      className={`${s.taskInput} ${isDragOver ? s.taskInputDragOver : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Command Tags */}
      {activeCommandTags.length > 0 && (
        <div className={s.commandTags}>
          {activeCommandTags.map((tag) => (
            <div key={tag} className={s.commandTag}>
              <Terminal size={12} className={s.commandTagIcon} />
              <span>{tag}</span>
              <button className={s.commandTagRemove} onClick={() => handleRemoveTag(tag)}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Attached files preview */}
      {attachedFiles.length > 0 && (
        <div className={s.attachedFiles}>
          {attachedFiles.map((af, i) => (
            <div key={i} className={s.attachedFileItem}>
              {af.preview ? (
                <img src={af.preview} alt="" className={s.attachedFileThumb} />
              ) : (
                <span className={s.attachedFileIcon}><FileIcon size={16} /></span>
              )}
              <span className={s.attachedFileName}>{af.file.name}</span>
              <button className={s.attachedFileRemove} onClick={() => removeFile(i)}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={s.taskInputRow}>
        {/* Attach button */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.txt,.json,.csv,.html,.css,.js,.py,.md"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <button
          className={s.btnAttach}
          onClick={() => fileInputRef.current?.click()}
          disabled={isRunning}
          title="Attach file or image"
        >
          <Paperclip size={16} />
        </button>

        <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>
          {showSlashCommands && filteredCommands.length > 0 && (
            <div className={s.slashCommandMenu}>
              {filteredCommands.map((cmd, i) => (
                <div 
                  key={cmd.name} 
                  className={`${s.slashCommandItem} ${i === slashIndex ? s.slashCommandItemActive : ''}`}
                  onClick={() => {
                    const match = task.match(/(?:^|\s)(\/[a-z-]*)$/)
                    if (match) {
                      const before = task.slice(0, match.index! + (match[0].startsWith(' ') ? 1 : 0))
                      setTask(before + cmd.name + ' ')
                    } else {
                      setTask(cmd.name + ' ')
                    }
                    setShowSlashCommands(false)
                    document.querySelector<HTMLTextAreaElement>(`.${s.taskTextarea}`)?.focus?.()
                  }}
                  onMouseEnter={() => setSlashIndex(i)}
                >
                  <div className={s.slashCommandName}>{cmd.name}</div>
                  <div className={s.slashCommandDesc}>{cmd.desc}</div>
                </div>
              ))}
            </div>
          )}
          <textarea
            className={s.taskTextarea}
            value={task}
            onChange={(e) => {
              const val = e.target.value
              setTask(val)
              
              const match = val.match(/(?:^|\s)(\/[a-z-]*)$/)
              if (match) {
                const query = match[1].toLowerCase()
                const filtered = allAvailableCommands.filter(c => c.name.startsWith(query))
                if (filtered.length > 0) {
                  setFilteredCommands(filtered)
                  setShowSlashCommands(true)
                  setSlashIndex(0)
                } else {
                  setShowSlashCommands(false)
                }
              } else {
                setShowSlashCommands(false)
              }
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Enter task... (paste image or drag files)"
            rows={2}
            disabled={isRunning}
          />
        </div>
        {isRunning ? (
          <button className={s.btnCancel} onClick={onCancel}>
            <span className={s.spinnerIcon}>
              <Loader2 size={18} className={s.spinnerRing} />
              <Square size={8} className={s.spinnerStop} />
            </span>
            CANCEL
          </button>
        ) : (
          <button
            className={s.btnRun}
            onClick={handleSend}
            disabled={!task.trim() && attachedFiles.length === 0}
          >
            <Play size={14} fill="currentColor" />
            RUN
          </button>
        )}
      </div>
      <div className={s.taskControls}>
        <span className={s.taskControlLabel}>MAX TURNS</span>
        <input
          className={s.taskControlInput}
          type="number"
          min={1}
          max={200}
          value={maxTurns}
          onChange={(e) => setMaxTurns(Number(e.target.value))}
        />

        {/* Custom model dropdown */}
        <span className={s.taskControlLabel} style={{ marginLeft: 12 }}>MODEL</span>
        <div className={s.modelDropdown} ref={dropdownRef}>
          <button
            className={s.modelDropdownBtn}
            onClick={() => setDropdownOpen(!dropdownOpen)}
            type="button"
          >
            <span className={s.modelDropdownLabel}>{currentModel.label}</span>
            <span className={s.modelDropdownDesc}>{currentModel.desc}</span>
            <span className={s.modelDropdownArrow}>{dropdownOpen ? '▲' : '▼'}</span>
          </button>
          {dropdownOpen && (
            <div className={s.modelDropdownMenu}>
              {MODEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`${s.modelDropdownItem} ${model === opt.value ? s.modelDropdownItemActive : ''}`}
                  onClick={() => {
                    setModel(opt.value)
                    setDropdownOpen(false)
                  }}
                  type="button"
                >
                  <span className={s.modelDropdownItemLabel}>{opt.label}</span>
                  <span className={s.modelDropdownItemDesc}>{opt.desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
