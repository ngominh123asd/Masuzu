/**
 * ModuleSelector — toggle modules per session.
 * Calls backend API to enable/disable modules (writes rules to CLAUDE.md).
 */
import { useAgentStore } from '../store/agentStore'
import { useSession } from '../hooks/useSession'
import s from '../agent.module.css'

export function ModuleSelector() {
  const { modules, activeSessionId, getSelectedModules, toggleSelectedModule } = useAgentStore()
  const { enableModule, disableModule } = useSession()
  const selected = getSelectedModules(activeSessionId)

  return (
    <div>
      {modules.map((mod) => {
        const isActive = selected.includes(mod.name)
        return (
          <div
            key={mod.name}
            className={s.moduleItem}
            onClick={() => {
              if (!activeSessionId) return
              // Toggle local state
              toggleSelectedModule(activeSessionId, mod.name)
              // Call backend API to write CLAUDE.md
              if (isActive) {
                disableModule(activeSessionId, mod.name)
              } else {
                enableModule(activeSessionId, mod.name)
              }
            }}
          >
            <div className={`${s.moduleCheck} ${isActive ? s.moduleCheckActive : ''}`}>
              {isActive ? '✓' : ''}
            </div>
            <div>
              <div className={s.moduleName}>{mod.display_name}</div>
              <div className={s.moduleDesc}>{mod.description}</div>
            </div>
          </div>
        )
      })}
      {modules.length === 0 && (
        <div className={s.mute} style={{ fontSize: 11, padding: '8px 0' }}>
          No modules loaded
        </div>
      )}
    </div>
  )
}
