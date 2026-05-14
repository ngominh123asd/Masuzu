/**
 * Sidebar — modules, sessions (with ⋮ context menu), and file tree.
 * NEW SESSION button at top. Menu opens upward. Pinned sessions sort to top.
 */
import { useState, useRef, useEffect } from 'react'
import { useAgentStore } from '../store/agentStore'
import { useSession } from '../hooks/useSession'
import { ModuleSelector } from './ModuleSelector'
import { PluginPanel } from './PluginPanel'
import { FileTree } from './FileTree'
import s from '../agent.module.css'

export function Sidebar() {
  const {
    sessions, activeSessionId, showNewSessionDialog,
    setShowNewSessionDialog, togglePinSession,
  } = useAgentStore()
  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const isRunning = activeSession?.status === 'running'
  const { setActiveSession, deleteSession, createSession } = useSession()
  const [newName, setNewName] = useState('')
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const handleCreateSession = () => {
    if (showNewSessionDialog) {
      const name = newName.trim()
      if (name) {
        createSession(name)
        setNewName('')
      }
    } else {
      if (isRunning) return
      setShowNewSessionDialog(true)
    }
  }

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpenId) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpenId])

  // Sort: pinned first
  const sortedSessions = [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return 0
  })

  return (
    <div className={s.sidebar}>
      {/* PLUGINS */}
      <div className={s.sidebarSection}>
        <div className={s.sidebarHeader}>▪ PLUGINS</div>
        <div className={s.sidebarBody}>
          <PluginPanel />
        </div>
      </div>

      {/* SESSIONS */}
      <div className={s.sidebarSection}>
        <div className={s.sidebarHeader}>▪ SESSIONS</div>
        <div className={s.sidebarBody}>
          {/* NEW SESSION — at the top */}
          {showNewSessionDialog ? (
            <div style={{ marginBottom: 8 }}>
              <input
                className={s.dialogInput}
                placeholder="Project name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateSession()
                  if (e.key === 'Escape') setShowNewSessionDialog(false)
                }}
                autoFocus
                style={{ marginBottom: 6 }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button className={s.btnNew} onClick={handleCreateSession}>
                  CREATE
                </button>
                <button
                  className={s.btnNew}
                  onClick={() => setShowNewSessionDialog(false)}
                  style={{ borderColor: 'var(--phos-mute)' }}
                >
                  ESC
                </button>
              </div>
            </div>
          ) : (
            <button 
              className={`${s.btnNew} ${isRunning ? s.disabledAction : ''}`} 
              onClick={handleCreateSession} 
              style={{ marginBottom: 8 }}
              disabled={isRunning}
            >
              + NEW SESSION
            </button>
          )}

          {/* Session list */}
          {sortedSessions.map((session) => {
            const isActive = session.id === activeSessionId
            const isMenuOpen = menuOpenId === session.id
            const dotClass =
              session.status === 'running' ? s.sessionDotRunning :
              session.status === 'error' ? s.sessionDotError :
              s.sessionDotIdle
            return (
              <div
                key={session.id}
                className={`${s.sessionItem} ${isActive ? s.sessionItemActive : ''} ${isRunning && !isActive ? s.disabledAction : ''}`}
                onClick={() => {
                  if (isRunning && !isActive) return
                  setActiveSession(session.id)
                }}
              >
                <span className={`${s.sessionDot} ${dotClass}`} />
                {session.pinned && <span className={s.sessionPinIcon}>▸</span>}
                <span className={s.sessionName}>{session.project_name}</span>

                {/* ⋮ menu */}
                <div className={s.sessionMenuWrap} ref={isMenuOpen ? menuRef : undefined}>
                  <button
                    className={`${s.sessionMenuBtn} ${isRunning ? s.disabledAction : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (isRunning) return
                      setMenuOpenId(isMenuOpen ? null : session.id)
                    }}
                    disabled={isRunning}
                  >
                    ⋮
                  </button>

                  {isMenuOpen && (
                    <div className={s.sessionMenu}>
                      <button
                        className={s.sessionMenuItem}
                        onClick={(e) => {
                          e.stopPropagation()
                          togglePinSession(session.id)
                          setMenuOpenId(null)
                        }}
                      >
                        <span className={s.sessionMenuIcon}>
                          {session.pinned ? '—' : '▸'}
                        </span>
                        {session.pinned ? 'Bỏ ghim' : 'Ghim'}
                      </button>
                      <div className={s.sessionMenuDivider} />
                      <button
                        className={`${s.sessionMenuItem} ${s.sessionMenuItemDanger}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setMenuOpenId(null)
                          // Use setTimeout to ensure menu DOM is removed before confirm blocks
                          setTimeout(() => {
                            deleteSession(session.id)
                          }, 0)
                        }}
                      >
                        <span className={s.sessionMenuIcon}>×</span>
                        Xóa
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* FILE TREE */}
      <div className={s.sidebarSection} style={{ flex: 1 }}>
        <div className={s.sidebarHeader}>▪ FILES</div>
        <div className={s.sidebarBody}>
          <FileTree />
        </div>
      </div>
    </div>
  )
}
