/**
 * App — Main layout for Masuzu Agent Platform.
 * Brutalist CRT terminal aesthetic.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ TOPBAR                                                     │
 * ├──────────┬────────────────────────────┬─────────────────────┤
 * │ SIDEBAR  │  CHAT PANEL               │  FILE PREVIEW PANEL │
 * │          │  Messages + Tool cards     │  (conditional)      │
 * │ Plugins  │                            │                     │
 * │ Sessions │  TASK INPUT               │                     │
 * │ Files    │                            │                     │
 * ├──────────┴────────────────────────────┴─────────────────────┤
 * │ STATUSBAR                                                   │
 * └─────────────────────────────────────────────────────────────┘
 */
import { useAgentStore } from './store/agentStore'
import { useWebSocket } from './hooks/useWebSocket'
import { TopChrome } from './components/TopChrome'
import { StatusBar } from './components/StatusBar'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { TaskInput } from './components/TaskInput'
import { ActiveModulesBar } from './components/ActiveModulesBar'
import { FilePreviewPanel } from './components/FilePreviewPanel'
import s from './agent.module.css'

export default function App() {
  const { activeSessionId } = useAgentStore()
  const { sendTask, cancelTask } = useWebSocket(activeSessionId)

  return (
    <div className={s.appLayout}>
      <TopChrome />
      <div className={s.mainArea}>
        <Sidebar />
        <div className={s.mainPanel}>
          <ActiveModulesBar />
          <ChatPanel />
          <TaskInput onSendTask={sendTask} onCancel={cancelTask} />
        </div>
      </div>
      <StatusBar />
      <FilePreviewPanel />
    </div>
  )
}
