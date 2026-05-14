/**
 * PluginPanel — Browse, toggle, and import Claude CLI plugins.
 * Displays available plugins with activation toggles per-session.
 * Supports expanding to see plugin details (commands, agents, skills, hooks).
 * Import works by uploading plugin folders to the backend.
 */
import { useState, useRef } from 'react'
import { useAgentStore, PluginInfo } from '../store/agentStore'
import { useSession } from '../hooks/useSession'
import s from '../agent.module.css'

const CATEGORY_COLORS: Record<string, string> = {
  development: '#00e5ff',
  productivity: '#76ff03',
  security: '#ff1744',
  learning: '#ffea00',
  general: '#b0bec5',
}

function CategoryBadge({ category }: { category: string }) {
  const color = CATEGORY_COLORS[category] || CATEGORY_COLORS.general
  return (
    <span
      className={s.pluginBadge}
      style={{ borderColor: color, color }}
    >
      {category.toUpperCase()}
    </span>
  )
}

function PluginCard({
  plugin,
  isActive,
  onToggle,
  disabled,
}: {
  plugin: PluginInfo
  isActive: boolean
  onToggle: () => void
  disabled?: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const contents = [
    ...plugin.commands.map((c) => ({ type: 'CMD', name: `/${c}` })),
    ...plugin.agents.map((a) => ({ type: 'AGT', name: a })),
    ...plugin.skills.map((sk) => ({ type: 'SKL', name: sk })),
    ...plugin.hooks.map((h) => ({ type: 'HK', name: h })),
  ]

  return (
    <div className={`${s.pluginCard} ${isActive ? s.pluginCardActive : ''} ${expanded ? s.pluginCardActive : ''}`}>
      <div className={s.pluginCardHeader} onClick={() => setExpanded(!expanded)}>
        <div className={s.pluginCardInfo}>
          <div className={s.pluginCardName}>
            {expanded ? '▾' : '▸'} {plugin.name}
            {plugin.is_builtin && <span className={s.pluginBuiltinTag}>BUILTIN</span>}
          </div>
          <div className={s.pluginCardDesc}>{plugin.description}</div>
        </div>
        <div className={s.pluginCardActions} onClick={(e) => e.stopPropagation()}>
          <CategoryBadge category={plugin.category} />
          <button
            className={`${s.pluginToggle} ${isActive ? s.pluginToggleOn : ''} ${disabled ? s.disabledAction : ''}`}
            onClick={onToggle}
            title={isActive ? 'Deactivate' : 'Activate'}
            disabled={disabled}
          >
            <span className={s.pluginToggleKnob} />
          </button>
        </div>
      </div>

      {expanded && contents.length > 0 && (
        <div className={s.pluginCardBody}>
          {contents.map((item, i) => (
            <div key={i} className={s.pluginContentItem}>
              <span className={s.pluginContentType}>{item.type}</span>
              <span className={s.pluginContentName}>{item.name}</span>
            </div>
          ))}
          {plugin.has_mcp && (
            <div className={s.pluginContentItem}>
              <span className={s.pluginContentType}>MCP</span>
              <span className={s.pluginContentName}>.mcp.json configured</span>
            </div>
          )}
          <div className={s.pluginCardMeta}>
            v{plugin.version} {plugin.author && `· ${plugin.author}`}
          </div>
        </div>
      )}
    </div>
  )
}

export function PluginPanel() {
  const { plugins, activeSessionId, activePlugins, sessions } = useAgentStore()
  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const isRunning = activeSession?.status === 'running'
  const { activatePlugin, deactivatePlugin, importPlugin, refreshPlugins } = useSession()
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const folderInputRef = useRef<HTMLInputElement>(null)

  const sessionActivePlugins = activeSessionId
    ? (activePlugins[activeSessionId] || [])
    : []

  const handleToggle = (pluginName: string) => {
    if (!activeSessionId || isRunning) return
    if (sessionActivePlugins.includes(pluginName)) {
      deactivatePlugin(activeSessionId, pluginName)
    } else {
      activatePlugin(activeSessionId, pluginName)
      // Auto-populate chat input with the first plugin command
      const plugin = plugins.find((p) => p.name === pluginName)
      if (plugin && plugin.commands && plugin.commands.length > 0) {
        useAgentStore.getState().setDraftTask(`/${plugin.commands[0]} `)
      }
    }
  }

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setImporting(true)
    setImportError('')

    try {
      const success = await importPlugin(files)
      if (!success) {
        setImportError('Import failed — ensure folder has .claude-plugin/plugin.json')
      }
    } catch {
      setImportError('Import failed')
    } finally {
      setImporting(false)
      // Reset the input so the same folder can be selected again
      if (folderInputRef.current) folderInputRef.current.value = ''
    }
  }

  if (!activeSessionId) {
    return (
      <div className={s.pluginEmpty}>
        Select a session to manage plugins
      </div>
    )
  }

  return (
    <div className={s.pluginPanel}>
      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <button
          className={`${s.btnNew} ${(importing || isRunning) ? s.disabledAction : ''}`}
          onClick={() => folderInputRef.current?.click()}
          disabled={importing || isRunning}
          style={{ flex: 1 }}
        >
          {importing ? '⏳ IMPORTING...' : '+ IMPORT PLUGIN'}
        </button>
        <button
          className={`${s.btnNew} ${isRunning ? s.disabledAction : ''}`}
          onClick={refreshPlugins}
          disabled={isRunning}
          title="Rescan plugin directories"
          style={{ flex: 0, padding: '6px 10px' }}
        >
          ↻
        </button>
      </div>

      {/* Hidden folder input */}
      <input
        ref={folderInputRef}
        type="file"
        /* @ts-expect-error webkitdirectory is a non-standard attribute */
        webkitdirectory=""
        directory=""
        multiple
        style={{ display: 'none' }}
        onChange={handleFolderSelect}
      />

      {importError && <div className={s.pluginImportError}>{importError}</div>}

      {/* Plugin list */}
      <div className={s.pluginList}>
        {plugins.length === 0 ? (
          <div className={s.pluginEmpty}>No plugins available</div>
        ) : (
          plugins.map((plugin) => (
            <PluginCard
              key={plugin.name}
              plugin={plugin}
              isActive={sessionActivePlugins.includes(plugin.name)}
              onToggle={() => handleToggle(plugin.name)}
              disabled={isRunning}
            />
          ))
        )}
      </div>

      {/* Active count */}
      {sessionActivePlugins.length > 0 && (
        <div className={s.pluginActiveCount}>
          {sessionActivePlugins.length} plugin{sessionActivePlugins.length > 1 ? 's' : ''} active
        </div>
      )}
    </div>
  )
}
