/**
 * StatusBar — bottom bar with WebSocket status, token count, serial.
 */
import { useAgentStore } from '../store/agentStore'
import s from '../agent.module.css'

export function StatusBar() {
  const { wsConnected, messages, activeSessionId } = useAgentStore()

  const toolUseCount = messages.filter((m) => m.type === 'tool_use').length
  const messageCount = messages.length

  return (
    <div className={s.botBar}>
      <div className={s.botBarSeg}>
        <span>
          WS{' '}
          <span
            className={s.liveDot}
            style={{
              background: wsConnected ? 'var(--green)' : 'var(--phos-mute)',
              boxShadow: wsConnected ? '0 0 6px rgba(74,246,38,0.4)' : 'none',
              display: 'inline-block',
              verticalAlign: 'middle',
              marginLeft: 4,
            }}
          />
        </span>
        <span>
          MSGS <b>{messageCount}</b>
        </span>
        <span>
          TOOLS <b>{toolUseCount}</b>
        </span>
      </div>
      <div className={s.botBarSeg}>
        <span>
          SERIAL <b>{activeSessionId?.toUpperCase() || '—'}</b>
        </span>
        <span>MASUZU · 2026</span>
      </div>
    </div>
  )
}
