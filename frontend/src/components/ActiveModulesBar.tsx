/**
 * ActiveModulesBar — displays selected modules as tags above the chat panel.
 * Remove button calls backend API to disable the module.
 */
import { useAgentStore } from '../store/agentStore'
import { useSession } from '../hooks/useSession'
import s from '../agent.module.css'

export function ActiveModulesBar() {
  const { activeSessionId, modules, getSelectedModules, toggleSelectedModule } = useAgentStore()
  const { disableModule } = useSession()
  const selected = getSelectedModules(activeSessionId)

  if (!activeSessionId || selected.length === 0) return null

  return (
    <div className={s.activeModulesBar}>
      <span className={s.activeModulesLabel}>▪ MODULES</span>
      <div className={s.activeModulesTags}>
        {selected.map((name) => {
          const mod = modules.find((m) => m.name === name)
          return (
            <span key={name} className={s.activeModuleTag}>
              {mod?.display_name || name}
              <button
                className={s.activeModuleTagClose}
                onClick={() => {
                  toggleSelectedModule(activeSessionId, name)
                  disableModule(activeSessionId, name)
                }}
                title="Remove module"
              >
                ×
              </button>
            </span>
          )
        })}
      </div>
    </div>
  )
}
