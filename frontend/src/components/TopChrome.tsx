/**
 * TopChrome — top bar matching the slides project's topbar style.
 * Shows: agent name, session info, model, turns, and status.
 */
import { useAgentStore } from '../store/agentStore'
import s from '../agent.module.css'

export function TopChrome() {
  const { activeSessionId, sessions, wsConnected, getActivePlugins } = useAgentStore()
  const session = sessions.find((x) => x.id === activeSessionId)
  const activePlugins = getActivePlugins(activeSessionId)

  return (
    <div className={s.topChrome}>
      <div>
        <b>MASUZU</b> · CTRL
      </div>
      <div className={s.topChromeSession}>
        SESSION{' '}
        <b>{session ? session.project_name.toUpperCase() : '—'}</b>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: '20px', alignItems: 'center' }}>
        <div>
          STATUS ·{' '}
          <b style={{ color: session?.status === 'running' ? 'var(--green)' : session?.status === 'error' ? 'var(--hazard)' : 'var(--phos-soft)' }}>
            {session?.status?.toUpperCase() || 'IDLE'}
          </b>
        </div>
        <div>
          PLUGINS · <b>{activePlugins.length}</b>
        </div>
        <div className={s.topChromeStatus}>
          <span
            className={s.liveDot}
            style={{
              background: wsConnected ? 'var(--green)' : 'var(--hazard)',
              boxShadow: wsConnected
                ? '0 0 8px rgba(74,246,38,0.5)'
                : '0 0 8px var(--hazard-glow)',
            }}
          />
          <span style={{ color: wsConnected ? 'var(--green)' : 'var(--hazard)' }}>
            {wsConnected ? 'CONNECTED' : 'OFFLINE'}
          </span>
        </div>
        <div>v0.1.0</div>
      </div>
    </div>
  )
}
